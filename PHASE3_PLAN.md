# Phase 3 개발 계획 — 소성 자동 기록

**작성일:** 2026-10-16  
**목표:** 5초 판독 결과를 1분 간격으로 저장하는 자동 기록 시스템 구현  
**예상 소요 시간:** 3~4시간

---

## 1. 구현 기능 개요

### 핵심 기능
1. **소성 시작/종료**
   - 버튼 클릭으로 즉시 시작
   - 소성 정보 저장 (firings)
   - 기록 상태 관리

2. **자동 판독 및 저장**
   - 기존 5초 판독 활용 (이미 구현됨)
   - 1분 구간별 중앙값 계산
   - 온도 기록 저장 (readings)

3. **데이터 품질 관리**
   - 유효 판독 개수 기록
   - 데이터 품질 구분 (normal/insufficient/missing)
   - 결측 구간 처리

4. **간소화된 UX**
   - 작업자 이름 입력 제거 (가마 이름으로 충분)
   - 경고 배너 제거 (가마는 천천히 변화, 인식 오류는 validator가 처리)

---

## 2. 구현할 파일

### 새로 생성
**`js/recorder.js`** (약 400~500줄)
- 소성 시작/종료
- 1분 구간 관리
- 중앙값 계산
- firings/readings 저장
- 경고 상태 관리

### 수정
1. **`index.html`** (약 30줄 추가)
   - 소성 시작/종료 버튼
   - 소성 진행 상태 표시
   - 경과 시간 표시

2. **`js/main.js`** (약 60줄 추가)
   - recorder 모듈 import
   - 소성 버튼 이벤트 연결
   - 판독 결과 → recorder 전달
   - 상태 표시 갱신

3. **`js/db.js`** (약 50줄 추가)
   - saveFiring() 함수
   - updateFiring() 함수
   - saveReading() 함수
   - getActiveFiring() 함수
   - getReadings() 함수

4. **`css/style.css`** (약 20줄 추가)
   - 소성 상태 표시 스타일
   - 버튼 배치

5. **`js/config.js`** (약 5줄 추가)
   - 기록 간격 상수
   - 데이터 품질 기준

---

## 3. 데이터 구조

### firings (소성 기록)
```javascript
{
  id: "uuid",
  kilnId: "uuid",
  kilnName: "1호기",         // 가마 이름으로 식별
  startedAt: 1697435280000,  // Date.now()
  endedAt: null              // 진행 중이면 null
}
```

### readings (온도 기록)
```javascript
{
  id: 1,                     // autoIncrement
  firingId: "uuid",
  ts: 1697435340000,         // 구간 종료 시각 (1분 단위)
  temp: 1187,                // 확정 온도 (중앙값)
  confidence: 0.96,          // 평균 신뢰도
  validSampleCount: 11,      // 유효 판독 개수
  quality: "normal",         // "normal" | "insufficient" | "missing"
  edited: false,
  originalTemp: null,
  editedAt: null
}
```

---

## 4. 상세 구현 계획

### 4-1. 소성 시작

#### UI (index.html)
```html
<!-- 소성 정보 (가마 카드 내부, 상태 표시 아래) -->
<div class="firing-section">
  <!-- 소성 대기 -->
  <div id="firingIdle">
    <button id="startFiringBtn" type="button" class="primary">
      소성 시작
    </button>
  </div>
  
  <!-- 소성 진행 중 -->
  <div id="firingActive" hidden>
    <div class="firing-info">
      <div class="status-row">
        <span class="status-label">시작 시각</span>
        <span id="firingStartTime">—</span>
      </div>
      <div class="status-row">
        <span class="status-label">경과 시간</span>
        <span id="firingElapsed">—</span>
      </div>
      <div class="status-row">
        <span class="status-label">마지막 기록</span>
        <span id="lastRecordTime">—</span>
      </div>
    </div>
    <button id="endFiringBtn" type="button" class="danger">
      소성 종료
    </button>
  </div>
</div>
```

