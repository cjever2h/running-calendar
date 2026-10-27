// 월간 러닝 리포트: 데이터 집계 + 공유 카드(앱·공유 페이지 공용)
import { TYPES, toSec, fmtPace, fmtDuration } from './plan.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const NON_RUN = ['rest', 'cross', 'strength'];
const kmOf = w => Number(w.actual_distance || w.planned_distance || 0);
const parse = s => new Date(s + 'T00:00:00');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const mondayOf = s => { const d = parse(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); };
export function addMonths(ym, n) { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }
const distName = km => Math.abs(km - 42.195) < 0.6 ? '풀코스' : Math.abs(km - 21.0975) < 0.4 ? '하프' : Math.abs(km - 10) < 0.4 ? '10km' : Math.abs(km - 5) < 0.3 ? '5km' : `${Number(km)}km`;
const distKey = km => Math.abs(km - 42.195) < 0.6 ? 42.195 : Math.abs(km - 21.0975) < 0.4 ? 21.0975 : Math.abs(km - 10) < 0.4 ? 10 : Math.abs(km - 5) < 0.3 ? 5 : null;

function agg(list) {
  let km = 0, sec = 0, secKm = 0, hrSum = 0, hrKm = 0;
  for (const w of list) {
    const k = kmOf(w); km += k;
    const s = toSec(w.actual_time); if (s && w.actual_distance) { sec += s; secKm += Number(w.actual_distance); }
    if (w.avg_hr) { hrSum += w.avg_hr * k; hrKm += k; }
  }
  return { km, n: list.length, sec, pace: secKm ? sec / secKm : null, hr: hrKm ? Math.round(hrSum / hrKm) : null };
}

