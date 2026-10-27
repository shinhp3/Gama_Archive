// ===== OCR 입력 이미지 전처리 =====
// 원본 영상 프레임에서 ROI를 잘라(화면의 CSS 확대 상태와 무관) 확대하고, OCR이 읽기 쉬운 "흰 바탕 검은 숫자" 이미지를 만듦.
// 픽셀 계산은 DOM 없이 쓸 수 있는 순수 함수, canvas 처리는 createOcrPreprocessor에서만

import {
  OCR_TARGET_H, OCR_GRAB_MAX_H, OCR_PAD_RATIO, OCR_CLOSE_RATIO, OCR_THICKEN_RATIO, OCR_SATURATED_R, OCR_SATURATED_GB,
  OCR_VARIANTS, OCR_STABLE_READS, OCR_RESEEK_FAILS, OCR_MIN_CONTENT_H, OCR_FRAGMENT_WIDTH
} from './config.js?v=0.3.28';
import { otsuThreshold } from './recognizer.js?v=0.3.28';
import { kilnSourceRegion } from './roi.js?v=0.3.28';

// 전처리 방식 이름 (판독 보정 화면 표시용)
export const VARIANT_LABELS = {
  red: '빨간 LED 강조',
  lcd: '어두운 숫자 LCD 대비',
  gray: '일반 그레이스케일',
  bin: '이진화',
  binInv: '이진화 반전',
  contrast: '대비 조정 원본'
};

export function allOcrVariants() {
  return OCR_VARIANTS.slice();
}

function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

// OCR에 넘길 전처리 순서.
// 수동 선택이면 그 방식만. 자동에서 유지 중인 방식이 있으면 그것만. 아니면 후보 전체(탐색).
export function variantOrder(kiln, lockedVariant) {
  const pick = kiln && kiln.ocrPreprocess;
  if (pick && pick !== 'auto' && VARIANT_LABELS[pick] && OCR_VARIANTS.indexOf(pick) >= 0) return [pick];
  if (pick === 'contrast') return ['lcd'];
  if ((!pick || pick === 'auto') && lockedVariant && OCR_VARIANTS.indexOf(lockedVariant) >= 0) return [lockedVariant];
  return allOcrVariants();
}

/**
 * 전처리 자동 선택 상태 한 칸 진행.
 * 신뢰도(이미 ok로 걸러진 결과)와 여러 프레임에서 같은 숫자가 반복되는지를 함께 봄.
 * 서로 다른 숫자가 둘 다 안정되면 하나를 고르지 않음.
 * @param {{ pending: Object, failStreak: number }|null} prev
 * @param {Array<{ variant: string, ok: boolean, text: string, confidence: number }>} attempts
 * @param {string|null} lockedVariant 이미 유지 중인 방식. 없으면 탐색
 * @param {{ blockLock?: function(string): boolean }|null} [options]
 *   blockLock(text)가 참이면 그 문자열을 전처리 고정값으로 저장하지 않고 확인 필요로 둔다.
 * @returns {{ state: { pending: Object, failStreak: number }, action: string, variant: string|null, text: string, count: number, blocked?: boolean }}
 */
