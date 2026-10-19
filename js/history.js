// ===== 기록 보기 (Phase 5) =====

import * as db from './db.js?v=0.3.11';
import { createTempChart } from './chart.js?v=0.3.11';

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
    deleteFiringBtn
  } = els;

  let currentFiring = null;
  let currentChart = null;

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
      
      // 정보 표시
      detailKilnName.textContent = firing.kilnName;
      detailStartTime.textContent = new Date(firing.startedAt).toLocaleString('ko-KR');
      detailEndTime.textContent = firing.endedAt 
        ? new Date(firing.endedAt).toLocaleString('ko-KR') 
        : '진행 중';
      
      const duration = (firing.endedAt || Date.now()) - firing.startedAt;
      const hours = Math.floor(duration / 3600000);
      const minutes = Math.floor((duration % 3600000) / 60000);
      detailDuration.textContent = `${hours > 0 ? hours + '시간 ' : ''}${minutes}분`;
      
      const temps = readings.map(r => r.temp).filter(t => t !== null);
      const maxTemp = temps.length > 0 ? Math.max(...temps) : null;
      detailMaxTemp.textContent = maxTemp !== null ? maxTemp + '°C' : '—';
      detailReadingCount.textContent = readings.length + '개';
      
      // 그래프
      if (currentChart) {
        currentChart.cleanup();
        currentChart = null;
      }
      
      chartContainer.innerHTML = '';
      if (readings.length === 0) {
        chartContainer.innerHTML = '<p class="muted">온도 기록이 없습니다.</p>';
      } else {
        currentChart = createTempChart(chartContainer, readings, firing.startedAt);
      }
      
      // 테이블
      if (readings.length === 0) {
        readingsTable.innerHTML = '<p class="muted">온도 기록이 없습니다.</p>';
      } else {
        const rows = readings.map((r, i) => {
          const time = new Date(r.ts).toLocaleTimeString('ko-KR');
          const elapsed = Math.floor((r.ts - firing.startedAt) / 60000);
          const temp = r.temp !== null ? r.temp + '°C' : '—';
          const quality = r.quality === 'normal' ? '정상' : 
                         r.quality === 'insufficient' ? '부족' : '누락';
          const edited = r.edited ? '✏️' : '';
          
          return `
            <tr>
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
      }
      
      // 화면 전환
      console.log('[History] 화면 전환 시작');
      console.log('[History] listCard:', listCard);
      console.log('[History] detailSection:', detailSection);
      
      listCard.hidden = true;
      detailSection.hidden = false;
      
      console.log('[History] 화면 전환 완료');
      
    } catch (err) {
      console.error('[History] 상세 보기 로드 실패:', err);
      alert('상세 정보를 불러오지 못했습니다: ' + err.message);
    }
  }

  // 목록으로 돌아가기
  function backToList() {
    if (currentChart) {
      currentChart.cleanup();
      currentChart = null;
    }
    currentFiring = null;
    detailSection.hidden = true;
    listCard.hidden = false;
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

  return {
    loadList
  };
}
