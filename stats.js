// 통계: 주간 / 월간 / 훈련별 + 그래프 (Chart.js)
import { TYPES, toSec, fmtPace, fmtDuration } from './plan.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let ChartP = null;
const charts = [];
function loadChart() {
  ChartP ||= import('https://cdn.jsdelivr.net/npm/chart.js@4.4.4/auto/+esm').then(m => m.default || m.Chart);
  return ChartP;
}

/* ---------- 날짜 ---------- */
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = s => new Date(s + 'T00:00:00');
function mondayOf(s) { const d = parse(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); }
function addDays(s, n) { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); }
const monthOf = s => s.slice(0, 7);
function addMonths(ym, n) { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }

/* ---------- 집계 ---------- */
const kmOf = w => Number(w.actual_distance || w.planned_distance || 0);
function agg(list) {
  const a = { n: 0, km: 0, sec: 0, secKm: 0, hrSum: 0, hrKm: 0, longest: 0, long18: 0, last: null };
  for (const w of list) {
    const km = kmOf(w); a.n++; a.km += km; a.longest = Math.max(a.longest, km);
    if (km >= 18) a.long18++;
    const s = toSec(w.actual_time);
    if (s && w.actual_distance) { a.sec += s; a.secKm += Number(w.actual_distance); }
    if (w.avg_hr) { a.hrSum += Number(w.avg_hr) * km; a.hrKm += km; }
    if (!a.last || w.date > a.last) a.last = w.date;
  }
  a.pace = a.secKm ? a.sec / a.secKm : null;
  a.hr = a.hrKm ? Math.round(a.hrSum / a.hrKm) : null;
  return a;
}
const NON_RUN = ['rest', 'cross', 'strength'];
const doneRuns = ws => ws.filter(w => w.status === 'done' && !NON_RUN.includes(w.type));

/* ---------- 범위 ---------- */
export const TAB_RANGES = { heat: ['y', 'all'], cum: ['y', 'all'] };
export const RANGES = {
  w4: '최근 4주', w12: '최근 12주', m6: '최근 6개월', y: '올해', all: '전체',
};
function rangeStart(key, today) {
  if (key === 'w4') return addDays(mondayOf(today), -21);
  if (key === 'w12') return addDays(mondayOf(today), -77);
  if (key === 'm6') return addMonths(monthOf(today), -5) + '-01';
  if (key === 'y') return today.slice(0, 4) + '-01-01';
  return '0000-01-01';
}

/* ---------- 차트 공통 ---------- */
function destroyCharts() { while (charts.length) charts.pop().destroy(); }
const paceTick = v => fmtPace(v);
async function makeChart(canvas, config) {
  const Chart = await loadChart();
  const c = new Chart(canvas, config);
  charts.push(c);
  return c;
}

function summaryCards(a, label) {
  return `
    <div class="stat"><div class="k">${label} 총 거리</div><div class="v">${a.km.toFixed(1)}<small> km</small></div></div>
    <div class="stat"><div class="k">러닝 횟수</div><div class="v">${a.n}<small> 회</small></div></div>
    <div class="stat"><div class="k">총 시간</div><div class="v sm">${a.sec ? fmtDuration(a.sec) : '-'}</div></div>
    <div class="stat"><div class="k">평균 페이스</div><div class="v">${a.pace ? fmtPace(a.pace) : '-'}<small> /km</small></div></div>
    <div class="stat"><div class="k">평균 심박</div><div class="v">${a.hr ?? '-'}<small> bpm</small></div></div>
    <div class="stat"><div class="k">최장 거리</div><div class="v">${a.longest ? a.longest.toFixed(1) : '-'}<small> km</small></div></div>`;
}

