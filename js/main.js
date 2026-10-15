// ===== 진입점 =====
// 화면 요소를 찾아 각 모듈을 연결하고, 탭 전환과 이벤트 처리를 담당

import { APP_VERSION, PREVIEW_INTERVAL_MS } from './config.js';
import { initDb } from './db.js';
import { createCamera } from './camera.js';
import { createRoiEditor, getVideoLayout, roiKey, roiFor } from './roi.js';
import { createKilnManager } from './kilns.js';

const TABS = ['record', 'history', 'settings'];
const RELAYOUT_LATE_MS = 300;   // iOS는 회전 직후 레이아웃/영상 크기가 늦게 바뀌므로 한 번 더 계산
const DEBUG_INTERVAL_MS = 500;

// 방향과 상관없이 영역이 하나라도 저장돼 있는지
function hasAnyRoi(k) {
  return !!(k && (k.roiLandscape || k.roiPortrait || k.roi));
}

function fmtRect(r) {
  if (!r) return '없음';
  const f = (v) => (Math.round(v * 1000) / 1000);
  return f(r.x) + ', ' + f(r.y) + ', ' + f(r.w) + ' × ' + f(r.h);
}

function getElements() {
  const $ = (id) => document.getElementById(id);
  return {
    message: $('message'),
    views: { record: $('viewRecord'), history: $('viewHistory'), settings: $('viewSettings') },
    tabButtons: Array.prototype.slice.call(document.querySelectorAll('.tabbar .tab')),
    cameraSlots: Array.prototype.slice.call(document.querySelectorAll('[data-camera-slot]')),
    cameraCard: $('cameraCard'),
    cameraBtn: $('cameraBtn'),
    videoWrap: $('videoWrap'),
    video: $('video'),
    overlay: $('overlay'),
    videoPlaceholder: $('videoPlaceholder'),
    previewCanvas: $('previewCanvas'),
    previewPlaceholder: $('previewPlaceholder'),
    recordKilnName: $('recordKilnName'),
    kilnSelect: $('kilnSelect'),
    addKilnBtn: $('addKilnBtn'),
    renameKilnBtn: $('renameKilnBtn'),
    deleteKilnBtn: $('deleteKilnBtn'),
    nameForm: $('nameForm'),
    nameFormLabel: $('nameFormLabel'),
    nameInput: $('nameInput'),
    nameOkBtn: $('nameOkBtn'),
    nameCancelBtn: $('nameCancelBtn'),
    kilnSettings: $('kilnSettings'),
    digitsSelect: $('digitsSelect'),
    intervalSelect: $('intervalSelect'),
    appVersion: $('appVersion')
  };
}

