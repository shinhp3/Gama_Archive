// ===== 7세그먼트 판독기 =====
// DOM에 의존하지 않는 순수 함수 모음. ImageData(또는 같은 모양의 { width, height, data } 객체)를 받아 판독 결과를 반환

import { SEGMENTS, PATTERN_TO_DIGIT } from './config.js?v=0.3.2';

function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

// Otsu 방식: 두 집단(배경/숫자)의 분산이 가장 잘 갈리는 임계값을 히스토그램에서 계산
export function otsuThreshold(hist, total) {
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let best = -1;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

// 기울어진(이탤릭) 숫자를 세우기 위한 가로 전단 변환.
// + 각도는 위쪽이 오른쪽으로 기운 숫자를 보정 (위쪽 줄일수록 왼쪽으로 당김)
export function shearBinary(bin, W, H, skewDeg) {
  if (!skewDeg) return bin;
  const t = Math.tan(skewDeg * Math.PI / 180);
  const out = new Uint8Array(W * H);
  const cy = (H - 1) / 2;
  for (let y = 0; y < H; y++) {
    const shift = Math.round((cy - y) * t);
    const row = y * W;
    for (let x = 0; x < W; x++) {
      const sx = x + shift;
      if (sx >= 0 && sx < W) out[row + x] = bin[row + sx];
    }
  }
  return out;
}

// 세그먼트 하나의 신뢰도: 켜진 비율이 기준값에서 멀수록(명확할수록) 1에 가까움
export function segmentConfidence(ratio, th) {
  const d = ratio >= th ? (ratio - th) / (1 - th) : (th - ratio) / th;
  return clamp(d, 0, 1);
}

// 자릿수 셀 하나 판독 (cx0 ~ cx1: 셀의 가로 범위, 세로는 전체 높이)
export function readDigit(bin, W, H, cx0, cx1, onRatio) {
  const cw = Math.max(1, cx1 - cx0);
  const ratios = {};
  const on = {};
  const rects = {};
  let key = '';
  let confSum = 0;

  SEGMENTS.forEach((s) => {
    const x0 = cx0 + Math.floor(s.x0 * cw);
    const x1 = Math.min(W, Math.max(x0 + 1, cx0 + Math.ceil(s.x1 * cw)));
    const y0 = Math.floor(s.y0 * H);
    const y1 = Math.min(H, Math.max(y0 + 1, Math.ceil(s.y1 * H)));
    let count = 0;
    let total = 0;
    for (let y = y0; y < y1; y++) {
      const row = y * W;
      for (let x = x0; x < x1; x++) {
        count += bin[row + x];
        total++;
      }
    }
    const ratio = total ? count / total : 0;
    const isOn = ratio >= onRatio;
    ratios[s.id] = ratio;
    on[s.id] = isOn;
    rects[s.id] = { x0, y0, x1, y1 };
    if (isOn) key += s.id;
    confSum += segmentConfidence(ratio, onRatio);
  });

  let ch;
  let st;
  if (!key) {
    ch = ' ';
    st = 'blank';      // 아무 세그먼트도 안 켜짐 → 빈 자리
  } else if (PATTERN_TO_DIGIT[key]) {
    ch = PATTERN_TO_DIGIT[key];
    st = 'digit';
  } else {
    ch = '?';
    st = 'fail';       // 표에 없는 패턴
  }
  return {
    value: ch,              // 인식한 숫자 문자 (' ' = 빈 자리, '?' = 실패)
    char: ch,
    state: st,
    pattern: key,
    segmentRatios: ratios,  // 세그먼트별 켜진 픽셀 비율 (a~g)
    ratios,
    on,
    rects,
    cellX0: cx0,
    cellX1: cx1,
    confidence: confSum / SEGMENTS.length
  };
}

/**
 * ROI 이미지에서 7세그먼트 숫자를 판독
 * @param {{ width: number, height: number, data: Uint8ClampedArray }} imageData ROI만 잘라낸 RGBA 이미지
 * @param {{ digits: number, redLedMode: boolean, polarity: 'bright'|'dark', thresholdOffset: number,
 *           shear: number, segOnRatio: number }} kiln 가마 설정
 * @returns {{ temp: number|null, confidence: number, digits: Array<{ value: string, segmentRatios: object }>,
 *             ok: boolean, text: string, reason: string, binary: Uint8Array, width: number, height: number,
 *             otsu: number, threshold: number }}
 */
export function recognize(imageData, kiln) {
  const W = imageData.width;
  const H = imageData.height;
  const data = imageData.data;

  // 2. 그레이스케일 (빨간색 LED 모드면 R - (G+B)/2, 음수는 0)
  const n = W * H;
  const gray = new Uint8Array(n);
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    const r = data[j];
    const g = data[j + 1];
    const b = data[j + 2];
    let val = kiln.redLedMode ? r - (g + b) / 2 : 0.299 * r + 0.587 * g + 0.114 * b;
    val = clamp(Math.round(val), 0, 255);
    gray[i] = val;
    hist[val]++;
  }

  // 3. 이진화 (Otsu 자동 임계값 + 수동 보정, 어두운 숫자면 반전). 1 = 숫자(켜진 픽셀)
  const otsu = otsuThreshold(hist, n);
  const threshold = clamp(otsu + (kiln.thresholdOffset || 0), 0, 255);
  const darkDigits = kiln.polarity === 'dark';
  const bin = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const bright = gray[i] > threshold;
    bin[i] = (darkDigits ? !bright : bright) ? 1 : 0;
  }

  // 4. 기울기 보정 후 자릿수만큼 균등 분할
  const sheared = shearBinary(bin, W, H, kiln.shear || 0);
  const count = Math.max(1, kiln.digits || 1);
  const digits = [];
  for (let i = 0; i < count; i++) {
    const cx0 = Math.round(i * W / count);
    const cx1 = Math.round((i + 1) * W / count);
    // 5~6. 자릿수별 세그먼트 판독 → 숫자 변환
    digits.push(readDigit(sheared, W, H, cx0, cx1, kiln.segOnRatio));
  }

  // 7. 자릿수 합치기 (앞쪽 빈 자리만 허용)
  let text = '';
  let started = false;
  const failPos = [];
  const gapPos = [];
  let confSum = 0;
  digits.forEach((dg, idx) => {
    confSum += dg.confidence;
    if (dg.state === 'fail') {
      failPos.push(idx + 1);
      started = true;
    } else if (dg.state === 'blank') {
      if (started) gapPos.push(idx + 1);
    } else {
      started = true;
    }
    text += dg.char;
  });

  const res = {
    ok: false,
    temp: null,
    value: null,
    text,
    reason: '',
    // 8. 신뢰도: 자릿수별 신뢰도의 평균 (0~1)
    confidence: digits.length ? confSum / digits.length : 0,
    digits,
    binary: sheared,
    width: W,
    height: H,
    otsu,
    threshold
  };
  if (failPos.length) {
    res.reason = failPos.join(', ') + '번째 자리를 숫자로 인식하지 못했습니다.';
  } else if (gapPos.length) {
    res.reason = gapPos.join(', ') + '번째 자리가 비어 있습니다.';
  } else if (!started) {
    res.reason = '숫자가 감지되지 않았습니다.';
  } else {
    res.ok = true;
    res.value = parseInt(text.trim(), 10);
    res.temp = res.value;
  }
  return res;
}

