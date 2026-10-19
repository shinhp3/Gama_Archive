// ===== 판독 보정 패널 =====
// 가마별 판독 설정(인식 방식, 자릿수 폭/높이 비율, 빨간 LED 모드, 숫자 극성, 임계값 보정, OCR 전처리, 7세그먼트 기울기·켜짐 기준)을 바꾸고,
// 가마 표시창의 실제 숫자와 인식 결과를 비교해 보여 줌. OCR 모드에서는 OCR이 실제로 본 이미지와 원본 텍스트를 진단용으로 표시

import {
  SEGMENTS, THRESHOLD_OFFSET_LIMIT, SHEAR_LIMIT, MIN_SEG_ON_RATIO, MAX_SEG_ON_RATIO,
  DEFAULT_DIGIT_ASPECT, MIN_DIGIT_ASPECT, MAX_DIGIT_ASPECT, OCR_PREPROCESS_OPTIONS, DEFAULT_OCR_PREPROCESS
} from './config.js?v=0.3.12';
import { confidenceText, confidenceLevel, recognitionMode, isReadResult, validationLabel } from './reading.js?v=0.3.12';
import { formatTemp } from './ocr.js?v=0.3.12';
import { VARIANT_LABELS } from './ocrPreprocess.js?v=0.3.12';

const DIAG_IMAGE_MAX_H = 120; // 진단 이미지 표시 높이 (CSS px 기준 캔버스 크기)

function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

function fmtAspect(v) { return v.toFixed(2); }
function fmtSigned(v) { return (v > 0 ? '+' : '') + v; }
function fmtShear(v) { return fmtSigned(Math.round(v * 10) / 10) + '°'; }
function fmtPercent(v) { return Math.round(v * 100) + '%'; }

// 화면에 보이는 자릿수 문자 (빈 자리는 "빈칸")
function charLabel(ch) {
  if (ch === ' ') return '빈칸';
  return ch;
}

function cell(tag, text, className) {
  const el = document.createElement(tag);
  el.textContent = text;
  if (className) el.className = className;
  return el;
}

// OCR 원본 문자열을 그대로 보이게 (줄바꿈은 ⏎)
function rawLabel(raw) {
  if (!raw) return '(빈 결과)';
  return '"' + raw.replace(/\r?\n/g, '⏎') + '"';
}

/**
 * @param {object} els 보정 패널 요소
 * @param {{ getKiln: Function, update: Function, onSettingsChange: Function, onRetryEngine: Function }} deps
 *   update(patch, soon): 현재 가마 설정 저장, onSettingsChange(): 설정이 바뀌어 바로 다시 판독할 때,
 *   onRetryEngine(): "엔진 다시 준비"
 */
