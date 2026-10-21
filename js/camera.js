// ===== 카메라 =====
// 후면 카메라 스트림 시작/중지, 영상 프레임에서 원하는 영역을 잘라내기

import { CAMERA_IDEAL_W, CAMERA_IDEAL_H } from './config.js?v=0.3.16';
import { markTiming } from './timings.js?v=0.3.16';

const PERMISSION_ERRORS = ['NotAllowedError', 'PermissionDeniedError', 'SecurityError'];

function cameraErrorMessage(err) {
  const name = err && err.name ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return '카메라 권한이 거부되었습니다. 브라우저의 사이트 설정에서 카메라를 허용한 뒤 페이지를 새로고침하세요.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return '사용할 수 있는 카메라를 찾지 못했습니다.';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return '카메라를 열 수 없습니다. 다른 앱(카메라, 영상통화 등)이 카메라를 사용 중이면 닫고 다시 시도하세요.';
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return '이 기기의 카메라가 요청한 설정을 지원하지 않습니다.';
    default:
      return '카메라를 시작하지 못했습니다.' + (name ? ' (' + name + ')' : '') + ' 페이지를 새로고침한 뒤 다시 시도하세요.';
  }
}

/**
 * @param {{ video: HTMLVideoElement, button: HTMLButtonElement, placeholder: HTMLElement }} els
 * @param {{ onMessage: Function, onStarted: Function, onEnded: Function }} hooks
 *   onStarted: 스트림 연결 직후, onEnded: 카메라 연결이 끊겼을 때
 */
