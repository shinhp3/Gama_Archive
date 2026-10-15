// ===== 판독 보정 패널 =====
// 가마별 판독 설정(빨간 LED 모드, 숫자 극성, 임계값 보정, 기울기, 켜짐 기준)을 바꾸고,
// 가마 표시창의 실제 숫자와 인식 결과를 자릿수·세그먼트별로 비교해 보여 줌

import {
  SEGMENTS, THRESHOLD_OFFSET_LIMIT, SHEAR_LIMIT, MIN_SEG_ON_RATIO, MAX_SEG_ON_RATIO
} from './config.js?v=0.3.0';
import { confidenceText, confidenceLevel } from './reading.js?v=0.3.0';

function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

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

/**
 * @param {object} els 보정 패널 요소
 * @param {{ getKiln: Function, update: Function, onSettingsChange: Function }} deps
 *   update(patch, soon): 현재 가마 설정 저장, onSettingsChange(): 설정이 바뀌어 바로 다시 판독할 때
 */
export function createCalibrationPanel(els, deps) {
  const binCtx = els.binaryCanvas.getContext('2d');
  let lastResult = null;
  let lastReason = null;

  // ===== 설정 컨트롤 =====
  function render() {
    const k = deps.getKiln();
    if (!k) return;
    els.redLedInput.checked = !!k.redLedMode;
    els.polaritySelect.value = k.polarity;
    els.thresholdInput.value = String(k.thresholdOffset);
    els.thresholdValue.textContent = fmtSigned(k.thresholdOffset);
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
    els.thresholdInput.min = String(-THRESHOLD_OFFSET_LIMIT);
    els.thresholdInput.max = String(THRESHOLD_OFFSET_LIMIT);
    els.shearInput.min = String(-SHEAR_LIMIT);
    els.shearInput.max = String(SHEAR_LIMIT);
    els.segOnInput.min = String(Math.round(MIN_SEG_ON_RATIO * 100));
    els.segOnInput.max = String(Math.round(MAX_SEG_ON_RATIO * 100));

    els.redLedInput.addEventListener('change', () => {
      change({ redLedMode: els.redLedInput.checked });
    });
    els.polaritySelect.addEventListener('change', () => {
      change({ polarity: els.polaritySelect.value === 'dark' ? 'dark' : 'bright' });
    });
    // 슬라이더는 움직이는 동안 계속 바뀌므로 잠시 모았다가 저장 (soon)
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
    els.expectedInput.addEventListener('input', () => show(lastResult, lastReason));
  }

  // ===== 판독 결과 표시 =====
  function isOpen() {
    return !!els.panel.open;
  }

  function show(result, reason) {
    lastResult = result;
    lastReason = reason;
    if (!isOpen()) return;

    if (!result) {
      els.calibSummary.textContent = reason || '판독할 수 없습니다.';
      els.calibMatch.hidden = true;
      els.calibTableWrap.hidden = true;
      els.binaryBox.hidden = true;
      return;
    }

    // 요약: 인식 결과, 신뢰도, 임계값
    els.calibSummary.textContent = '';
    els.calibSummary.appendChild(document.createTextNode('인식 결과 '));
    els.calibSummary.appendChild(cell('strong', result.ok ? String(result.temp) : '"' + result.text + '"'));
    const conf = cell('span', ' · 신뢰도 ' + confidenceText(result.confidence), 'conf');
    conf.dataset.level = confidenceLevel(result.confidence);
    els.calibSummary.appendChild(conf);
    els.calibSummary.appendChild(cell('span', ' · 임계값 ' + result.otsu + ' → ' + result.threshold, 'muted-inline'));
    if (!result.ok && result.reason) {
      els.calibSummary.appendChild(cell('div', result.reason, 'calib-reason'));
    }

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

  return { render, show, isOpen };
}
