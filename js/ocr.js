// ===== OCR 숫자 인식 (Tesseract.js) =====
// Tesseract 작업자(Worker) 준비·재사용·종료, 숫자 이미지 인식, OCR 출력 검증, 신뢰도 정규화.
// 모든 처리는 브라우저 안에서 하며 이미지나 온도를 서버로 보내지 않음 (엔진 파일만 CDN에서 내려받음)

import {
  TESSERACT_WORKER_PATH, TESSERACT_CORE_PATH, TESSERACT_LANG_PATH, OCR_LANG, OCR_LANG_GZIP, OCR_WHITELIST,
  OCR_PSM_SINGLE_LINE, OCR_MIN_CONFIDENCE, OCR_INIT_TIMEOUT_MS, OCR_RECOGNIZE_TIMEOUT_MS,
  TEMP_MIN, TEMP_MAX
} from './config.js?v=0.3.4';

const OEM_LSTM_ONLY = 1;
const LIBRARY_WAIT_MS = 20000;

function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

// Tesseract 신뢰도(0~100) → 0~1. 실제 정답 확률이 아니며 7세그먼트 신뢰도와 의미가 다름
export function normalizeConfidence(conf) {
  return typeof conf === 'number' && isFinite(conf) ? clamp(conf / 100, 0, 1) : 0;
}

/**
 * OCR 원본 문자열 검증 (보정해서 억지로 숫자를 만들지 않음)
 * @returns {{ ok: boolean, text: string, value: number|null, reason: string }}
 */
export function parseOcrText(raw, digits) {
  // 공백·줄바꿈 제거 (7세그먼트 숫자는 자리 사이가 떨어져 있어 공백으로 나뉘어 나오기도 함)
  const text = (typeof raw === 'string' ? raw : '').replace(/\s+/g, '');
  const fail = (reason) => ({ ok: false, text, value: null, reason });
  if (!text) return fail('숫자를 찾지 못했습니다.');
  if (!/^[0-9]+$/.test(text)) return fail('숫자가 아닌 문자가 섞여 있습니다.');
  if (text.length > digits) return fail('숫자 자릿수(' + digits + '자리)보다 많이 읽었습니다: ' + text);
  const value = parseInt(text, 10); // 앞자리 0 허용 ("0025" → 25)
  if (value < TEMP_MIN || value > TEMP_MAX) return fail('온도 범위(' + TEMP_MIN + '~' + TEMP_MAX + '°C)를 벗어났습니다: ' + value);
  return { ok: true, text, value, reason: '' };
}

/**
 * OCR 출력 → 판독 결과 (7세그먼트 판독 결과와 같은 기본 구조)
 * @returns {{ ok, temp, value, candidate, text, rawText, confidence, digits, reason, engine, status }}
 */
export function judgeOcr(rawText, confidence, digits) {
  const p = parseOcrText(rawText, digits);
  const res = {
    ok: false,
    temp: null,
    value: null,
    candidate: p.value,           // 형식은 맞게 읽은 숫자 (신뢰도가 낮아 실패해도 진단용으로 보여 줌)
    text: p.text,
    rawText: typeof rawText === 'string' ? rawText : '',
    confidence,
    digits: p.text.split('').map((ch) => ({ value: ch })),
    reason: p.reason,
    engine: 'ocr',
    status: 'fail'
  };
  if (!p.ok) return res;
  if (confidence < OCR_MIN_CONFIDENCE) {
    res.reason = '인식 신뢰도가 낮습니다 (' + Math.round(confidence * 100) + '%).';
    return res;
  }
  res.ok = true;
  res.temp = p.value;
  res.value = p.value;
  res.status = 'ok';
  return res;
}

