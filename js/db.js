// ===== 데이터 저장 =====
// IndexedDB(가마·소성·기록)와 localStorage(간단한 기억값) 접근은 이 파일에서만 함

import { DB_NAME, DB_VERSION, LEGACY_KEY_KILNS, LEGACY_KEY_LAST } from './config.js?v=0.3.0';

const OPEN_TIMEOUT_MS = 8000; // 일부 iOS 버전에서 open 요청이 응답 없이 멈추는 경우 대비

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      finish(reject, new Error('저장소(IndexedDB)가 응답하지 않습니다. 페이지를 새로고침하세요.'));
    }, OPEN_TIMEOUT_MS);

    let req;
    try {
      if (!window.indexedDB) throw new Error('no indexedDB');
      req = window.indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      finish(reject, new Error('이 브라우저에서는 저장소(IndexedDB)를 사용할 수 없습니다. 개인정보 보호 브라우징을 끄고 Safari로 접속하세요.'));
      return;
    }

    // 처음 만들 때 이후 단계에서 쓸 저장소까지 모두 생성 (버전 올리기 최소화)
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kilns')) {
        db.createObjectStore('kilns', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('firings')) {
        const firings = db.createObjectStore('firings', { keyPath: 'id' });
        firings.createIndex('kilnId', 'kilnId');
        firings.createIndex('startedAt', 'startedAt');
      }
      if (!db.objectStoreNames.contains('readings')) {
        const readings = db.createObjectStore('readings', { keyPath: 'id', autoIncrement: true });
        readings.createIndex('firingId', 'firingId');
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // 다른 탭에서 DB 버전을 올리면 연결을 닫아 막지 않도록
      db.onversionchange = () => { db.close(); dbPromise = null; };
      finish(resolve, db);
    };
    req.onerror = () => {
      finish(reject, new Error('저장소(IndexedDB)를 열지 못했습니다. (' + (req.error && req.error.name) + ')'));
    };
    req.onblocked = () => {
      finish(reject, new Error('다른 탭에서 이 페이지가 열려 있어 저장소를 열 수 없습니다. 다른 탭을 닫고 새로고침하세요.'));
    };
  });
  // 실패하면 다음 호출에서 다시 시도할 수 있게
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

// 트랜잭션 하나를 실행하고, 완료되면 work가 돌려준 요청의 결과로 resolve
function run(storeName, mode, work) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    let tx;
    try {
      tx = db.transaction(storeName, mode);
    } catch (e) {
      reject(new Error('저장소 작업을 시작하지 못했습니다. (' + e.name + ')'));
      return;
    }
    const req = work(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(new Error('저장소 작업에 실패했습니다. (' + (tx.error && tx.error.name) + ')'));
    tx.onabort = () => {
      const name = tx.error && tx.error.name;
      reject(new Error(name === 'QuotaExceededError'
        ? '저장 공간이 부족합니다. 오래된 기록을 백업한 뒤 삭제하세요.'
        : '저장소 작업이 취소되었습니다. (' + name + ')'));
    };
  }));
}

// 저장소 준비 (앱 시작 시 오류를 일찍 알리기 위해 사용)
export function initDb() {
  return openDb().then(() => undefined);
}

// ===== 가마 =====
export function getKilns() {
  return run('kilns', 'readonly', (store) => store.getAll()).then((list) => {
    (list || []).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    return list || [];
  });
}

export function putKiln(kiln) {
  return run('kilns', 'readwrite', (store) => store.put(kiln)).then(() => kiln);
}

export function deleteKiln(id) {
  return run('kilns', 'readwrite', (store) => store.delete(id)).then(() => undefined);
}

// ===== 간단한 기억값 (localStorage) =====
// 개인정보 보호 모드 등에서 localStorage가 실패해도 메모리에 보관해 계속 동작하게 함
const memoryPrefs = {};

export function getPref(key) {
  try {
    const v = window.localStorage.getItem(key);
    if (v !== null) return v;
  } catch (e) { /* 메모리 값 사용 */ }
  return Object.prototype.hasOwnProperty.call(memoryPrefs, key) ? memoryPrefs[key] : null;
}

export function setPref(key, value) {
  memoryPrefs[key] = String(value);
  try {
    window.localStorage.setItem(key, String(value));
    return true;
  } catch (e) {
    return false;
  }
}

export function removePref(key) {
  delete memoryPrefs[key];
  try {
    window.localStorage.removeItem(key);
  } catch (e) { /* 무시 */ }
}

// ===== 이전 버전(v0.1) 가마 설정 =====
// { kilns: 원본 배열, lastName: 마지막 선택 이름 } 또는 null
export function readLegacyKilns() {
  let raw = null;
  let lastName = null;
  try {
    raw = window.localStorage.getItem(LEGACY_KEY_KILNS);
    lastName = window.localStorage.getItem(LEGACY_KEY_LAST);
  } catch (e) {
    return null;
  }
  if (!raw) return null;
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? { kilns: list, lastName } : null;
  } catch (e) {
    return null;
  }
}

export function clearLegacyKilns() {
  try {
    window.localStorage.removeItem(LEGACY_KEY_KILNS);
    window.localStorage.removeItem(LEGACY_KEY_LAST);
  } catch (e) { /* 무시 */ }
}