function startApp() {
  const els = getElements();
  let activeTab = 'record';

  // ===== 안내 메시지 =====
  let messageTimer = null;
  function showMessage(text, type, autoHideMs) {
    clearTimeout(messageTimer);
    els.message.textContent = text;
    els.message.className = 'message ' + (type || 'info');
    els.message.hidden = false;
    if (autoHideMs) {
      messageTimer = setTimeout(hideMessage, autoHideMs);
    }
  }
  function hideMessage() {
    clearTimeout(messageTimer);
    els.message.hidden = true;
  }

  // ===== 모듈 연결 =====
  const kilns = createKilnManager(els, {
    onMessage: showMessage,
    onChange: handleKilnChange
  });

  const camera = createCamera(
    { video: els.video, button: els.cameraBtn, placeholder: els.videoPlaceholder },
    {
      onMessage: showMessage,
      onStarted: handleCameraStarted,
      onEnded: handleCameraEnded
    }
  );

  const roi = createRoiEditor(
    { video: els.video, overlay: els.overlay, previewCanvas: els.previewCanvas, previewPlaceholder: els.previewPlaceholder },
    {
      camera,
      getKiln: () => kilns.current(),
      onMessage: showMessage,
      onCommit: handleRoiCommit
    }
  );

  // ?debug=1 일 때만 화면 구석에 레이아웃 정보 표시
  const debugEl = createDebugView();

  function refreshCameraView() {
    // 방향 구분 전 영역은 실제 프레임 방향을 알게 된 시점에 그 방향의 영역으로 옮김
    if (camera.isFrameReady()) {
      kilns.adoptLegacyRoi(getVideoLayout(els.video).orientation);
    }
    roi.scheduleDraw();
    roi.updatePreview();
    updateDebug();
  }

  // 회전/크기 변화 직후, requestAnimationFrame 두 번 뒤, 약 300ms 뒤에 각각 다시 계산
  function scheduleRelayout() {
    refreshCameraView();
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(refreshCameraView);
    });
    setTimeout(() => {
      refreshCameraView();
      camera.resumeIfPaused(); // 회전 중 iOS가 영상을 멈춘 경우 다시 재생
    }, RELAYOUT_LATE_MS);
  }

  function createDebugView() {
    let on = false;
    try {
      on = new URLSearchParams(window.location.search).get('debug') === '1';
    } catch (e) { /* 무시 */ }
    if (!on) return null;
    const el = document.createElement('div');
    el.className = 'debug-info';
    document.body.appendChild(el);
    return el;
  }

  function updateDebug() {
    if (!debugEl) return;
    const L = getVideoLayout(els.video);
    const r = (v) => Math.round(v);
    const k = kilns.current();
    debugEl.textContent = [
      '방향: ' + (L.orientation || '-'),
      'video: ' + L.videoW + '×' + L.videoH,
      'client: ' + L.clientW + '×' + L.clientH,
      'contain: ' + (L.box ? r(L.box.x) + ', ' + r(L.box.y) + ', ' + r(L.box.w) + '×' + r(L.box.h) : '-'),
      'ROI(' + (L.orientation || '-') + '): ' + fmtRect(roiFor(k, L.orientation))
    ].join('\n');
  }

  // ===== 탭 전환 =====
  function showTab(tab) {
    if (TABS.indexOf(tab) < 0) return;
    activeTab = tab;
    TABS.forEach((t) => { els.views[t].hidden = t !== tab; });
    els.tabButtons.forEach((btn) => {
      if (btn.dataset.tab === tab) {
        btn.setAttribute('aria-current', 'page');
      } else {
        btn.removeAttribute('aria-current');
      }
    });

    // 카메라 카드를 현재 탭의 자리로 옮김 (영상 스트림은 그대로 유지)
    const slot = els.cameraSlots.filter((s) => s.dataset.cameraSlot === tab)[0];
    if (slot && els.cameraCard.parentNode !== slot) {
      slot.appendChild(els.cameraCard);
      // iOS는 video 요소를 옮기면 재생이 멈추는 경우가 있어 다시 재생
      camera.resumeIfPaused();
    }

    // 영역은 설정 화면에서만 편집
    roi.setEditable(tab === 'settings');
    refreshCameraView();
    window.scrollTo(0, 0);
    if (tab === 'settings') guideRoi();
  }

  // 설정 화면에서 영역이 없으면 지정 방법 안내
  function guideRoi() {
    const k = kilns.current();
    if (activeTab !== 'settings' || !k) return;
    if (camera.isFrameReady() ? roiFor(k, getVideoLayout(els.video).orientation) : hasAnyRoi(k)) return;
    if (camera.isRunning()) {
      showMessage('영상 위를 드래그해 온도 표시창 영역을 지정하세요.', 'ok');
    } else {
      showMessage('"카메라 시작"을 누른 뒤 영상 위를 드래그해 온도 표시창 영역을 지정하세요.', 'ok');
    }
  }

  // ===== 가마 =====
  function handleKilnChange(switched) {
    if (switched) {
      roi.cancelDrag();
      const k = kilns.current();
      if (!k) {
        showMessage('"추가"를 눌러 가마를 등록하세요.', 'info');
      } else if (!hasAnyRoi(k)) {
        guideRoi();
      } else {
        hideMessage();
      }
    }
    refreshCameraView();
  }

  // 드래그한 방향의 영역만 저장
  function handleRoiCommit(newRoi, orientation) {
    const patch = {};
    patch[roiKey(orientation)] = newRoi;
    kilns.update(patch);
    hideMessage();
    refreshCameraView();
  }

  // ===== 카메라 =====
  function handleCameraStarted() {
    const k = kilns.current();
    if (!k) {
      showMessage('설정 탭에서 가마를 먼저 추가하세요.', 'info');
    } else if (!hasAnyRoi(k)) {
      if (activeTab === 'settings') {
        guideRoi();
      } else {
        showMessage('설정 탭에서 영상 위를 드래그해 온도 표시창 영역을 지정하세요.', 'info');
      }
    } else {
      hideMessage();
    }
    roi.scheduleDraw();
  }

  function stopCamera() {
    camera.stop();
    roi.cancelDrag();
    refreshCameraView();
  }

  function handleCameraEnded() {
    stopCamera();
    showMessage('카메라 연결이 끊어졌습니다. "카메라 시작"을 다시 눌러주세요.', 'error');
  }

  // ===== 이벤트 연결 =====
  function bindEvents() {
    els.tabButtons.forEach((btn) => {
      btn.addEventListener('click', () => showTab(btn.dataset.tab));
    });

    // 카메라 시작/중지 (버튼 클릭 시에만 시작)
    els.cameraBtn.addEventListener('click', () => {
      if (camera.isRunning()) {
        stopCamera();
        hideMessage();
      } else {
        camera.start();
      }
    });

    // 영역 지정 드래그
    const ov = els.overlay;
    ov.addEventListener('pointerdown', roi.onPointerDown);
    ov.addEventListener('pointermove', roi.onPointerMove);
    ov.addEventListener('pointerup', roi.onPointerUp);
    ov.addEventListener('pointercancel', roi.onPointerUp);
    // touch-action을 지원하지 않는 구형 iOS 대비: 편집 중에는 오버레이 위 터치 스크롤/확대 차단
    ov.addEventListener('touchmove', (e) => { if (roi.isEditable()) e.preventDefault(); }, { passive: false });
    ov.addEventListener('gesturestart', (e) => { if (roi.isEditable()) e.preventDefault(); });
    ov.addEventListener('contextmenu', (e) => { e.preventDefault(); });

    // 영상 크기 정보가 준비되거나 바뀌면(회전 시 원본 프레임이 가로↔세로로 바뀜) 다시 계산
    ['loadedmetadata', 'playing', 'resize'].forEach((ev) => {
      els.video.addEventListener(ev, scheduleRelayout);
    });

    // 화면 크기/회전 변화 대응
    window.addEventListener('resize', scheduleRelayout);
    window.addEventListener('orientationchange', scheduleRelayout);
    if (window.screen && window.screen.orientation && typeof window.screen.orientation.addEventListener === 'function') {
      window.screen.orientation.addEventListener('change', scheduleRelayout);
    }
    if (typeof window.ResizeObserver === 'function') {
      new window.ResizeObserver(scheduleRelayout).observe(els.videoWrap);
    }

    // 다른 앱에 다녀오면 iOS가 영상을 멈추는 경우가 있어 다시 재생
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) camera.resumeIfPaused();
    });
  }

  // ===== 초기화 =====
  els.appVersion.textContent = APP_VERSION;
  bindEvents();
  showTab('record');

  initDb()
    .then(() => kilns.load())
    .then(() => {
      refreshCameraView();
      if (!kilns.hasKilns()) {
        showTab('settings');
        showMessage('"추가"를 눌러 가마를 등록하세요.', 'info');
      }
    })
    .catch((err) => {
      showMessage(err && err.message ? err.message : '저장소를 열지 못했습니다.', 'error');
    });

  // 1초마다 영역 확대 미리보기 갱신
  setInterval(roi.updatePreview, PREVIEW_INTERVAL_MS);
  if (debugEl) setInterval(updateDebug, DEBUG_INTERVAL_MS);
}

startApp();
