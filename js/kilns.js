// ===== 가마 관리 =====
// 가마 목록 불러오기·추가·이름 변경·삭제·선택, 가마별 설정(자릿수·판독 주기 등) 저장

import {
  PREF_LAST_KILN_ID, MAX_NAME_LENGTH,
  DEFAULT_DIGITS, MIN_DIGITS, MAX_DIGITS,
  READ_INTERVAL_OPTIONS, DEFAULT_READ_INTERVAL_SEC, DEFAULT_POLARITY,
  THRESHOLD_OFFSET_LIMIT, SHEAR_LIMIT, DEFAULT_SEG_ON_RATIO, MIN_SEG_ON_RATIO, MAX_SEG_ON_RATIO,
  DEFAULT_DIGIT_ASPECT, MIN_DIGIT_ASPECT, MAX_DIGIT_ASPECT, MIN_ZOOM, MAX_ZOOM,
  DEFAULT_GUIDE_WIDTH_RATIO, MIN_GUIDE_WIDTH_RATIO, MAX_GUIDE_WIDTH_RATIO, MAX_ROTATION_DEG, ROTATION_STEP_DEG,
  MIN_GUIDE_ASPECT, MAX_GUIDE_ASPECT,
  RECOGNITION_MODES, DEFAULT_RECOGNITION_MODE, OCR_PREPROCESS_OPTIONS, OCR_VARIANTS, DEFAULT_OCR_PREPROCESS,
  OCR_LOCK_REVISION
} from './config.js?v=0.3.16';
import {
  getKilns, putKiln, deleteKiln, getPref, setPref, removePref,
  readLegacyKilns, clearLegacyKilns
} from './db.js?v=0.3.16';

const SAVE_DELAY_MS = 400; // 슬라이더처럼 값이 연속으로 바뀔 때 모았다가 저장하는 시간

function isNum(v) { return typeof v === 'number' && isFinite(v); }
// 범위 안의 숫자면 그대로, 아니면 기본값
function numInRange(v, min, max, def) { return (isNum(v) && v >= min && v <= max) ? v : def; }

function makeId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function round2(v) { return Math.round(v * 100) / 100; }

// 저장된 전처리. 예전 'contrast'는 어두운 숫자 LCD 대비로 이어받음
function normalizePreprocess(v) {
  if (v === 'contrast') return 'lcd';
  return OCR_PREPROCESS_OPTIONS.indexOf(v) >= 0 ? v : DEFAULT_OCR_PREPROCESS;
}

// 틀 가로/세로. 없으면 예전 자릿수×자릿수 비율로 같은 사각형을 유지. 범위 밖이면 그 복원값 사용
function guideAspectOf(raw, digits) {
  const digitAspect = numInRange(raw.digitAspect, MIN_DIGIT_ASPECT, MAX_DIGIT_ASPECT, DEFAULT_DIGIT_ASPECT);
  const legacy = round2(Math.min(MAX_GUIDE_ASPECT, Math.max(MIN_GUIDE_ASPECT, digits * digitAspect)));
  if (!isNum(raw.guideAspect)) return legacy;
  if (raw.guideAspect < MIN_GUIDE_ASPECT || raw.guideAspect > MAX_GUIDE_ASPECT) return legacy;
  return round2(raw.guideAspect);
}

function isValidRoi(r) {
  return !!r && typeof r === 'object' &&
    isNum(r.x) && isNum(r.y) && isNum(r.w) && isNum(r.h) &&
    r.x >= 0 && r.y >= 0 && r.w > 0 && r.h > 0 &&
    r.x + r.w <= 1.0001 && r.y + r.h <= 1.0001;
}

function copyRoi(r) {
  return isValidRoi(r) ? { x: r.x, y: r.y, w: r.w, h: r.h } : null;
}

// 확대/이동 상태 { zoom, cx, cy } (중심은 원본 프레임 비율)
function cameraZoomOf(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (!isFinite(n) || n <= 0 || n > 20) return null;
  return Math.round(n * 100) / 100;
}

function copyView(v) {
  if (!v || typeof v !== 'object') return null;
  if (!isNum(v.zoom) || !isNum(v.cx) || !isNum(v.cy)) return null;
  if (v.zoom < MIN_ZOOM || v.zoom > MAX_ZOOM || v.cx < 0 || v.cx > 1 || v.cy < 0 || v.cy > 1) return null;
  return { zoom: v.zoom, cx: v.cx, cy: v.cy };
}

