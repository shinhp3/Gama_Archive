// ===== 실시간 판독 =====
// 가마 설정의 인식 방식(OCR / 7세그먼트)에 따라 엔진을 골라 현재 프레임을 판독하고, 기록 화면에 현재 인식값·신뢰도·상태 표시.
// OCR은 오래 걸리므로 한 번에 하나만 실행하고, 가마·설정이 바뀌거나 카메라가 꺼진 뒤 늦게 끝난 결과는 버림

import {
  READ_MAX_W, CONF_HIGH, CONF_LOW, FRAME_SETTLE_MS, OCR_STABLE_READS, OCR_LANG, CONFIRM_INTERVAL_MS
} from './config.js?v=0.3.30';
import { markTiming } from './timings.js?v=0.3.30';
import { createValidatorState, validateReading } from './temperature-validator.js?v=0.3.30';
import { kilnSourceRegion, frameBlockReason } from './roi.js?v=0.3.30';
import { recognize } from './recognizer.js?v=0.3.30';
import { judgeOcr, formatTemp } from './ocr.js?v=0.3.30';
import { variantOrder, advanceVariantLock, VARIANT_LABELS } from './ocrPreprocess.js?v=0.3.30';

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
 *   onResult: Function, onActivity: Function, onLockVariant: Function }} deps
 *   onResult(result): 새 판독 결과(또는 판독할 수 없는 상태), onActivity(): 인식 중 여부·엔진 상태가 바뀜
 *   onLockVariant(variant|null): 자동으로 고른 전처리를 가마 설정에 저장 (null이면 다시 탐색)
 */
