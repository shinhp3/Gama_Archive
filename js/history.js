// ===== 기록 보기 (Phase 5) =====

import * as db from './db.js?v=0.3.21';
import { createTempChart } from './chart.js?v=0.3.21';

/**
 * @param {{ listEl: HTMLElement, listCard: HTMLElement, detailSection: HTMLElement, ...detailElements }} els
 */
export function createHistoryView(els) {
  const { 
    listEl,
    listCard,
    detailSection,
    backToListBtn,
    detailKilnName,
    detailStartTime,
    detailEndTime,
    detailDuration,
    detailMaxTemp,
    detailReadingCount,
    chartContainer,
    readingsTable,
    deleteFiringBtn,
    intervalBar
  } = els;

  let currentFiring = null;
  let currentReadings = [];
  let currentChart = null;
  let intervalMinutes = 30;

  function median(nums) {
    if (!nums.length) return null;
    const sorted = nums.slice().sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    if (sorted.length % 2 === 1) return sorted[mid];
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function formatWall(ts) {
    const d = new Date(ts);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function formatWallRange(startTs, endTs) {
    const a = new Date(startTs);
    const b = new Date(endTs);
    const sameDay = a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (sameDay) return formatWall(startTs) + '–' + formatWall(endTs);
    const day = (d) => (d.getMonth() + 1) + '/' + d.getDate() + ' ' + formatWall(d.getTime());
    return day(a) + '–' + day(b);
  }

  function detailChartHeight() {
    const available = window.innerHeight || 800;
    return Math.max(190, Math.min(250, Math.round(available * 0.3)));
  }

  function setDetailLayout(on) {
    document.body.classList.toggle('history-detail-open', on);
  }

  function formatClock(min) {
    const whole = Math.round(min);
    if (whole < 60) return whole + '분';
    const hours = Math.floor(whole / 60);
    const minutes = whole % 60;
    return minutes ? hours + '시간 ' + minutes + '분' : hours + '시간';
  }

  function formatBucketTemp(temp) {
    if (typeof temp !== 'number') return '—';
    const rounded = Math.round(temp * 10) / 10;
    return (Math.abs(rounded - Math.round(rounded)) < 0.05 ? String(Math.round(rounded)) : rounded.toFixed(1)) + '°C';
  }

  // stepMin 간격으로 모아 각 구간의 온도 중앙값을 만든다. 저장값 자체는 바꾸지 않는다.
  function bucketReadings(readings, startedAt, stepMin) {
    const groups = new Map();
    readings.forEach((r) => {
      const elapsed = Math.max(0, (r.ts - startedAt) / 60000);
      const index = Math.floor(elapsed / stepMin);
      if (!groups.has(index)) groups.set(index, []);
      groups.get(index).push({ reading: r, elapsed });
    });
    return Array.from(groups.keys()).sort((a, b) => a - b).map((index) => {
      const items = groups.get(index);
      const temps = items.map((item) => item.reading.temp).filter((t) => typeof t === 'number');
      const lastElapsed = items.reduce((max, item) => Math.max(max, item.elapsed), 0);
      return {
        startMin: index * stepMin,
        endMin: (index + 1) * stepMin,
        lastElapsed,
        temp: median(temps),
        count: items.length,
        ts: startedAt + lastElapsed * 60000
      };
    });
  }

  function setIntervalPressed(minutes) {
    if (!intervalBar) return;
    intervalBar.querySelectorAll('button').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(Number(btn.dataset.minutes) === minutes));
    });
  }

  // 소성 목록 표시
  async function loadList() {
    try {
      listEl.innerHTML = '<p class="muted">로딩 중...</p>';
      
      console.log('[History] 소성 목록 로드 시작...');
      const firings = await db.getAllFirings();
      console.log('[History] 소성 개수:', firings ? firings.length : 0, firings);
      
      if (!firings || firings.length === 0) {
        listEl.innerHTML = '<p class="muted">아직 소성 기록이 없습니다.</p>';
        return;
      }

      // 최신순 정렬
      firings.sort((a, b) => b.startedAt - a.startedAt);

      // 목록 생성
      const items = await Promise.all(firings.map(async (f) => {
        console.log('[History] 소성:', f.id, f.kilnName);
        const readings = await db.getReadings(f.id);
        console.log('[History] 온도 기록 수:', readings.length);
        const temps = readings.map(r => r.temp).filter(t => t !== null);
        const maxTemp = temps.length > 0 ? Math.max(...temps) : null;
        
        const startTime = new Date(f.startedAt);
        const duration = f.endedAt ? f.endedAt - f.startedAt : Date.now() - f.startedAt;
        const hours = Math.floor(duration / 3600000);
        const minutes = Math.floor((duration % 3600000) / 60000);
        
        const status = f.endedAt ? '완료' : '진행 중';
        const statusClass = f.endedAt ? 'status-complete' : 'status-active';

        return `
          <div class="firing-item" data-firing-id="${f.id}">
            <div class="firing-header">
              <h3>${f.kilnName}</h3>
              <span class="status-badge ${statusClass}">${status}</span>
            </div>
            <div class="firing-meta">
              <div class="meta-row">
                <span class="meta-label">시작:</span>
                <span>${startTime.toLocaleString('ko-KR')}</span>
              </div>
              <div class="meta-row">
                <span class="meta-label">소요:</span>
                <span>${hours > 0 ? hours + '시간 ' : ''}${minutes}분</span>
              </div>
              <div class="meta-row">
                <span class="meta-label">최고온도:</span>
                <span>${maxTemp !== null ? maxTemp + '°C' : '—'}</span>
              </div>
              <div class="meta-row">
                <span class="meta-label">기록 수:</span>
                <span>${readings.length}개</span>
              </div>
            </div>
          </div>
        `;
      }));

      listEl.innerHTML = items.join('');
      
      console.log('[History] 목록 렌더링 완료, 클릭 이벤트 등록 시작');
      
      // 클릭 이벤트
      const itemElements = listEl.querySelectorAll('.firing-item');
      console.log('[History] 찾은 아이템 수:', itemElements.length);
      
      itemElements.forEach((item, index) => {
        const firingId = item.dataset.firingId;
        console.log('[History] 아이템', index, '- firingId:', firingId);
        
        item.addEventListener('click', () => {
          console.log('[History] 클릭됨! firingId:', firingId);
          showDetail(firingId);
        });
        
        // 커서 포인터 스타일 확인
        item.style.cursor = 'pointer';
      });
      
    } catch (err) {
      console.error('소성 목록 로드 실패:', err);
      listEl.innerHTML = '<p class="muted error">목록을 불러오지 못했습니다.</p>';
    }
  }

  // 소성 상세 보기
  async function showDetail(firingId) {
    console.log('[History] showDetail 호출됨, firingId:', firingId);
    
    try {
      const firing = await db.getFiring(firingId);
      console.log('[History] firing 데이터:', firing);
      
      if (!firing) {
        alert('소성 기록을 찾을 수 없습니다.');
        return;
      }
      
      currentFiring = firing;
      const readings = await db.getReadings(firingId);
      currentReadings = readings;
      intervalMinutes = readings.length > 60 ? 30 : 1;
      setIntervalPressed(intervalMinutes);
      
      // 정보 표시
      detailKilnName.textContent = firing.kilnName;
      const crossDay = !!(firing.endedAt && new Date(firing.startedAt).toDateString() !== new Date(firing.endedAt).toDateString());
      const stamp = (ts) => {
        const d = new Date(ts);
        return crossDay ? (d.getMonth() + 1) + '/' + d.getDate() + ' ' + formatWall(ts) : formatWall(ts);
      };
      detailStartTime.textContent = stamp(firing.startedAt);
      detailEndTime.textContent = firing.endedAt ? stamp(firing.endedAt) : '진행 중';
      
      const duration = (firing.endedAt || Date.now()) - firing.startedAt;
      const hours = Math.floor(duration / 3600000);
      const minutes = Math.floor((duration % 3600000) / 60000);
      detailDuration.textContent = `${hours > 0 ? hours + '시간 ' : ''}${minutes}분`;
      
      const temps = readings.map(r => r.temp).filter(t => t !== null);
      const maxTemp = temps.length > 0 ? Math.max(...temps) : null;
      detailMaxTemp.textContent = maxTemp !== null ? '최고 ' + maxTemp + '°C' : '최고 —';
      detailReadingCount.textContent = readings.length + '개';
      renderSeries();
      
      // 화면 전환
      console.log('[History] 화면 전환 시작');
      console.log('[History] listCard:', listCard);
      console.log('[History] detailSection:', detailSection);
      
      listCard.hidden = true;
      detailSection.hidden = false;
      setDetailLayout(true);
      
      console.log('[History] 화면 전환 완료');
      
    } catch (err) {
      console.error('[History] 상세 보기 로드 실패:', err);
      alert('상세 정보를 불러오지 못했습니다: ' + err.message);
    }
  }

  function renderSeries() {
    const firing = currentFiring;
    const readings = currentReadings;
    if (!firing) return;

    if (currentChart) {
      currentChart.cleanup();
      currentChart = null;
    }
    chartContainer.innerHTML = '';

    if (readings.length === 0) {
      chartContainer.innerHTML = '<p class="muted">온도 기록이 없습니다.</p>';
      readingsTable.innerHTML = '<p class="muted">온도 기록이 없습니다.</p>';
      return;
    }

    if (intervalMinutes <= 1) {
      detailReadingCount.textContent = readings.length + '개';
      currentChart = createTempChart(chartContainer, readings, firing.startedAt, {
        showPoints: readings.length <= 80,
        height: detailChartHeight(),
        onPick: (index) => selectReading(index)
      });
      const rows = readings.map((r, i) => {
          const time = new Date(r.ts).toLocaleTimeString('ko-KR');
          const elapsed = Math.floor((r.ts - firing.startedAt) / 60000);
          const temp = r.temp !== null ? r.temp + '°C' : '—';
          const quality = r.quality === 'normal' ? '정상' : 
                         r.quality === 'insufficient' ? '부족' : '누락';
          const edited = r.edited ? '✏️' : '';
          
          return `
            <tr data-index="${i}" tabindex="0">
              <td>${i + 1}</td>
              <td>${elapsed}분</td>
              <td>${time}</td>
              <td>${temp} ${edited}</td>
              <td>${r.validSampleCount || 0}</td>
              <td>${quality}</td>
            </tr>
          `;
        }).join('');
        
        readingsTable.innerHTML = `
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>경과</th>
                <th>시각</th>
                <th>온도</th>
                <th>샘플</th>
                <th>품질</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        `;
      return;
    }

    const buckets = bucketReadings(readings, firing.startedAt, intervalMinutes);
    detailReadingCount.textContent = readings.length + '개 · ' + buckets.length + '칸';
    currentChart = createTempChart(chartContainer, buckets.map((b) => ({
      ts: b.ts,
      temp: b.temp
    })), firing.startedAt, {
      showPoints: true,
      height: detailChartHeight(),
      pointLabel: (i) => {
        const b = buckets[i];
        if (!b) return '';
        const startTs = firing.startedAt + b.startMin * 60000;
        const endTs = firing.startedAt + b.endMin * 60000;
        return formatWallRange(startTs, endTs) + ' · ' + formatBucketTemp(b.temp);
      },
      onPick: (index) => selectReading(index)
    });
    const rows = buckets.map((b, i) => `
      <tr data-index="${i}" tabindex="0">
        <td>${i + 1}</td>
        <td>${formatClock(b.startMin)}–${formatClock(b.endMin)}</td>
        <td>${formatWallRange(firing.startedAt + b.startMin * 60000, firing.startedAt + b.endMin * 60000)}</td>
        <td>${formatBucketTemp(b.temp)}</td>
        <td>${b.count}개</td>
      </tr>
    `).join('');
    readingsTable.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>구간</th>
            <th>시각</th>
            <th>온도</th>
            <th>포함 기록</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    `;
  }

  function selectReading(index) {
    if (!currentChart || typeof currentChart.focusIndex !== 'function' || !Number.isInteger(index)) return;
    readingsTable.querySelectorAll('tbody tr').forEach((tr) => {
      tr.classList.toggle('is-selected', Number(tr.dataset.index) === index);
    });
    currentChart.focusIndex(index);
    const row = readingsTable.querySelector('tbody tr.is-selected');
    if (row) row.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function readingFromEvent(e) {
    const row = e.target.closest('tbody tr');
    if (!row || !readingsTable.contains(row)) return null;
    const index = Number(row.dataset.index);
    return Number.isInteger(index) ? index : null;
  }

  function backToList() {
    if (currentChart) {
      currentChart.cleanup();
      currentChart = null;
    }
    currentFiring = null;
    currentReadings = [];
    detailSection.hidden = true;
    listCard.hidden = false;
    setDetailLayout(false);
    loadList();
  }

  // 소성 삭제
  async function deleteFiring() {
    if (!currentFiring) return;
    
    if (!confirm(`"${currentFiring.kilnName}" 소성 기록을 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.`)) {
      return;
    }
    
    try {
      await db.deleteFiring(currentFiring.id);
      alert('삭제되었습니다.');
      backToList();
    } catch (err) {
      console.error('삭제 실패:', err);
      alert('삭제하지 못했습니다.');
    }
  }

  // 이벤트 리스너
  backToListBtn.addEventListener('click', backToList);
  deleteFiringBtn.addEventListener('click', deleteFiring);
  if (intervalBar) {
    intervalBar.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn || !currentFiring) return;
      const minutes = Number(btn.dataset.minutes);
      if (!minutes || minutes === intervalMinutes) return;
      intervalMinutes = minutes;
      setIntervalPressed(minutes);
      renderSeries();
    });
  }
  readingsTable.addEventListener('click', (e) => {
    const index = readingFromEvent(e);
    if (index == null) return;
    selectReading(index);
  });
  readingsTable.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const index = readingFromEvent(e);
    if (index == null) return;
    e.preventDefault();
    selectReading(index);
  });

  return {
    loadList,
    redraw: () => { if (currentFiring) renderSeries(); }
  };
}