export function advanceVariantLock(prev, attempts, lockedVariant, options) {
  const pending = {};
  const prevPending = (prev && prev.pending) || {};
  Object.keys(prevPending).forEach((key) => { pending[key] = prevPending[key]; });
  let failStreak = prev && prev.failStreak ? prev.failStreak : 0;
  const oks = (attempts || []).filter((a) => a && a.ok && a.text);

  if (lockedVariant) {
    const hit = oks.filter((a) => a.variant === lockedVariant)[0];
    if (hit) {
      return { state: { pending: {}, failStreak: 0 }, action: 'use', variant: lockedVariant, text: hit.text, count: 0 };
    }
    failStreak += 1;
    if (failStreak >= OCR_RESEEK_FAILS) {
      return { state: { pending: {}, failStreak: 0 }, action: 'reseek', variant: null, text: '', count: 0 };
    }
    return { state: { pending, failStreak }, action: 'fail', variant: lockedVariant, text: '', count: 0 };
  }

  const texts = [];
  oks.forEach((a) => { if (texts.indexOf(a.text) < 0) texts.push(a.text); });
  // 한 프레임에서 전처리끼리 숫자가 다르면 어느 쪽도 정답으로 고정하지 않음
  if (texts.length >= 2) {
    return { state: { pending: {}, failStreak: 0 }, action: 'conflict', variant: null, text: '', count: 0, blocked: false };
  }

  const seen = {};
  oks.forEach((a) => {
    const before = pending[a.variant];
    const count = before && before.text === a.text ? before.count + 1 : 1;
    pending[a.variant] = { text: a.text, count, confidence: a.confidence || 0 };
    seen[a.variant] = true;
  });
  Object.keys(pending).forEach((key) => { if (!seen[key]) delete pending[key]; });
  const state = { pending, failStreak: 0 };

  const ranked = Object.keys(pending).map((variant) => ({
    variant,
    text: pending[variant].text,
    count: pending[variant].count,
    confidence: pending[variant].confidence
  })).sort((a, b) => b.count - a.count || b.confidence - a.confidence || (a.variant < b.variant ? -1 : 1));

  if (!ranked.length) {
    return { state, action: 'searching', variant: null, text: '', count: 0 };
  }
  const top = ranked[0];
  const conflict = ranked.some((r) => r.count >= OCR_STABLE_READS && r.text !== top.text);
  if (top.count >= OCR_STABLE_READS && conflict) {
    return { state, action: 'conflict', variant: top.variant, text: top.text, count: top.count };
  }
  if (top.count >= OCR_STABLE_READS) {
    if (options && typeof options.blockLock === 'function' && options.blockLock(top.text)) {
      return { state, action: 'conflict', variant: top.variant, text: top.text, count: top.count, blocked: true };
    }
    return { state: { pending: {}, failStreak: 0 }, action: 'lock', variant: top.variant, text: top.text, count: top.count };
  }
  return { state, action: 'searching', variant: top.variant, text: top.text, count: top.count };
}

// 일반 밝기
export function grayOf(data, n) {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    out[i] = Math.round(0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2]);
  }
  return out;
}

// 주변 픽셀이 배경보다 충분히 빨가면 true. 밤의 포화된 획 중심만 획으로 남기고, 혼자 흰 반사는 배경으로 둔다.
function neighborIsRed(excess, W, H, x, y, bg) {
  const y0 = Math.max(0, y - 6);
  const y1 = Math.min(H - 1, y + 6);
  const x0 = Math.max(0, x - 6);
  const x1 = Math.min(W - 1, x + 6);
  for (let yy = y0; yy <= y1; yy++) {
    const row = yy * W;
    for (let xx = x0; xx <= x1; xx++) {
      if (xx === x && yy === y) continue;
      if (excess[row + xx] - bg >= 28) return true;
    }
  }
  return false;
}

// 빨간 정도. 창 테두리의 공통 빨강을 빼서 낮 빛이 패널 전체에 더해진 값을 걷고, LED가 더한 빨강만 남긴다.
// 하얗게 포화된 점은 주변에 빨간 획이 있을 때만 숫자로 본다.
export function redScoreOf(data, W, H) {
  const n = W * H;
  const excess = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    excess[i] = data[j] - ((data[j + 1] + data[j + 2]) >> 1);
  }
  const bg = borderMedian(excess, W, H);
  const out = new Uint8Array(n);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const j = i * 4;
      const lifted = excess[i] - bg;
      if (data[j] >= OCR_SATURATED_R && data[j + 1] >= OCR_SATURATED_GB && data[j + 2] >= OCR_SATURATED_GB) {
        out[i] = neighborIsRed(excess, W, H, x, y, bg) ? 255 : 0;
      } else {
        out[i] = lifted > 8 ? clamp(Math.round(lifted), 0, 255) : 0;
      }
    }
  }
  return out;
}

function boxCropped(box, W, H) {
  return !!box && !box.keptFull && (box.w < W - 1 || box.h < H - 1);
}

// 회색으로 획이 안 보이면 빨강 점수의 범위를 쓴다. 어두운 LCD는 회색 범위를 유지한다.
export function chooseContentBox(gray, red, W, H) {
  const grayBox = contentBounds(gray, W, H);
  const redBox = contentBounds(red, W, H);
  const grayOn = boxCropped(grayBox, W, H);
  const redOn = boxCropped(redBox, W, H);
  if (redOn && !grayOn) return redBox;
  if (grayOn && !redOn) return grayBox;
  if (redOn && grayOn && redBox.w * redBox.h < grayBox.w * grayBox.h * 0.9) return redBox;
  return grayBox;
}

