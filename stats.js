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
const doneRuns = ws => ws.filter(w => w.status === 'done' && w.type !== 'rest');

/* ---------- 범위 ---------- */
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
export async function renderStats(root, { workouts, tab, range, today, onPickDate }) {
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
    const rows = weeks.map(m => {
      const e = addDays(m, 6);
      const plan = workouts.filter(w => w.type !== 'rest' && w.date >= m && w.date <= e).reduce((s, w) => s + Number(w.planned_distance || 0), 0);
      const a = agg(runs.filter(w => w.date >= m && w.date <= e));
      return { m, plan, a, future: m > thisMon };
    });
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
    table.innerHTML = `<thead><tr><th>주(월요일)</th><th>계획</th><th>완료</th><th>달성률</th><th>횟수</th><th>평균 페이스</th><th>평균 심박</th><th>총 시간</th><th>최장</th></tr></thead><tbody>
      ${[...rows].reverse().map(r => `<tr class="${r.m === thisMon ? 'cur' : ''}${r.future ? ' fut' : ''}"><td>${r.m.slice(5).replace('-', '/')}~${r.future ? ' (예정)' : ''}</td><td>${r.plan.toFixed(1)}km</td><td><b>${r.a.km.toFixed(1)}km</b></td><td>${r.plan ? Math.round(r.a.km / r.plan * 100) + '%' : '-'}</td><td>${r.a.n}회</td><td>${r.a.pace ? fmtPace(r.a.pace) : '-'}</td><td>${r.a.hr ?? '-'}</td><td>${r.a.sec ? fmtDuration(r.a.sec) : '-'}</td><td>${r.a.longest ? r.a.longest.toFixed(1) + 'km' : '-'}</td></tr>`).join('')}</tbody>`;
  }

  if (tab === 'month') {
    const firstM = start < '1000' ? monthOf(runs[0]?.date || today) : monthOf(start);
    const months = [];
    for (let m = firstM; m <= monthOf(today); m = addMonths(m, 1)) months.push(m);
    const rows = months.map(m => ({ m, a: agg(runs.filter(w => monthOf(w.date) === m)) }));
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
    const keys = Object.keys(TYPES).filter(k => k !== 'rest');
    const rows = keys.map(k => ({ k, t: TYPES[k], a: agg(inRange.filter(w => w.type === k)) })).filter(r => r.a.n);
    const total = rows.reduce((s, r) => s + r.a.km, 0);
    note.textContent = '왼쪽: 훈련 종류별 거리 비중 · 오른쪽: 훈련 종류별 평균 페이스';
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
}