// 저장된 값이 손상됐거나 항목이 빠져 있어도 안전한 값으로 보정
export function sanitizeKiln(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, MAX_NAME_LENGTH) : '';
  if (!name) return null;
  let digits = parseInt(raw.digits, 10);
  if (!(digits >= MIN_DIGITS && digits <= MAX_DIGITS)) digits = DEFAULT_DIGITS;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : makeId(),
    name,
    // 방향별로 저장하던 버전(roiLandscape/roiPortrait)의 영역도 하나로 이어받음
    roi: copyRoi(raw.roi) || copyRoi(raw.roiLandscape) || copyRoi(raw.roiPortrait),
    view: copyView(raw.view),
    // 기기 카메라 확대. 지원하지 않는 기기·이전 가마는 null (열면 최소 배율)
    cameraZoom: cameraZoomOf(raw.cameraZoom),
    digits,
    digitAspect: numInRange(raw.digitAspect, MIN_DIGIT_ASPECT, MAX_DIGIT_ASPECT, DEFAULT_DIGIT_ASPECT),
    // 노란 틀 폭 (영상 영역 폭 대비). 저장되지 않은 이전 가마는 기본값
    guideWidthRatio: numInRange(raw.guideWidthRatio, MIN_GUIDE_WIDTH_RATIO, MAX_GUIDE_WIDTH_RATIO, DEFAULT_GUIDE_WIDTH_RATIO),
    // 노란 틀 가로/세로. 저장되지 않은 이전 가마는 자릿수×자릿수 비율로 같은 모양을 유지
    guideAspect: guideAspectOf(raw, digits),
    // 틀 회전각 (영역 roi 중심 기준, 양수 = 시계 방향). 저장되지 않은 이전 가마는 0°
    rotationDeg: Math.round(numInRange(raw.rotationDeg, -MAX_ROTATION_DEG, MAX_ROTATION_DEG, 0) / ROTATION_STEP_DEG) * ROTATION_STEP_DEG || 0,
    polarity: raw.polarity === 'dark' ? 'dark' : DEFAULT_POLARITY,
    redLedMode: raw.redLedMode === true,
    thresholdOffset: Math.round(numInRange(raw.thresholdOffset, -THRESHOLD_OFFSET_LIMIT, THRESHOLD_OFFSET_LIMIT, 0)),
    shear: numInRange(raw.shear, -SHEAR_LIMIT, SHEAR_LIMIT, 0),
    segOnRatio: numInRange(raw.segOnRatio, MIN_SEG_ON_RATIO, MAX_SEG_ON_RATIO, DEFAULT_SEG_ON_RATIO),
    readIntervalSec: READ_INTERVAL_OPTIONS.indexOf(raw.readIntervalSec) >= 0 ? raw.readIntervalSec : DEFAULT_READ_INTERVAL_SEC,
    // 인식 방식이 저장되지 않은 이전 가마는 OCR
    recognitionMode: RECOGNITION_MODES.indexOf(raw.recognitionMode) >= 0 ? raw.recognitionMode : DEFAULT_RECOGNITION_MODE,
    ocrPreprocess: normalizePreprocess(raw.ocrPreprocess),
    // 자동 탐색으로 고정한 전처리. 없거나 알 수 없는 값이면 다시 탐색
    ocrLockedVariant: raw.ocrLockRevision === OCR_LOCK_REVISION && OCR_VARIANTS.indexOf(raw.ocrLockedVariant) >= 0
      ? raw.ocrLockedVariant
      : null,
    ocrLockRevision: OCR_LOCK_REVISION,
    ocrSmooth: raw.ocrSmooth !== false,  // OCR 입력 확대 보간: true = 부드럽게, false = 최근접 이웃
    createdAt: isNum(raw.createdAt) ? raw.createdAt : Date.now()
  };
}

// 이전 버전(v0.1) 항목 이름을 새 형식으로 바꿈
function fromLegacy(raw, order) {
  if (!raw || typeof raw !== 'object') return null;
  return sanitizeKiln({
    name: raw.name,
    roi: raw.roi,
    digits: raw.digits,
    polarity: raw.polarity,
    redLedMode: raw.redMode,
    thresholdOffset: raw.thresholdOffset,
    shear: raw.skew,
    segOnRatio: raw.onRatio,
    readIntervalSec: raw.readIntervalSec,
    createdAt: Date.now() + order // 원래 순서 유지
  });
}

/**
 * @param {object} els 가마 관리/설정 화면 요소
 * @param {{ onMessage: Function, onChange: Function }} hooks
 *   onChange(switched): 선택 가마나 그 설정이 바뀐 뒤 호출. switched=true면 다른 가마로 바뀐 것
 */