/**
 * 판독 결과의 세그먼트 샘플 위치를 원래(기울기 보정 전) ROI 기준 비율 좌표의 사각형(평행사변형)으로 변환
 * 영상 위에 덧그려 샘플 위치가 숫자 획에 맞는지 눈으로 확인할 때 사용
 * @returns {Array<{ on: boolean, pts: Array<{x: number, y: number}> }>} pts: 왼쪽 위부터 시계 방향 4점 (0~1)
 */
export function segmentQuads(result, shearDeg) {
  const W = result.width;
  const H = result.height;
  const t = shearDeg ? Math.tan(shearDeg * Math.PI / 180) : 0;
  const cy = (H - 1) / 2;
  // 보정된 이미지의 x는 원본의 x + shift(y) 위치에서 가져온 값 (shearBinary 참고)
  const shift = (y) => (cy - y) * t;
  const quads = [];
  result.digits.forEach((dg) => {
    SEGMENTS.forEach((s) => {
      const r = dg.rects[s.id];
      const sTop = shift(r.y0);
      const sBottom = shift(r.y1);
      quads.push({
        on: !!dg.on[s.id],
        pts: [
          { x: (r.x0 + sTop) / W, y: r.y0 / H },
          { x: (r.x1 + sTop) / W, y: r.y0 / H },
          { x: (r.x1 + sBottom) / W, y: r.y1 / H },
          { x: (r.x0 + sBottom) / W, y: r.y1 / H }
        ]
      });
    });
  });
  return quads;
}