#### 로직 (recorder.js)
```javascript
export function createRecorder(deps) {
  const { getKiln, db } = deps;
  
  let currentFiring = null;
  let intervalTimer = null;
  let readings = []; // 현재 1분 구간의 판독 결과들
  
  async function startFiring() {
    // 1. 검증
    const kiln = getKiln();
    if (!kiln) throw new Error("가마를 선택하세요");
    if (!kiln.roi) throw new Error("영역을 먼저 지정하세요");
    if (!camera.isRunning()) throw new Error("카메라를 먼저 시작하세요");
    
    // 2. 활성 소성 확인
    const active = await db.getActiveFiring();
    if (active) throw new Error("이미 진행 중인 소성이 있습니다");
    
    // 3. 소성 기록 생성
    const firing = {
      id: makeId(),
      kilnId: kiln.id,
      kilnName: kiln.name,
      startedAt: Date.now(),
      endedAt: null
    };
    
    await db.saveFiring(firing);
    currentFiring = firing;
    
    // 4. 1분 타이머 시작
    startIntervalTimer();
    
    return firing;
  }
  
  // ... 나머지 함수들
}
```

### 4-2. 1분 구간 처리

#### 구간 계산
```javascript
// 소성 시작 시각 기준 1분 구간
function getCurrentInterval(startedAt) {
  const elapsed = Date.now() - startedAt;
  const minutes = Math.floor(elapsed / 60000);
  return {
    index: minutes,  // 0분, 1분, 2분...
    start: startedAt + minutes * 60000,
    end: startedAt + (minutes + 1) * 60000
  };
}
```

#### 판독 결과 수집
```javascript
function onReading(result) {
  if (!currentFiring) return;
  if (!result || !result.validation) return;
  
  // 검증된 온도만 수집
  if (result.validation.validatedTemp !== null) {
    readings.push({
      temp: result.validation.validatedTemp,
      confidence: result.confidence,
      at: Date.now()
    });
  }
}
```

#### 1분마다 저장
```javascript
function startIntervalTimer() {
  // 다음 1분 구간 시작까지 대기
  const interval = getCurrentInterval(currentFiring.startedAt);
  const delay = interval.end - Date.now();
  
  intervalTimer = setTimeout(async () => {
    await saveCurrentInterval();
    startIntervalTimer(); // 다음 구간
  }, delay);
}

async function saveCurrentInterval() {
  const interval = getCurrentInterval(currentFiring.startedAt);
  
  // 중앙값 계산
  const temps = readings
    .filter(r => r.temp !== null)
    .map(r => r.temp)
    .sort((a, b) => a - b);
  
  const temp = temps.length === 0 ? null :
    temps.length % 2 === 1 ? temps[Math.floor(temps.length / 2)] :
    (temps[Math.floor(temps.length / 2) - 1] + temps[Math.floor(temps.length / 2)]) / 2;
  
  // 데이터 품질
  const quality = temps.length === 0 ? "missing" :
    temps.length < 6 ? "insufficient" : "normal";
  
  // 평균 신뢰도
  const avgConf = readings.length === 0 ? null :
    readings.reduce((sum, r) => sum + r.confidence, 0) / readings.length;
  
  // 저장
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
  
  // 다음 구간 준비
  readings = [];
}
```

### 4-3. 소성 종료

```javascript
async function endFiring() {
  if (!currentFiring) return;
  
  // 1. 타이머 정지
  if (intervalTimer) {
    clearTimeout(intervalTimer);
    intervalTimer = null;
  }
  
  // 2. 마지막 구간 저장
  if (readings.length > 0) {
    await saveCurrentInterval();
  }
  
  // 3. 소성 종료 시각 저장
  await db.updateFiring(currentFiring.id, {
    endedAt: Date.now()
  });
  
  // 4. 상태 초기화
  currentFiring = null;
  readings = [];
  
  return true;
}
```

### 4-4. 상태 모니터링 (간소화)

```javascript
// 경고 배너 제거, 상태만 기록
function updateStatus(result) {
  // 마지막 유효 판독 시각 기록
  if (result.validation && result.validation.validatedTemp !== null) {
    lastValidTime = Date.now();
  }
  
  // 상태 표시만 (UI에 반영)
  return {
    hasValidData: lastValidTime !== null,
    lastValidTime
  };
}
```