export function createKilnManager(els, hooks) {
  let kilns = [];
  let currentId = null;
  let nameMode = null;      // 이름 입력 폼 용도: 'add' | 'rename' | null
  let saveTimer = null;
  let pendingSave = null;   // 아직 저장하지 않은 가마

  function find(id) {
    for (let i = 0; i < kilns.length; i++) {
      if (kilns[i].id === id) return kilns[i];
    }
    return null;
  }

  function current() {
    return currentId ? find(currentId) : null;
  }

  function reportError(err) {
    hooks.onMessage(err && err.message ? err.message : '저장 중 오류가 발생했습니다.', 'error');
  }

  // ===== 불러오기 =====
  // 이전 버전 설정이 있으면 처음 한 번 IndexedDB로 옮김
  function migrateLegacy(existing) {
    const legacy = readLegacyKilns();
    if (!legacy) return Promise.resolve(null);
    if (existing.length > 0) {
      clearLegacyKilns();
      return Promise.resolve(null);
    }
    const seen = {};
    const list = [];
    legacy.kilns.forEach((raw, i) => {
      const k = fromLegacy(raw, i);
      if (k && !seen['$' + k.name]) {
        seen['$' + k.name] = true;
        list.push(k);
      }
    });
    return Promise.all(list.map(putKiln)).then(() => {
      clearLegacyKilns();
      const last = list.filter((k) => k.name === legacy.lastName)[0];
      return { list, lastId: last ? last.id : null };
    });
  }

  function load() {
    return getKilns()
      .then((stored) => migrateLegacy(stored).then((migrated) => {
        if (migrated) {
          kilns = migrated.list;
          if (migrated.lastId) setPref(PREF_LAST_KILN_ID, migrated.lastId);
        } else {
          kilns = stored.map(sanitizeKiln).filter(Boolean);
        }
      }))
      .then(() => {
        const last = getPref(PREF_LAST_KILN_ID);
        currentId = (last && find(last)) ? last : (kilns.length ? kilns[0].id : null);
        render();
      });
  }

  // ===== 저장 =====
  function flushSave() {
    clearTimeout(saveTimer);
    const k = pendingSave;
    pendingSave = null;
    if (!k) return Promise.resolve();
    return putKiln(k).catch(reportError);
  }

  // 현재 가마 설정 일부 변경 후 저장 (soon이면 잠시 모았다가 저장)
  function update(patch, soon) {
    const k = current();
    if (!k) return;
    Object.keys(patch).forEach((key) => { k[key] = patch[key]; });
    if (pendingSave && pendingSave !== k) flushSave();
    pendingSave = k;
    clearTimeout(saveTimer);
    if (soon) {
      saveTimer = setTimeout(flushSave, SAVE_DELAY_MS);
    } else {
      flushSave();
    }
  }

  // 모든 가마의 영역과 확대/이동 상태를 지움 (화면 방향이 바뀌면 이전 영역은 맞지 않음). 지운 영역이 있으면 true
  function clearAllRois() {
    flushSave();
    const hadRoi = kilns.some((k) => k.roi);
    kilns.filter((k) => k.roi || k.view || k.ocrLockedVariant).forEach((k) => {
      k.roi = null;
      k.view = null;
      k.ocrLockedVariant = null;
      putKiln(k).catch(reportError);
    });
    return hadRoi;
  }

  // ===== 선택 =====
  function select(id) {
    flushSave();
    const next = (id && find(id)) ? id : null;
    const switched = next !== currentId;
    currentId = next;
    if (currentId) {
      setPref(PREF_LAST_KILN_ID, currentId);
    } else {
      removePref(PREF_LAST_KILN_ID);
    }
    render();
    hooks.onChange(switched);
  }

  // ===== 이름 입력 폼 (추가/이름 변경 공용) =====
  function validateName(name, exceptId) {
    if (!name) return '가마 이름을 입력하세요.';
    if (name.length > MAX_NAME_LENGTH) return '가마 이름은 ' + MAX_NAME_LENGTH + '자 이내로 입력하세요.';
    if (kilns.some((k) => k.name === name && k.id !== exceptId)) return '같은 이름의 가마가 이미 있습니다.';
    return null;
  }

  function openNameForm(mode) {
    const k = current();
    if (mode === 'rename' && !k) return;
    nameMode = mode;
    els.nameFormLabel.textContent = mode === 'add' ? '새 가마 이름' : '바꿀 이름';
    els.nameOkBtn.textContent = mode === 'add' ? '추가' : '변경';
    els.nameInput.value = mode === 'rename' ? k.name : '';
    els.nameForm.hidden = false;
    // iOS는 사용자 탭 이벤트 안에서 focus해야 키보드가 올라옴
    els.nameInput.focus();
  }

  function closeNameForm() {
    nameMode = null;
    els.nameInput.blur();
    els.nameForm.hidden = true;
  }

  function submitNameForm() {
    const name = els.nameInput.value.trim();
    if (nameMode === 'add') {
      const err = validateName(name, null);
      if (err) { hooks.onMessage(err, 'error', 4000); els.nameInput.focus(); return; }
      const k = sanitizeKiln({ name });
      putKiln(k).then(() => {
        kilns.push(k);
        closeNameForm();
        select(k.id);
      }).catch(reportError);
    } else if (nameMode === 'rename') {
      const k = current();
      if (!k) { closeNameForm(); return; }
      if (name === k.name) { closeNameForm(); return; }
      const err = validateName(name, k.id);
      if (err) { hooks.onMessage(err, 'error', 4000); els.nameInput.focus(); return; }
      const oldName = k.name;
      k.name = name;
      putKiln(k).then(() => {
        closeNameForm();
        render();
        hooks.onChange(false);
      }).catch((e) => {
        k.name = oldName;
        reportError(e);
      });
    }
  }

  // ===== 삭제 =====
  function deleteCurrent() {
    const k = current();
    if (!k) return;
    if (!window.confirm('"' + k.name + '" 가마를 삭제할까요?\n(이 가마로 기록한 소성 기록은 지워지지 않습니다.)')) return;
    if (pendingSave === k) { clearTimeout(saveTimer); pendingSave = null; }
    deleteKiln(k.id).then(() => {
      kilns = kilns.filter((x) => x.id !== k.id);
      closeNameForm();
      select(kilns.length ? kilns[0].id : null);
    }).catch(reportError);
  }

  // ===== 화면 =====
  // 자릿수/판독 주기 선택지 채우기
  function populateOptions() {
    for (let i = MIN_DIGITS; i <= MAX_DIGITS; i++) {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = i + '자리';
      els.digitsSelect.appendChild(opt);
    }
    READ_INTERVAL_OPTIONS.forEach((sec) => {
      const opt = document.createElement('option');
      opt.value = String(sec);
      opt.textContent = sec + '초';
      els.intervalSelect.appendChild(opt);
    });
  }

  function render() {
    const sel = els.kilnSelect;
    const k = current();
    sel.innerHTML = '';
    if (kilns.length === 0) {
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = '등록된 가마 없음';
      sel.appendChild(empty);
    } else {
      kilns.forEach((item) => {
        const opt = document.createElement('option');
        opt.value = item.id;
        opt.textContent = item.name;
        sel.appendChild(opt);
      });
      sel.value = currentId || '';
    }
    sel.disabled = kilns.length === 0;
    els.renameKilnBtn.disabled = !k;
    els.deleteKilnBtn.disabled = !k;
    els.addKilnBtn.classList.toggle('primary', kilns.length === 0); // 가마가 없으면 추가 버튼 강조

    els.kilnSettings.hidden = true;
    if (!k) return;
    els.digitsSelect.value = String(k.digits);
    els.intervalSelect.value = String(k.readIntervalSec);
  }

  function bindEvents() {
    els.kilnSelect.addEventListener('change', () => select(els.kilnSelect.value));
    els.addKilnBtn.addEventListener('click', () => openNameForm('add'));
    els.renameKilnBtn.addEventListener('click', () => openNameForm('rename'));
    els.deleteKilnBtn.addEventListener('click', deleteCurrent);
    els.nameOkBtn.addEventListener('click', submitNameForm);
    els.nameCancelBtn.addEventListener('click', closeNameForm);
    els.nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submitNameForm(); }
      else if (e.key === 'Escape') { closeNameForm(); }
    });

    els.digitsSelect.addEventListener('change', () => {
      const d = parseInt(els.digitsSelect.value, 10);
      update({ digits: (d >= MIN_DIGITS && d <= MAX_DIGITS) ? d : DEFAULT_DIGITS });
      hooks.onChange(false);
    });
    els.intervalSelect.addEventListener('change', () => {
      const sec = parseInt(els.intervalSelect.value, 10);
      update({ readIntervalSec: READ_INTERVAL_OPTIONS.indexOf(sec) >= 0 ? sec : DEFAULT_READ_INTERVAL_SEC });
      hooks.onChange(false);
    });

    // 페이지를 떠나기 전에 모아 둔 설정 저장
    window.addEventListener('pagehide', flushSave);
  }

  populateOptions();
  bindEvents();

  return { load, current, update, clearAllRois, select, render, hasKilns: () => kilns.length > 0 };
}
