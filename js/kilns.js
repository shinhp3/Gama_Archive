// ===== 가마 관리 =====
// 가마 목록 불러오기·추가·이름 변경·삭제·선택, 가마별 설정(자릿수·판독 주기 등) 저장

import {
  PREF_LAST_KILN_ID, MAX_NAME_LENGTH,
  DEFAULT_DIGITS, MIN_DIGITS, MAX_DIGITS,
  READ_INTERVAL_OPTIONS, DEFAULT_READ_INTERVAL_SEC, DEFAULT_POLARITY,
  THRESHOLD_OFFSET_LIMIT, SHEAR_LIMIT, DEFAULT_SEG_ON_RATIO, MIN_SEG_ON_RATIO, MAX_SEG_ON_RATIO
} from './config.js';
import {
  getKilns, putKiln, deleteKiln, getPref, setPref, removePref,
  readLegacyKilns, clearLegacyKilns
} from './db.js';

const SAVE_DELAY_MS = 400; // 슬라이더처럼 값이 연속으로 바뀔 때 모았다가 저장하는 시간

function isNum(v) { return typeof v === 'number' && isFinite(v); }
// 범위 안의 숫자면 그대로, 아니면 기본값
function numInRange(v, min, max, def) { return (isNum(v) && v >= min && v <= max) ? v : def; }

function makeId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function isValidRoi(r) {
  return !!r && typeof r === 'object' &&
    isNum(r.x) && isNum(r.y) && isNum(r.w) && isNum(r.h) &&
    r.x >= 0 && r.y >= 0 && r.w > 0 && r.h > 0 &&
    r.x + r.w <= 1.0001 && r.y + r.h <= 1.0001;
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
    roi: isValidRoi(raw.roi) ? { x: raw.roi.x, y: raw.roi.y, w: raw.roi.w, h: raw.roi.h } : null,
    digits,
    polarity: raw.polarity === 'dark' ? 'dark' : DEFAULT_POLARITY,
    redLedMode: raw.redLedMode === true,
    thresholdOffset: Math.round(numInRange(raw.thresholdOffset, -THRESHOLD_OFFSET_LIMIT, THRESHOLD_OFFSET_LIMIT, 0)),
    shear: numInRange(raw.shear, -SHEAR_LIMIT, SHEAR_LIMIT, 0),
    segOnRatio: numInRange(raw.segOnRatio, MIN_SEG_ON_RATIO, MAX_SEG_ON_RATIO, DEFAULT_SEG_ON_RATIO),
    readIntervalSec: READ_INTERVAL_OPTIONS.indexOf(raw.readIntervalSec) >= 0 ? raw.readIntervalSec : DEFAULT_READ_INTERVAL_SEC,
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

    els.kilnSettings.hidden = !k;
    els.recordKilnName.textContent = k ? k.name : '가마 없음';
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

  return { load, current, update, select, render, hasKilns: () => kilns.length > 0 };
}