// Otsu 임계값 + 수동 보정으로 이진화. 1 = 숫자 픽셀. brightDigits=false면 어두운 픽셀이 숫자
export function binarize(score, brightDigits, offset) {
  const n = score.length;
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) hist[score[i]]++;
  const otsu = otsuThreshold(hist, n);
  const threshold = clamp(otsu + (offset || 0), 0, 255);
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const bright = score[i] > threshold;
    mask[i] = (brightDigits ? bright : !bright) ? 1 : 0;
  }
  return { mask, otsu, threshold };
}

// 한 방향(가로 또는 세로) 팽창/침식. 반경 r 안에 숫자 픽셀이 하나라도 있으면 / 모두 숫자 픽셀이면 1
function morph1d(src, W, H, r, horizontal, erode) {
  const out = new Uint8Array(W * H);
  const len = horizontal ? W : H;
  const lines = horizontal ? H : W;
  const pre = new Int32Array(len + 1);
  for (let l = 0; l < lines; l++) {
    const idx = (k) => (horizontal ? l * W + k : k * W + l);
    for (let k = 0; k < len; k++) pre[k + 1] = pre[k] + src[idx(k)];
    for (let k = 0; k < len; k++) {
      const a = Math.max(0, k - r);
      const b = Math.min(len - 1, k + r);
      const count = pre[b + 1] - pre[a];
      out[idx(k)] = erode ? (count === b - a + 1 ? 1 : 0) : (count > 0 ? 1 : 0);
    }
  }
  return out;
}

// 닫힘 연산(팽창 후 침식): 획 굵기는 거의 그대로 두고 세그먼트 사이의 좁은 틈을 메움
export function closeMask(mask, W, H, r) {
  if (r < 1) return mask;
  const dilated = morph1d(morph1d(mask, W, H, r, true, false), W, H, r, false, false);
  return morph1d(morph1d(dilated, W, H, r, true, true), W, H, r, false, true);
}

// 팽창: 획을 사방으로 r픽셀 굵힘 (가는 세그먼트가 이어져 OCR이 숫자 모양으로 읽기 쉬워짐)
export function thickenMask(mask, W, H, r) {
  if (r < 1) return mask;
  return morph1d(morph1d(mask, W, H, r, true, false), W, H, r, false, false);
}

// 숫자 마스크 → 흰 바탕 검은 숫자 RGBA
export function maskToRgba(mask) {
  const out = new Uint8ClampedArray(mask.length * 4);
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i] ? 0 : 255;
    const j = i * 4;
    out[j] = v;
    out[j + 1] = v;
    out[j + 2] = v;
    out[j + 3] = 255;
  }
  return out;
}

function borderMedian(gray, W, H) {
  const samples = [];
  const stepX = Math.max(1, Math.floor(W / 32));
  const stepY = Math.max(1, Math.floor(H / 32));
  for (let x = 0; x < W; x += stepX) {
    samples.push(gray[x]);
    samples.push(gray[(H - 1) * W + x]);
  }
  for (let y = 0; y < H; y += stepY) {
    samples.push(gray[y * W]);
    samples.push(gray[y * W + W - 1]);
  }
  samples.sort((a, b) => a - b);
  return samples[samples.length >> 1];
}

/**
 * 사용자가 맞춘 ROI 안에서 거의 비어 있는 테두리 좌표.
 * 화면 전체에서 숫자를 찾지 않고, 이미 지정된 사각형의 빈 여백만 걷어 숫자 높이를 유지한다.
 * 잉크가 거의 없으면 원본 사각형을 그대로 돌려준다.
 */
