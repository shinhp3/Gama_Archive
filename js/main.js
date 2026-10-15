// ===== 진입점 =====
// 화면 요소를 찾아 각 모듈을 연결하고, 탭 전환과 이벤트 처리를 담당

import { APP_VERSION, PREVIEW_INTERVAL_MS } from './config.js';
import { initDb } from './db.js';
import { createCamera } from './camera.js';
import { createRoiEditor } from './roi.js';
import { createKilnManager } from './kilns.js';

const TABS = ['record', 'history', 'settings'];

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
    if (activeTab !== 'settings' || !k || k.roi) return;
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
      } else if (!k.roi) {
        guideRoi();
      } else {
        hideMessage();
      }
    }
    refreshCameraView();
  }

  function handleRoiCommit(newRoi) {
    kilns.update({ roi: newRoi });
    hideMessage();
    refreshCameraView();
  }

  // ===== 카메라 =====
  function handleCameraStarted() {
    const k = kilns.current();
    if (!k) {
      showMessage('설정 탭에서 가마를 먼저 추가하세요.', 'info');
    } else if (!k.roi) {
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

    // 영상 크기 정보가 준비되거나 바뀌면 다시 그림
    ['loadedmetadata', 'playing', 'resize'].forEach((ev) => {
      els.video.addEventListener(ev, refreshCameraView);
    });

    // 화면 크기/회전 변화 대응 (iOS는 회전 직후 크기 값이 늦게 반영되므로 한 번 더 그림)
    const onLayoutChange = () => {
      roi.scheduleDraw();
      setTimeout(roi.scheduleDraw, 300);
    };
    window.addEventListener('resize', onLayoutChange);
    window.addEventListener('orientationchange', onLayoutChange);
    if (typeof window.ResizeObserver === 'function') {
      new window.ResizeObserver(() => { roi.scheduleDraw(); }).observe(els.videoWrap);
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
}

startApp();
