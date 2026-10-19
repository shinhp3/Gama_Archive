// ===== 첫 판독까지 걸린 시간 =====
// 대기 상수를 줄이기 전에, 카메라·워커·첫 인식이 어디서 시간을 쓰는지 한 번씩 기록한다.
// 이미지는 저장하지 않는다.

const marks = [];

function now() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

// 같은 이름은 처음 한 번만 남긴다 (첫 카메라, 첫 OCR, 첫 유효 숫자).
export function markTiming(name, detail) {
  if (!name || marks.some((m) => m.name === name)) return;
  marks.push({
    name,
    t: now(),
    detail: detail == null || detail === '' ? '' : String(detail)
  });
}

export function timingMarks() {
  return marks.map((m) => ({ name: m.name, t: m.t, detail: m.detail }));
}

export function timingText() {
  if (!marks.length) return '아직 없음';
  const t0 = marks[0].t;
  return marks.map((m, i) => {
    const prev = i ? marks[i - 1].t : m.t;
    const step = Math.round(m.t - prev);
    const total = Math.round(m.t - t0);
    return m.name + '  구간 ' + step + 'ms · 누적 ' + total + 'ms' + (m.detail ? ' · ' + m.detail : '');
  }).join('\n');
}
