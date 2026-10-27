// ===== 진입점 =====
// 화면 요소를 찾아 각 모듈을 연결하고, 탭 전환과 이벤트 처리를 담당

import { APP_VERSION, PREVIEW_INTERVAL_MS, LIVE_READ_MS, CAMERA_IDEAL_W, CAMERA_IDEAL_H, OCR_LOCK_REVISION } from './config.js?v=0.3.28';
import { initDb } from './db.js?v=0.3.28';
import { createCamera } from './camera.js?v=0.3.28';
import { createRoiEditor, kilnSourceRegion, frameAspectRelation } from './roi.js?v=0.3.28';
import { markTiming, timingText } from './timings.js?v=0.3.28';
import { createKilnManager } from './kilns.js?v=0.3.28';
import { createReader, createLiveDisplay, recognitionMode, isRecognitionReady } from './reading.js?v=0.3.28';
import { formatTemp } from './ocr.js?v=0.3.28';
import { createOcrEngine } from './ocr.js?v=0.3.28';
import { createOcrPreprocessor } from './ocrPreprocess.js?v=0.3.28';
import { createCalibrationPanel } from './calibration.js?v=0.3.28';
import { segmentQuads } from './recognizer.js?v=0.3.28';
import { createRecorder } from './recorder.js?v=0.3.28';
import { createHistoryView } from './history.js?v=0.3.28';
import { exportArchive, parseArchive, importArchive } from './backup.js?v=0.3.28';

const TABS = ['record', 'history'];

// 주소에 ?debug=1 을 붙이면 카메라 해상도와 확대/영역 값을 영상 아래에 표시
function isDebugMode() {
  try {
    return new URLSearchParams(window.location.search).get('debug') === '1';
  } catch (e) {
    return false;
  }
}

