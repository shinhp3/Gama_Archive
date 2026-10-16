// ===== 카메라 =====
// 후면 카메라 스트림 시작/중지, 영상 프레임에서 원하는 영역을 잘라내기

import { CAMERA_IDEAL_W, CAMERA_IDEAL_H } from './config.js?v=0.3.7';

const PERMISSION_ERRORS = ['NotAllowedError', 'PermissionDeniedError', 'SecurityError'];

function cameraErrorMessage(err) {
  const name = err && err.name ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return '카메라 권한이 거부되었습니다. 주소창 왼쪽의 "가가"(또는 "AA") 메뉴 → 웹 사이트 설정 → 카메라를 "허용"으로 바꾸거나, iPad 설정 → Safari → 카메라를 "허용"으로 바꾼 뒤 페이지를 새로고침하세요.';
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

  // 반드시 버튼 클릭 이벤트 안에서만 호출 (iOS 제약)
  function start() {
    if (stream) return;

    if (window.isSecureContext === false) {
      hooks.onMessage('카메라는 HTTPS 주소에서만 사용할 수 있습니다. GitHub Pages 주소(https://…)로 접속하세요.', 'error');
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      hooks.onMessage('이 브라우저에서는 카메라를 사용할 수 없습니다. iPad의 Safari 최신 버전에서 HTTPS 주소로 접속하세요.', 'error');
      return;
    }

    button.disabled = true;
    hooks.onMessage('카메라를 여는 중…', 'info');

    // 후면 카메라 우선, 고해상도 희망 (지원하지 않으면 기기가 가능한 값으로 맞춤)
    const constraints = {
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: CAMERA_IDEAL_W },
        height: { ideal: CAMERA_IDEAL_H }
      }
    };

    navigator.mediaDevices.getUserMedia(constraints)
      .catch((err) => {
        // 권한 거부가 아니면 해상도 조건 없이 한 번 더 시도
        if (err && PERMISSION_ERRORS.indexOf(err.name) >= 0) throw err;
        return navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } });
      })
      .then((s) => {
        stream = s;
        s.getVideoTracks().forEach((t) => {
          t.addEventListener('ended', onTrackEnded);
        });

        // iOS는 속성뿐 아니라 프로퍼티로도 muted/playsInline을 지정해야 안정적으로 인라인 재생됨
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
      })
      .catch((err) => {
        button.disabled = false;
        setButton(false);
        hooks.onMessage(cameraErrorMessage(err), 'error');
      });
  }

  function stop() {
    if (stream) {
      stream.getTracks().forEach((t) => {
        t.removeEventListener('ended', onTrackEnded);
        t.stop();
      });
    }
    stream = null;
    try { video.pause(); } catch (e) { /* 무시 */ }
    video.srcObject = null;
    placeholder.hidden = false;
    setButton(false);
  }

  function isRunning() {
    return !!stream;
  }

  function videoSize() {
    return { width: video.videoWidth, height: video.videoHeight };
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

  return { start, stop, isRunning, videoSize, trackSettings, isFrameReady, resumeIfPaused, drawRegion, grabRegion };
}
