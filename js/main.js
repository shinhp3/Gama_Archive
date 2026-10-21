// ===== 진입점 =====
// 화면 요소를 찾아 각 모듈을 연결하고, 탭 전환과 이벤트 처리를 담당

import { APP_VERSION, PREVIEW_INTERVAL_MS, LIVE_READ_MS, CAMERA_IDEAL_W, CAMERA_IDEAL_H, OCR_LOCK_REVISION } from './config.js?v=0.3.15';
import { initDb } from './db.js?v=0.3.15';
import { createCamera } from './camera.js?v=0.3.15';
import { createRoiEditor, kilnSourceRegion, frameAspectRelation } from './roi.js?v=0.3.15';
import { markTiming, timingText } from './timings.js?v=0.3.15';
import { createKilnManager } from './kilns.js?v=0.3.15';
import { createReader, createLiveDisplay, recognitionMode, isRecognitionReady } from './reading.js?v=0.3.15';
import { formatTemp } from './ocr.js?v=0.3.15';
import { createOcrEngine } from './ocr.js?v=0.3.15';
import { createOcrPreprocessor } from './ocrPreprocess.js?v=0.3.15';
import { createCalibrationPanel } from './calibration.js?v=0.3.15';
import { segmentQuads } from './recognizer.js?v=0.3.15';
import { createRecorder } from './recorder.js?v=0.3.15';
import { createHistoryView } from './history.js?v=0.3.15';

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
    deleteFiringBtn: $('deleteFiringBtn'),
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
    readingCount: $('readingCount'),
    lastReading: $('lastReading'),
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
      
      // 측정 횟수와 마지막 측정
      els.readingCount.textContent = state.readingCount || 0;
      if (state.lastReadingTemp !== undefined && state.lastReadingTemp !== null) {
        els.lastReading.textContent = state.lastReadingTemp + '°C';
      } else {
        els.lastReading.textContent = '—';
      }
      
      // 버튼 상태
      els.startFiringBtn.disabled = true;
      updateRoiButton(); // ROI 버튼도 비활성화
    } else {
      els.recordElapsed.textContent = '—';
      els.startFiringBtn.disabled = !canStartFiring();
    }
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
    deleteFiringBtn: els.deleteFiringBtn
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
  }

  function stopCamera() {
    camera.stop();
    clearRecognitionReady();
    live.show(null);
    reader.invalidate(); // 진행 중인 OCR 결과는 버리고 새 판독은 시작하지 않음 (카메라 꺼짐)
    roi.cancelGesture();
    updateRoiButton();
    updateStartButton(); // 소성 시작 버튼 상태 갱신
    refreshCameraView();
  }

  function handleCameraEnded() {
    stopCamera();
    if (recorder.isActive()) updateFiringState(recorder.state());
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
  els.appVersion.textContent = APP_VERSION;
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