// 제한 시간 안에 끝나지 않으면 실패. onLate: 시간이 지난 뒤에 성공한 결과 정리용
function withTimeout(promise, ms, message, onLate) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      done = true;
      reject(new Error(message));
    }, ms);
    promise.then((v) => {
      if (done) { if (onLate) onLate(v); return; }
      done = true;
      clearTimeout(timer);
      resolve(v);
    }, (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

function errorText(err) {
  if (!err) return '';
  if (typeof err === 'string') return err;
  return err.message || String(err);
}

/**
 * @param {{ onStateChange: Function }} hooks onStateChange(state, message): 'idle' | 'loading' | 'ready' | 'error'
 */
export function createOcrEngine(hooks) {
  let state = 'idle';
  let message = '';
  let worker = null;
  let generation = 0;   // terminate()로 버린 준비 작업이 늦게 끝나면 무시하기 위한 번호

  function setState(next, msg) {
    state = next;
    message = msg || '';
    hooks.onStateChange(state, message);
  }

  // 최초 한 번만 준비하고 이후에는 같은 작업자를 재사용
  function init() {
    if (state === 'loading' || state === 'ready') return;
    const gen = ++generation;
    setState('loading');
    waitForLibrary().then((T) => {
      if (gen !== generation) return;
      if (!T) {
        setState('error', '숫자 인식 엔진(Tesseract.js) 파일을 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 새로고침하세요.');
        return;
      }
      startWorker(T, gen);
    });
  }

  // index.html의 Tesseract.js 스크립트(async)가 다 내려받아질 때까지 잠시 기다림
  function waitForLibrary() {
    return new Promise((resolve) => {
      const started = Date.now();
      (function check() {
        const T = window.Tesseract;
        if (T && typeof T.createWorker === 'function') { resolve(T); return; }
        if (Date.now() - started > LIBRARY_WAIT_MS) { resolve(null); return; }
        setTimeout(check, 200);
      })();
    });
  }

  function startWorker(T, gen) {
    let created;
    try {
      created = T.createWorker(OCR_LANG, OEM_LSTM_ONLY, {
        workerPath: TESSERACT_WORKER_PATH,
        corePath: TESSERACT_CORE_PATH,
        langPath: TESSERACT_LANG_PATH,
        gzip: OCR_LANG_GZIP,
        // 작업 실패를 예외로 던지지 않음. 준비 중 실패(언어 데이터 내려받기 실패 등)는 createWorker가 끝나지 않으므로 여기서 오류 처리
        errorHandler: (data) => {
          if (gen !== generation || state !== 'loading') return;
          generation++;
          setState('error', '숫자 인식 엔진을 준비하지 못했습니다. 인터넷 연결을 확인하세요. (' + errorText(data) + ')');
        }
      });
    } catch (err) {
      if (gen === generation) setState('error', '숫자 인식 엔진을 시작하지 못했습니다. (' + errorText(err) + ')');
      return;
    }

    let made = null;
    withTimeout(created, OCR_INIT_TIMEOUT_MS, '준비 시간이 너무 오래 걸립니다', (late) => { late.terminate(); })
      .then((w) => {
        made = w;
        return w.setParameters({
          tessedit_char_whitelist: OCR_WHITELIST,
          tessedit_pageseg_mode: OCR_PSM_SINGLE_LINE,
          user_defined_dpi: '300'
        });
      })
      .then(() => {
        if (gen !== generation) { made.terminate(); return; }
        worker = made;
        setState('ready');
      })
      .catch((err) => {
        if (made) made.terminate();
        if (gen !== generation) return;
        setState('error', '숫자 인식 엔진을 준비하지 못했습니다. 인터넷 연결을 확인하세요. (' + errorText(err) + ')');
      });
  }

  /**
   * 이미지(canvas) 인식
   * @returns {Promise<{ rawText: string, confidence: number }>}
   */
  function recognize(canvas) {
    if (state !== 'ready' || !worker) return Promise.reject(new Error('숫자 인식 엔진이 준비되지 않았습니다.'));
    const w = worker;
    return withTimeout(w.recognize(canvas), OCR_RECOGNIZE_TIMEOUT_MS, 'timeout')
      .then((res) => {
        const data = (res && res.data) || {};
        return { rawText: typeof data.text === 'string' ? data.text : '', confidence: normalizeConfidence(data.confidence) };
      })
      .catch((err) => {
        // 응답이 없으면 작업자를 버리고 오류 상태로 (다시 준비하기 전까지 인식하지 않음)
        if (errorText(err) === 'timeout' && w === worker) {
          terminate();
          setState('error', '숫자 인식 엔진이 응답하지 않습니다. "엔진 다시 준비"를 누르거나 페이지를 새로고침하세요.');
        }
        throw err;
      });
  }

  // 작업자 종료 (다시 쓰려면 init)
  function terminate() {
    generation++;
    if (worker) {
      const w = worker;
      worker = null;
      Promise.resolve().then(() => w.terminate()).catch(() => {});
    }
    if (state !== 'idle') setState('idle');
  }

  // 오류 후 다시 준비
  function retry() {
    terminate();
    init();
  }

  return {
    init,
    retry,
    recognize,
    terminate,
    state: () => state,
    message: () => message
  };
}
