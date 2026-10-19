// ===== OCR 숫자 인식 (Tesseract.js) =====
// Tesseract 작업자(Worker) 준비·재사용·종료, 숫자 이미지 인식, OCR 출력 검증, 신뢰도 정규화.
// 모든 처리는 브라우저 안에서 하며 이미지나 온도를 서버로 보내지 않음 (엔진 파일만 CDN에서 내려받음)

import {
  TESSERACT_WORKER_PATH, TESSERACT_CORE_PATH, TESSERACT_LANG_PATH, OCR_LANG, OCR_LANG_GZIP, OCR_WHITELIST,
  OCR_PSM_SINGLE_LINE, OCR_MIN_CONFIDENCE, OCR_MIN_CHAR_CONFIDENCE, OCR_INIT_TIMEOUT_MS, OCR_RECOGNIZE_TIMEOUT_MS,
  TEMP_MIN, TEMP_MAX
} from './config.js?v=0.3.11';
import { markTiming } from './timings.js?v=0.3.11';

const OEM_LSTM_ONLY = 1;
const LIBRARY_WAIT_MS = 20000;

function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

// Tesseract 신뢰도(0~100) → 0~1. 실제 정답 확률이 아니며 7세그먼트 신뢰도와 의미가 다름
export function normalizeConfidence(conf) {
  return typeof conf === 'number' && isFinite(conf) ? clamp(conf / 100, 0, 1) : 0;
}

const NUMBER_RE = /^\d+(?:\.\d+)?$/;

function cleanToken(s) {
  return String(s || '').replace(/\s+/g, '');
}

// "0025" → "25", "20.70" → "20.7", "20.0" → "20". 소수점을 넣거나 빼서 다른 온도로 바꾸지는 않음
function canonicalText(text) {
  if (text.indexOf('.') < 0) return String(parseInt(text, 10));
  const parts = text.split('.');
  const whole = String(parseInt(parts[0], 10));
  const frac = parts[1].replace(/0+$/, '');
  return frac ? whole + '.' + frac : whole;
}

function parseNumber(text) {
  if (text.indexOf('.') < 0) return parseInt(text, 10);
  const parts = text.split('.');
  const whole = parseInt(parts[0], 10);
  const frac = parts[1];
  return whole + parseInt(frac, 10) / Math.pow(10, frac.length);
}

// 화면 표시용. 소수 온도는 불필요한 끝자리를 붙이지 않음
export function formatTemp(value) {
  if (typeof value !== 'number' || !isFinite(value)) return '—';
  const rounded = Math.round(value * 1000) / 1000;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-9) return String(Math.round(rounded));
  return String(rounded);
}

/**
 * 단어 상자 간격으로 한 줄의 숫자를 묶음.
 * 자릿수 사이처럼 좁은 간격은 한 숫자로 붙이고, 숫자 폭만큼 떨어진 간격이나 다른 줄은 별도 숫자로 봄.
 * 상자 정보가 없으면 null (호출 측이 원문 공백 규칙으로 처리).
 * @returns {string[]|null}
 */
export function groupsFromBoxes(words) {
  if (!Array.isArray(words) || !words.length) return null;
  const items = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const b = w && w.bbox;
    if (!b || !isFinite(b.x0) || !isFinite(b.x1)) return null;
    const text = cleanToken(w.text);
    if (!text || !/[0-9]/.test(text)) continue;
    if (/[^0-9.]/.test(text)) return null;
    items.push({
      text,
      x0: b.x0,
      x1: Math.max(b.x1, b.x0 + 1),
      y0: isFinite(b.y0) ? b.y0 : 0,
      y1: isFinite(b.y1) ? b.y1 : ((isFinite(b.y0) ? b.y0 : 0) + 1)
    });
  }
  if (!items.length) return [];

  const heights = items.map((it) => Math.max(1, it.y1 - it.y0)).sort((a, b) => a - b);
  const medH = heights[heights.length >> 1];
  const sortedY = items.slice().sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1));
  const rows = [[sortedY[0]]];
  for (let i = 1; i < sortedY.length; i++) {
    const row = rows[rows.length - 1];
    let cy = 0;
    row.forEach((it) => { cy += (it.y0 + it.y1) / 2; });
    cy /= row.length;
    const iy = (sortedY[i].y0 + sortedY[i].y1) / 2;
    if (iy - cy > medH * 0.8) rows.push([sortedY[i]]);
    else row.push(sortedY[i]);
  }

  const groups = [];
  rows.forEach((row) => {
    const sorted = row.slice().sort((a, b) => a.x0 - b.x0);
    const widths = sorted.map((it) => it.x1 - it.x0).sort((a, b) => a - b);
    const medW = widths[widths.length >> 1];
    const rowH = sorted.map((it) => Math.max(1, it.y1 - it.y0)).sort((a, b) => a - b);
    const splitAt = Math.max(medW, rowH[rowH.length >> 1] * 0.5);
    let cur = sorted[0].text;
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i].x0 - sorted[i - 1].x1;
      if (gap >= splitAt) {
        groups.push(cur);
        cur = sorted[i].text;
      } else {
        cur += sorted[i].text;
      }
    }
    groups.push(cur);
  });
  return groups;
}

function tokensOf(flat) {
  return flat.split(/\s+/).filter(Boolean);
}

// 한 글자씩 떨어진 7세그먼트("1 1 8 7", "2 0 . 7")만 한 숫자로 붙임. 두 자리 이상 덩어리는 붙이지 않음
function isSplitGlyphs(tokens) {
  return tokens.length > 1 && tokens.every((t) => /^[0-9.]$/.test(t));
}