export function createCalibrationPanel(els, deps) {
  const binCtx = els.binaryCanvas.getContext('2d');
  let lastResult = null;

  // ===== 설정 컨트롤 =====
  function render() {
    const k = deps.getKiln();
    if (!k) return;
    const mode = recognitionMode(k);
    els.modeSelect.value = mode;
    const ocrMode = mode === 'ocr';
    els.ocrOptions.hidden = !ocrMode;
    els.ocrDiag.hidden = !ocrMode;
    els.segOptions.hidden = mode !== 'sevenSegment';
    els.segDiag.hidden = mode !== 'sevenSegment';
    if (els.digitsField) els.digitsField.hidden = ocrMode;
    if (els.digitAspectField) els.digitAspectField.hidden = true;
    if (els.redLedField) els.redLedField.hidden = ocrMode;
    if (els.polarityField) els.polarityField.hidden = ocrMode;

    els.digitAspectInput.value = String(k.digitAspect);
    els.digitAspectValue.textContent = fmtAspect(k.digitAspect);
    els.redLedInput.checked = !!k.redLedMode;
    els.polaritySelect.value = k.polarity;
    els.thresholdInput.value = String(k.thresholdOffset);
    els.thresholdValue.textContent = fmtSigned(k.thresholdOffset);
    els.ocrPreprocessSelect.value = k.ocrPreprocess;
    els.ocrSmoothSelect.value = k.ocrSmooth === false ? 'nearest' : 'smooth';
    els.shearInput.value = String(k.shear);
    els.shearValue.textContent = fmtShear(k.shear);
    els.segOnInput.value = String(Math.round(k.segOnRatio * 100));
    els.segOnValue.textContent = fmtPercent(k.segOnRatio);
  }

  function change(patch, soon) {
    if (!deps.getKiln()) return;
    deps.update(patch, soon);
    render();
    deps.onSettingsChange();
  }

  function bindEvents() {
    els.digitAspectInput.min = String(MIN_DIGIT_ASPECT);
    els.digitAspectInput.max = String(MAX_DIGIT_ASPECT);
    els.thresholdInput.min = String(-THRESHOLD_OFFSET_LIMIT);
    els.thresholdInput.max = String(THRESHOLD_OFFSET_LIMIT);
    els.shearInput.min = String(-SHEAR_LIMIT);
    els.shearInput.max = String(SHEAR_LIMIT);
    els.segOnInput.min = String(Math.round(MIN_SEG_ON_RATIO * 100));
    els.segOnInput.max = String(Math.round(MAX_SEG_ON_RATIO * 100));

    els.modeSelect.addEventListener('change', () => {
      lastResult = null;
      change({ recognitionMode: els.modeSelect.value === 'sevenSegment' ? 'sevenSegment' : 'ocr' });
    });
    els.redLedInput.addEventListener('change', () => {
      change({ redLedMode: els.redLedInput.checked });
    });
    els.polaritySelect.addEventListener('change', () => {
      change({ polarity: els.polaritySelect.value === 'dark' ? 'dark' : 'bright' });
    });
    els.ocrPreprocessSelect.addEventListener('change', () => {
      const v = els.ocrPreprocessSelect.value;
      change({ ocrPreprocess: OCR_PREPROCESS_OPTIONS.indexOf(v) >= 0 ? v : DEFAULT_OCR_PREPROCESS });
    });
    els.ocrSmoothSelect.addEventListener('change', () => {
      change({ ocrSmooth: els.ocrSmoothSelect.value !== 'nearest' });
    });
    els.engineRetryBtn.addEventListener('click', () => deps.onRetryEngine());
    // 슬라이더는 움직이는 동안 계속 바뀌므로 잠시 모았다가 저장 (soon)
    els.digitAspectInput.addEventListener('input', () => {
      const v = parseFloat(els.digitAspectInput.value);
      change({ digitAspect: clamp(isFinite(v) ? v : DEFAULT_DIGIT_ASPECT, MIN_DIGIT_ASPECT, MAX_DIGIT_ASPECT) }, true);
    });
    els.thresholdInput.addEventListener('input', () => {
      const v = Math.round(clamp(parseFloat(els.thresholdInput.value) || 0, -THRESHOLD_OFFSET_LIMIT, THRESHOLD_OFFSET_LIMIT));
      change({ thresholdOffset: v }, true);
    });
    els.shearInput.addEventListener('input', () => {
      const v = clamp(parseFloat(els.shearInput.value) || 0, -SHEAR_LIMIT, SHEAR_LIMIT);
      change({ shear: v }, true);
    });
    els.segOnInput.addEventListener('input', () => {
      const pct = parseFloat(els.segOnInput.value);
      const v = clamp((isFinite(pct) ? pct : 40) / 100, MIN_SEG_ON_RATIO, MAX_SEG_ON_RATIO);
      change({ segOnRatio: v }, true);
    });
    els.expectedInput.addEventListener('input', refresh);
  }

  // ===== 엔진 상태 (OCR) =====
  function setEngineState(a) {
    let text = '대기';
    if (a.engineState === 'loading') text = '숫자 인식 엔진 준비 중';
    else if (a.engineState === 'error') text = '오류: ' + a.engineMessage;
    else if (a.engineState === 'ready') text = a.busy ? '준비됨 · 인식 중…' : '준비됨';
    els.engineState.textContent = text;
    els.engineState.className = a.engineState === 'error' ? 'bad' : '';
    els.engineRetryBtn.hidden = a.engineState !== 'error';
  }

  // ===== 판독 결과 표시 =====
  function isOpen() {
    return !!els.panel.open;
  }

  function refresh() {
    show(lastResult);
  }

  function show(result) {
    lastResult = result;
    if (!isOpen()) return;

    if (!isReadResult(result)) {
      els.calibSummary.textContent = (result && result.reason) || '판독할 수 없습니다.';
      els.calibMatch.hidden = true;
      els.calibTableWrap.hidden = true;
      els.binaryBox.hidden = true;
      return;
    }

    // 요약: 인식 결과, 신뢰도 (+ 7세그먼트는 임계값)
    els.calibSummary.textContent = '';
    els.calibSummary.appendChild(document.createTextNode('인식 결과 '));
    els.calibSummary.appendChild(cell('strong', result.ok ? formatTemp(result.temp) : '"' + result.text + '"'));
    const conf = cell('span', ' · 신뢰도 ' + confidenceText(result.confidence), 'conf');
    conf.dataset.level = confidenceLevel(result.confidence);
    els.calibSummary.appendChild(conf);
    if (result.threshold !== null && result.threshold !== undefined) {
      els.calibSummary.appendChild(cell('span', ' · 임계값 ' + result.otsu + ' → ' + result.threshold, 'muted-inline'));
    }
    if (!result.ok && result.reason) {
      els.calibSummary.appendChild(cell('div', result.reason, 'calib-reason'));
    }
    // 시간 변화 검증 (인식 신뢰도와 별개): 위 인식 결과는 원시값, 기록 화면 현재 인식값은 검증을 통과한 값
    const v = result.validation;
    if (v) {
      const why = v.warning || (v.status === 'unavailable' ? '' : v.reason);
      els.calibSummary.appendChild(cell('div', '시간 변화 검증: ' + validationLabel(v) +
        (typeof v.validatedTemp === 'number' ? ' (' + formatTemp(v.validatedTemp) + '°C 통과)' : ' (통과한 온도 없음)') +
        (why ? ' — ' + why : ''), 'calib-reason'));
    }

    if (result.engine === 'ocr') {
      renderOcrMatch(result);
      renderOcr(result);
    } else {
      renderSegments(result);
    }
  }

  // ===== OCR =====
  function renderOcrMatch(result) {
    const typed = els.expectedInput.value.trim().replace(/\s+/g, '');
    if (!typed) {
      els.calibMatch.hidden = true;
      return;
    }
    if (!/^\d+(?:\.\d+)?$/.test(typed)) {
      els.calibMatch.textContent = '실제 온도는 숫자와 소수점만 입력하세요. 예: 1187, 20.7';
      els.calibMatch.className = 'calib-match bad';
      els.calibMatch.hidden = false;
      return;
    }
    const expected = typed.indexOf('.') >= 0 ? parseFloat(typed) : parseInt(typed, 10);
    const same = result.candidate !== null && Math.abs(result.candidate - expected) < 0.001;
    let text = same ? '일치합니다.' : '일치하지 않습니다. OCR에 넘긴 이미지에서 숫자가 또렷한지 확인하세요.';
    if (same && !result.ok) text = '숫자는 맞게 읽었지만 판독 실패로 처리했습니다. (' + result.reason + ')';
    els.calibMatch.textContent = text;
    els.calibMatch.className = 'calib-match ' + (same && result.ok ? 'ok' : 'bad');
    els.calibMatch.hidden = false;
  }

  function renderOcr(result) {
    els.ocrRaw.textContent = rawLabel(result.rawText);
    if (result.ok) {
      els.ocrValue.textContent = formatTemp(result.temp) + '°C';
    } else if (result.candidate !== null) {
      els.ocrValue.textContent = formatTemp(result.candidate) + ' (확정하지 않음)';
    } else {
      els.ocrValue.textContent = '없음';
    }
    els.ocrConf.textContent = confidenceText(result.confidence);
    els.ocrTime.textContent = typeof result.elapsedMs === 'number' ? result.elapsedMs + 'ms' : '—';
    const variantName = VARIANT_LABELS[result.variant] || '—';
    const stateNote = result.preprocessState === 'locked' ? ' · 유지' : (result.preprocessState === 'searching' ? ' · 탐색' : '');
    els.ocrVariant.textContent = variantName + stateNote;

    // 기본 전처리에서 실패해 다른 전처리도 시험했으면 시도 내역 표시
    const attempts = result.attempts || [];
    if (attempts.length > 1) {
      els.ocrAttempts.textContent = '시도 순서: ' + attempts.map((a) => (
        VARIANT_LABELS[a.variant] + ' ' + rawLabel(a.rawText) + ' ' + confidenceText(a.confidence) + (a.ok ? ' 성공' : ' 실패')
      )).join(' → ');
      els.ocrAttempts.hidden = false;
    } else {
      els.ocrAttempts.hidden = true;
    }

    copyImage(result.source, els.ocrSourceCanvas);
    copyImage(result.image, els.ocrInputCanvas);
    els.ocrImages.hidden = !result.source && !result.image;
  }

  // 판독에 쓰는 canvas는 다음 판독 때 다시 그려지므로 패널 쪽 canvas에 복사해 둠
  function copyImage(src, dst) {
    if (!src || !src.width || !src.height) return;
    const scale = Math.min(1, DIAG_IMAGE_MAX_H * 3 / src.height);
    const w = Math.max(1, Math.round(src.width * scale));
    const h = Math.max(1, Math.round(src.height * scale));
    if (dst.width !== w) dst.width = w;
    if (dst.height !== h) dst.height = h;
    const ctx = dst.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0, w, h);
  }

  // ===== 7세그먼트 =====
  function renderSegments(result) {
    // 실제 숫자 비교 (오른쪽 정렬: " 25"처럼 앞쪽 빈 자리 허용)
    const digits = result.digits.length;
    const typed = els.expectedInput.value.replace(/\D/g, '');
    let expected = null;
    if (typed) {
      if (typed.length > digits) {
        els.calibMatch.textContent = '실제 숫자가 자릿수(' + digits + '자리)보다 깁니다. 가마 설정의 자릿수를 확인하세요.';
        els.calibMatch.className = 'calib-match bad';
      } else {
        expected = typed.padStart(digits, ' ');
        const allOk = result.digits.every((dg, i) => dg.value === expected[i]);
        els.calibMatch.textContent = allOk ? '일치합니다.' : '일치하지 않습니다. 틀린 자리의 세그먼트 비율을 확인하세요.';
        els.calibMatch.className = 'calib-match ' + (allOk ? 'ok' : 'bad');
      }
      els.calibMatch.hidden = false;
    } else {
      els.calibMatch.hidden = true;
    }

    renderTable(result, expected);
    renderBinary(result);
  }

  // 자릿수별 인식/실제/판정 + 세그먼트별 켜진 비율
  function renderTable(result, expected) {
    const body = els.calibRows;
    body.textContent = '';
    result.digits.forEach((dg, i) => {
      const tr = document.createElement('tr');
      tr.appendChild(cell('td', String(i + 1)));
      tr.appendChild(cell('td', charLabel(dg.value), dg.state === 'fail' ? 'bad' : ''));
      if (expected) {
        const exp = expected[i];
        const ok = dg.value === exp;
        tr.appendChild(cell('td', charLabel(exp)));
        tr.appendChild(cell('td', ok ? '맞음' : '틀림', ok ? 'ok' : 'bad'));
      } else {
        tr.appendChild(cell('td', '—', 'muted-inline'));
        tr.appendChild(cell('td', '—', 'muted-inline'));
      }
      SEGMENTS.forEach((s) => {
        tr.appendChild(cell('td', fmtPercent(dg.segmentRatios[s.id]), dg.on[s.id] ? 'seg-on' : 'seg-off'));
      });
      body.appendChild(tr);
    });
    els.calibTableWrap.hidden = false;
  }

  // 이진화·기울기 보정된 판독 이미지 + 자릿수 경계와 세그먼트 샘플 위치
  function renderBinary(result) {
    const W = result.width;
    const H = result.height;
    const c = els.binaryCanvas;
    if (c.width !== W) c.width = W;
    if (c.height !== H) c.height = H;
    const img = binCtx.createImageData(W, H);
    const bin = result.binary;
    for (let i = 0; i < W * H; i++) {
      const v = bin[i] ? 255 : 0;
      const j = i * 4;
      img.data[j] = v;
      img.data[j + 1] = v;
      img.data[j + 2] = v;
      img.data[j + 3] = 255;
    }
    binCtx.putImageData(img, 0, 0);

    const lw = Math.max(1, Math.round(W / 240));
    binCtx.lineWidth = lw;
    result.digits.forEach((dg, i) => {
      if (i > 0) {
        binCtx.strokeStyle = 'rgba(255, 212, 0, 0.9)';
        binCtx.beginPath();
        binCtx.moveTo(dg.cellX0 + 0.5, 0);
        binCtx.lineTo(dg.cellX0 + 0.5, H);
        binCtx.stroke();
      }
      SEGMENTS.forEach((s) => {
        const r = dg.rects[s.id];
        const on = dg.on[s.id];
        binCtx.fillStyle = on ? 'rgba(40, 200, 90, 0.45)' : 'rgba(255, 70, 70, 0.25)';
        binCtx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
        binCtx.strokeStyle = on ? 'rgba(40, 200, 90, 1)' : 'rgba(255, 70, 70, 0.9)';
        binCtx.strokeRect(r.x0 + lw / 2, r.y0 + lw / 2, r.x1 - r.x0 - lw, r.y1 - r.y0 - lw);
      });
    });
    els.binaryBox.hidden = false;
  }

  bindEvents();

  return { render, show, refresh, isOpen, setEngineState };
}
