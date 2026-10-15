// ===== 실시간 판독 =====
// 현재 카메라 프레임에서 가마의 영역을 잘라 7세그먼트 판독, 기록 화면에 현재 인식값·신뢰도 표시

import { READ_MAX_W, CONF_HIGH, CONF_LOW } from './config.js?v=0.3.1';
import { roiToSource, frameBlockReason } from './roi.js?v=0.3.1';
import { recognize } from './recognizer.js?v=0.3.1';

/**
 * 현재 프레임 판독
 * @returns {{ result: object|null, reason: string|null }} 읽을 수 없으면 result=null, reason에 이유
 */
export function readKilnFrame(camera, kiln) {
  const block = frameBlockReason(kiln, camera);
  if (block) return { result: null, reason: block };
  const size = camera.videoSize();
  const src = roiToSource(kiln.roi, size.width, size.height);
  const W = Math.max(8, Math.min(src.w, READ_MAX_W));
  const H = Math.max(8, Math.round(src.h * W / src.w));
  const img = camera.grabRegion(src, W, H);
  if (!img) return { result: null, reason: '영상을 읽지 못했습니다.' };
  return { result: recognize(img, kiln), reason: null };
}

// 신뢰도 → 표시 문자열과 색 구분
export function confidenceText(conf) {
  return Math.round(conf * 100) + '%';
}
export function confidenceLevel(conf) {
  if (conf >= CONF_HIGH) return 'high';
  if (conf >= CONF_LOW) return 'mid';
  return 'low';
}

/**
 * 기록 화면의 현재 인식값 표시
 * @param {{ liveTemp: HTMLElement, liveConf: HTMLElement, liveReason: HTMLElement }} els
 */
export function createLiveDisplay(els) {
  function show(result, reason) {
    const ok = !!(result && result.ok);
    els.liveTemp.textContent = ok ? String(result.temp) : '—';
    els.liveTemp.classList.toggle('is-empty', !ok);

    if (result) {
      els.liveConf.textContent = confidenceText(result.confidence);
      els.liveConf.dataset.level = confidenceLevel(result.confidence);
    } else {
      els.liveConf.textContent = '—';
      delete els.liveConf.dataset.level;
    }

    // 이유 줄은 비워 둘 뿐 숨기지 않음: 줄이 생겼다 없어지면 아래 카메라 영상이 밀려 확대/이동 중인 손가락 아래에서 움직임
    els.liveReason.textContent = ok ? '' : (reason || (result && result.reason) || '');
  }

  return { show };
}
