// ===== 시간 연속성 기반 온도 검증 =====
// OCR(또는 7세그먼트)이 읽은 원시 온도(rawTemp)를 직전 정상 온도와 실제 경과 시간으로 비교해
// 검증된 온도(validatedTemp)만 통과시킴. 검증에 실패하면 validatedTemp = null (이전 정상 온도로 대체하지 않음).
// DOM·IndexedDB에 접근하지 않는 순수 함수: 이전 상태를 받아 결과와 새 상태를 돌려줌 (이전 상태는 바꾸지 않음).
// 기록 데이터 품질을 위한 필터이며 가마 안전 장치를 대신하지 않음.

import {
  TEMP_MIN, TEMP_MAX, VALID_RATE_DEG_PER_SEC, VALID_MIN_DELTA, VALID_MAX_DELTA,
  VALID_INIT_CONFIRM_COUNT, VALID_RECHECK_COUNT, VALID_CANDIDATE_TOLERANCE, VALID_HISTORY_SIZE
} from './config.js?v=0.3.31';

/**
 * 검증 상태 (phase)
 *  - 'initializing': 기준 온도 없음. 서로 이어지는 판독을 모으는 중 (run)
 *  - 'normal': 기준 온도(baseline) 확립. 새 판독을 기준과 비교
 *  - 'suspect': 기준에서 크게 벗어난 판독(candidates)을 확인 중. 기준은 그대로
 */
export function createValidatorState() {
  return { phase: 'initializing', baseline: null, run: [], candidates: [], history: [] };
}

function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

// 경과 시간(ms) 동안 허용되는 온도 변화량
export function allowedDelta(elapsedMs) {
  const sec = Math.max(0, elapsedMs) / 1000;
  return clamp(sec * VALID_RATE_DEG_PER_SEC, VALID_MIN_DELTA, VALID_MAX_DELTA);
}

function isTemp(v) {
  return typeof v === 'number' && isFinite(v) && v >= TEMP_MIN && v <= TEMP_MAX;
}

function suspectMessage(from, to, count, persistent) {
  if (persistent) {
    return '온도 급변이 계속 감지됩니다: ' + from + '°C → ' + to + '°C (' + count + '회). ' +
      '실제 온도 변화나 표시 이상일 수 있으니 가마 표시창을 직접 확인하세요.';
  }
  return '온도 급변 감지: ' + from + '°C → ' + to + '°C. OCR 오인식 가능성이 있어 확인 중입니다.';
}

/**
 * 판독 한 번 검증
 * @param {object|null} prev 이전 검증 상태 (없으면 처음부터)
 * @param {{ rawTemp: number|null, confidence: number|null, at: number }} input
 *   rawTemp: 인식한 숫자 (판독 실패면 null), confidence: 인식 신뢰도(참고용, 검증 판단에는 쓰지 않음), at: 판독 시각(Date.now)
 * @returns {{ result: object, state: object }}
 *   result: { at, rawTemp, confidence, validatedTemp, status, reason, warning, persistent, baselineTemp }
 *     status: 'normal' | 'suspect' | 'unavailable' | 'initializing'
 *     reason: 검증 실패/대기 사유 (정상이면 '')
 *     warning: 진행 중인 급변 경고 (판독 실패가 끼어도 유지, 없으면 '')
 *     persistent: 급변값이 반복돼 직접 확인이 필요한 상태
 */
export function validateReading(prev, input) {
  const s = prev || createValidatorState();
  const at = input.at;
  const raw = isTemp(input.rawTemp) ? input.rawTemp : null;
  const confidence = typeof input.confidence === 'number' ? input.confidence : null;

  let phase = s.phase;
  let baseline = s.baseline;
  let run = s.run;
  let candidates = s.candidates;
  let status;
  let validatedTemp = null;
  let reason = '';

  if (raw === null) {
    // 인식 실패: 상태는 그대로 두고 이번 판독만 실패 (시간 변화 검증 실패와 구분)
    status = 'unavailable';
    reason = typeof input.rawTemp === 'number' ? '온도 범위(' + TEMP_MIN + '~' + TEMP_MAX + '°C)를 벗어났습니다.' : '숫자 판독 실패';
  } else if (phase === 'initializing') {
    // 처음: 직전 판독과 이어지는 값이면 모으고, 아니면 새로 시작. 충분히 모이면 기준 확립
    const last = run[run.length - 1];
    run = (last && Math.abs(raw - last.temp) <= allowedDelta(at - last.at)) ? run.concat([{ temp: raw, at }]) : [{ temp: raw, at }];
    if (run.length >= VALID_INIT_CONFIRM_COUNT) {
      phase = 'normal';
      baseline = { temp: raw, at };
      run = [];
      status = 'normal';
      validatedTemp = raw;
    } else {
      status = 'initializing';
      reason = '기준 온도 확인 중 (' + run.length + '/' + VALID_INIT_CONFIRM_COUNT + '회 일치)';
    }
  } else if (Math.abs(raw - baseline.temp) <= allowedDelta(at - baseline.at)) {
    // 마지막 정상 온도에서 허용 범위 안: 정상 (급변 확인 중이었다면 정상 복귀)
    phase = 'normal';
    baseline = { temp: raw, at };
    candidates = [];
    status = 'normal';
    validatedTemp = raw;
  } else {
    // 허용 범위를 넘는 변화: 이상치 후보. 같은 값(±오차)이 이어지면 횟수를 세지만 기준은 바꾸지 않음
    const last = candidates[candidates.length - 1];
    candidates = (phase === 'suspect' && last && Math.abs(raw - last.temp) <= VALID_CANDIDATE_TOLERANCE)
      ? candidates.concat([{ temp: raw, at }])
      : [{ temp: raw, at }];
    phase = 'suspect';
    status = 'suspect';
    reason = suspectMessage(baseline.temp, raw, candidates.length, candidates.length > VALID_RECHECK_COUNT);
  }

  const persistent = phase === 'suspect' && candidates.length > VALID_RECHECK_COUNT;
  const lastCandidate = candidates[candidates.length - 1];
  const warning = phase === 'suspect' && lastCandidate
    ? suspectMessage(baseline.temp, lastCandidate.temp, candidates.length, persistent)
    : '';

  const result = {
    at,
    rawTemp: raw,
    confidence,
    validatedTemp,
    status,
    reason,
    warning,
    persistent,
    baselineTemp: baseline ? baseline.temp : null
  };
  // 분석용 최근 원시 판독 기록 (제외된 이상치도 시각·원시값·사유와 함께 남김)
  const history = s.history.concat([{ at, rawTemp: raw, confidence, validatedTemp, status, reason }]).slice(-VALID_HISTORY_SIZE);
  return { result, state: { phase, baseline, run, candidates, history } };
}

// 검증을 통과한 온도만으로 중앙값 (예: 1분 중앙값). 통과한 값이 없으면 null
export function validatedMedian(results) {
  const temps = results
    .map((r) => (r ? r.validatedTemp : null))
    .filter((t) => typeof t === 'number' && isFinite(t))
    .sort((a, b) => a - b);
  if (!temps.length) return null;
  const mid = temps.length >> 1;
  return temps.length % 2 ? temps[mid] : (temps[mid - 1] + temps[mid]) / 2;
}