/* ---------- 렌더 ---------- */
export async function renderStats(root, { workouts, logs = [], races = [], tab, range, today, onPickDate }) {
  destroyCharts();
  const runs = doneRuns(workouts);
  const start = rangeStart(range, today);
  const inRange = runs.filter(w => w.date >= start && w.date <= today);
  root.querySelector('#stat-summary').innerHTML = summaryCards(agg(inRange), RANGES[range]);
  const c1 = root.querySelector('#stat-chart'), c2 = root.querySelector('#stat-chart2');
  const box2 = root.querySelector('#stat-chart2-box');
  const table = root.querySelector('#stat-table');
  const note = root.querySelector('#stat-note');
  box2.classList.add('hidden'); note.textContent = '';

  if (tab === 'week') {
    // 주 목록: 범위 시작 주 ~ (이번 주 또는 계획이 있는 최대 6주 뒤)
    const thisMon = mondayOf(today);
    const lastPlanned = workouts.filter(w => w.type !== 'rest' && w.date > today && w.date <= addDays(thisMon, 48)).map(w => w.date).sort().pop();
    const endMon = lastPlanned ? mondayOf(lastPlanned) : thisMon;
    let firstMon = mondayOf(start < '1000' ? (runs[0]?.date || today) : start);
    const weeks = [];
    for (let m = firstMon; m <= endMon; m = addDays(m, 7)) weeks.push(m);
    let rows = weeks.map(m => {
      const e = addDays(m, 6);
      const plan = workouts.filter(w => !NON_RUN.includes(w.type) && w.date >= m && w.date <= e).reduce((s, w) => s + Number(w.planned_distance || 0), 0);
      const a = agg(runs.filter(w => w.date >= m && w.date <= e));
      return { m, plan, a, future: m > thisMon };
    });
    while (rows.length > 1 && !rows[0].plan && !rows[0].a.n) rows.shift();
    note.textContent = '막대: 완료 거리(진한 색)와 계획 거리(연한 색) · 선: 평균 페이스(위로 갈수록 빠름)';
    await makeChart(c1, {
      data: {
        labels: rows.map(r => r.m.slice(5).replace('-', '/')),
        datasets: [
          { type: 'bar', label: '완료(km)', data: rows.map(r => +r.a.km.toFixed(1)), backgroundColor: '#2563eb', borderRadius: 4, order: 2 },
          { type: 'bar', label: '계획(km)', data: rows.map(r => +r.plan.toFixed(1)), backgroundColor: '#cbd5e1', borderRadius: 4, order: 3 },
          { type: 'line', label: '평균 페이스', data: rows.map(r => r.a.pace ? Math.round(r.a.pace) : null), yAxisID: 'y1', borderColor: '#f97316', backgroundColor: '#f97316', tension: .3, spanGaps: true, order: 1 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        scales: { y: { beginAtZero: true, title: { display: true, text: 'km' } }, y1: { position: 'right', reverse: true, grid: { drawOnChartArea: false }, ticks: { callback: paceTick } } },
        plugins: { tooltip: { callbacks: { label: c => c.dataset.yAxisID === 'y1' ? `평균 페이스 ${fmtPace(c.raw)}/km` : `${c.dataset.label} ${c.raw}` } } },
        onClick: (_e, els) => { if (els[0]) onPickDate?.(rows[els[0].index].m); },
      },
    });
    // 전주 대비 증가율 (지난 주=실제, 이번 주 이후=계획과 실제 중 큰 값)
    rows.forEach((r, i) => { r.load = r.m < thisMon ? r.a.km : Math.max(r.a.km, r.plan); const p = rows[i - 1]; r.chg = p && p.load >= 10 ? (r.load - p.load) / p.load : null; r.race = workouts.some(w => w.type === 'race' && w.date >= r.m && w.date <= addDays(r.m, 6)); });
    let streak = 0; rows.forEach(r => { streak = r.chg != null && r.chg > -0.15 ? streak + 1 : 0; r.recHint = streak >= 3 && !r.race; });
    const warnN = rows.filter(r => r.chg > 0.1 && !r.race).length;
    note.textContent += warnN ? ` · 전주 대비 10% 초과 증가 ${warnN}주 (빨간 표시)` : ' · 전주 대비 10% 초과 증가 없음';
    table.innerHTML = `<thead><tr><th>주(월요일)</th><th>계획</th><th>완료</th><th>전주 대비</th><th>달성률</th><th>횟수</th><th>평균 페이스</th><th>평균 심박</th><th>총 시간</th><th>최장</th></tr></thead><tbody>
      ${[...rows].reverse().map(r => `<tr class="${r.m === thisMon ? 'cur' : ''}${r.future ? ' fut' : ''}"><td>${r.m.slice(5).replace('-', '/')}~${r.future ? ' (예정)' : ''}${r.race ? ' <span class="tag">대회</span>' : ''}</td><td>${r.plan.toFixed(1)}km</td><td><b>${r.a.km.toFixed(1)}km</b></td><td>${r.chg == null ? '-' : `<span class="${r.chg > 0.1 && !r.race ? 'pv fast' : r.chg < -0.15 ? 'pv ok' : ''}">${r.chg > 0 ? '+' : ''}${Math.round(r.chg * 100)}%</span>`}${r.recHint ? ' <span class="tag">다음 주 회복주 권장</span>' : ''}</td><td>${r.plan ? Math.round(r.a.km / r.plan * 100) + '%' : '-'}</td><td>${r.a.n}회</td><td>${r.a.pace ? fmtPace(r.a.pace) : '-'}</td><td>${r.a.hr ?? '-'}</td><td>${r.a.sec ? fmtDuration(r.a.sec) : '-'}</td><td>${r.a.longest ? r.a.longest.toFixed(1) + 'km' : '-'}</td></tr>`).join('')}</tbody>`;
  }

  if (tab === 'month') {
    const firstM = start < '1000' ? monthOf(runs[0]?.date || today) : monthOf(start);
    const months = [];
    for (let m = firstM; m <= monthOf(today); m = addMonths(m, 1)) months.push(m);
    let rows = months.map(m => ({ m, a: agg(runs.filter(w => monthOf(w.date) === m)) }));
    while (rows.length > 1 && !rows[0].a.n) rows.shift();
    note.textContent = '막대: 월간 거리 · 선: 러닝 횟수';
    await makeChart(c1, {
      data: {
        labels: rows.map(r => `${+r.m.slice(5)}월`),
        datasets: [
          { type: 'bar', label: '거리(km)', data: rows.map(r => +r.a.km.toFixed(1)), backgroundColor: '#2563eb', borderRadius: 6, order: 2 },
          { type: 'line', label: '러닝 횟수', data: rows.map(r => r.a.n), yAxisID: 'y1', borderColor: '#16a34a', backgroundColor: '#16a34a', tension: .3, order: 1 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        scales: { y: { beginAtZero: true, title: { display: true, text: 'km' } }, y1: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, ticks: { precision: 0 } } },
      },
    });
    table.innerHTML = `<thead><tr><th>월</th><th>거리</th><th>횟수</th><th>총 시간</th><th>평균 페이스</th><th>평균 심박</th><th>최장</th><th>18km+ 장거리</th></tr></thead><tbody>
      ${[...rows].reverse().map(r => `<tr><td>${r.m.replace('-', '.')}</td><td><b>${r.a.km.toFixed(1)}km</b></td><td>${r.a.n}회</td><td>${r.a.sec ? fmtDuration(r.a.sec) : '-'}</td><td>${r.a.pace ? fmtPace(r.a.pace) : '-'}</td><td>${r.a.hr ?? '-'}</td><td>${r.a.longest ? r.a.longest.toFixed(1) + 'km' : '-'}</td><td>${r.a.long18}회</td></tr>`).join('')}</tbody>`;
  }

  if (tab === 'type') {
    const keys = Object.keys(TYPES).filter(k => !NON_RUN.includes(k));
    const rows = keys.map(k => ({ k, t: TYPES[k], a: agg(inRange.filter(w => w.type === k)) })).filter(r => r.a.n);
    const total = rows.reduce((s, r) => s + r.a.km, 0);
    note.textContent = '왼쪽: 훈련 종류별 거리 비중 · 오른쪽: 훈련 종류별 평균 페이스 (막대가 짧을수록 빠름)';
    box2.classList.remove('hidden');
    if (rows.length) {
      await makeChart(c1, {
        type: 'doughnut',
        data: { labels: rows.map(r => r.t.label), datasets: [{ data: rows.map(r => +r.a.km.toFixed(1)), backgroundColor: rows.map(r => r.t.color) }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' }, tooltip: { callbacks: { label: c => `${c.label} ${c.raw}km (${Math.round(c.raw / total * 100)}%)` } } } },
      });
      const pr = rows.filter(r => r.a.pace);
      await makeChart(c2, {
        type: 'bar',
        data: { labels: pr.map(r => r.t.label), datasets: [{ label: '평균 페이스', data: pr.map(r => Math.round(r.a.pace)), backgroundColor: pr.map(r => r.t.color), borderRadius: 6 }] },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, scales: { x: { reverse: false, ticks: { callback: paceTick }, min: Math.max(0, Math.min(...pr.map(r => r.a.pace)) - 40) } },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${fmtPace(c.raw)}/km` } } } },
      });
    }
    table.innerHTML = rows.length ? `<thead><tr><th>훈련</th><th>횟수</th><th>총 거리</th><th>비중</th><th>평균 거리</th><th>평균 페이스</th><th>평균 심박</th><th>최장</th><th>최근</th></tr></thead><tbody>
      ${rows.sort((a, b) => b.a.km - a.a.km).map(r => `<tr><td><span class="badge" style="--c:${r.t.color}">${esc(r.t.label)}</span></td><td>${r.a.n}회</td><td><b>${r.a.km.toFixed(1)}km</b></td><td>${Math.round(r.a.km / total * 100)}%</td><td>${(r.a.km / r.a.n).toFixed(1)}km</td><td>${r.a.pace ? fmtPace(r.a.pace) : '-'}</td><td>${r.a.hr ?? '-'}</td><td>${r.a.longest.toFixed(1)}km</td><td>${r.a.last.slice(5).replace('-', '/')}</td></tr>`).join('')}</tbody>`
      : '<tbody><tr><td class="empty">선택한 기간에 완료한 훈련이 없어요</td></tr></tbody>';
  }

  if (tab === 'cum') {
    // 연도별 누적 거리 (연중 일자 기준)
    const years = [...new Set(inRange.map(w => w.date.slice(0, 4)))].sort();
    const doy = s => Math.round((parse(s) - parse(s.slice(0, 4) + '-01-01')) / 86400000) + 1;
    const pal = ['#2563eb', '#94a3b8', '#f97316', '#16a34a'];
    note.textContent = '왼쪽: 연도별 누적 거리 · 오른쪽: 월별 평균 페이스 추이 (이지 계열 vs 포인트 훈련, 위로 갈수록 빠름)';
    box2.classList.remove('hidden');
    await makeChart(c1, {
      type: 'line',
      data: { datasets: years.reverse().map((y, k) => { let cum = 0; return { label: `${y}년`, borderColor: pal[k % 4], backgroundColor: pal[k % 4], pointRadius: 0, stepped: true,
        data: inRange.filter(w => w.date.startsWith(y)).map(w => ({ x: doy(w.date), y: +(cum += kmOf(w)).toFixed(1) })) }; }) },
      options: { responsive: true, maintainAspectRatio: false, scales: { x: { type: 'linear', min: 1, max: 366, ticks: { stepSize: 30.5, callback: v => `${Math.min(12, Math.floor((v - 1) / 30.5) + 1)}월` } }, y: { beginAtZero: true, title: { display: true, text: '누적 km' } } } },
    });
    const months = [...new Set(inRange.map(w => monthOf(w.date)))].sort();
    const easyT = ['easy', 'recovery', 'long'], qT = ['tempo', 'interval', 'mp', 'race'];
    const mp = (m, ts) => agg(inRange.filter(w => monthOf(w.date) === m && ts.includes(w.type))).pace;
    await makeChart(c2, {
      type: 'line',
      data: { labels: months.map(m => `${m.slice(2, 4)}.${m.slice(5)}`), datasets: [
        { label: '이지·LSD·회복', data: months.map(m => mp(m, easyT) ? Math.round(mp(m, easyT)) : null), borderColor: '#22c55e', backgroundColor: '#22c55e', spanGaps: true, tension: .3 },
        { label: '템포·인터벌·MP·대회', data: months.map(m => mp(m, qT) ? Math.round(mp(m, qT)) : null), borderColor: '#ef4444', backgroundColor: '#ef4444', spanGaps: true, tension: .3 },
      ] },
      options: { responsive: true, maintainAspectRatio: false, scales: { y: { reverse: true, ticks: { callback: paceTick } } }, plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label} ${fmtPace(c.raw)}/km` } } } },
    });
    // 기록(PB)
    const pbFor = (D, label) => {
      const c = runs.filter(w => w.actual_time && Number(w.actual_distance) >= D * 0.99 && Number(w.actual_distance) <= D * 1.05)
        .map(w => ({ t: toSec(w.actual_time) * D / Number(w.actual_distance), date: w.date, title: w.title, est: Number(w.actual_distance) > D * 1.01 }));
      for (const r of races) if (r.result_time && Math.abs(Number(r.distance_km) - D) < 0.2) c.push({ t: toSec(r.result_time), date: r.date, title: r.name, race: true });
      const b = c.filter(x => x.t).sort((a, b) => a.t - b.t)[0];
      return `<tr><td><b>${label}</b></td><td>${b ? `<b>${fmtDuration(b.t)}</b>${b.est ? ' <span class="muted">(환산)</span>' : ''}` : '-'}</td><td>${b ? fmtPace(b.t / D) + '/km' : '-'}</td><td>${b ? `${b.date} · ${esc(b.title)}${b.race ? ' <span class="tag pb">대회</span>' : ''}` : '<span class="muted">해당 거리 기록 없음</span>'}</td></tr>`;
    };
    const longest = [...runs].sort((a, b) => kmOf(b) - kmOf(a))[0];
    const wk = {}; runs.forEach(w => { const m = mondayOf(w.date); wk[m] = (wk[m] || 0) + kmOf(w); });
    const bestW = Object.entries(wk).sort((a, b) => b[1] - a[1])[0];
    const mo = {}; runs.forEach(w => { const m = monthOf(w.date); mo[m] = (mo[m] || 0) + kmOf(w); });
    const bestM = Object.entries(mo).sort((a, b) => b[1] - a[1])[0];
    const yrs = [...new Set(runs.map(w => w.date.slice(0, 4)))].sort().reverse();
    table.innerHTML = `<thead><tr><th>기록(PB)</th><th>기록</th><th>페이스</th><th>날짜·훈련</th></tr></thead><tbody>
      ${pbFor(5, '5km')}${pbFor(10, '10km')}${pbFor(21.0975, '하프')}${pbFor(42.195, '풀코스')}
      <tr><td><b>최장 거리</b></td><td><b>${longest ? kmOf(longest).toFixed(2) + 'km' : '-'}</b></td><td>${longest && paceOf2(longest) ? fmtPace(paceOf2(longest)) + '/km' : '-'}</td><td>${longest ? `${longest.date} · ${esc(longest.title)}` : '-'}</td></tr>
      <tr><td><b>최다 주간 거리</b></td><td><b>${bestW ? bestW[1].toFixed(1) + 'km' : '-'}</b></td><td></td><td>${bestW ? bestW[0].slice(5).replace('-', '/') + '~ 주' : '-'}</td></tr>
      <tr><td><b>최다 월간 거리</b></td><td><b>${bestM ? bestM[1].toFixed(1) + 'km' : '-'}</b></td><td></td><td>${bestM ? bestM[0].replace('-', '.') : '-'}</td></tr>
      ${yrs.map(y => { const a = agg(runs.filter(w => w.date.startsWith(y))); return `<tr><td><b>${y}년 누적</b></td><td><b>${a.km.toFixed(1)}km</b></td><td>${a.pace ? fmtPace(a.pace) + '/km' : '-'}</td><td>${a.n}회 · ${a.sec ? fmtDuration(a.sec) : '-'}</td></tr>`; }).join('')}
      </tbody>`;
  }

  if (tab === 'heat') {
    root.querySelector('.chart-row').classList.add('hidden');
    const endMon = mondayOf(today);
    const first = mondayOf(start < '1000' ? (runs[0]?.date || today) : start);
    const km = {}; runs.forEach(w => { km[w.date] = (km[w.date] || 0) + kmOf(w); });
    const lv = v => !v ? 0 : v < 6 ? 1 : v < 11 ? 2 : v < 20 ? 3 : 4;
    let cols = '', lastM = '';
    for (let m = first; m <= endMon; m = addDays(m, 7)) {
      const mm = m.slice(5, 7); const label = mm !== lastM ? `${+mm}월` : ''; lastM = mm;
      cols += `<div class="hm-col"><div class="hm-m">${label}</div>${[0, 1, 2, 3, 4, 5, 6].map(k => { const d = addDays(m, k); const v = km[d] || 0; return d > today ? '<i class="hm-c fut"></i>' : `<i class="hm-c l${lv(v)}" title="${d} ${v ? v.toFixed(1) + 'km' : '휴식'}" data-d="${d}"></i>`; }).join('')}</div>`;
    }
    root.querySelector('#stat-extra').innerHTML = `<div class="heatmap"><div class="hm-days"><span></span><span>월</span><span></span><span>수</span><span></span><span>금</span><span></span><span>일</span></div><div class="hm-grid">${cols}</div></div>
      <div class="hm-legend">적음 <i class="hm-c l0"></i><i class="hm-c l1"></i><i class="hm-c l2"></i><i class="hm-c l3"></i><i class="hm-c l4"></i> 많음 <span class="muted">(0 / ~5 / ~10 / ~20 / 20km+)</span></div>`;
    root.querySelectorAll('.hm-c[data-d]').forEach(c => c.onclick = () => onPickDate?.(c.dataset.d));
    note.textContent = '날짜별 달린 거리 히트맵 (칸을 누르면 해당 날짜로 이동)';
    const months = []; for (let m = monthOf(first); m <= monthOf(today); m = addMonths(m, 1)) months.push(m);
    table.innerHTML = `<thead><tr><th>월</th><th>훈련 일수</th><th>거리</th><th>하루 평균(훈련일)</th><th>최장</th></tr></thead><tbody>${months.reverse().map(m => { const ds = Object.keys(km).filter(d => d.startsWith(m)); const t = ds.reduce((s, d) => s + km[d], 0); return `<tr><td>${m.replace('-', '.')}</td><td><b>${ds.length}일</b></td><td>${t.toFixed(1)}km</td><td>${ds.length ? (t / ds.length).toFixed(1) + 'km' : '-'}</td><td>${ds.length ? Math.max(...ds.map(d => km[d])).toFixed(1) + 'km' : '-'}</td></tr>`; }).join('')}</tbody>`;
  } else {
    root.querySelector('.chart-row').classList.remove('hidden');
    root.querySelector('#stat-extra').innerHTML = '';
  }

  if (tab === 'cond') {
    const L = logs.filter(l => l.date >= start && l.date <= today).sort((a, b) => a.date.localeCompare(b.date));
    box2.classList.remove('hidden');
    note.textContent = '왼쪽: 안정시 심박·피로도·수면 · 오른쪽: 체중 (컨디션 기록은 캘린더 날짜 상세에서 입력)';
    if (!L.length) { table.innerHTML = '<tbody><tr><td class="empty">선택한 기간에 컨디션 기록이 없어요. 캘린더에서 날짜를 누르고 "컨디션 기록"을 입력하세요.</td></tr></tbody>'; return; }
    const lab = L.map(l => l.date.slice(5).replace('-', '/'));
    await makeChart(c1, { type: 'line', data: { labels: lab, datasets: [
      { label: '안정시 심박', data: L.map(l => l.resting_hr), borderColor: '#ef4444', backgroundColor: '#ef4444', spanGaps: true, yAxisID: 'y' },
      { label: '피로도', data: L.map(l => l.fatigue), borderColor: '#f97316', backgroundColor: '#f97316', spanGaps: true, yAxisID: 'y1' },
      { label: '수면(시간)', data: L.map(l => l.sleep_hours), borderColor: '#6366f1', backgroundColor: '#6366f1', spanGaps: true, yAxisID: 'y1' },
    ] }, options: { responsive: true, maintainAspectRatio: false, scales: { y: { title: { display: true, text: 'bpm' } }, y1: { position: 'right', min: 0, max: 12, grid: { drawOnChartArea: false } } } } });
    await makeChart(c2, { type: 'line', data: { labels: lab, datasets: [{ label: '체중(kg)', data: L.map(l => l.weight), borderColor: '#0ea5e9', backgroundColor: '#0ea5e9', spanGaps: true }] }, options: { responsive: true, maintainAspectRatio: false } });
    const pain = {}; L.forEach(l => (l.pain_areas || []).forEach(a => { (pain[a] ||= []).push(l); }));
    table.innerHTML = `<thead><tr><th>통증 부위</th><th>기록 일수</th><th>최고 통증</th><th>최근</th></tr></thead><tbody>${Object.keys(pain).length ? Object.entries(pain).sort((a, b) => b[1].length - a[1].length).map(([a, ls]) => `<tr><td><b>${esc(a)}</b></td><td>${ls.length}일</td><td>${Math.max(...ls.map(l => l.pain_level || 0))}/10</td><td>${ls[ls.length - 1].date}</td></tr>`).join('') : '<tr><td colspan="4" class="muted">이 기간 통증 기록 없음</td></tr>'}</tbody>`;
  }
}
const paceOf2 = w => { const s = toSec(w.actual_time); return s && w.actual_distance ? s / Number(w.actual_distance) : null; };