function hasMultipleNumbers(flat, words) {
  const boxed = groupsFromBoxes(words);
  if (boxed && boxed.length > 1) return true;
  const tokens = tokensOf(flat);
  if (tokens.length <= 1) return false;
  if (isSplitGlyphs(tokens)) return false;
  return true;
}

function collapseNumber(flat) {
  const tokens = tokensOf(flat);
  if (isSplitGlyphs(tokens)) return tokens.join('');
  return tokens.join('');
}

/**
 * OCR 원본 문자열 검증.
 * 소수점을 끼워 넣거나 빼서 온도를 추측하지 않음. 독립된 숫자가 둘 이상이면 하나를 고르지 않음.
 * @param {string} raw
 * @param {Array<{ text: string, bbox: { x0, y0, x1, y1 } }>|null} [words]
 * @returns {{ ok: boolean, text: string, value: number|null, reason: string, multiple: boolean }}
 */
export function parseOcrText(raw, words) {
  const flat = (typeof raw === 'string' ? raw : '').replace(/[\r\n]+/g, ' ').trim();
  const fail = (reason, multiple) => ({
    ok: false,
    text: flat.replace(/\s+/g, ''),
    value: null,
    reason,
    multiple: !!multiple
  });
  if (!flat) return fail('숫자를 찾지 못했습니다.', false);
  if (/[^0-9.\s]/.test(flat)) return fail('숫자와 소수점 이외의 문자가 섞여 있습니다.', false);
  if (hasMultipleNumbers(flat, words)) {
    return {
      ok: false,
      text: flat,
      value: null,
      reason: '영역 안에 숫자가 여러 개 있습니다. 현재 온도 숫자만 네모 안에 들어오도록 다시 맞춰 주세요.',
      multiple: true
    };
  }
  const text = collapseNumber(flat);
  if (!text) return fail('숫자를 찾지 못했습니다.', false);
  if (!NUMBER_RE.test(text)) return fail('소수점 형식이 올바르지 않습니다.', false);
  const value = parseNumber(text);
  if (!isFinite(value) || value < TEMP_MIN || value > TEMP_MAX) {
    return fail('온도 범위(' + TEMP_MIN + '~' + TEMP_MAX + '°C)를 벗어났습니다: ' + text, false);
  }
  return { ok: true, text: canonicalText(text), value, reason: '', multiple: false };
}

/**
 * OCR 출력 → 판독 결과 (7세그먼트 판독 결과와 같은 기본 구조)
 * @returns {{ ok, temp, value, candidate, text, rawText, confidence, digits, reason, engine, status, multiple }}
 */
function minDigitConfidence(symbols) {
  if (!Array.isArray(symbols) || !symbols.length) return null;
  let min = null;
  symbols.forEach((s) => {
    const t = String(s && s.text || '').trim();
    if (!/^[0-9.]$/.test(t) || typeof s.confidence !== 'number') return;
    if (min === null || s.confidence < min) min = s.confidence;
  });
  return min;
}

export function judgeOcr(rawText, confidence, words, symbols) {
  const p = parseOcrText(rawText, words);
  const charConfidence = minDigitConfidence(symbols);
  const res = {
    ok: false,
    temp: null,
    value: null,
    candidate: p.value,           // 형식은 맞게 읽은 숫자 (신뢰도가 낮아 실패해도 진단용으로 보여 줌)
    text: p.text,
    rawText: typeof rawText === 'string' ? rawText : '',
    confidence,
    charConfidence,
    digits: p.text.split('').map((ch) => ({ value: ch })),
    reason: p.reason,
    multiple: p.multiple,
    engine: 'ocr',
    status: 'fail'
  };
  if (!p.ok) return res;
  if (confidence < OCR_MIN_CONFIDENCE) {
    res.reason = '인식 신뢰도가 낮습니다 (' + Math.round(confidence * 100) + '%).';
    return res;
  }
  if (charConfidence !== null && charConfidence < OCR_MIN_CHAR_CONFIDENCE) {
    res.reason = '한 자리가 불안정합니다 (' + Math.round(charConfidence * 100) + '%). 비슷한 숫자로 확정하지 않았습니다.';
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
    markTiming('workerInitStart');
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
        if (T && typeof T.createWorker === 'function') {
          markTiming('libraryReady');
          resolve(T);
          return;
        }
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
        markTiming('langLoaded', OCR_LANG);
        return w.setParameters({
          tessedit_char_whitelist: OCR_WHITELIST,
          tessedit_pageseg_mode: OCR_PSM_SINGLE_LINE,
          user_defined_dpi: '300',
          classify_bln_numeric_mode: '1',
          load_system_dawg: '0',
          load_freq_dawg: '0'
        });
      })
      .then(() => {
        if (gen !== generation) { made.terminate(); return; }
        worker = made;
        markTiming('workerReady', OCR_LANG);
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
    markTiming('firstRecognizeStart');
    return withTimeout(w.recognize(canvas), OCR_RECOGNIZE_TIMEOUT_MS, 'timeout')
      .then((res) => {
        markTiming('firstRecognizeEnd');
        const data = (res && res.data) || {};
        const words = Array.isArray(data.words) ? data.words.map((w) => ({
          text: typeof w.text === 'string' ? w.text : '',
          confidence: normalizeConfidence(w.confidence),
          bbox: w.bbox ? { x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 } : null
        })) : [];
        const symbols = Array.isArray(data.symbols) ? data.symbols.map((s) => ({
          text: typeof s.text === 'string' ? s.text : '',
          confidence: normalizeConfidence(s.confidence)
        })) : [];
        return {
          rawText: typeof data.text === 'string' ? data.text : '',
          confidence: normalizeConfidence(data.confidence),
          words,
          symbols
        };
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
