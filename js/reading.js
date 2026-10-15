// ===== 실시간 판독 =====
// 가마 설정의 인식 방식(OCR / 7세그먼트)에 따라 엔진을 골라 현재 프레임을 판독하고, 기록 화면에 현재 인식값·신뢰도·상태 표시.
// OCR은 오래 걸리므로 한 번에 하나만 실행하고, 가마·설정이 바뀌거나 카메라가 꺼진 뒤 늦게 끝난 결과는 버림

import {
  READ_MAX_W, CONF_HIGH, CONF_LOW, JUMP_WARN_DEG, JUMP_COMPARE_MS, FRAME_SETTLE_MS
} from './config.js?v=0.3.4';
import { kilnSourceRegion, frameBlockReason } from './roi.js?v=0.3.4';
import { recognize } from './recognizer.js?v=0.3.4';
import { judgeOcr } from './ocr.js?v=0.3.4';
import { variantOrder } from './ocrPreprocess.js?v=0.3.4';

export const ENGINE_LABELS = { ocr: 'OCR', sevenSegment: '7세그먼트' };

// 가마의 인식 방식 (저장된 값이 없으면 OCR)
export function recognitionMode(kiln) {
  return kiln && kiln.recognitionMode === 'sevenSegment' ? 'sevenSegment' : 'ocr';
}

/**
 * 현재 프레임 7세그먼트 판독
 * @returns {{ result: object|null, reason: string|null }} 읽을 수 없으면 result=null, reason에 이유
 */
export function readKilnFrame(camera, kiln) {
  const block = frameBlockReason(kiln, camera);
  if (block) return { result: null, reason: block };
  const size = camera.videoSize();
  const src = kilnSourceRegion(kiln, size.width, size.height);
  const W = Math.max(8, Math.round(Math.min(src.w, READ_MAX_W)));
  const H = Math.max(8, Math.round(src.h * W / src.w));
  const img = camera.grabRegion(src, W, H);
  if (!img) return { result: null, reason: '영상을 읽지 못했습니다.' };
  return { result: recognize(img, kiln), reason: null };
}

// 신뢰도 → 표시 문자열과 색 구분
export function confidenceText(conf) {
  return Math.round(conf * 100) + '%';
}
export function confidenceLevel(conf) {
  if (conf >= CONF_HIGH) return 'high';
  if (conf >= CONF_LOW) return 'mid';
  return 'low';
}

// 판독하지 못한 상태 결과. status: 'blocked'(가마·카메라·영역 없음) | 'waiting'(영상 준비 중)
//   | 'engineLoading' | 'engineError' | 'error'(인식 중 오류) | 'fail'(숫자 판독 실패)
function statusResult(engine, status, reason) {
  return { ok: false, temp: null, value: null, confidence: null, digits: [], engine, status, reason };
}

// 판독 결과가 의미 있는 결과(성공/숫자 판독 실패)인지
export function isReadResult(res) {
  return !!res && (res.status === 'ok' || res.status === 'fail');
}

// 기록 화면 상태 줄 문구
export function activityText(a) {
  if (a.engine !== 'ocr') return '실시간 판독';
  if (a.engineState === 'loading') return '숫자 인식 엔진 준비 중';
  if (a.engineState === 'error') return '엔진 오류';
  if (a.busy) return '인식 중…';
  return '대기';
}

/**
 * 판독 조정기
 * @param {{ camera: object, ocr: object, preprocessor: object, getKiln: Function,
 *   onResult: Function, onActivity: Function }} deps
 *   onResult(result): 새 판독 결과(또는 판독할 수 없는 상태), onActivity(): 인식 중 여부·엔진 상태가 바뀜
 */
