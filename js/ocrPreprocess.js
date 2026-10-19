// ===== OCR 입력 이미지 전처리 =====
// 원본 영상 프레임에서 ROI를 잘라(화면의 CSS 확대 상태와 무관) 확대하고, OCR이 읽기 쉬운 "흰 바탕 검은 숫자" 이미지를 만듦.
// 픽셀 계산은 DOM 없이 쓸 수 있는 순수 함수, canvas 처리는 createOcrPreprocessor에서만

import {
  OCR_TARGET_H, OCR_PAD_RATIO, OCR_CLOSE_RATIO, OCR_THICKEN_RATIO, OCR_SATURATED_R, OCR_SATURATED_GB,
  OCR_VARIANTS, OCR_STABLE_READS, OCR_RESEEK_FAILS
} from './config.js?v=0.3.9';
import { otsuThreshold } from './recognizer.js?v=0.3.9';
import { kilnSourceRegion } from './roi.js?v=0.3.9';

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
 * @returns {{ state: { pending: Object, failStreak: number }, action: string, variant: string|null, text: string, count: number }}
 */
export function advanceVariantLock(prev, attempts, lockedVariant) {
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

// 빨간 정도: R - (G+B)/2. 빨간 LED 중심이 하얗게 포화되면(R·G·B 모두 높음) 이 값이 0이 되므로 최대값으로 처리
export function redScoreOf(data, n) {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    const r = data[j];
    const g = data[j + 1];
    const b = data[j + 2];
    out[i] = (r >= OCR_SATURATED_R && g >= OCR_SATURATED_GB && b >= OCR_SATURATED_GB)
      ? 255
      : clamp(Math.round(r - (g + b) / 2), 0, 255);
  }
  return out;
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
    return binaryVariant(redScoreOf(img.data, n), W, H, true, offset);
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
    const h0 = Math.max(8, Math.round(Math.min(src.h, OCR_TARGET_H)));
    const w0 = Math.max(8, Math.round(src.w * h0 / src.h));
    const img = camera.grabRegion(src, w0, h0);
    if (!img) return null;
    sizeCanvas(sourceCanvas, w0, h0);
    sourceCtx.putImageData(img, 0, 0);

    // ROI가 작으면 OCR 입력 높이까지 확대: 부드러운 보간(기본) 또는 최근접 이웃 (가마 설정에서 비교 가능)
    const H = OCR_TARGET_H;
    const W = Math.max(8, Math.round(w0 * H / h0));
    sizeCanvas(scaledCanvas, W, H);
    const smooth = kiln.ocrSmooth !== false;
    scaledCtx.imageSmoothingEnabled = smooth;
    if (smooth) scaledCtx.imageSmoothingQuality = 'high';
    scaledCtx.clearRect(0, 0, W, H);
    scaledCtx.drawImage(sourceCanvas, 0, 0, W, H);
    try {
      return { source: sourceCanvas, scaled: scaledCtx.getImageData(0, 0, W, H) };
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
