// ===== 온도 그래프 (uPlot) =====

/**
 * 온도-시간 그래프 생성
 * @param {HTMLElement} container 
 * @param {Array} readings - 온도 기록 [{ts, temp, quality}, ...]
 * @param {number} startedAt - 소성 시작 시각
 * @returns {Object} uPlot 인스턴스
 */
export function createTempChart(container, readings, startedAt) {
  if (!readings || readings.length === 0) {
    container.innerHTML = '<p class="muted">온도 기록이 없습니다.</p>';
    return null;
  }

  // 데이터 준비: [x축(분), y축(온도)]
  const times = [];
  const temps = [];
  
  readings.forEach(r => {
    const elapsedMin = (r.ts - startedAt) / 60000; // 경과 분
    times.push(elapsedMin);
    temps.push(r.temp);
  });

  const data = [times, temps];

  // 그래프 옵션
  const opts = {
    width: container.clientWidth,
    height: 300,
    series: [
      {
        label: '시간 (분)'
      },
      {
        label: '온도 (°C)',
        stroke: '#3b82f6',
        fill: 'rgba(59, 130, 246, 0.1)',
        width: 2,
        points: {
          show: true,
          size: 4,
          fill: '#3b82f6'
        }
      }
    ],
    axes: [
      {
        label: '경과 시간 (분)',
        grid: {
          show: true,
          stroke: '#e5e7eb',
          width: 1
        }
      },
      {
        label: '온도 (°C)',
        grid: {
          show: true,
          stroke: '#e5e7eb',
          width: 1
        }
      }
    ],
    scales: {
      x: {
        time: false
      },
      y: {
        range: [0, 1400]
      }
    },
    cursor: {
      lock: true,
      focus: {
        prox: 16
      },
      sync: {
        key: 'temp-chart'
      }
    },
    legend: {
      show: true
    }
  };

  // uPlot 생성
  const chart = new uPlot(opts, data, container);

  // 반응형: 컨테이너 크기 변경 시 그래프 크기 조정
  const resizeObserver = new ResizeObserver(() => {
    chart.setSize({
      width: container.clientWidth,
      height: 300
    });
  });
  resizeObserver.observe(container);

  // 정리 함수를 차트 객체에 추가
  chart.cleanup = () => {
    resizeObserver.disconnect();
    chart.destroy();
  };

  return chart;
}

/**
 * 여러 소성 비교 그래프
 * @param {HTMLElement} container 
 * @param {Array} firings - [{firing, readings}, ...]
 * @returns {Object} uPlot 인스턴스
 */
export function createComparisonChart(container, firings) {
  if (!firings || firings.length === 0) {
    container.innerHTML = '<p class="muted">비교할 소성을 선택하세요.</p>';
    return null;
  }

  // 공통 시간축 생성 (0분부터 가장 긴 소성까지)
  let maxMinutes = 0;
  firings.forEach(f => {
    if (f.readings.length > 0) {
      const lastReading = f.readings[f.readings.length - 1];
      const minutes = (lastReading.ts - f.firing.startedAt) / 60000;
      maxMinutes = Math.max(maxMinutes, minutes);
    }
  });

  // 1분 단위로 시간축 생성
  const timeStep = 1;
  const times = [];
  for (let t = 0; t <= maxMinutes; t += timeStep) {
    times.push(t);
  }

  // 각 소성 데이터 보간
  const data = [times];
  const colors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b'];
  
  const series = [{label: '시간 (분)'}];

  firings.forEach((f, i) => {
    const temps = new Array(times.length).fill(null);
    
    // 각 시간 포인트에 대해 가장 가까운 온도 찾기
    f.readings.forEach(r => {
      const elapsedMin = (r.ts - f.firing.startedAt) / 60000;
      const idx = Math.round(elapsedMin / timeStep);
      if (idx >= 0 && idx < temps.length) {
        temps[idx] = r.temp;
      }
    });

    data.push(temps);
    
    series.push({
      label: f.firing.kilnName,
      stroke: colors[i % colors.length],
      width: 2,
      points: {
        show: false
      }
    });
  });

  const opts = {
    width: container.clientWidth,
    height: 400,
    series,
    axes: [
      {
        label: '경과 시간 (분)',
        grid: {show: true, stroke: '#e5e7eb', width: 1}
      },
      {
        label: '온도 (°C)',
        grid: {show: true, stroke: '#e5e7eb', width: 1}
      }
    ],
    scales: {
      x: {time: false},
      y: {range: [0, 1400]}
    },
    cursor: {
      lock: true,
      focus: {prox: 16},
      sync: {key: 'comparison-chart'}
    },
    legend: {
      show: true
    }
  };

  const chart = new uPlot(opts, data, container);

  const resizeObserver = new ResizeObserver(() => {
    chart.setSize({
      width: container.clientWidth,
      height: 400
    });
  });
  resizeObserver.observe(container);

  chart.cleanup = () => {
    resizeObserver.disconnect();
    chart.destroy();
  };

  return chart;
}
