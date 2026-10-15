// ===== 진입점 =====
// 화면 요소를 찾아 각 모듈을 연결하고, 탭 전환과 이벤트 처리를 담당

import { APP_VERSION, PREVIEW_INTERVAL_MS } from './config.js';
import { initDb } from './db.js';
import { createCamera } from './camera.js';
import { createRoiEditor } from './roi.js';
import { createKilnManager } from './kilns.js';

const TABS = ['record', 'history'];
const ROI_RESET_MESSAGE = '화면 방향이 바뀌어 영역이 초기화되었습니다. 영역 버튼을 눌러 영역을 다시 지정해 주세요.';

// 기기 화면 방향. iPad Split View처럼 창 크기만 바뀌는 경우와 구분하려고 기기 방향 정보를 먼저 사용
function screenOrientation() {
  const so = window.screen && window.screen.orientation;
  if (so && typeof so.type === 'string') return so.type.indexOf('portrait') === 0 ? 'portrait' : 'landscape';
  if (typeof window.orientation === 'number') return Math.abs(window.orientation) === 90 ? 'landscape' : 'portrait';
  return window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait';
}

function getElements() {
  const $ = (id) => document.getElementById(id);
  return {
    message: $('message'),
    views: { record: $('viewRecord'), history: $('viewHistory') },
    tabButtons: Array.prototype.slice.call(document.querySelectorAll('.tabbar .tab')),
    roiEditBtn: $('roiEditBtn'),
    cameraBtn: $('cameraBtn'),
    videoWrap: $('videoWrap'),
    video: $('video'),
    overlay: $('overlay'),
    videoPlaceholder: $('videoPlaceholder'),
    previewCanvas: $('previewCanvas'),
    previewPlaceholder: $('previewPlaceholder'),
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
    { overlay: els.overlay, previewCanvas: els.previewCanvas, previewPlaceholder: els.previewPlaceholder },
    {
      camera,
      getKiln: () => kilns.current(),
      onMessage: showMessage,
      onCommit: handleRoiCommit
    }
  );

  function refreshCameraView() {
    roi.scheduleDraw();
    roi.updatePreview();
  }

  // 화면이 자동 회전으로 가로↔세로 바뀌면 지정해 둔 영역을 초기화하고 다시 지정하라고 안내
  let lastOrientation = screenOrientation();
  function checkOrientation() {
    const now = screenOrientation();
    if (now === lastOrientation) return;
    lastOrientation = now;
    roi.cancelDrag();
    if (kilns.clearAllRois()) {
      showMessage(ROI_RESET_MESSAGE, 'error');
    }
    refreshCameraView();
  }

  // ===== 탭 전환 =====
  function showTab(tab) {
    if (TABS.indexOf(tab) < 0) return;
    TABS.forEach((t) => { els.views[t].hidden = t !== tab; });
    els.tabButtons.forEach((btn) => {
      if (btn.dataset.tab === tab) {
        btn.setAttribute('aria-current', 'page');
      } else {
        btn.removeAttribute('aria-current');
      }
    });
    if (tab !== 'record') setRoiEditing(false);
    refreshCameraView();
    window.scrollTo(0, 0);
  }

  // ===== 영역 지정 모드 (카메라 옆 영역 버튼으로 켜고 끔) =====
  function setRoiEditing(on) {
    const next = !!on && camera.isRunning() && !!kilns.current();
    if (roi.isEditable() === next) return;
    roi.setEditable(next);
    els.roiEditBtn.setAttribute('aria-pressed', next ? 'true' : 'false');
    if (next) {
      showMessage('영상 위를 드래그해 온도 표시창 영역을 지정하세요. 다 되면 영역 버튼을 다시 누르세요.', 'ok');
    } else {
      hideMessage();
    }
    refreshCameraView();
  }

  // 카메라가 켜져 있고 가마가 있을 때만 영역 버튼 사용 가능
  function updateRoiButton() {
    const usable = camera.isRunning() && !!kilns.current();
    els.roiEditBtn.disabled = !usable;
    if (!usable) setRoiEditing(false);
  }

  // 영역이 하나도 없으면 지정 방법 안내
  function guideRoi() {
    const k = kilns.current();
    if (!k || k.roi || roi.isEditable()) return;
    if (camera.isRunning()) {
      showMessage('영역 버튼을 누른 뒤 영상 위를 드래그해 온도 표시창 영역을 지정하세요.', 'ok');
    } else {
      showMessage('"카메라 시작"을 누른 뒤 영역 버튼으로 온도 표시창 영역을 지정하세요.', 'ok');
    }
  }

  // ===== 가마 =====
  function handleKilnChange(switched) {
    updateRoiButton();
    if (switched) {
      roi.cancelDrag();
      const k = kilns.current();
      if (!k) {
        showMessage('"추가"를 눌러 가마를 등록하세요.', 'info');
      } else if (!k.roi) {
        guideRoi();
      } else if (!roi.isEditable()) {
        hideMessage();
      }
    }
    refreshCameraView();
  }

  function handleRoiCommit(newRoi) {
    kilns.update({ roi: newRoi });
    refreshCameraView();
  }

  // ===== 카메라 =====
  function handleCameraStarted() {
    updateRoiButton();
    const k = kilns.current();
    if (!k) {
      showMessage('"추가"를 눌러 가마를 먼저 등록하세요.', 'info');
    } else if (!k.roi) {
      guideRoi();
    } else {
      hideMessage();
    }
    roi.scheduleDraw();
  }

  function stopCamera() {
    camera.stop();
    roi.cancelDrag();
    updateRoiButton();
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

    // 영역 지정 모드 켜기/끄기
    els.roiEditBtn.addEventListener('click', () => setRoiEditing(!roi.isEditable()));

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

    // 영상 크기 정보가 준비되거나 바뀌면 다시 그림
    ['loadedmetadata', 'playing', 'resize'].forEach((ev) => {
      els.video.addEventListener(ev, refreshCameraView);
    });

    // 화면 크기/회전 변화 대응 (iOS는 회전 직후 크기·방향 값이 늦게 반영되므로 한 번 더 확인)
    const onLayoutChange = () => {
      checkOrientation();
      roi.scheduleDraw();
      setTimeout(() => {
        checkOrientation();
        roi.scheduleDraw();
      }, 300);
    };
    window.addEventListener('resize', onLayoutChange);
    window.addEventListener('orientationchange', onLayoutChange);
    if (window.screen && window.screen.orientation && typeof window.screen.orientation.addEventListener === 'function') {
      window.screen.orientation.addEventListener('change', onLayoutChange);
    }
    if (typeof window.ResizeObserver === 'function') {
      new window.ResizeObserver(() => { roi.scheduleDraw(); }).observe(els.videoWrap);
    }

    // 다른 앱에 다녀오면 iOS가 영상을 멈추는 경우가 있어 다시 재생
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      camera.resumeIfPaused();
      checkOrientation(); // 다른 앱에 있는 동안 회전했을 수 있음
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
        showMessage('"추가"를 눌러 가마를 등록하세요.', 'info');
      }
    })
    .catch((err) => {
      showMessage(err && err.message ? err.message : '저장소를 열지 못했습니다.', 'error');
    });

  // 1초마다 영역 확대 미리보기 갱신
  setInterval(roi.updatePreview, PREVIEW_INTERVAL_MS);
}

startApp();