export function contentBounds(gray, W, H) {
  const full = { x: 0, y: 0, w: W, h: H };
  if (!gray || W < 8 || H < 8 || gray.length < W * H) return full;
  const bg = borderMedian(gray, W, H);
  const ink = new Uint8Array(W * H);
  let inkCount = 0;
  for (let i = 0; i < W * H; i++) {
    if (Math.abs(gray[i] - bg) >= 20) {
      ink[i] = 1;
      inkCount++;
    }
  }
  if (inkCount < Math.max(12, Math.round(W * H * 0.004))) return full;

  const rowMin = 2;
  const colMin = 2;
  const rowCount = (y) => {
    let c = 0;
    const row = y * W;
    for (let x = 0; x < W; x++) c += ink[row + x];
    return c;
  };
  const colCount = (x) => {
    let c = 0;
    for (let y = 0; y < H; y++) c += ink[y * W + x];
    return c;
  };
  let top = 0;
  let bottom = H - 1;
  let left = 0;
  let right = W - 1;
  while (top < bottom && rowCount(top) < rowMin) top++;
  while (bottom > top && rowCount(bottom) < rowMin) bottom--;
  while (left < right && colCount(left) < colMin) left++;
  while (right > left && colCount(right) < colMin) right--;
  // 숫자 바로 바깥의 작은 잉크(소수점)는 여백으로 잘라내지 않음. 빈 칸은 2칸까지만 건너뜀
  function expandSmall(at, step, countAt) {
    let cursor = at;
    let gap = 0;
    while (gap <= 2) {
      const n = cursor + step;
      const count = countAt(n);
      if (count == null) break;
      if (count >= 1 && count <= 4) {
        cursor = n;
        gap = 0;
      } else if (count === 0) {
        gap += 1;
        cursor = n;
      } else break;
    }
    while (cursor !== at) {
      if (countAt(cursor) >= 1) break;
      cursor -= step;
    }
    return cursor;
  }
  const countCol = (x) => (x < 0 || x >= W ? null : colCount(x));
  const countRow = (y) => (y < 0 || y >= H ? null : rowCount(y));
  left = expandSmall(left, -1, countCol);
  right = expandSmall(right, 1, countCol);
  top = expandSmall(top, -1, countRow);
  bottom = expandSmall(bottom, 1, countRow);
  const ch = bottom - top + 1;
  const cw = right - left + 1;
  if (ch < 8 || cw < 8) return { x: 0, y: 0, w: W, h: H, keptFull: true };
  // 잉크가 ROI의 얇은 조각뿐이면 그 조각만 확대해 한 자리로 읽히므로 사각형 전체를 유지
  if (cw < W * OCR_FRAGMENT_WIDTH) {
    return { x: 0, y: 0, w: W, h: H, keptFull: true };
  }
  const pad = Math.max(2, Math.round(ch * 0.12));
  const x = Math.max(0, left - pad);
  const y = Math.max(0, top - pad);
  const x2 = Math.min(W, right + 1 + pad);
  const y2 = Math.min(H, bottom + 1 + pad);
  return { x, y, w: x2 - x, h: y2 - y };
}

function meanOf(score) {
  let sum = 0;
  for (let i = 0; i < score.length; i++) sum += score[i];
  return score.length ? sum / score.length : 128;
}

// 밝기 하위 2%~상위 2%를 0~255로 늘린 흑백 RGBA. invert면 밝은 숫자를 검게 뒤집음
export function contrastRgba(gray, invert) {
  const n = gray.length;
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) hist[gray[i]]++;
  const cut = Math.floor(n * 0.02);
  let lo = 0;
  let hi = 255;
  for (let acc = 0; lo < 255; lo++) { acc += hist[lo]; if (acc > cut) break; }
  for (let acc = 0; hi > 0; hi--) { acc += hist[hi]; if (acc > cut) break; }
  const span = Math.max(1, hi - lo);
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    let v = clamp(Math.round((gray[i] - lo) * 255 / span), 0, 255);
    if (invert) v = 255 - v;
    const j = i * 4;
    out[j] = v;
    out[j + 1] = v;
    out[j + 2] = v;
    out[j + 3] = 255;
  }
  return out;
}

/**
 * 확대된 ROI 이미지 → 전처리 방식별 RGBA (흰 바탕 검은 숫자)
 * @param {{ width: number, height: number, data: Uint8ClampedArray }} img
 * @param {'red'|'gray'|'contrast'} variant
 * @param {{ polarity: string, thresholdOffset: number }} kiln
 */
function binaryVariant(score, W, H, brightDigits, offset) {
  const bin = binarize(score, brightDigits, offset);
  const closed = closeMask(bin.mask, W, H, Math.max(1, Math.round(H * OCR_CLOSE_RATIO)));
  const thick = thickenMask(closed, W, H, Math.max(1, Math.round(H * OCR_THICKEN_RATIO)));
  return { rgba: maskToRgba(thick), otsu: bin.otsu, threshold: bin.threshold };
}

export function processVariant(img, variant, kiln) {
  const W = img.width;
  const H = img.height;
  const n = W * H;
  const gray = grayOf(img.data, n);
  const offset = kiln.thresholdOffset;
  // 어두운 숫자 LCD: 대비를 늘리고 숫자(어두운 획)는 검게 유지
  if (variant === 'lcd' || variant === 'contrast') {
    return { rgba: contrastRgba(gray, false), otsu: null, threshold: null };
  }
  // 일반 그레이스케일: 배경이 어두우면(밝은 숫자) 뒤집어서 흰 바탕 검은 숫자로
  if (variant === 'gray') {
    return { rgba: contrastRgba(gray, meanOf(gray) < 128), otsu: null, threshold: null };
  }
  if (variant === 'red') {
    return binaryVariant(redScoreOf(img.data, W, H), W, H, true, offset);
  }
  if (variant === 'binInv') {
    return binaryVariant(gray, W, H, false, offset);
  }
  // bin: 밝은 숫자를 이진화
  return binaryVariant(gray, W, H, true, offset);
}