function getElements() {
  const $ = (id) => document.getElementById(id);
  return {
    message: $('message'),
    views: { record: $('viewRecord'), history: $('viewHistory') },
    tabButtons: Array.prototype.slice.call(document.querySelectorAll('.tabbar .tab')),
    firingList: $('firingList'),
    firingListCard: $('firingList').parentElement,
    firingDetail: $('firingDetail'),
    backToListBtn: $('backToListBtn'),
    detailKilnName: $('detailKilnName'),
    detailStartTime: $('detailStartTime'),
    detailEndTime: $('detailEndTime'),
    detailDuration: $('detailDuration'),
    detailMaxTemp: $('detailMaxTemp'),
    detailReadingCount: $('detailReadingCount'),
    chartContainer: $('chartContainer'),
    readingsTable: $('readingsTable'),
    intervalBar: $('intervalBar'),
    deleteFiringBtn: $('deleteFiringBtn'),
    exportBackupBtn: $('exportBackupBtn'),
    importBackupBtn: $('importBackupBtn'),
    importBackupInput: $('importBackupInput'),
    roiEditBtn: $('roiEditBtn'),
    cameraBtn: $('cameraBtn'),
    verifyNotice: $('verifyNotice'),
    verifyNoticeText: $('verifyNoticeText'),
    readyDialog: $('readyDialog'),
    readyDialogTemp: $('readyDialogTemp'),
    readyDialogOk: $('readyDialogOk'),
    videoWrap: $('videoWrap'),
    video: $('video'),
    overlay: $('overlay'),
    videoPlaceholder: $('videoPlaceholder'),
    previewCanvas: $('previewCanvas'),
    previewPlaceholder: $('previewPlaceholder'),
    cameraZoomBar: $('cameraZoomBar'),
    cameraZoomInput: $('cameraZoomInput'),
    cameraZoomValue: $('cameraZoomValue'),
    exposureBar: $('exposureBar'),
    exposureInput: $('exposureInput'),
    exposureValue: $('exposureValue'),
    zoomBar: $('zoomBar'),
    zoomInput: $('zoomInput'),
    zoomValue: $('zoomValue'),
    zoomInBtn: $('zoomInBtn'),
    zoomOutBtn: $('zoomOutBtn'),
    zoomResetBtn: $('zoomResetBtn'),
    guideBar: $('guideBar'),
    guideInput: $('guideInput'),
    guideValue: $('guideValue'),
    aspectBar: $('aspectBar'),
    aspectInput: $('aspectInput'),
    aspectValue: $('aspectValue'),
    rotateBar: $('rotateBar'),
    rotateInput: $('rotateInput'),
    rotateValue: $('rotateValue'),
    rotateMinusBtn: $('rotateMinusBtn'),
    rotatePlusBtn: $('rotatePlusBtn'),
    rotateResetBtn: $('rotateResetBtn'),
    debugInfo: $('debugInfo'),
    debugImages: $('debugImages'),
    debugSourceCanvas: $('debugSourceCanvas'),
    debugInputCanvas: $('debugInputCanvas'),
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
    cameraTemp: $('cameraTemp'),
    cameraTempValue: $('cameraTempValue'),
    liveTemp: $('liveTemp'),
    confirmedTemp: $('confirmedTemp'),
    liveConf: $('liveConf'),
    liveReason: $('liveReason'),
    liveEngine: $('liveEngine'),
    liveState: $('liveState'),
    liveValid: $('liveValid'),
    validResetBtn: $('validResetBtn'),
    startFiringBtn: $('startFiringBtn'),
    endFiringBtn: $('endFiringBtn'),
    firingIdle: $('firingIdle'),
    firingActive: $('firingActive'),
    firingStartTime: $('firingStartTime'),
    firingElapsed: $('firingElapsed'),
    lastRecordTime: $('lastRecordTime'),
    recordState: $('recordState'),
    recordElapsed: $('recordElapsed'),
    calib: {
      panel: $('kilnSettings'),
      modeSelect: $('modeSelect'),
      ocrOptions: $('ocrOptions'),
      segOptions: $('segOptions'),
      ocrDiag: $('ocrDiag'),
      segDiag: $('segDiag'),
      ocrPreprocessSelect: $('ocrPreprocessSelect'),
      ocrSmoothSelect: $('ocrSmoothSelect'),
      engineState: $('engineState'),
      engineRetryBtn: $('engineRetryBtn'),
      ocrRaw: $('ocrRaw'),
      ocrValue: $('ocrValue'),
      ocrConf: $('ocrConf'),
      ocrTime: $('ocrTime'),
      ocrTiming: $('ocrTiming'),
      ocrModel: $('ocrModel'),
      ocrRoi: $('ocrRoi'),
      ocrVariant: $('ocrVariant'),
      ocrAttempts: $('ocrAttempts'),
      ocrImages: $('ocrImages'),
      ocrSourceCanvas: $('ocrSourceCanvas'),
      ocrInputCanvas: $('ocrInputCanvas'),
      expectedInput: $('expectedInput'),
      calibSummary: $('calibSummary'),
      calibMatch: $('calibMatch'),
      binaryBox: $('binaryBox'),
      binaryCanvas: $('binaryCanvas'),
      calibTableWrap: $('calibTableWrap'),
      calibRows: $('calibRows'),
      digitsField: $('digitsField'),
      digitAspectField: $('digitAspectField'),
      digitAspectInput: $('digitAspectInput'),
      digitAspectValue: $('digitAspectValue'),
      redLedField: $('redLedField'),
      redLedInput: $('redLedInput'),
      polarityField: $('polarityField'),
      polaritySelect: $('polaritySelect'),
      thresholdInput: $('thresholdInput'),
      thresholdValue: $('thresholdValue'),
      shearInput: $('shearInput'),
      shearValue: $('shearValue'),
      segOnInput: $('segOnInput'),
      segOnValue: $('segOnValue')
    },
    themeBtn: $('themeBtn'),
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
      zoomResetBtn: els.zoomResetBtn,
      guideBar: els.guideBar,
      guideInput: els.guideInput,
      guideValue: els.guideValue,
      aspectBar: els.aspectBar,
      aspectInput: els.aspectInput,
      aspectValue: els.aspectValue,
      rotateBar: els.rotateBar,
      rotateInput: els.rotateInput,
      rotateValue: els.rotateValue,
      rotateMinusBtn: els.rotateMinusBtn,
      rotatePlusBtn: els.rotatePlusBtn,
      rotateResetBtn: els.rotateResetBtn
    },
    {
      camera,
      getKiln: () => kilns.current(),
      onCommit: (patch, soon) => {
        kilns.update(patch, soon);
        reader.invalidate(); // 영역이 바뀌면 진행 중인 OCR 결과는 버림
        clearRecognitionReady();
      }
    }
  );

  // 숫자 인식: OCR 엔진(처음 필요할 때 한 번 준비) + 전처리 + 판독 조정기
  const ocr = createOcrEngine({ onStateChange: handleEngineState });
  const reader = createReader({
    camera,
    ocr,
    preprocessor: createOcrPreprocessor(camera),
    getKiln: () => kilns.current(),
    onResult: handleReading,
    onActivity: updateActivity,
    onLockVariant: (variant) => {
      const k = kilns.current();
      if (!k || k.ocrPreprocess !== 'auto') return;
      if ((k.ocrLockedVariant || null) === (variant || null) && k.ocrLockRevision === OCR_LOCK_REVISION) return;
      kilns.update({ ocrLockedVariant: variant, ocrLockRevision: OCR_LOCK_REVISION }, false);
    }
  });

  const live = createLiveDisplay(els);
  const calib = createCalibrationPanel(els.calib, {
    getKiln: () => kilns.current(),
    update: kilns.update,
    onSettingsChange: () => {
      roi.scheduleDraw(); // 자릿수 폭/높이 비율이 바뀌면 틀 모양과 영역도 다시 계산
      reader.invalidate();
      updateActivity();
      readNow();
    },
    onRetryEngine: () => {
      ocr.retry();
      readNow();
    }
  });

  // ===== 소성 기록 (Phase 3) =====
  const recorder = createRecorder({
    getKiln: () => kilns.current(),
    camera,
    onStateChange: updateFiringState,
    onSaveError: () => showMessage('1분 온도를 저장하지 못했습니다. 같은 구간을 잠시 뒤 다시 저장합니다.', 'error')
  });

  function updateFiringState(state) {
    const isActive = state.active;
    
    // UI 전환
    els.firingIdle.hidden = isActive;
    els.firingActive.hidden = !isActive;
    
    // 상태 표시
    els.recordState.textContent = !isActive ? '대기' : (camera.isRunning() ? '기록 중' : '카메라 중단');
    
    if (isActive) {
      // 시작 시각
      const startTime = new Date(state.firing.startedAt);
      els.firingStartTime.textContent = startTime.toLocaleString('ko-KR', {
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      
      // 경과 시간 (1초마다 갱신)
      updateElapsed();
      
      // 마지막 기록 시각
      if (state.lastSaveTime) {
        const saveTime = new Date(state.lastSaveTime);
        els.lastRecordTime.textContent = saveTime.toLocaleTimeString('ko-KR');
      } else {
        els.lastRecordTime.textContent = '아직 없음';
      }

      // 버튼 상태
      els.startFiringBtn.disabled = true;
      updateRoiButton(); // ROI 버튼도 비활성화
    } else {
      els.recordElapsed.textContent = '—';
      els.startFiringBtn.disabled = !canStartFiring();
    }
    syncCameraZoomBar();
    syncExposureBar();
  }

  function formatCameraZoom(value, step) {
    const digits = step >= 1 ? 0 : (step >= 0.1 ? 1 : 2);
    return value.toFixed(digits) + '×';
  }

  function syncCameraZoomBar() {
    if (!els.cameraZoomBar) return;
    const cap = camera.zoomCapability();
    const show = camera.isRunning() && !!cap;
    els.cameraZoomBar.hidden = !show;
    if (!show) return;
    const input = els.cameraZoomInput;
    input.min = String(cap.min);
    input.max = String(cap.max);
    input.step = String(cap.step);
    input.disabled = recorder.isActive();
    const now = camera.currentZoom();
    const value = now == null ? cap.min : now;
    input.value = String(value);
    els.cameraZoomValue.textContent = formatCameraZoom(value, cap.step);
  }

  // 가마에 저장된 카메라 배율을 적용한다. 저장값이 없으면 기기 최소 배율.
  function formatExposure(value) {
    const n = Math.round(value * 10) / 10;
    return (n > 0 ? '+' : '') + n.toFixed(1) + ' EV';
  }

  function syncExposureBar() {
    if (!els.exposureBar) return;
    const cap = camera.exposureCapability();
    const show = camera.isRunning() && !!cap;
    els.exposureBar.hidden = !show;
    if (!show) return;
    const input = els.exposureInput;
    input.min = String(cap.min);
    input.max = String(cap.max);
    input.step = String(cap.step);
    input.disabled = recorder.isActive();
    const now = camera.currentExposure();
    const value = now == null ? 0 : now;
    input.value = String(value);
    els.exposureValue.textContent = formatExposure(value);
  }

  function applyKilnExposure() {
    if (!camera.isRunning()) {
      syncExposureBar();
      return Promise.resolve(null);
    }
    const k = kilns.current();
    const target = k && typeof k.exposureCompensation === 'number' ? k.exposureCompensation : null;
    return camera.applyExposure(target).then(() => {
      syncExposureBar();
    });
  }

  function applyKilnZoom() {
    if (!camera.isRunning()) {
      syncCameraZoomBar();
      return Promise.resolve(null);
    }
    const k = kilns.current();
    const target = k && typeof k.cameraZoom === 'number' ? k.cameraZoom : null;
    return camera.applyZoom(target).then(() => {
      syncCameraZoomBar();
    });
  }

  function updateElapsed() {
    const state = recorder.state();
    if (!state.active) return;
    
    const elapsed = state.elapsed;
    const hours = Math.floor(elapsed / 3600000);
    const minutes = Math.floor((elapsed % 3600000) / 60000);
    const seconds = Math.floor((elapsed % 60000) / 1000);
    
    const parts = [];
    if (hours > 0) parts.push(hours + '시간');
    if (minutes > 0) parts.push(minutes + '분');
    parts.push(seconds + '초');
    
    els.recordElapsed.textContent = parts.join(' ');
    els.firingElapsed.textContent = parts.join(' ');
  }

  let recognitionReady = false;
  let readyAnnounced = false;

  function canStartFiring() {
    const k = kilns.current();
    return !!(k && k.roi && camera.isRunning() && recognitionReady && !recorder.isActive());
  }

  function clearRecognitionReady() {
    recognitionReady = false;
    readyAnnounced = false;
    if (els.readyDialog) els.readyDialog.hidden = true;
    updateStartButton();
    updateVerifyNotice();
  }

  function verifyMessage(res) {
    if (res && res.status === 'engineLoading') return '인식 엔진을 준비하고 있습니다';
    if (res && res.status === 'waiting') return '영상을 준비하고 있습니다';
    const v = res && res.validation;
    if (v && v.status === 'initializing') return '같은 온도인지 다시 확인하고 있습니다';
    const seen = res && (typeof res.temp === 'number' ? res.temp : (typeof res.candidate === 'number' ? res.candidate : null));
    if (seen != null) return formatTemp(seen) + '°C를 확인하고 있습니다';
    return '온도를 확인하고 있습니다';
  }

  function updateVerifyNotice(res) {
    if (!els.verifyNotice) return;
    const k = kilns.current();
    const readyOpen = els.readyDialog && !els.readyDialog.hidden;
    const show = camera.isRunning() && k && k.roi && !recognitionReady && !recorder.isActive() && !readyOpen;
    els.verifyNotice.hidden = !show;
    if (show && els.verifyNoticeText) els.verifyNoticeText.textContent = verifyMessage(res);
  }

  function showReadyDialog(temp) {
    if (!els.readyDialog || !els.readyDialogTemp) return;
    els.readyDialogTemp.textContent = formatTemp(temp) + '°C';
    if (els.verifyNotice) els.verifyNotice.hidden = true;
    els.readyDialog.hidden = false;
    if (els.readyDialogOk) els.readyDialogOk.focus();
  }

  function updateStartButton() {
    if (!recorder.isActive()) {
      els.startFiringBtn.disabled = !canStartFiring();
    }
  }

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
    if (k) {
      lines.push('틀 너비 ' + Math.round(k.guideWidthRatio * 100) + '% · 가로세로 ' + k.guideAspect.toFixed(2) + ':1 · 회전 ' +
        (k.rotationDeg > 0 ? '+' : '') + k.rotationDeg.toFixed(1) + '° (양수 = 시계 방향)');
    }
    if (k && k.roi) {
      lines.push('영역 x ' + k.roi.x.toFixed(4) + ' y ' + k.roi.y.toFixed(4) + ' w ' + k.roi.w.toFixed(4) + ' h ' + k.roi.h.toFixed(4));
      const size = camera.videoSize();
      if (camera.isRunning() && size.width && size.height) {
        const src = kilnSourceRegion(k, size.width, size.height);
        const px = (p) => '(' + p.x.toFixed(1) + ', ' + p.y.toFixed(1) + ')';
        lines.push('영역 중심 ' + px({ x: src.cx, y: src.cy }) + ' · 크기 ' + src.w.toFixed(1) + '×' + src.h.toFixed(1) + 'px (원본 프레임)');
        lines.push('네 모서리 (좌상 → 우상 → 우하 → 좌하) ' + src.corners.map(px).join(' '));
      }
    } else {
      lines.push('영역 지정 안 됨');
    }
    lines.push(timingText());
    els.debugInfo.textContent = lines.join('\n');
  }

  function updateTimingView() {
    if (els.calib.ocrTiming) els.calib.ocrTiming.textContent = timingText();
  }

  function refreshCameraView() {
    roi.scheduleDraw();
    roi.updatePreview();
    readNow();
  }

  // 판독 주기를 기다리지 않고 바로 판독 (OCR이 진행 중이면 끝난 뒤)
  function readNow() {
    reader.requestNow();
  }

  // 판독 결과를 현재 인식값·보정 패널·영상 위 샘플 위치(7세그먼트 보정 중일 때만)에 반영
  function handleReading(res) {
    const k = kilns.current();
    live.show(res);
    calib.show(res);
    if (els.calib.ocrModel) els.calib.ocrModel.textContent = res.model || '—';
    if (els.calib.ocrRoi && res.roiSource) {
      els.calib.ocrRoi.textContent = res.roiSource.w + '×' + res.roiSource.h + 'px · 숫자 높이 ' + res.roiSource.contentH + 'px';
    }
    updateTimingView();

    const ready = isRecognitionReady(res);
    const becameReady = ready && !recognitionReady;
    recognitionReady = ready;
    if (becameReady && !recorder.isActive() && !readyAnnounced) {
      readyAnnounced = true;
      showReadyDialog(res.validation.validatedTemp);
    }
    if (!recorder.isActive()) updateStartButton();
    updateVerifyNotice(res);
    
    // 소성 기록 중이면 recorder에 전달
    recorder.addReading(res);
    
    const showSamples = k && res.engine === 'sevenSegment' && res.binary && calib.isOpen();
    roi.setSamples(showSamples ? segmentQuads(res, k.shear) : null);
    if (debugMode && res.source) {
      copyCanvas(res.source, els.debugSourceCanvas);
      if (res.image) copyCanvas(res.image, els.debugInputCanvas);
      els.debugImages.hidden = false;
    }
  }

  function copyCanvas(src, dst) {
    if (dst.width !== src.width) dst.width = src.width;
    if (dst.height !== src.height) dst.height = src.height;
    const ctx = dst.getContext('2d');
    ctx.clearRect(0, 0, dst.width, dst.height);
    ctx.drawImage(src, 0, 0);
  }

  // 인식 방식·인식 중 여부·엔진 상태 표시
  function updateActivity() {
    const a = reader.activity();
    live.setActivity(a);
    calib.setEngineState(a);
  }

  function handleEngineState(state, message) {
    updateActivity();
    if (state === 'error' && recognitionMode(kilns.current()) === 'ocr') {
      showMessage(message, 'error');
    }
  }

  // 창 크기·주소창·Split View는 저장한 ROI를 건드리지 않는다.
  // 카메라 원본 크기가 실제로 바뀌면 비율 좌표로 다시 맞추고, 종횡비를 변환할 수 없을 때만 확인을 요청한다.
  let lastFrameSize = null;
  function noteFrameSize() {
    if (!camera.isFrameReady()) return;
    const size = camera.videoSize();
    const next = { w: size.width, h: size.height };
    if (!lastFrameSize) {
      lastFrameSize = next;
      markTiming('videoSize', next.w + 'x' + next.h);
      return;
    }
    if (next.w === lastFrameSize.w && next.h === lastFrameSize.h) return;
    const prev = lastFrameSize;
    lastFrameSize = next;
    const relation = frameAspectRelation(prev, next);
    reader.invalidate();
    if (relation === 'unknown') {
      showMessage('카메라 원본 비율이 바뀌었습니다. 노란 네모가 숫자와 맞는지 영역 버튼으로 확인하세요. 저장된 영역은 지우지 않았습니다.', 'error');
    }
    refreshCameraView();
  }

  // ===== 기록 보기 =====
  const history = createHistoryView({ 
    listEl: els.firingList,
    listCard: els.firingListCard,
    detailSection: els.firingDetail,
    backToListBtn: els.backToListBtn,
    detailKilnName: els.detailKilnName,
    detailStartTime: els.detailStartTime,
    detailEndTime: els.detailEndTime,
    detailDuration: els.detailDuration,
    detailMaxTemp: els.detailMaxTemp,
    detailReadingCount: els.detailReadingCount,
    chartContainer: els.chartContainer,
    readingsTable: els.readingsTable,
    deleteFiringBtn: els.deleteFiringBtn,
    intervalBar: els.intervalBar
  });

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
    
    // 기록 보기 탭이면 목록 새로고침
    if (tab === 'history') {
      history.loadList();
    }
    
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
      document.dispatchEvent(new CustomEvent('gama-control', { detail: 'guideBar' }));
      showMessage('온도 숫자 전체가 노란 네모 안에 들어오게 확대·이동하세요. 틀 너비와 가로세로로 여백을 맞출 수 있습니다. 프로그램 번호, 시간, 목표 온도는 넣지 마세요.', 'ok');
    } else {
      hideMessage();
    }
    refreshCameraView();
  }

  // 카메라가 켜져 있고 가마가 있을 때만 영역 버튼 사용 가능
  // 소성 중에는 영역 버튼 비활성화
  function updateRoiButton() {
    const usable = camera.isRunning() && !!kilns.current() && !recorder.isActive();
    els.roiEditBtn.disabled = !usable;
    if (!usable) setRoiEditing(false);
  }

  // 영역이 하나도 없으면 지정 방법 안내
  function guideRoi() {
    const k = kilns.current();
    if (!k || k.roi || roi.isEditable()) return;
    if (camera.isRunning()) {
      showMessage('영역 버튼을 누른 뒤, 온도 숫자 전체가 노란 네모 안에 들어오도록 맞추세요.', 'ok');
    } else {
      showMessage('"카메라 시작"을 누른 뒤 영역 버튼으로 온도 숫자를 노란 네모 안에 맞추세요.', 'ok');
    }
  }

  // ===== 가마 =====
  function handleKilnChange(switched) {
    updateRoiButton();
    updateStartButton(); // 소성 시작 버튼 상태 갱신
    calib.render();
    if (switched) {
      clearRecognitionReady();
      roi.cancelGesture();
      reader.reset(); // 이전 가마의 인식값을 지우고, 늦게 끝난 이전 가마 OCR 결과는 버림
      if (roi.isEditable()) roi.setEditable(true); // 영역 지정 중에 가마를 바꾸면 바뀐 가마도 지금 틀 위치로 지정
      const k = kilns.current();
      if (!k) {
        showMessage('"추가"를 눌러 가마를 등록하세요.', 'info');
      } else if (!k.roi) {
        guideRoi();
      } else if (!roi.isEditable()) {
        hideMessage();
      }
      if (camera.isRunning() && !recorder.isActive()) {
        applyKilnZoom();
        applyKilnExposure();
      }
    }
    refreshCameraView();
  }

  // ===== 카메라 =====
  function handleCameraStarted() {
    updateRoiButton();
    updateStartButton(); // 소성 시작 버튼 상태 갱신
    const k = kilns.current();
    if (!k) {
      showMessage('"추가"를 눌러 가마를 먼저 등록하세요.', 'info');
    } else if (!k.roi) {
      guideRoi();
    } else {
      hideMessage();
    }
    reader.invalidate(); // 카메라를 다시 켜면 판독 주기를 기다리지 않고 영상 크기가 확정되는 대로 판독
    if (recognitionMode(kilns.current()) === 'ocr') ocr.init();
    updateFiringState(recorder.state());
    roi.scheduleDraw();
    updateVerifyNotice();
    applyKilnZoom();
    applyKilnExposure();
  }

  function stopCamera() {
    camera.stop();
    clearRecognitionReady();
    live.show(null);
    reader.invalidate(); // 진행 중인 OCR 결과는 버리고 새 판독은 시작하지 않음 (카메라 꺼짐)
    roi.cancelGesture();
    updateRoiButton();
    updateStartButton(); // 소성 시작 버튼 상태 갱신
    syncCameraZoomBar();
    refreshCameraView();
  }

  function handleCameraEnded() {
    stopCamera();
    if (recorder.isActive()) updateFiringState(recorder.state());
    showMessage('카메라 연결이 끊어졌습니다. "카메라 시작"을 다시 눌러주세요.', 'error');
  }

  // ===== 이벤트 연결 =====
  // 쓸 수 있는 조절만 버튼으로 보여 주고, 고른 항목의 슬라이더만 연다.
  function bindCameraControls() {
    const dock = document.getElementById('cameraControls');
    const rail = document.getElementById('ctrlRail');
    if (!dock || !rail) return;
    const chips = Array.from(rail.querySelectorAll('.ctrl-chip'));
    let current = null;

    function barOf(chip) {
      return document.getElementById(chip.dataset.for);
    }

    function refresh() {
      const open = chips.filter((chip) => {
        const bar = barOf(chip);
        const available = !!(bar && !bar.hidden);
        chip.hidden = !available;
        return available;
      });
      if (!open.length) {
        current = null;
        rail.hidden = true;
        chips.forEach((chip) => {
          chip.setAttribute('aria-selected', 'false');
          const bar = barOf(chip);
          if (bar) bar.classList.remove('is-open');
        });
        return;
      }
      if (!open.some((chip) => chip.dataset.for === current)) current = open[0].dataset.for;
      chips.forEach((chip) => {
        const on = chip.dataset.for === current;
        chip.setAttribute('aria-selected', on ? 'true' : 'false');
        const bar = barOf(chip);
        if (bar) bar.classList.toggle('is-open', on);
        if (on && !chip.hidden) {
          const left = chip.offsetLeft;
          const right = left + chip.offsetWidth;
          if (left < rail.scrollLeft) rail.scrollLeft = left;
          else if (right > rail.scrollLeft + rail.clientWidth) rail.scrollLeft = right - rail.clientWidth;
        }
      });
      rail.hidden = open.length < 2;
    }

    function stepRange(input, dir) {
      if (!input || input.disabled) return;
      const step = parseFloat(input.step);
      const stepN = isFinite(step) && step > 0 ? step : 1;
      const min = parseFloat(input.min);
      const max = parseFloat(input.max);
      const cur = parseFloat(input.value);
      const base = isFinite(cur) ? cur : (isFinite(min) ? min : 0);
      let next = base + dir * stepN;
      if (isFinite(min)) next = Math.max(min, next);
      if (isFinite(max)) next = Math.min(max, next);
      const decimals = (String(stepN).split('.')[1] || '').length;
      input.value = decimals ? next.toFixed(decimals) : String(Math.round(next));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    chips.forEach((chip) => {
      chip.addEventListener('click', () => {
        current = chip.dataset.for;
        refresh();
      });
    });
    dock.querySelectorAll('.step-btn[data-step]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const input = btn.parentElement && btn.parentElement.querySelector('input[type="range"]');
        stepRange(input, Number(btn.dataset.step) || 0);
      });
    });
    document.addEventListener('gama-control', (e) => {
      if (!e.detail) return;
      current = e.detail;
      refresh();
    });
    const obs = new MutationObserver(refresh);
    chips.forEach((chip) => {
      const bar = barOf(chip);
      if (bar) obs.observe(bar, { attributes: true, attributeFilter: ['hidden'] });
    });
    dock.classList.add('dock-ready');
    refresh();
  }

  function bindEvents() {
    applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
    if (els.themeBtn) {
      els.themeBtn.addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
        applyTheme(next);
        history.redraw();
      });
    }

    els.tabButtons.forEach((btn) => {
      btn.addEventListener('click', () => showTab(btn.dataset.tab));
    });

    if (els.exportBackupBtn) {
      els.exportBackupBtn.addEventListener('click', () => {
        exportArchive().then((archive) => {
          const blob = new Blob([JSON.stringify(archive)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          const now = new Date();
          const stamp = now.getFullYear()
            + String(now.getMonth() + 1).padStart(2, '0')
            + String(now.getDate()).padStart(2, '0');
          link.href = url;
          link.download = 'gama-archive-' + stamp + '.json';
          document.body.appendChild(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1500);
          showMessage('기록 파일을 저장했습니다. 다른 브라우저에서는 이 파일을 불러오세요.', 'ok', 5000);
        }).catch((err) => {
          showMessage(err && err.message ? err.message : '기록 파일을 만들지 못했습니다.', 'error');
        });
      });
    }

    if (els.importBackupBtn && els.importBackupInput) {
      els.importBackupBtn.addEventListener('click', () => {
        els.importBackupInput.value = '';
        els.importBackupInput.click();
      });
      els.importBackupInput.addEventListener('change', () => {
        const file = els.importBackupInput.files && els.importBackupInput.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          let archive;
          try {
            archive = parseArchive(String(reader.result || ''));
          } catch (err) {
            showMessage(err && err.message ? err.message : '기록 파일을 읽지 못했습니다.', 'error');
            return;
          }
          const ask = '이 브라우저에 기록을 넣습니다.\n가마 ' + archive.kilns.length
            + '개, 소성 ' + archive.firings.length
            + '개, 온도 ' + archive.readings.length
            + '개\n\n같은 기록은 파일 내용으로 바뀌고, 이 브라우저에만 있는 기록은 남습니다.';
          if (!confirm(ask)) return;
          importArchive(archive).then((counts) => {
            return kilns.load().then(() => {
              history.loadList();
              showMessage('기록을 불러왔습니다. 소성 ' + counts.firings + '개, 온도 ' + counts.readings + '개.', 'ok', 5000);
            });
          }).catch((err) => {
            showMessage(err && err.message ? err.message : '기록을 불러오지 못했습니다.', 'error');
          });
        };
        reader.onerror = () => showMessage('기록 파일을 읽지 못했습니다.', 'error');
        reader.readAsText(file);
      });
    }

    // 카메라 시작/중지 (버튼 클릭 시에만 시작)
    els.cameraBtn.addEventListener('click', () => {
      if (camera.isRunning()) {
        stopCamera();
        hideMessage();
        if (recorder.isActive()) updateFiringState(recorder.state());
      } else {
        camera.start();
      }
    });

    if (els.readyDialogOk) {
      els.readyDialogOk.addEventListener('click', () => {
        els.readyDialog.hidden = true;
        if (!els.startFiringBtn.disabled) els.startFiringBtn.focus();
      });
    }

    // 영역 지정(영상 확대/이동) 모드 켜기/끄기
    els.roiEditBtn.addEventListener('click', () => setRoiEditing(!roi.isEditable()));

    if (els.cameraZoomInput) {
      els.cameraZoomInput.addEventListener('input', () => {
        if (recorder.isActive()) return;
        const raw = parseFloat(els.cameraZoomInput.value);
        camera.applyZoom(raw).then((applied) => {
          if (applied == null) return;
          const cap = camera.zoomCapability();
          els.cameraZoomValue.textContent = formatCameraZoom(applied, cap ? cap.step : 0.1);
          if (kilns.current()) kilns.update({ cameraZoom: Math.round(applied * 100) / 100 }, true);
        });
      });
      els.cameraZoomInput.addEventListener('change', () => {
        if (recorder.isActive()) {
          syncCameraZoomBar();
          return;
        }
        clearRecognitionReady();
        reader.invalidate();
        readNow();
        const k = kilns.current();
        if (k && k.roi) showMessage('카메라 확대가 바뀌었습니다. 노란 네모가 숫자와 맞는지 확인하세요.', 'ok');
      });
    }

    if (els.exposureInput) {
      els.exposureInput.addEventListener('input', () => {
        if (recorder.isActive()) return;
        const raw = parseFloat(els.exposureInput.value);
        camera.applyExposure(raw).then((applied) => {
          if (applied == null) return;
          els.exposureValue.textContent = formatExposure(applied);
          if (kilns.current()) kilns.update({ exposureCompensation: Math.round(applied * 100) / 100 }, true);
        });
      });
      els.exposureInput.addEventListener('change', () => {
        if (recorder.isActive()) {
          syncExposureBar();
          return;
        }
        clearRecognitionReady();
        reader.invalidate();
        readNow();
        const k = kilns.current();
        if (k && k.roi) showMessage('노출이 바뀌었습니다. 노란 네모가 숫자와 맞는지 확인하세요.', 'ok');
      });
    }
    
    // 소성 시작/종료 (Phase 3)
    els.startFiringBtn.addEventListener('click', async () => {
      try {
        els.startFiringBtn.disabled = true;
        await recorder.start();
        showMessage('소성 기록을 시작했습니다.', 'ok', 3000);
      } catch (err) {
        showMessage(err.message || '소성을 시작하지 못했습니다.', 'error');
        updateStartButton();
      }
    });
    
    els.endFiringBtn.addEventListener('click', () => {
      if (!confirm('소성을 종료하시겠습니까?\n기록된 데이터는 "기록 보기"에서 확인할 수 있습니다.')) return;
      
      recorder.end()
        .then(() => {
          showMessage('소성 기록을 종료했습니다. 정기적으로 데이터를 백업하세요.', 'ok', 5000);
        })
        .catch((err) => {
          showMessage(err.message || '소성 종료에 실패했습니다.', 'error');
        });
    });
    
    // 급변 경고가 계속될 때: 사용자가 표시창을 직접 확인한 뒤 기준 온도를 처음부터 다시 확립
    els.validResetBtn.addEventListener('click', () => {
      reader.resetValidation();
      clearRecognitionReady();
      els.validResetBtn.hidden = true;
      readNow();
    });

    // 영상 크기 정보가 준비되거나 바뀌면(회전 시 프레임 가로·세로가 바뀜) 방향 확인 후 다시 그림
    ['loadedmetadata', 'playing', 'resize'].forEach((ev) => {
      els.video.addEventListener(ev, () => {
        noteFrameSize();
        refreshCameraView();
        // 일부 기기는 재생이 시작된 뒤에야 카메라 확대 범위를 알려 준다.
        if (ev !== 'resize' && els.cameraZoomBar && els.cameraZoomBar.hidden) applyKilnZoom();
        if (ev !== 'resize' && els.exposureBar && els.exposureBar.hidden) applyKilnExposure();
      });
    });

    // 창 크기와 회전은 영상만 다시 그린다. ROI는 카메라 원본 크기가 바뀔 때만 noteFrameSize가 본다.
    const onLayoutChange = () => {
      noteFrameSize();
      roi.scheduleDraw();
      setTimeout(() => {
        noteFrameSize();
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

    // 판독 보정 패널을 열면 마지막 결과를 바로 보여 주고 다시 판독, 닫으면 샘플 위치 숨김
    els.calib.panel.addEventListener('toggle', () => {
      calib.refresh();
      if (!calib.isOpen()) roi.setSamples(null);
      readNow();
    });

    // 다른 앱에 다녀오면 iOS가 영상을 멈추는 경우가 있어 다시 재생
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      camera.resumeIfPaused();
      noteFrameSize();
    });

    // 페이지를 떠날 때 OCR 작업자 종료 (뒤로 가기로 돌아오면 필요할 때 다시 준비)
    window.addEventListener('pagehide', () => {
      reader.invalidate();
      ocr.terminate();
    });
  }

  // ===== 초기화 =====
  const THEME_KEY = 'kilnRecorder.theme';
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = theme;
    if (!els.themeBtn) return;
    const dark = theme === 'dark';
    els.themeBtn.textContent = dark ? '라이트' : '다크';
    els.themeBtn.setAttribute('aria-label', dark ? '라이트 테마로 전환' : '다크 테마로 전환');
    els.themeBtn.setAttribute('aria-pressed', dark ? 'true' : 'false');
  }

  els.appVersion.textContent = APP_VERSION;
  bindCameraControls();
  bindEvents();
  showTab('record');

  initDb()
    .then(() => kilns.load())
    .then(() => recorder.resume()) // 활성 소성 복구 시도
    .then(() => {
      calib.render();
      updateActivity();
      updateStartButton();
      updateFiringState(recorder.state());
      refreshCameraView();
      if (!kilns.hasKilns()) {
        showMessage('"추가"를 눌러 가마를 등록하세요.', 'info');
      }
    })
    .catch((err) => {
      showMessage(err && err.message ? err.message : '저장소를 열지 못했습니다.', 'error');
    });

  // 1초마다 영역 확대 미리보기 갱신 및 소성 경과 시간 갱신
  setInterval(() => {
    noteFrameSize();
    updateTimingView();
    roi.updatePreview();
    updateDebug();
    if (recorder.isActive()) {
      updateElapsed();
    }
  }, PREVIEW_INTERVAL_MS);

  // 판독 확인 (7세그먼트는 매번 판독, OCR은 이전 작업이 끝났고 판독 주기가 지났을 때만)
  setInterval(reader.tick, LIVE_READ_MS);
}

startApp();
