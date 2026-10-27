// ===== 온도 그래프 (uPlot) =====

function cssColor(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function chartAxes() {
  const text = cssColor('--text', '#1b1f24');
  const grid = cssColor('--border', '#d5dae1');
  const axis = () => ({
    stroke: text,
    font: '12px -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif',
    ticks: { stroke: text, width: 1, size: 6 },
    grid: { show: true, stroke: grid, width: 1 }
  });
  return [
    Object.assign(axis(), { label: '시각' }),
    Object.assign(axis(), { label: '온도 (°C)' })
  ];
}

function formatClockShort(ts) {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return h + ':' + m;
}

/**
 * 온도-시간 그래프 생성
 * @param {HTMLElement} container 
 * @param {Array} readings - 온도 기록 [{ts, temp, quality}, ...]
 * @param {number} startedAt - 소성 시작 시각
 * @returns {Object} uPlot 인스턴스
 */
export function createTempChart(container, readings, startedAt, options) {
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
  const plotH = options && options.height ? options.height : 240;

  function formatElapsed(min) {
    const whole = Math.round(min);
    if (whole < 60) return whole + '분';
    const hours = Math.floor(whole / 60);
    const rest = whole % 60;
    return rest ? hours + '시간 ' + rest + '분' : hours + '시간';
  }

  function formatPointTemp(temp) {
    if (typeof temp !== 'number') return '—';
    const rounded = Math.round(temp * 10) / 10;
    return (Math.abs(rounded - Math.round(rounded)) < 0.05 ? String(Math.round(rounded)) : rounded.toFixed(1)) + '°C';
  }

  // 그래프 옵션
  const opts = {
    width: container.clientWidth,
    height: plotH,
    series: [
      {
        label: '시각'
      },
      {
        label: '온도 (°C)',
        stroke: '#3b82f6',
        fill: 'rgba(59, 130, 246, 0.1)',
        width: 2,
        points: {
          show: !options || options.showPoints !== false,
          size: 4,
          fill: '#3b82f6'
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
    axes: chartAxes().map((axis, i) => {
      if (i !== 0) return axis;
      return Object.assign({}, axis, {
        values: (u, splits) => splits.map((v) => {
          if (typeof v !== 'number' || !isFinite(v)) return '';
          return formatClockShort(startedAt + v * 60000);
        })
      });
    }),
    cursor: {
      show: false
    },
    legend: {
      show: true
    }
  };

  // uPlot 생성
  const chart = new uPlot(opts, data, container);
  const over = chart.root.querySelector('.u-over');
  const marker = document.createElement('div');
  marker.className = 'chart-focus';
  marker.hidden = true;
  marker.innerHTML = '<div class="chart-focus-line"></div><div class="chart-focus-dot"></div><div class="chart-focus-label"></div>';
  if (over) over.appendChild(marker);
  const dot = marker.querySelector('.chart-focus-dot');
  const label = marker.querySelector('.chart-focus-label');
  let focusIdx = -1;

  function placeFocus() {
    if (!over || focusIdx < 0 || focusIdx >= times.length) {
      marker.hidden = true;
      return;
    }
    const x = times[focusIdx];
    const y = temps[focusIdx];
    const left = chart.valToPos(x, 'x', false);
    const plotW = over.clientWidth || 0;
    marker.hidden = false;
    marker.style.left = left + 'px';
    label.style.transform = left > plotW - 130 ? 'translateX(calc(-100% - 8px))' : 'translateX(8px)';
    if (typeof y !== 'number') {
      dot.hidden = true;
      label.textContent = formatElapsed(x);
      label.style.top = '8px';
      return;
    }
    const top = chart.valToPos(y, 'y', false);
    dot.hidden = false;
    dot.style.top = top + 'px';
    const custom = options && typeof options.pointLabel === 'function' ? options.pointLabel(focusIdx) : '';
    label.textContent = custom || (formatClockShort(startedAt + x * 60000) + ' · ' + formatElapsed(x) + ' · ' + formatPointTemp(y));
    label.style.top = (top < 36 ? top + 16 : top - 28) + 'px';
  }

  chart.focusIndex = (idx) => {
    focusIdx = idx;
    placeFocus();
  };

  function nearestIndex(px, py) {
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < times.length; i++) {
      const x = chart.valToPos(times[i], 'x', false);
      const y = typeof temps[i] === 'number' ? chart.valToPos(temps[i], 'y', false) : null;
      const dx = x - px;
      const dy = y == null ? 0 : y - py;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    return best;
  }

  if (over) {
    over.addEventListener('click', (e) => {
      const rect = over.getBoundingClientRect();
      const idx = nearestIndex(e.clientX - rect.left, e.clientY - rect.top);
      if (idx < 0) return;
      chart.focusIndex(idx);
      if (options && typeof options.onPick === 'function') options.onPick(idx);
    });
  }

  // 반응형: 컨테이너 크기 변경 시 그래프 크기 조정
  const resizeObserver = new ResizeObserver(() => {
    chart.setSize({
      width: container.clientWidth,
      height: plotH
    });
    placeFocus();
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
    scales: {
      x: {time: false},
      y: {range: [0, 1400]}
    },
    axes: chartAxes(),
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