export function createReader(deps) {
  const { camera, ocr } = deps;
  let busy = false;          // OCR 진행 중
  let generation = 0;        // 가마·설정 변경, 카메라 중지 때마다 증가 → 그 전에 시작한 OCR 결과는 버림
  let lastStartAt = 0;       // 마지막 OCR 시작 시각
  let settleKey = '';        // 영상 크기가 확정됐는지 확인용
  let settleAt = 0;
  const validators = new Map(); // 가마 id → 시간 변화 검증 상태
  const searches = new Map();   // 가마 id → 전처리 탐색 상태 { pending, failStreak }

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

  // 인식 결과에 시간 변화 검증 결과(res.validation)를 붙임. res.temp는 인식한 원시값 그대로 둠
  // at: 판독한 프레임 시각 (Date.now 기준)
  function validate(res, kilnId, at) {
    const out = validateReading(validators.get(kilnId), {
      rawTemp: res.ok ? res.temp : null,
      confidence: typeof res.confidence === 'number' ? res.confidence : null,
      at
    });
    validators.set(kilnId, out.state);
    res.validation = out.result;
    return res;
  }

  // 지금 가마의 검증을 처음부터 다시 (급변 경고가 계속될 때 사용자가 표시창을 확인한 뒤 누름)
  function resetValidation() {
    const k = deps.getKiln();
    if (k) validators.set(k.id, createValidatorState());
  }

  // 카메라 시작·회전 직후 영상 크기가 확정될 때까지 기다림
  function frameSettled() {
    const size = camera.videoSize();
    const key = size.width + 'x' + size.height;
    if (key !== settleKey) {
      settleKey = key;
      settleAt = Date.now();
    }
    const settled = Date.now() - settleAt >= FRAME_SETTLE_MS;
    if (settled && size.width > 0) markTiming('videoSizeStable', size.width + 'x' + size.height);
    return settled;
  }

  function readSevenSegment(k) {
    const at = Date.now();
    const read = readKilnFrame(camera, k);
    if (!read.result) return validate(statusResult('sevenSegment', 'fail', read.reason), k.id, at);
    const r = read.result;
    r.engine = 'sevenSegment';
    r.status = r.ok ? 'ok' : 'fail';
    return validate(r, k.id, at);
  }

  function searchState(id) {
    let s = searches.get(id);
    if (!s) {
      s = { pending: {}, failStreak: 0 };
      searches.set(id, s);
    }
    return s;
  }

  function rememberLock(variant) {
    if (deps.onLockVariant) deps.onLockVariant(variant || null);
  }

  // 탐색 중에는 온도를 확정하지 않음. 진단용 후보는 남겨 둠
  function holdForSearch(result, reason, preprocessState) {
    result.ok = false;
    result.temp = null;
    result.value = null;
    result.status = 'fail';
    result.reason = reason;
    result.preprocessState = preprocessState;
    return result;
  }

  // OCR 한 번. 자동이면 후보 전처리를 비교해 같은 숫자가 이어질 때만 그 방식을 유지
  async function runOcr(k) {
    busy = true;
    lastStartAt = Date.now();
    const gen = generation;
    const kilnId = k.id;
    deps.onActivity();
    const t0 = now();
    const attempts = [];
    let judged = [];
    let result = null;
    let source = null;
    const manual = !!(k.ocrPreprocess && k.ocrPreprocess !== 'auto');
    const lockedVariant = manual ? null : (k.ocrLockedVariant || null);
    let lockToSave;
    try {
      const frame = deps.preprocessor.prepare(k);
      if (!frame) {
        result = statusResult('ocr', 'fail', '영상을 읽지 못했습니다.');
      } else {
        source = frame.source;
        const order = variantOrder(k, lockedVariant);
        for (let i = 0; i < order.length; i++) {
          const built = deps.preprocessor.build(frame, order[i], k);
          const out = await ocr.recognize(built.canvas);
          if (gen !== generation) break;
          const one = judgeOcr(out.rawText, out.confidence, out.words, out.symbols);
          one.variant = order[i];
          one.image = built.canvas;
          one.otsu = built.otsu;
          one.threshold = built.threshold;
          judged.push(one);
          attempts.push({
            variant: order[i],
            rawText: out.rawText,
            confidence: out.confidence,
            ok: one.ok,
            reason: one.reason,
            multiple: !!one.multiple,
            text: one.text
          });
        }
        if (gen === generation && judged.length) {
          result = judged[judged.length - 1];
          if (manual) {
            const hit = judged.filter((j) => j.ok)[0];
            result = hit || result;
            result.preprocessState = 'manual';
          } else {
            const decision = advanceVariantLock(searchState(kilnId), attempts, lockedVariant, {
              blockLock: (text) => {
                const digits = String(text || '').replace('.', '');
                if (frame.lowQuality) return true;
                return !!(frame.keptFull && digits.length <= 1);
              }
            });
            searches.set(kilnId, decision.state);
            const picked = judged.filter((j) => j.variant === decision.variant && (decision.action === 'use' || decision.action === 'lock' ? j.ok : true))[0] || result;
            result = picked;
            if (decision.action === 'lock') {
              result.preprocessState = 'locked';
              lockToSave = decision.variant;
            } else if (decision.action === 'use') {
              result.preprocessState = 'locked';
            } else if (decision.action === 'reseek') {
              lockToSave = null;
              const why = result.reason || '숫자를 찾지 못했습니다.';
              holdForSearch(result, why + ' 인식이 여러 번 실패해 전처리를 다시 찾습니다.', 'reseek');
            } else if (decision.action === 'conflict') {
              const whyConflict = decision.blocked
                ? (frame.lowQuality
                  ? '숫자 높이가 너무 낮습니다. 확정하지 않습니다. 숫자를 네모 안에 더 크게 맞추세요.'
                  : '넓은 영역에서 한 자리만 반복됩니다. 이 값을 온도로 확정하지 않습니다. 숫자 전체가 네모 안에 있는지 확인하세요.')
                : '전처리마다 다른 숫자가 나옵니다. 현재 온도 숫자만 네모 안에 있는지 확인하세요.';
              holdForSearch(result, whyConflict, 'conflict');
            } else if (decision.action === 'fail') {
              result.preprocessState = 'locked';
            } else if (decision.action === 'searching' && result.ok) {
              // 첫 성공도 검증 횟수에 넣어, 같은 숫자가 한 번 더 나오면 바로 기준이 되게 함
              result.preprocessState = 'searching';
            } else {
              const multi = judged.filter((j) => j.multiple)[0];
              let why;
              if (multi) why = multi.reason;
              else if (decision.variant) {
                why = '표시창에 맞는 전처리를 찾는 중입니다 (' +
                  (VARIANT_LABELS[decision.variant] || decision.variant) + ', ' +
                  decision.count + '/' + OCR_STABLE_READS + ').';
              } else why = '표시창에 맞는 전처리를 찾는 중입니다.';
              holdForSearch(result, why, 'searching');
            }
          }
        }
      }
      if (result && frame) {
        result.model = OCR_LANG;
        result.roiSource = {
          w: Math.round(frame.sourceW),
          h: Math.round(frame.sourceH),
          contentH: Math.round(frame.contentH)
        };
        result.lowQuality = !!frame.lowQuality;
        if (frame.lowQuality && (!result.reason || result.reason.indexOf('숫자 높이가') < 0)) {
          const note = '숫자 높이가 ' + Math.round(frame.contentH) + 'px로 낮습니다. 숫자를 더 크게 맞추세요.';
          result.reason = result.reason ? (note + ' ' + result.reason) : note;
        }
      }
      if (attempts.length) markTiming('firstSearchDone', attempts.length + ' variants');
      if (result && result.ok) markTiming('firstValidParse', result.text || '');
    } catch (err) {
      result = statusResult('ocr', 'error', '인식 중 오류가 발생했습니다.' + (err && err.message ? ' (' + err.message + ')' : ''));
    }
    busy = false;

    // 그사이 가마·설정이 바뀌었거나 카메라가 꺼졌으면 늦게 끝난 결과를 버림
    const cur = deps.getKiln();
    const stale = gen !== generation || !result || !camera.isRunning() ||
      !cur || cur.id !== kilnId || recognitionMode(cur) !== 'ocr';
    if (!stale) {
      if (lockToSave !== undefined) rememberLock(lockToSave);
      result.elapsedMs = Math.round(now() - t0);
      result.attempts = attempts;
      result.source = source;
      const published = validate(result, kilnId, lastStartAt);
      const vv = published.validation;
      if (vv && vv.status === 'normal' && typeof vv.validatedTemp === 'number') {
        markTiming('validatorBaseline', String(vv.validatedTemp));
      }
      publish(published);
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
    const phase = (validators.get(k.id) || {}).phase;
    const wait = phase === 'normal' || phase === 'suspect' ? k.readIntervalSec * 1000 : CONFIRM_INTERVAL_MS;
    if (Date.now() - lastStartAt < wait) return;
    runOcr(k);
  }

  // 진행 중인 OCR 결과를 버리고 다음 판독을 바로 허용 (가마 설정·영역 변경, 카메라 중지 시)
  function invalidate() {
    generation++;
    lastStartAt = 0;
  }

  // 다른 가마로 바뀜: 이전 가마 결과와 검증 기준을 지우고 처음부터
  function clearSearch() {
    searches.clear();
  }

  function reset() {
    invalidate();
    settleKey = '';
    validators.clear();
    clearSearch();
    publish(statusResult(recognitionMode(deps.getKiln()), 'waiting', '판독 대기 중'));
    deps.onActivity();
  }

  // 판독 주기를 기다리지 않고 바로 판독 (이전 OCR이 진행 중이면 끝난 뒤 다음 확인 때)
  function requestNow() {
    lastStartAt = 0;
    tick();
  }

  return { tick, invalidate, reset, requestNow, activity, resetValidation, clearSearch };
}

// 소성 시작 전에 필요한 안정 인식. 시간 검증을 통과한 온도가 있고, 품질 경고가 없을 때.
export function isRecognitionReady(res) {
  const v = res && res.validation;
  return !!(res && res.ok && !res.lowQuality && v && v.status === 'normal' && typeof v.validatedTemp === 'number');
}

// 검증 상태 표시 문구
export function validationLabel(v) {
  if (!v) return '—';
  if (v.status === 'suspect') return v.persistent ? '급변 경고' : '확인 중';
  if (v.status === 'normal') return '시간 검증 통과';
  if (v.status === 'initializing') return '확인 중';
  return '판독 실패';
}

/**
 * 기록 화면의 현재 인식값 표시
 * @param {{ liveTemp: HTMLElement, liveConf: HTMLElement, liveReason: HTMLElement,
 *   liveEngine: HTMLElement, liveState: HTMLElement, liveValid: HTMLElement, validResetBtn: HTMLElement,
 *   confirmedTemp: HTMLElement }} els
 */
export function createLiveDisplay(els) {
  // OCR이 읽은 값과, 시간 검증을 통과한 온도를 따로 표시한다.
  function show(res) {
    const v = res && res.validation;
    const raw = (res && typeof res.temp === 'number') ? res.temp
      : (res && typeof res.candidate === 'number' ? res.candidate : null);
    els.liveTemp.textContent = raw == null ? '—' : formatTemp(raw);
    els.liveTemp.classList.toggle('is-empty', raw == null);
    const confirmed = v && v.status === 'normal' && typeof v.validatedTemp === 'number' ? v.validatedTemp : null;
    if (els.confirmedTemp) {
      els.confirmedTemp.textContent = confirmed == null ? '—' : formatTemp(confirmed);
      els.confirmedTemp.classList.toggle('is-empty', confirmed == null);
    }
    const shown = confirmed != null ? confirmed : raw;
    if (els.cameraTempValue) {
      els.cameraTempValue.textContent = shown == null ? '—' : formatTemp(shown);
      els.cameraTempValue.classList.toggle('is-empty', shown == null);
    }
    if (els.cameraTemp) {
      els.cameraTemp.hidden = shown == null;
      els.cameraTemp.classList.toggle('is-warning', !!(v && v.warning));
    }

    // 검증 상태 (OCR 신뢰도와 별개)
    els.liveValid.textContent = validationLabel(v);
    if (v) els.liveValid.dataset.state = v.persistent ? 'warn' : v.status;
    else delete els.liveValid.dataset.state;
    els.validResetBtn.hidden = !(v && v.persistent);

    if (isReadResult(res) && typeof res.confidence === 'number') {
      els.liveConf.textContent = confidenceText(res.confidence);
      els.liveConf.dataset.level = confidenceLevel(res.confidence);
    } else {
      els.liveConf.textContent = '—';
      delete els.liveConf.dataset.level;
    }

    // 이유 줄은 비워 둘 뿐 숨기지 않음: 줄이 생겼다 없어지면 아래 카메라 영상이 밀려 확대/이동 중인 손가락 아래에서 움직임
    // 급변 경고는 그사이 판독 실패가 끼어도 정상으로 돌아올 때까지 유지
    let why = '';
    if (!v) why = (res && res.reason) || '';
    else if (v.warning) why = v.warning;
    else if (v.status === 'unavailable') why = res.reason || v.reason;
    else if (v.status === 'initializing') why = v.reason;
    else if (res && res.lowQuality && res.reason) why = res.reason;
    els.liveReason.textContent = why;
    els.liveReason.classList.toggle('is-warning', !!(v && v.warning));
  }

  function setActivity(a) {
    els.liveEngine.textContent = ENGINE_LABELS[a.engine];
    els.liveState.textContent = activityText(a);
    els.liveState.dataset.state = a.engine === 'ocr' && a.engineState === 'error' ? 'error' : (a.busy ? 'busy' : 'idle');
  }

  return { show, setActivity };
}