/**
 * canvas를 재사용하는 전처리기 (판독이 겹치지 않으므로 한 벌만 둠)
 * @param {object} camera camera.js의 카메라 객체
 */
export function createOcrPreprocessor(camera) {
  const sourceCanvas = document.createElement('canvas');   // 원본 프레임에서 잘라낸 ROI
  const sourceCtx = sourceCanvas.getContext('2d');
  const scaledCanvas = document.createElement('canvas');   // 확대한 ROI
  const scaledCtx = scaledCanvas.getContext('2d', { willReadFrequently: true });
  const outCanvases = {};                                  // 전처리 방식별 OCR 입력

  function sizeCanvas(c, w, h) {
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
  }

  /**
   * 현재 프레임에서 ROI를 잘라(회전 보정 포함) 확대 (실패 시 null)
   * @returns {{ source: HTMLCanvasElement, scaled: ImageData }|null}
   */
  function prepare(kiln) {
    const size = camera.videoSize();
    if (!kiln || !kiln.roi || !size.width || !size.height) return null;
    // 회전했으면 원본 프레임에서 회전 보정해 수평으로 편 영역 (화면 노란 틀 안과 같은 영역)
    const src = kilnSourceRegion(kiln, size.width, size.height);
    const grabH = Math.max(8, Math.min(Math.round(src.h), OCR_GRAB_MAX_H));
    const grabW = Math.max(8, Math.round(src.w * grabH / src.h));
    const img = camera.grabRegion(src, grabW, grabH);
    if (!img) return null;
    sizeCanvas(sourceCanvas, grabW, grabH);
    sourceCtx.putImageData(img, 0, 0);

    // 빈 여백을 걷어 숫자 높이가 OCR 입력 높이에 가깝게 한 뒤 확대/축소
    const pixels = grabW * grabH;
    const box = chooseContentBox(grayOf(img.data, pixels), redScoreOf(img.data, grabW, grabH), grabW, grabH);
    // 이미 목표 높이에 가까우면 한 번 더 키우거나 줄이지 않음
    const near = box.h >= OCR_TARGET_H * 0.75 && box.h <= OCR_TARGET_H * 1.5;
    const H = near ? box.h : OCR_TARGET_H;
    const W = Math.max(8, near ? box.w : Math.round(box.w * H / box.h));
    sizeCanvas(scaledCanvas, W, H);
    const smooth = kiln.ocrSmooth !== false;
    scaledCtx.imageSmoothingEnabled = smooth;
    if (smooth) scaledCtx.imageSmoothingQuality = 'high';
    scaledCtx.clearRect(0, 0, W, H);
    scaledCtx.drawImage(sourceCanvas, box.x, box.y, box.w, box.h, 0, 0, W, H);
    const contentH = box.h * (src.h / grabH);
    try {
      return {
        source: sourceCanvas,
        scaled: scaledCtx.getImageData(0, 0, W, H),
        sourceW: src.w,
        sourceH: src.h,
        contentH,
        keptFull: !!box.keptFull,
        lowQuality: contentH < OCR_MIN_CONTENT_H
      };
    } catch (e) {
      return null;
    }
  }

  /**
   * 전처리 방식 하나로 OCR 입력 canvas 생성 (상하좌우 흰 여백 포함)
   * @returns {{ canvas: HTMLCanvasElement, variant: string, otsu: number|null, threshold: number|null }}
   */
  function build(frame, variant, kiln) {
    const W = frame.scaled.width;
    const H = frame.scaled.height;
    const p = processVariant(frame.scaled, variant, kiln);
    const pad = Math.round(H * OCR_PAD_RATIO);
    let c = outCanvases[variant];
    if (!c) {
      c = document.createElement('canvas');
      outCanvases[variant] = c;
    }
    sizeCanvas(c, W + pad * 2, H + pad * 2);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.putImageData(new ImageData(p.rgba, W, H), pad, pad);
    return { canvas: c, variant, otsu: p.otsu, threshold: p.threshold };
  }

  return { prepare, build };
}
