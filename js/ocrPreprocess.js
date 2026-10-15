// ===== OCR 입력 이미지 전처리 =====
// 원본 영상 프레임에서 ROI를 잘라(화면의 CSS 확대 상태와 무관) 확대하고, OCR이 읽기 쉬운 "흰 바탕 검은 숫자" 이미지를 만듦.
// 픽셀 계산은 DOM 없이 쓸 수 있는 순수 함수, canvas 처리는 createOcrPreprocessor에서만

import {
  OCR_TARGET_H, OCR_PAD_RATIO, OCR_CLOSE_RATIO, OCR_THICKEN_RATIO, OCR_SATURATED_R, OCR_SATURATED_GB
} from './config.js?v=0.3.2';
import { otsuThreshold } from './recognizer.js?v=0.3.2';
import { roiToSource } from './roi.js?v=0.3.2';

// 전처리 방식 이름 (판독 보정 화면 표시용)
export const VARIANT_LABELS = {
  red: '빨간 LED 강조 이진화',
  gray: '흑백 이진화',
  contrast: '대비 조정 원본'
};

function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

// OCR에 넘길 전처리 순서. 자동이면 기본 방식 하나를 먼저 쓰고, 실패했을 때만 나머지를 차례로 시험
export function variantOrder(kiln) {
  const pick = kiln.ocrPreprocess;
  if (pick && pick !== 'auto' && VARIANT_LABELS[pick]) return [pick];
  return kiln.redLedMode ? ['red', 'gray', 'contrast'] : ['gray', 'contrast', 'red'];
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
export function processVariant(img, variant, kiln) {
  const W = img.width;
  const H = img.height;
  const n = W * H;
  const brightPolarity = kiln.polarity !== 'dark';
  if (variant === 'contrast') {
    return { rgba: contrastRgba(grayOf(img.data, n), brightPolarity), otsu: null, threshold: null };
  }
  const score = variant === 'red' ? redScoreOf(img.data, n) : grayOf(img.data, n);
  // 빨간 정도는 높을수록 LED이므로 숫자 극성과 관계없이 밝은 쪽이 숫자
  const bin = binarize(score, variant === 'red' ? true : brightPolarity, kiln.thresholdOffset);
  const closed = closeMask(bin.mask, W, H, Math.max(1, Math.round(H * OCR_CLOSE_RATIO)));
  const thick = thickenMask(closed, W, H, Math.max(1, Math.round(H * OCR_THICKEN_RATIO)));
  return { rgba: maskToRgba(thick), otsu: bin.otsu, threshold: bin.threshold };
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
   * 현재 프레임에서 ROI를 잘라 확대 (실패 시 null)
   * @returns {{ source: HTMLCanvasElement, scaled: ImageData }|null}
   */
  function prepare(kiln) {
    const size = camera.videoSize();
    if (!kiln || !kiln.roi || !size.width || !size.height) return null;
    const src = roiToSource(kiln.roi, size.width, size.height);
    const h0 = Math.max(8, Math.min(src.h, OCR_TARGET_H));
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
