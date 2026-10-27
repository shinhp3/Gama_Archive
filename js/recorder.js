// ===== 소성 자동 기록 =====
// 5초 판독 결과를 모아 1분마다 중앙값을 계산해 저장

import { RECORD_INTERVAL_MS, MIN_VALID_SAMPLES } from './config.js?v=0.3.21';
import * as db from './db.js?v=0.3.21';

function makeId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/**
 * @param {{ getKiln: Function, camera: object, onStateChange: Function }} deps
 *   getKiln(): 현재 선택된 가마, camera: 카메라 모듈, onStateChange(state): 소성 상태 변경
 */
export function createRecorder(deps) {
  const { getKiln, camera } = deps;
  
  let currentFiring = null;    // 진행 중인 소성
  let intervalTimer = null;    // 1분 타이머
  let readings = [];           // 현재 1분 구간의 판독 결과들
  let lastSaveTime = null;     // 마지막 저장 시각
  const savedIntervals = {};   // firingId+구간 → 저장됨. 같은 1분 구간을 두 번 쓰지 않음

  // 현재 소성 상태
  function state() {
    if (!currentFiring) return { active: false };
    
    const lastReading = readings.length > 0 ? readings[readings.length - 1] : null;
    
    return {
      active: true,
      firing: currentFiring,
      elapsed: Date.now() - currentFiring.startedAt,
      lastSaveTime,
      readingCount: readings.length,
      lastReadingTemp: lastReading ? lastReading.temp : null
    };
  }

  // 현재 1분 구간 (소성 시작 시각 기준)
  function getCurrentInterval(startedAt) {
    const elapsed = Date.now() - startedAt;
    const minutes = Math.floor(elapsed / RECORD_INTERVAL_MS);
    return {
      index: minutes,  // 0분, 1분, 2분...
      start: startedAt + minutes * RECORD_INTERVAL_MS,
      end: startedAt + (minutes + 1) * RECORD_INTERVAL_MS
    };
  }

  // 판독 결과 추가 (검증된 온도만)
  function addReading(result) {
    if (!currentFiring) {
      console.log('[Recorder] 소성이 진행 중이 아닙니다');
      return;
    }
    if (!result || !result.validation) {
      console.log('[Recorder] validation 없음:', result);
      return;
    }
    
    const validatedTemp = result.validation.validatedTemp;
    if (validatedTemp === null) {
      console.log('[Recorder] validatedTemp가 null, status:', result.validation.status, 'rawTemp:', result.temp);
      return;
    }
    
    readings.push({
      temp: validatedTemp,
      confidence: typeof result.confidence === 'number' ? result.confidence : 0,
      at: Date.now()
    });
    console.log('[Recorder] 판독 추가:', validatedTemp, '현재 개수:', readings.length);
    
    // UI 업데이트
    if (deps.onStateChange) deps.onStateChange(state());
  }

  // 중앙값 계산
  function calculateMedian(temps) {
    if (!temps.length) return null;
    const sorted = temps.slice().sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 === 1
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  // 현재 구간 저장
  async function saveCurrentInterval() {
    if (!currentFiring) return 'skip';

    const interval = getCurrentInterval(currentFiring.startedAt);
    const slot = currentFiring.id + ':' + interval.index;
    if (savedIntervals[slot]) return 'duplicate';
    
    // 온도 중앙값
    const temps = readings.map((r) => r.temp);
    const temp = calculateMedian(temps);
    
    // 데이터 품질
    const quality = temps.length === 0 ? 'missing' :
      temps.length < MIN_VALID_SAMPLES ? 'insufficient' : 'normal';
    
    // 평균 신뢰도
    const avgConf = readings.length === 0 ? null :
      readings.reduce((sum, r) => sum + r.confidence, 0) / readings.length;
    
    console.log('[Recorder] 구간 저장:', {
      interval: interval.index,
      temp,
      samples: temps.length,
      quality
    });
    
    // 저장
    try {
      await db.saveReading({
        firingId: currentFiring.id,
        ts: interval.end,
        temp,
        confidence: avgConf,
        validSampleCount: temps.length,
        quality,
        edited: false,
        originalTemp: null,
        editedAt: null
      });
      
      console.log('[Recorder] 저장 완료');
      savedIntervals[slot] = true;
      lastSaveTime = Date.now();
      
      // 다음 구간 준비
      readings = [];
      return 'saved';
      
    } catch (err) {
      console.error('[Recorder] 온도 기록 저장 실패:', err);
      if (deps.onSaveError) deps.onSaveError(err);
      throw err;
    }
  }

  // 1분 타이머 시작
  function startIntervalTimer() {
    if (!currentFiring) return;
    
    if (intervalTimer) {
      clearTimeout(intervalTimer);
      intervalTimer = null;
    }
    const interval = getCurrentInterval(currentFiring.startedAt);
    const delay = Math.max(0, interval.end - Date.now());

    intervalTimer = setTimeout(() => {
      intervalTimer = null;
      saveCurrentInterval()
        .then((kind) => {
          if (!currentFiring) return;
          if (kind === 'duplicate') {
            const again = getCurrentInterval(currentFiring.startedAt);
            const wait = Math.max(1000, again.end - Date.now());
            intervalTimer = setTimeout(() => startIntervalTimer(), wait);
            return;
          }
          startIntervalTimer();
        })
        .catch((err) => {
          console.error('구간 저장 실패:', err);
          if (!currentFiring) return;
          intervalTimer = setTimeout(() => startIntervalTimer(), 5000);
        });
    }, delay);
  }

  // 소성 시작
  async function start() {
    // 1. 검증
    const kiln = getKiln();
    if (!kiln) throw new Error('가마를 선택하세요.');
    if (!kiln.roi) throw new Error('영역을 먼저 지정하세요.');
    if (!camera.isRunning()) throw new Error('카메라를 먼저 시작하세요.');
    
    // 2. 활성 소성 확인
    const active = await db.getActiveFiring();
    if (active) throw new Error('이미 진행 중인 소성이 있습니다.');
    
    // 3. 소성 기록 생성
    const firing = {
      id: makeId(),
      kilnId: kiln.id,
      kilnName: kiln.name,
      startedAt: Date.now(),
      endedAt: null
    };
    
    console.log('[Recorder] 소성 시작:', firing);
    await db.saveFiring(firing);
    currentFiring = firing;
    readings = [];
    lastSaveTime = null;
    
    // 4. 1분 타이머 시작
    startIntervalTimer();
    
    // 5. 상태 변경 알림
    if (deps.onStateChange) deps.onStateChange(state());
    
    return firing;
  }

  // 소성 종료
  async function end() {
    if (!currentFiring) return false;
    
    console.log('[Recorder] 소성 종료 시작, 현재 판독 수:', readings.length);
    
    // 1. 타이머 정지
    if (intervalTimer) {
      clearTimeout(intervalTimer);
      intervalTimer = null;
    }
    
    // 2. 마지막 구간 저장 (1초 이상 경과했으면)
    if (readings.length > 0 && Date.now() - currentFiring.startedAt >= 1000) {
      console.log('[Recorder] 마지막 구간 저장 시도...');
      try {
        await saveCurrentInterval();
      } catch (err) {
        console.error('[Recorder] 마지막 구간 저장 실패:', err);
        // 저장 실패해도 종료는 진행
      }
    }
    
    // 3. 소성 종료 시각 저장
    const firingId = currentFiring.id;
    try {
      console.log('[Recorder] 소성 종료 시각 저장:', firingId);
      await db.updateFiring(firingId, { endedAt: Date.now() });
      console.log('[Recorder] 소성 종료 완료');
    } catch (err) {
      console.error('[Recorder] 소성 종료 시각 저장 실패:', err);
      throw err;
    }
    
    // 4. 상태 초기화
    currentFiring = null;
    readings = [];
    lastSaveTime = null;
    
    // 5. 상태 변경 알림
    if (deps.onStateChange) deps.onStateChange(state());
    
    return true;
  }

  // 활성 소성 복구 (페이지 새로고침 시)
  async function resume() {
    const active = await db.getActiveFiring();
    if (!active) return null;
    
    currentFiring = active;
    readings = [];
    lastSaveTime = null;
    
    // 타이머 재시작
    startIntervalTimer();
    
    if (deps.onStateChange) deps.onStateChange(state());
    
    return active;
  }

  return {
    start,
    end,
    resume,
    addReading,
    state,
    isActive: () => !!currentFiring
  };
}