export function createReader(deps) {
  const { camera, ocr } = deps;
  let busy = false;          // OCR 진행 중
  let generation = 0;        // 가마·설정 변경, 카메라 중지 때마다 증가 → 그 전에 시작한 OCR 결과는 버림
  let lastStartAt = 0;       // 마지막 OCR 시작 시각
  let settleKey = '';        // 영상 크기가 확정됐는지 확인용
  let settleAt = 0;
  const lastGood = new Map(); // 가마 id → 직전 판독 성공 { temp, at } (비교용으로만 사용)

  function now() {
    return (window.performance && performance.now) ? performance.now() : Date.now();
  }

  function activity() {
    return {
      engine: recognitionMode(deps.getKiln()),
      busy,
      engineState: ocr.state(),
      engineMessage: ocr.message()
    };
  }

  function publish(res) {
    deps.onResult(res);
  }

  // 직전 판독값과 비교만 해서 크게 바뀌었으면 표시 (온도를 바꾸거나 이전 값으로 대체하지 않음)
  function markJump(res, kilnId) {
    if (!res.ok) return res;
    const t = Date.now();
    const prev = lastGood.get(kilnId);
    if (prev && t - prev.at <= JUMP_COMPARE_MS) {
      res.prevTemp = prev.temp;
      res.delta = res.temp - prev.temp;
      res.jump = Math.abs(res.delta) > JUMP_WARN_DEG;
    }
    lastGood.set(kilnId, { temp: res.temp, at: t });
    return res;
  }

  // 카메라 시작·회전 직후 영상 크기가 확정될 때까지 기다림
  function frameSettled() {
    const size = camera.videoSize();
    const key = size.width + 'x' + size.height;
    if (key !== settleKey) {
      settleKey = key;
      settleAt = Date.now();
    }
    return Date.now() - settleAt >= FRAME_SETTLE_MS;
  }

  function readSevenSegment(k) {
    const read = readKilnFrame(camera, k);
    if (!read.result) return statusResult('sevenSegment', 'fail', read.reason);
    const r = read.result;
    r.engine = 'sevenSegment';
    r.status = r.ok ? 'ok' : 'fail';
    return markJump(r, k.id);
  }

  // OCR 한 번: 기본 전처리로 먼저 읽고, 실패했을 때만 다른 전처리를 차례로 시험
  async function runOcr(k) {
    busy = true;
    lastStartAt = Date.now();
    const gen = generation;
    const kilnId = k.id;
    deps.onActivity();
    const t0 = now();
    const attempts = [];
    let result = null;
    let source = null;
    try {
      const frame = deps.preprocessor.prepare(k);
      if (!frame) {
        result = statusResult('ocr', 'fail', '영상을 읽지 못했습니다.');
      } else {
        source = frame.source;
        const order = variantOrder(k);
        for (let i = 0; i < order.length; i++) {
          const built = deps.preprocessor.build(frame, order[i], k);
          const out = await ocr.recognize(built.canvas);
          if (gen !== generation) break;
          result = judgeOcr(out.rawText, out.confidence, k.digits);
          result.variant = order[i];
          result.image = built.canvas;
          result.otsu = built.otsu;
          result.threshold = built.threshold;
          attempts.push({ variant: order[i], rawText: out.rawText, confidence: out.confidence, ok: result.ok, reason: result.reason });
          if (result.ok) break;
        }
      }
    } catch (err) {
      result = statusResult('ocr', 'error', '인식 중 오류가 발생했습니다.' + (err && err.message ? ' (' + err.message + ')' : ''));
    }
    busy = false;

    // 그사이 가마·설정이 바뀌었거나 카메라가 꺼졌으면 늦게 끝난 결과를 버림
    const cur = deps.getKiln();
    const stale = gen !== generation || !result || !camera.isRunning() ||
      !cur || cur.id !== kilnId || recognitionMode(cur) !== 'ocr';
    if (!stale) {
      result.elapsedMs = Math.round(now() - t0);
      result.attempts = attempts;
      result.source = source;
      publish(markJump(result, kilnId));
    }
    deps.onActivity();
  }

  // 주기적으로 호출. 7세그먼트는 매번 판독, OCR은 이전 작업이 끝났고 판독 주기가 지났을 때만 시작
  function tick() {
    if (document.hidden) return;
    const k = deps.getKiln();
    const engine = recognitionMode(k);
    const block = frameBlockReason(k, camera);
    if (block) {
      settleKey = '';
      publish(statusResult(engine, 'blocked', block));
      return;
    }
    if (!frameSettled()) {
      publish(statusResult(engine, 'waiting', '영상 준비 중'));
      return;
    }
    if (engine === 'sevenSegment') {
      publish(readSevenSegment(k));
      return;
    }

    if (ocr.state() === 'idle') ocr.init();
    const st = ocr.state();
    if (st === 'loading') {
      publish(statusResult('ocr', 'engineLoading', '숫자 인식 엔진 준비 중'));
      return;
    }
    if (st === 'error') {
      publish(statusResult('ocr', 'engineError', ocr.message()));
      return;
    }
    if (st !== 'ready' || busy) return;
    if (Date.now() - lastStartAt < k.readIntervalSec * 1000) return;
    runOcr(k);
  }

  // 진행 중인 OCR 결과를 버리고 다음 판독을 바로 허용 (가마 설정·영역 변경, 카메라 중지 시)
  function invalidate() {
    generation++;
    lastStartAt = 0;
  }

  // 다른 가마로 바뀜: 이전 가마 결과를 지우고 처음부터
  function reset() {
    invalidate();
    settleKey = '';
    publish(statusResult(recognitionMode(deps.getKiln()), 'waiting', '판독 대기 중'));
    deps.onActivity();
  }

  // 판독 주기를 기다리지 않고 바로 판독 (이전 OCR이 진행 중이면 끝난 뒤 다음 확인 때)
  function requestNow() {
    lastStartAt = 0;
    tick();
  }

  return { tick, invalidate, reset, requestNow, activity };
}

/**
 * 기록 화면의 현재 인식값 표시
 * @param {{ liveTemp: HTMLElement, liveConf: HTMLElement, liveReason: HTMLElement,
 *   liveEngine: HTMLElement, liveState: HTMLElement }} els
 */
export function createLiveDisplay(els) {
  // 인식값이 없거나 유효하지 않으면 온도를 표시하지 않음
  function show(res) {
    const ok = !!(res && res.ok);
    els.liveTemp.textContent = ok ? String(res.temp) : '—';
    els.liveTemp.classList.toggle('is-empty', !ok);

    if (isReadResult(res) && typeof res.confidence === 'number') {
      els.liveConf.textContent = confidenceText(res.confidence);
      els.liveConf.dataset.level = confidenceLevel(res.confidence);
    } else {
      els.liveConf.textContent = '—';
      delete els.liveConf.dataset.level;
    }

    // 이유 줄은 비워 둘 뿐 숨기지 않음: 줄이 생겼다 없어지면 아래 카메라 영상이 밀려 확대/이동 중인 손가락 아래에서 움직임
    let why = '';
    if (!ok) why = (res && res.reason) || '';
    else if (res.jump) why = '직전 판독값(' + res.prevTemp + '°C)보다 크게 바뀌었습니다. 확인 필요';
    els.liveReason.textContent = why;
  }

  function setActivity(a) {
    els.liveEngine.textContent = ENGINE_LABELS[a.engine];
    els.liveState.textContent = activityText(a);
    els.liveState.dataset.state = a.engine === 'ocr' && a.engineState === 'error' ? 'error' : (a.busy ? 'busy' : 'idle');
  }

  return { show, setActivity };
}
