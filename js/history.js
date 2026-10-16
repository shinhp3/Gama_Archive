// ===== 기록 보기 (Phase 3 간단 버전) =====
// Phase 5에서 완전한 기능 구현 예정

import * as db from './db.js?v=0.3.6';

/**
 * @param {{ listEl: HTMLElement }} els
 */
export function createHistoryView(els) {
  const { listEl } = els;

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
          <div class="firing-item">
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
      
    } catch (err) {
      console.error('소성 목록 로드 실패:', err);
      listEl.innerHTML = '<p class="muted error">목록을 불러오지 못했습니다.</p>';
    }
  }

  return {
    loadList
  };
}
