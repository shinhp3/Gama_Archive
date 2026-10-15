// ===== 진입점 =====
// 화면 요소를 찾아 각 모듈을 연결하고, 탭 전환과 이벤트 처리를 담당

import { APP_VERSION, PREVIEW_INTERVAL_MS, LIVE_READ_MS, CAMERA_IDEAL_W, CAMERA_IDEAL_H } from './config.js?v=0.3.1';
import { initDb } from './db.js?v=0.3.1';
import { createCamera } from './camera.js?v=0.3.1';
import { createRoiEditor } from './roi.js?v=0.3.1';
import { createKilnManager } from './kilns.js?v=0.3.1';
import { readKilnFrame, createLiveDisplay } from './reading.js?v=0.3.1';
import { createCalibrationPanel } from './calibration.js?v=0.3.1';
import { segmentQuads } from './recognizer.js?v=0.3.1';

const TABS = ['record', 'history'];
const ROI_RESET_MESSAGE = '화면 방향이 바뀌어 영역이 초기화되었습니다. 영역 버튼을 눌러 숫자를 노란 틀에 다시 맞춰 주세요.';

// 주소에 ?debug=1 을 붙이면 카메라 해상도와 확대/영역 값을 영상 아래에 표시
function isDebugMode() {
  try {
    return new URLSearchParams(window.location.search).get('debug') === '1';
  } catch (e) {
    return false;
  }
}

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
    zoomBar: $('zoomBar'),
    zoomInput: $('zoomInput'),
    zoomValue: $('zoomValue'),
    zoomInBtn: $('zoomInBtn'),
    zoomOutBtn: $('zoomOutBtn'),
    zoomResetBtn: $('zoomResetBtn'),
    debugInfo: $('debugInfo'),
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
    liveTemp: $('liveTemp'),
    liveConf: $('liveConf'),
    liveReason: $('liveReason'),
    calib: {
      panel: $('kilnSettings'),
      expectedInput: $('expectedInput'),
      calibSummary: $('calibSummary'),
      calibMatch: $('calibMatch'),
      binaryBox: $('binaryBox'),
      binaryCanvas: $('binaryCanvas'),
      calibTableWrap: $('calibTableWrap'),
      calibRows: $('calibRows'),
      digitAspectInput: $('digitAspectInput'),
      digitAspectValue: $('digitAspectValue'),
      redLedInput: $('redLedInput'),
      polaritySelect: $('polaritySelect'),
      thresholdInput: $('thresholdInput'),
      thresholdValue: $('thresholdValue'),
      shearInput: $('shearInput'),
      shearValue: $('shearValue'),
      segOnInput: $('segOnInput'),
      segOnValue: $('segOnValue')
    },
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
    {
      video: els.video,
      overlay: els.overlay,
      previewCanvas: els.previewCanvas,
      previewPlaceholder: els.previewPlaceholder,
      zoomBar: els.zoomBar,
      zoomInput: els.zoomInput,
      zoomValue: els.zoomValue,
      zoomInBtn: els.zoomInBtn,
      zoomOutBtn: els.zoomOutBtn,
      zoomResetBtn: els.zoomResetBtn
    },
    {
      camera,
      getKiln: () => kilns.current(),
      onCommit: (patch, soon) => kilns.update(patch, soon)
    }
  );

  const live = createLiveDisplay(els);
  const calib = createCalibrationPanel(els.calib, {
    getKiln: () => kilns.current(),
    update: kilns.update,
    onSettingsChange: () => {
      roi.scheduleDraw(); // 자릿수 폭/높이 비율이 바뀌면 틀 모양과 영역도 다시 계산
      readNow();
    }
  });

  const debugMode = isDebugMode();
  els.debugInfo.hidden = !debugMode;
  function updateDebug() {
    if (!debugMode) return;
    const lines = [];
    if (camera.isRunning()) {
      const size = camera.videoSize();
      const t = camera.trackSettings();
      let cam = '카메라 ' + size.width + '×' + size.height + ' (요청 ' + CAMERA_IDEAL_W + '×' + CAMERA_IDEAL_H + ')';
      if (t && t.width) cam += ' · 트랙 ' + t.width + '×' + t.height + (t.frameRate ? ' ' + Math.round(t.frameRate) + 'fps' : '');
      lines.push(cam);
    } else {
      lines.push('카메라 꺼짐');
    }
    const v = roi.currentView();
    if (v) lines.push('배율 ' + v.zoom.toFixed(2) + ' · 중심 ' + v.cx.toFixed(4) + ', ' + v.cy.toFixed(4));
    const k = kilns.current();
    if (k && k.roi) {
      lines.push('영역 x ' + k.roi.x.toFixed(4) + ' y ' + k.roi.y.toFixed(4) + ' w ' + k.roi.w.toFixed(4) + ' h ' + k.roi.h.toFixed(4));
    } else {
      lines.push('영역 지정 안 됨');
    }
    els.debugInfo.textContent = lines.join('\n');
  }

  function refreshCameraView() {
    roi.scheduleDraw();
    roi.updatePreview();
    readNow();
  }

  // 현재 프레임을 판독해 현재 인식값·보정 패널·영상 위 샘플 위치를 갱신
  function readNow() {
    const k = kilns.current();
    const read = readKilnFrame(camera, k);
    live.show(read.result, read.reason);
    calib.show(read.result, read.reason);
    roi.setSamples(read.result && calib.isOpen() ? segmentQuads(read.result, k.shear) : null);
  }

  // 카메라 영상 프레임 방향 (영상이 없으면 null). iPad는 회전하면 프레임 가로·세로도 바뀜
  function frameOrientation() {
    if (!camera.isFrameReady()) return null;
    const size = camera.videoSize();
    return size.width >= size.height ? 'landscape' : 'portrait';
  }

  // 화면이 자동 회전으로 가로↔세로 바뀌면 지정해 둔 영역을 초기화하고 다시 지정하라고 안내
  // 화면 방향 또는 영상 프레임 방향 중 하나라도 바뀌면 회전으로 봄
  let lastScreen = screenOrientation();
  let lastFrame = frameOrientation();
  function checkOrientation() {
    const screenNow = screenOrientation();
    const frameNow = frameOrientation();
    const rotated = screenNow !== lastScreen || (frameNow && lastFrame && frameNow !== lastFrame);
    lastScreen = screenNow;
    if (frameNow) lastFrame = frameNow;
    if (!rotated) return;
    roi.cancelGesture();
    setRoiEditing(false);
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
      showMessage('두 손가락으로 벌리거나 오므려 확대/축소하고, 한 손가락으로 끌어 온도 숫자를 노란 틀에 맞추세요. 다 되면 영역 버튼을 다시 누르세요.', 'ok');
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
      showMessage('영역 버튼을 누른 뒤 영상을 확대·이동해 온도 숫자를 노란 틀에 맞추세요.', 'ok');
    } else {
      showMessage('"카메라 시작"을 누른 뒤 영역 버튼으로 온도 숫자를 노란 틀에 맞추세요.', 'ok');
    }
  }

  // ===== 가마 =====
  function handleKilnChange(switched) {
    updateRoiButton();
    calib.render();
    if (switched) {
      roi.cancelGesture();
      if (roi.isEditable()) roi.setEditable(true); // 영역 지정 중에 가마를 바꾸면 바뀐 가마도 지금 틀 위치로 지정
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
    roi.cancelGesture();
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

    // 영역 지정(영상 확대/이동) 모드 켜기/끄기
    els.roiEditBtn.addEventListener('click', () => setRoiEditing(!roi.isEditable()));

    // 영상 크기 정보가 준비되거나 바뀌면(회전 시 프레임 가로·세로가 바뀜) 방향 확인 후 다시 그림
    ['loadedmetadata', 'playing', 'resize'].forEach((ev) => {
      els.video.addEventListener(ev, () => {
        checkOrientation();
        refreshCameraView();
      });
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

    // 판독 보정 패널을 열면 바로 판독해 결과와 샘플 위치 표시, 닫으면 샘플 위치 숨김
    els.calib.panel.addEventListener('toggle', readNow);

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
      calib.render();
      refreshCameraView();
      if (!kilns.hasKilns()) {
        showMessage('"추가"를 눌러 가마를 등록하세요.', 'info');
      }
    })
    .catch((err) => {
      showMessage(err && err.message ? err.message : '저장소를 열지 못했습니다.', 'error');
    });

  // 1초마다 영역 확대 미리보기 갱신. 회전 이벤트가 오지 않는 경우에 대비해 방향도 함께 확인
  setInterval(() => {
    checkOrientation();
    roi.updatePreview();
    updateDebug();
  }, PREVIEW_INTERVAL_MS);

  // 현재 인식값 갱신
  setInterval(readNow, LIVE_READ_MS);
}

startApp();