**참고:** 온도 급변은 `temperature-validator.js`가 이미 처리하므로 별도 경고 불필요

---

## 5. IndexedDB 함수 추가

### db.js
```javascript
// 소성 저장
export function saveFiring(firing) {
  return run('firings', 'readwrite', store => store.add(firing));
}

// 소성 업데이트 (종료 시각 등)
export function updateFiring(id, updates) {
  return run('firings', 'readwrite', store => {
    return new Promise((resolve, reject) => {
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const firing = getReq.result;
        if (!firing) {
          reject(new Error("소성을 찾을 수 없습니다"));
          return;
        }
        const updated = Object.assign({}, firing, updates);
        const putReq = store.put(updated);
        putReq.onsuccess = () => resolve(updated);
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  });
}

// 활성 소성 조회 (endedAt = null)
export function getActiveFiring() {
  return run('firings', 'readonly', store => {
    return new Promise((resolve) => {
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve(null);
          return;
        }
        const firing = cursor.value;
        if (!firing.endedAt) {
          resolve(firing);
          return;
        }
        cursor.continue();
      };
      req.onerror = () => resolve(null);
    });
  });
}

// 온도 기록 저장
export function saveReading(reading) {
  return run('readings', 'readwrite', store => store.add(reading));
}

// 소성의 온도 기록 조회
export function getReadings(firingId) {
  return run('readings', 'readonly', store => {
    const index = store.index('firingId');
    return index.getAll(firingId);
  }).then(list => {
    (list || []).sort((a, b) => a.ts - b.ts);
    return list || [];
  });
}
```

---

## 6. config.js 상수 추가

```javascript
// ===== 소성 기록 (Phase 3) =====
export const RECORD_INTERVAL_MS = 60000;        // 1분 (60초)
export const MIN_VALID_SAMPLES = 6;             // 정상 품질 최소 판독 수
```

---

## 7. 구현 순서

### 1단계: IndexedDB 함수 (30분)
- `db.js` 수정
- firings/readings CRUD

### 2단계: recorder.js 작성 (70분)
- 소성 시작/종료
- 1분 구간 처리
- 중앙값 계산

### 3단계: UI 추가 (25분)
- `index.html` 수정
- 버튼, 상태 표시 (간소화)

### 4단계: main.js 연결 (25분)
- recorder 모듈 import
- 이벤트 연결
- 상태 갱신

### 5단계: 스타일 (15분)
- `css/style.css` 추가
- 버튼, 상태 표시 스타일

### 6단계: 테스트 (35분)
- 소성 시작/종료
- 1분 저장 확인
- 데이터 품질

---

## 8. 주의사항

### 기존 코드 보존
- ✅ reading.js 수정 없음
- ✅ temperature-validator.js 수정 없음
- ✅ camera.js 수정 없음
- ✅ 기존 5초 판독 활용

### 데이터 무결성
- 소성 시작 전 활성 소성 확인
- 1분 구간 중복 저장 방지
- 트랜잭션 오류 처리

### 사용자 경험
- 버튼 클릭으로 즉시 시작 (입력 폼 없음)
- 소성 중에는 가마 변경 제한
- 소성 중에는 ROI 변경 제한
- 종료 확인 다이얼로그

---

## 9. 테스트 계획

### 기본 동작
- [ ] 소성 시작 → firings 저장 확인
- [ ] 1분 경과 → readings 저장 확인
- [ ] 중앙값 계산 정확성
- [ ] 소성 종료 → endedAt 저장 확인

### 데이터 품질
- [ ] 정상 판독 11개 → quality: normal
- [ ] 판독 5개 → quality: insufficient
- [ ] 판독 0개 → quality: missing

### 에지 케이스
- [ ] 활성 소성 있을 때 시작 방지
- [ ] 페이지 새로고침 → 활성 소성 복구 (Phase 4)
- [ ] 브라우저 종료 후 재시작

---

이 계획대로 진행해도 괜찮을까요? 수정하고 싶은 부분이 있으면 말씀해 주세요!