export function createCamera(els, hooks) {
  const { video, button, placeholder } = els;
  let stream = null;
  let opening = false;
  let openGen = 0;

  // 판독용 작업 캔버스 (화면에 붙이지 않음). getImageData를 자주 호출하므로 willReadFrequently 지정
  const workCanvas = document.createElement('canvas');
  const workCtx = workCanvas.getContext('2d', { willReadFrequently: true });

  function safePlay() {
    try {
      const p = video.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
      return p;
    } catch (e) {
      return null;
    }
  }

  function setButton(running) {
    button.textContent = running ? '카메라 중지' : '카메라 시작';
    if (running) {
      button.classList.remove('primary');
    } else {
      button.classList.add('primary');
    }
  }

  function onTrackEnded() {
    hooks.onEnded();
  }

  // 주 포인터가 거친(터치) 기기만 후면을 우선한다. 마우스·트랙패드가 주 포인터면 기본 웹캠.
  function wantsRearCamera() {
    if (!window.matchMedia) return false;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const fineHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    return coarse && !fineHover;
  }

  function videoConstraints(withSize) {
    const videoCons = {};
    if (wantsRearCamera()) videoCons.facingMode = { ideal: 'environment' };
    if (withSize) {
      videoCons.width = { ideal: CAMERA_IDEAL_W };
      videoCons.height = { ideal: CAMERA_IDEAL_H };
    }
    return { audio: false, video: videoCons };
  }

  function requestStream() {
    return navigator.mediaDevices.getUserMedia(videoConstraints(true))
      .catch((err) => {
        if (err && PERMISSION_ERRORS.indexOf(err.name) >= 0) throw err;
        return navigator.mediaDevices.getUserMedia(videoConstraints(false));
      });
  }

  function releaseStream() {
    if (stream) {
      stream.getTracks().forEach((t) => {
        t.removeEventListener('ended', onTrackEnded);
        t.stop();
      });
    }
    stream = null;
    try { video.pause(); } catch (e) { /* 무시 */ }
    video.srcObject = null;
  }

  function attachStream(s) {
    stream = s;
    s.getVideoTracks().forEach((t) => {
      t.addEventListener('ended', onTrackEnded);
    });
    const settings = trackSettings();
    const sizeNote = (settings && settings.width) ? (settings.width + 'x' + settings.height) : '';
    markTiming('cameraStarted', sizeNote);

    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.srcObject = s;
    safePlay();

    placeholder.hidden = true;
    setButton(true);
    button.disabled = false;
    hooks.onStarted();
  }

  function start() {
    if (stream || opening) return;

    if (window.isSecureContext === false) {
      hooks.onMessage('카메라는 HTTPS 주소에서만 사용할 수 있습니다.', 'error');
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      hooks.onMessage('이 브라우저는 카메라 API(getUserMedia)를 지원하지 않습니다. HTTPS 주소의 최신 브라우저에서 여세요.', 'error');
      return;
    }

    const gen = ++openGen;
    opening = true;
    button.disabled = true;
    hooks.onMessage('카메라를 여는 중…', 'info');
    markTiming('cameraRequest');
    releaseStream();

    requestStream()
      .then((s) => {
        if (gen !== openGen) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        opening = false;
        attachStream(s);
      })
      .catch((err) => {
        if (gen !== openGen) return;
        opening = false;
        button.disabled = false;
        setButton(false);
        placeholder.hidden = false;
        hooks.onMessage(cameraErrorMessage(err), 'error');
      });
  }

  function stop() {
    openGen++;
    opening = false;
    releaseStream();
    placeholder.hidden = false;
    setButton(false);
    button.disabled = false;
  }

  function isRunning() {
    return !!stream;
  }

  function videoSize() {
    return { width: video.videoWidth, height: video.videoHeight };
  }

  function videoTrack() {
    if (!stream) return null;
    const tracks = stream.getVideoTracks();
    return tracks.length ? tracks[0] : null;
  }

  // 기기가 알려 주는 카메라 확대 범위. 없으면 null (화면 확대만 사용)
  function zoomCapability() {
    const track = videoTrack();
    if (!track || typeof track.getCapabilities !== 'function') return null;
    let caps = null;
    try { caps = track.getCapabilities(); } catch (e) { return null; }
    const z = caps && caps.zoom;
    if (!z || typeof z.min !== 'number' || typeof z.max !== 'number' || !(z.max > z.min)) return null;
    const step = typeof z.step === 'number' && z.step > 0 ? z.step : 0.1;
    return { min: z.min, max: z.max, step };
  }

  function currentZoom() {
    const settings = trackSettings();
    return settings && typeof settings.zoom === 'number' ? settings.zoom : null;
  }

  // value가 없으면 기기 최소 배율(보통 1배)로 둔다. 범위 밖은 기기 한계로 맞춘다.
  function applyZoom(value) {
    const track = videoTrack();
    const cap = zoomCapability();
    if (!track || !cap || typeof track.applyConstraints !== 'function') return Promise.resolve(null);
    const want = value == null || !isFinite(value) ? cap.min : Math.min(cap.max, Math.max(cap.min, value));
    const now = currentZoom();
    if (now != null && Math.abs(now - want) < cap.step / 2) return Promise.resolve(now);
    return track.applyConstraints({ advanced: [{ zoom: want }] }).then(() => {
      const applied = currentZoom();
      return applied == null ? want : applied;
    }).catch(() => null);
  }

  // 카메라가 실제로 준 설정 (해상도, 프레임 속도). 확인할 수 없으면 null
  function trackSettings() {
    if (!stream) return null;
    const track = stream.getVideoTracks()[0];
    if (!track || typeof track.getSettings !== 'function') return null;
    try {
      return track.getSettings();
    } catch (e) {
      return null;
    }
  }

  // 프레임을 읽을 수 있는 상태인지
  function isFrameReady() {
    return !!stream && !!video.videoWidth && !!video.videoHeight && video.readyState >= 2;
  }

  // 다른 앱에 다녀오면 iOS가 영상을 멈추는 경우가 있어 다시 재생
  function resumeIfPaused() {
    if (stream && video.paused) safePlay();
  }

  // 원본 프레임의 src 영역을 ctx에 outW×outH 크기의 수평 이미지로 그림 (프레임이 준비되지 않으면 예외 발생 가능)
  // src.angle이 있으면(roi.js roiSourceRegion) 중심 (cx, cy) 기준으로 angle만큼 회전된 w×h 영역을 반대로 돌려 수평으로 펴서 그림
  function drawRegion(ctx, src, outW, outH) {
    if (!src.angle) {
      ctx.drawImage(video, src.x, src.y, src.w, src.h, 0, 0, outW, outH);
      return;
    }
    // 출력 좌표 → 원본 좌표: P = C + R(angle) · S⁻¹ · (출력 - 출력 가운데)
    ctx.save();
    ctx.translate(outW / 2, outH / 2);
    ctx.scale(outW / src.w, outH / src.h);
    ctx.rotate(-src.angle);
    ctx.translate(-src.cx, -src.cy);
    // 회전된 영역을 덮는 원본 사각형만 그대로 옮겨 그림 (프레임 전체를 그리지 않음)
    const b = src.bounds;
    ctx.drawImage(video, b.x, b.y, b.w, b.h, b.x, b.y, b.w, b.h);
    ctx.restore();
  }

  // 원본 프레임의 src 영역을 W×H로 잘라 ImageData로 반환 (실패 시 null)
  function grabRegion(src, W, H) {
    if (workCanvas.width !== W) workCanvas.width = W;
    if (workCanvas.height !== H) workCanvas.height = H;
    try {
      workCtx.imageSmoothingEnabled = true;
      drawRegion(workCtx, src, W, H);
      return workCtx.getImageData(0, 0, W, H);
    } catch (e) {
      return null;
    }
  }

  return {
    start, stop, isRunning, videoSize, trackSettings, isFrameReady, resumeIfPaused, drawRegion, grabRegion,
    zoomCapability, currentZoom, applyZoom
  };
}