/** 모든 대회 결과 (races 결과 기록 + 완료된 대회 훈련) */
function raceResults(workouts, races) {
  const out = [];
  for (const r of races) if (r.result_time && toSec(r.result_time)) out.push({ date: r.date, name: r.name, km: Number(r.distance_km), time: r.result_time, goal: r.goal_time || null });
  for (const w of workouts) {
    if (w.type !== 'race' || w.status !== 'done' || !w.actual_time || out.some(x => x.date === w.date)) continue;
    const r = races.find(x => x.date === w.date);
    out.push({ date: w.date, name: r?.name || w.title, km: Number(r?.distance_km || w.actual_distance || w.planned_distance), time: w.actual_time, goal: r?.goal_time || null });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** 월간 리포트 데이터 */
export function buildMonthReport(month, { workouts = [], races = [], logs = [], shoes = [], name = '', note = '', today } = {}) {
  const runsAll = workouts.filter(w => w.status === 'done' && !NON_RUN.includes(w.type));
  const runs = runsAll.filter(w => w.date.startsWith(month)).sort((a, b) => a.date.localeCompare(b.date));
  const crossN = workouts.filter(w => w.status === 'done' && ['cross', 'strength'].includes(w.type) && w.date.startsWith(month)).length;
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const partial = !!(today && today >= `${month}-01` && today < `${month}-${pad(daysInMonth)}`);
  const pm = addMonths(month, -1), cutDay = partial ? +today.slice(8) : 31;
  const A = agg(runs), P = agg(runsAll.filter(w => w.date.startsWith(pm) && +w.date.slice(8) <= cutDay));
  const days = new Set(runs.map(w => w.date)).size;
  const ytd = runsAll.filter(w => w.date.startsWith(String(y)) && w.date <= `${month}-31`).reduce((s, w) => s + kmOf(w), 0);

  // 훈련 종류별
  const byType = Object.keys(TYPES).filter(k => !NON_RUN.includes(k)).map(k => {
    const l = runs.filter(w => w.type === k);
    return { type: k, label: TYPES[k].label, color: TYPES[k].color, n: l.length, km: l.reduce((s, w) => s + kmOf(w), 0) };
  }).filter(x => x.n).sort((a, b) => b.km - a.km);

  // 주차별 거리 (월에 걸친 주)
  const weeks = [];
  for (let mon = mondayOf(`${month}-01`); mon <= `${month}-${pad(daysInMonth)}`; mon = addDays(mon, 7)) {
    const e = addDays(mon, 6);
    weeks.push({ mon, km: runs.filter(w => w.date >= mon && w.date <= e).reduce((s, w) => s + kmOf(w), 0) });
  }
  // 일별 거리 (달력 히트맵)
  const daily = {}; runs.forEach(w => { daily[w.date] = (daily[w.date] || 0) + kmOf(w); });

  // 대회
  const all = raceResults(workouts, races);
  const monthRaces = all.filter(r => r.date.startsWith(month)).map(r => {
    const key = distKey(r.km);
    const prev = key ? all.filter(x => x.date < r.date && distKey(x.km) === key).map(x => toSec(x.time)).filter(Boolean) : [];
    const best = prev.length ? Math.min(...prev) : null, t = toSec(r.time);
    return { ...r, dist: distName(r.km), pace: t && r.km ? fmtPace(t / r.km) : null, pb: !!(key && t && (best == null || t < best)), firstTime: key && best == null,
      diffPb: best && t ? t - best : null, goalHit: r.goal && t ? t <= toSec(r.goal) : null };
  });

  // 특이사항 (자동)
  const hl = [];
  const longest = [...runs].sort((a, b) => kmOf(b) - kmOf(a))[0];
  for (const r of monthRaces) hl.push(`${r.name} ${r.dist} ${r.time} 완주${r.pb ? (r.firstTime ? ' (첫 기록)' : ` · 개인 최고 기록(PB) ${fmtDuration(-r.diffPb)} 단축`) : ''}${r.goalHit === true ? ' · 목표 달성' : ''}`);
  if (longest) hl.push(`최장 거리 ${kmOf(longest).toFixed(1)}km (${+longest.date.slice(5, 7)}/${+longest.date.slice(8)}${longest.title ? ` ${longest.title}` : ''})`);
  const long18 = runs.filter(w => kmOf(w) >= 18).length;
  if (long18) hl.push(`18km 이상 장거리 ${long18}회`);
  const bw = [...weeks].sort((a, b) => b.km - a.km)[0];
  if (bw && bw.km > 0) hl.push(`최다 주간 거리 ${bw.km.toFixed(1)}km (${+bw.mon.slice(5, 7)}/${+bw.mon.slice(8)} 주)`);
  if (P.km >= 10) { const ch = Math.round((A.km - P.km) / P.km * 100); hl.push(`전월${partial ? ' 같은 기간' : ''} 대비 거리 ${ch >= 0 ? '+' : ''}${ch}% (${P.km.toFixed(1)}km → ${A.km.toFixed(1)}km)`); }
  // 월간 최다 기록 여부
  const monthTotals = {}; runsAll.forEach(w => { const k = w.date.slice(0, 7); monthTotals[k] = (monthTotals[k] || 0) + kmOf(w); });
  if (A.km > 0 && Object.entries(monthTotals).every(([k, v]) => k === month || v < A.km) && Object.keys(monthTotals).length > 2) hl.push('역대 최다 월간 거리');
  // 연속 훈련
  let streak = 0, best = 0; for (let d = 1; d <= daysInMonth; d++) { if (daily[`${month}-${pad(d)}`]) { streak++; best = Math.max(best, streak); } else streak = 0; }
  if (best >= 4) hl.push(`최장 연속 러닝 ${best}일`);
  // 신발
  const shoeKm = {}; runs.forEach(w => { if (w.shoe_id) shoeKm[w.shoe_id] = (shoeKm[w.shoe_id] || 0) + kmOf(w); });
  const topShoe = Object.entries(shoeKm).sort((a, b) => b[1] - a[1])[0];
  const sh = topShoe && shoes.find(s => s.id === topShoe[0]);
  if (sh) hl.push(`가장 많이 신은 러닝화: ${sh.nickname || `${sh.brand} ${sh.model}`} (${topShoe[1].toFixed(1)}km)`);
  // 컨디션
  const ml = logs.filter(l => l.date.startsWith(month));
  const pain = {}; ml.forEach(l => (l.pain_areas || []).forEach(a => pain[a] = (pain[a] || 0) + 1));
  const pk = Object.entries(pain).sort((a, b) => b[1] - a[1]);
  if (pk.length) hl.push(`컨디션 메모: ${pk.map(([a, n]) => `${a} 통증 ${n}일`).join(', ')}`);
  if (crossN) hl.push(`크로스·보강 운동 ${crossN}회`);

  return {
    v: 1, month, label: `${y}년 ${m}월`, name: name || '', partial, asOf: partial ? today : null,
    km: +A.km.toFixed(1), runs: A.n, days, daysInMonth, sec: Math.round(A.sec), pace: A.pace, hr: A.hr,
    prev: { km: +P.km.toFixed(1), runs: P.n }, ytd: +ytd.toFixed(1), year: y,
    byType, weeks: weeks.map(w => ({ mon: w.mon, km: +w.km.toFixed(1) })), daily: Object.fromEntries(Object.entries(daily).map(([k, v]) => [k, +v.toFixed(1)])),
    races: monthRaces, highlights: hl, note: note || '',
  };
}

/** 공유 카드 HTML (고정 크기 540×675 → 이미지 저장 시 2배) */
export function reportCardHTML(d, opts = {}) {
  const chg = d.prev.km >= 10 ? Math.round((d.km - d.prev.km) / d.prev.km * 100) : null;
  const maxW = Math.max(1, ...d.weeks.map(w => w.km));
  const totalN = d.byType.reduce((s, t) => s + t.n, 0) || 1;
  const [y, m] = d.month.split('-').map(Number);
  const first = new Date(y, m - 1, 1).getDay(); // 0=일
  const lead = (first + 6) % 7; // 월요일 시작
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<i class="rc-d e"></i>');
  for (let k = 1; k <= d.daysInMonth; k++) {
    const v = d.daily[`${d.month}-${pad(k)}`] || 0;
    const lv = !v ? 0 : v < 6 ? 1 : v < 11 ? 2 : v < 20 ? 3 : 4;
    cells.push(`<i class="rc-d l${lv}" title="${m}/${k} ${v ? v + 'km' : ''}">${k}</i>`);
  }
  const room = Math.max(2, 6 - Math.max(0, d.races.length - 1) * 2 - (d.note ? Math.ceil(d.note.length / 45) + 1 : 0));
  const hl = (opts.highlights ?? d.highlights).slice(0, opts.maxHl ?? room);
  return `<div class="rc-card" id="${opts.id || 'report-card'}">
    <div class="rc-top">
      <div><div class="rc-brand">42<span>.195</span> RUNNING REPORT</div>
        <div class="rc-title">${esc(d.name ? `${d.name}의 ` : '')}${esc(d.label)} 러닝</div>
        ${d.partial ? `<div class="rc-sub">${+d.asOf.slice(5, 7)}/${+d.asOf.slice(8)} 기준</div>` : ''}</div>
      <div class="rc-ytd"><small>${d.year}년 누적</small><b>${Math.round(d.ytd).toLocaleString()}</b><small>km</small></div>
    </div>
    <div class="rc-hero">
      <div class="rc-big"><b>${d.km.toFixed(1)}</b><span>km</span></div>
      ${chg != null ? `<div class="rc-chg ${chg >= 0 ? 'up' : 'down'}">전월${d.partial ? ' 같은 기간' : ''} 대비 ${chg >= 0 ? '▲' : '▼'} ${Math.abs(chg)}%</div>` : ''}
    </div>
    <div class="rc-stats">
      <div><small>러닝 횟수</small><b>${d.runs}<i>회</i></b></div>
      <div><small>훈련 일수</small><b>${d.days}<i>일</i></b></div>
      <div><small>총 시간</small><b>${d.sec ? fmtDuration(d.sec) : '-'}</b></div>
      <div><small>평균 페이스</small><b>${d.pace ? fmtPace(d.pace) : '-'}<i>/km</i></b></div>
    </div>
    <div class="rc-row">
      <div class="rc-box rc-types">
        <div class="rc-h">훈련 종류별</div>
        <div class="rc-stack">${d.byType.map(t => `<i style="flex:${t.n};background:${t.color}"></i>`).join('')}</div>
        ${d.byType.slice(0, 7).map(t => `<div class="rc-t"><i style="background:${t.color}"></i><span>${esc(t.label)}</span><b>${t.n}회</b><em>${t.km.toFixed(0)}km</em></div>`).join('') || '<div class="rc-empty">기록 없음</div>'}
      </div>
      <div class="rc-box">
        <div class="rc-h">주간 거리</div>
        <div class="rc-weeks" style="${d.races.length ? 'height:96px' : ''}">${d.weeks.map(w => `<div class="rc-w"><em>${w.km ? Math.round(w.km) : ''}</em><i style="height:${Math.max(2, w.km / maxW * 64)}px"></i><span>${+w.mon.slice(5, 7)}/${+w.mon.slice(8)}</span></div>`).join('')}</div>
        ${d.races.length ? '' : `<div class="rc-cal">${['월', '화', '수', '목', '금', '토', '일'].map(x => `<i class="rc-d h">${x}</i>`).join('')}${cells.join('')}</div>`}
      </div>
    </div>
    ${d.races.length ? `<div class="rc-box rc-races"><div class="rc-h">대회 기록</div>${d.races.map(r => `<div class="rc-race"><div><b>${esc(r.name)}</b><span>${+r.date.slice(5, 7)}/${+r.date.slice(8)} · ${esc(r.dist)}</span></div><div class="rc-rt">${esc(r.time)}${r.pb ? '<em>PB</em>' : ''}<span>${r.pace ? r.pace + '/km' : ''}${r.goal ? ` · 목표 ${esc(r.goal)}` : ''}</span></div></div>`).join('')}</div>` : ''}
    <div class="rc-box rc-hl">
      <div class="rc-h">특이사항</div>
      <ul>${hl.map(h => `<li>${esc(h)}</li>`).join('')}</ul>
      ${d.note ? `<p class="rc-note">${esc(d.note).replace(/\n/g, '<br>')}</p>` : ''}
    </div>
    <div class="rc-foot">running-calendar · ${esc(d.label)}</div>
  </div>`;
}

/** 텍스트 요약 (SNS 붙여넣기용) */
export function reportText(d, opts = {}) {
  const chg = d.prev.km >= 10 ? Math.round((d.km - d.prev.km) / d.prev.km * 100) : null;
  const L = [`🏃 ${d.name ? `${d.name}의 ` : ''}${d.label} 러닝 리포트${d.partial ? ` (${+d.asOf.slice(5, 7)}/${+d.asOf.slice(8)} 기준)` : ''}`, ''];
  L.push(`📏 월 거리 ${d.km.toFixed(1)}km${chg != null ? ` (전월${d.partial ? ' 같은 기간' : ''} 대비 ${chg >= 0 ? '+' : ''}${chg}%)` : ''}`);
  L.push(`🔁 러닝 ${d.runs}회 · 훈련 ${d.days}일 · ${d.sec ? fmtDuration(d.sec) : '-'}`);
  if (d.pace) L.push(`⏱ 평균 페이스 ${fmtPace(d.pace)}/km${d.hr ? ` · 평균 심박 ${d.hr}` : ''}`);
  if (d.byType.length) L.push(`🧩 ${d.byType.map(t => `${t.label} ${t.n}회`).join(' · ')}`);
  if (d.races.length) { L.push(''); L.push('🏅 대회 기록'); d.races.forEach(r => L.push(`- ${r.name} ${r.dist} ${r.time}${r.pb ? ' PB' : ''}`)); }
  const hl = opts.highlights ?? d.highlights;
  if (hl.length || d.note) { L.push(''); L.push('📝 특이사항'); hl.forEach(h => L.push(`- ${h}`)); if (d.note) L.push(d.note); }
  L.push(''); L.push(`${d.year}년 누적 ${Math.round(d.ytd).toLocaleString()}km`);
  if (opts.url) L.push(opts.url);
  return L.join('\n');
}

/** 카드 → PNG Blob (html2canvas) */
let h2cP = null;
export async function cardToBlob(el) {
  h2cP ||= new Promise((res, rej) => {
    if (window.html2canvas) return res(window.html2canvas);
    const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
    s.onload = () => res(window.html2canvas); s.onerror = () => { h2cP = null; rej(new Error('이미지 변환 도구를 불러오지 못했어요')); };
    document.head.appendChild(s);
  });
  const h2c = await h2cP;
  await document.fonts?.ready;
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0;zoom:1;transform:none';
  const clone = el.cloneNode(true); clone.removeAttribute('id'); clone.style.borderRadius = '0'; holder.appendChild(clone); document.body.appendChild(holder);
  try {
    const canvas = await h2c(clone, { scale: 2, backgroundColor: '#0f172a', useCORS: true, logging: false, width: clone.offsetWidth, height: clone.offsetHeight });
    return await new Promise(res => canvas.toBlob(res, 'image/png'));
  } finally { holder.remove(); }
}
