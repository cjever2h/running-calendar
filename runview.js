// "오늘의 러닝" 상세 화면 + 공용 헬퍼(강도 색, 러닝 판별 등)
import { TYPES, toSec, fmtPace, fmtDuration } from './plan.js';

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
export const parse = s => new Date(s + 'T00:00:00');
export const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
export const mondayOf = s => { const d = parse(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); };
const WD = ['일', '월', '화', '수', '목', '금', '토'];

/* ---------- 운동 강도 색 (네온, 라이트 모드는 15% 진하게) ---------- */
const NEON = ['#2e6bff', '#00b3ff', '#00f0ff', '#00ff9d', '#7dff00', '#e6ff00', '#ffb800', '#ff8a00', '#ff2e63', '#ff00b8'];
const NEON_LIGHT = ['#1f5ae6', '#0098d9', '#00bfcc', '#00cc80', '#5fcc00', '#b8cc00', '#e6a200', '#f07800', '#ee1750', '#dd00a0'];
export const isDark = () => document.documentElement.dataset.theme === 'dark';
export const rpeColors = () => isDark() ? NEON : NEON_LIGHT;
export const rpeColor = n => n ? rpeColors()[Math.min(10, Math.max(1, Math.round(n))) - 1] : null;
export const rpeName = n => !n ? '-' : n <= 3 ? '쉬움' : n <= 6 ? '보통' : n <= 8 ? '힘듦' : '전력';
/** 라이트 모드에서 글자로 쓸 때 더 진하게 */
export const rpeText = n => { const c = rpeColor(n); if (!c || isDark()) return c; const k = [1, 2, 3, 4, 5, 6].includes(Math.round(n)) ? .72 : .9; return shade(c, k); };
function shade(hex, k) { const v = parseInt(hex.slice(1), 16); const r = Math.round((v >> 16) * k), g = Math.round(((v >> 8) & 255) * k), b = Math.round((v & 255) * k); return `rgb(${r},${g},${b})`; }
export const ZONE_C = ['#94a3b8', '#3b9bff', '#00d6b9', '#9be600', '#ffa200', '#ff2d45'];

/* ---------- 공용 ---------- */
export const NON_RUN = ['rest', 'cross', 'strength'];
export const isRunDone = w => w.status === 'done' && !NON_RUN.includes(w.type) && Number(w.actual_distance || w.planned_distance) > 0;
export const kmOf = w => Number(w.actual_distance || w.planned_distance || 0);
export const paceSec = w => { const s = toSec(w.actual_time); const d = Number(w.actual_distance); return s && d ? s / d : null; };
export const startOf = w => w.metrics?.start || (w.details || '').match(/시작 (\d{1,2}:\d{2})/)?.[1] || null;
export const typeLabel = t => (TYPES[t] || TYPES.easy).label;
export const korDate = s => { const d = parse(s); return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${WD[d.getDay()]}요일`; };
const ampm = t => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${pad(m)}`; };

/* ---------- 인사이트 ---------- */
export function runInsight(w, all, logs, races) {
  const runs = all.filter(isRunDone);
  const d = w.date;
  const sum = (a, b) => runs.filter(x => x.date > a && x.date <= b).reduce((s, x) => s + kmOf(x), 0);
  const acute = sum(addDays(d, -7), d), chronic = sum(addDays(d, -28), d) / 4;
  const ratio = chronic > 5 ? acute / chronic : null;
  const out = { title: '', text: '', lines: [], chips: [] };
  const z = w.metrics?.zones;
  if (w.type === 'race') { out.title = '대회 완주'; out.text = '끝까지 달려낸 날이에요. 3~4일은 완전 휴식·가벼운 걷기, 1~2주는 이지런 위주로 회복하세요.'; }
  else if (ratio && ratio > 1.3) { out.title = '쌓이는 러닝'; out.text = `최근 7일 거리(${acute.toFixed(0)}km)가 지난 4주 주평균(${chronic.toFixed(0)}km)보다 ${Math.round((ratio - 1) * 100)}% 많아요. 1~2일은 이지런이나 휴식으로 회복하세요.`; }
  else if (ratio && ratio < .75) { out.title = '가볍게 조절한 구간'; out.text = `최근 7일 거리가 지난 4주 주평균보다 ${Math.round((1 - ratio) * 100)}% 적어요. 테이퍼링·회복 중이라면 좋은 흐름이에요.`; }
  else if (['interval', 'tempo', 'mp', 'hill'].includes(w.type)) { out.title = '강도를 올린 날'; out.text = '포인트 훈련을 마쳤어요. 다음 1~2일은 이지런으로 몸을 풀어 주세요.'; }
  else if (['long'].includes(w.type)) { out.title = '지구력을 쌓은 날'; out.text = '긴 거리를 채웠어요. 탄수화물·단백질 보충과 수면을 챙기고 다음 날은 회복런이나 휴식을 권해요.'; }
  else { out.title = '균형 잡힌 러닝'; out.text = '최근 부하가 지난 4주와 비슷한 수준이에요. 이 흐름을 유지하세요.'; }
  if (z) {
    const tot = z.reduce((s, v) => s + v, 0);
    if (tot) { let k = 1; for (let i = 2; i <= 5; i++) if (z[i] > z[k]) k = i; out.lines.push({ dot: ZONE_C[k], label: '심박', text: `Zone ${k} 중심 · ${Math.round(z[k] / tot * 100)}%` }); }
  }
  const same = runs.filter(x => x.type === w.type && x.id !== w.id && x.date < d && x.date >= addDays(d, -90) && paceSec(x));
  const ps = paceSec(w);
  if (same.length >= 3 && ps) {
    const avg = same.reduce((s, x) => s + paceSec(x), 0) / same.length; const diff = Math.round(avg - ps);
    out.lines.push({ dot: diff >= 0 ? '#22c55e' : '#f59e0b', label: '페이스', text: `최근 90일 ${typeLabel(w.type)} 평균 ${fmtPace(avg)} 대비 ${Math.abs(diff)}초 ${diff >= 0 ? '빠름' : '느림'}` });
  }
  if (ratio) out.lines.push({ dot: ratio > 1.3 ? '#f59e0b' : ratio < .75 ? '#3b82f6' : '#22c55e', label: '훈련 부하', text: `최근 7일 ${acute.toFixed(0)}km · 4주 주평균 ${chronic.toFixed(0)}km (${ratio.toFixed(2)}배)` });
  const log = logs.find(l => l.date === d);
  if (log?.sleep_hours) out.chips.push(`수면 ${Math.floor(log.sleep_hours)}시간${log.sleep_hours % 1 ? ` ${Math.round(log.sleep_hours % 1 * 60)}분` : ''}`);
  if (log?.pain_areas?.length) out.chips.push(`통증 ${log.pain_areas.join(', ')}`);
  const nr = races.filter(r => r.date > d).sort((a, b) => a.date.localeCompare(b.date))[0];
  if (nr) out.chips.push(`${nr.name} D-${Math.round((parse(nr.date) - parse(d)) / 86400000)}`);
  return out;
}

/* ---------- 화면 ---------- */
function rankText(w, all) {
  const runs = all.filter(isRunDone).filter(x => x.date <= w.date).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
  if (runs.length < 3 || !runs.some(x => x.id === w.id)) return '';
  const r = [...runs].sort((a, b) => kmOf(b) - kmOf(a)).findIndex(x => x.id === w.id) + 1;
  return r <= 3 ? `↑ 최근 ${runs.length}회 중 ${r === 1 ? '가장' : `${r}번째로`} 긴 거리` : '';
}
function donut(z) {
  const tot = z.reduce((s, v) => s + v, 0); if (!tot) return '';
  let k = 1; for (let i = 2; i <= 5; i++) if (z[i] > z[k]) k = i;
  const r = 40, c = 2 * Math.PI * r; let off = 0;
  const segs = z.map((v, i) => { const len = c * v / tot; const s = len > .5 ? `<circle cx="50" cy="50" r="${r}" fill="none" stroke="${ZONE_C[i]}" stroke-width="11" stroke-dasharray="${len} ${c}" stroke-dashoffset="${-off}" transform="rotate(-90 50 50)"/>` : ''; off += len; return s; }).join('');
  return `<svg viewBox="0 0 100 100" class="rv-donut">${segs}<text x="50" y="50" text-anchor="middle" class="rv-dn-v" fill="${ZONE_C[k]}">${Math.round(z[k] / tot * 100)}%</text><text x="50" y="64" text-anchor="middle" class="rv-dn-l">Zone ${k}</text></svg>`;
}
const fmtZ = s => `${Math.floor(s / 60)}:${pad(s % 60)}`;

export function renderRunView(root, { w, all, shoes, races, logs, imgUrl, zoneRanges }) {
  if (!w) { root.innerHTML = '<div class="card empty">기록을 찾을 수 없어요</div>'; return; }
  const t = TYPES[w.type] || TYPES.easy, m = w.metrics || {};
  const done = w.status === 'done';
  const ps = paceSec(w), km = kmOf(w);
  const ins = runInsight(w, all, logs, races);
  const wk = mondayOf(w.date), mo = w.date.slice(0, 7);
  const runs = all.filter(isRunDone);
  const weekKm = runs.filter(x => x.date >= wk && x.date <= w.date).reduce((s, x) => s + kmOf(x), 0);
  const monKm = runs.filter(x => x.date.startsWith(mo) && x.date <= w.date).reduce((s, x) => s + kmOf(x), 0);
  const last7 = Array.from({ length: 7 }, (_, i) => { const d = addDays(w.date, i - 6); const k = runs.filter(x => x.date === d).reduce((s, x) => s + kmOf(x), 0); return { d, k }; });
  const shoe = shoes.find(s => s.id === w.shoe_id);
  const rpe = w.rpe ? Math.round(w.rpe) : null;
  const cols = rpeColors();
  const tile = (ic, label, val, unit, sub) => val == null || val === '' ? '' : `<div class="rv-tile"><span>${ic} ${label}</span><b>${val}${unit ? `<small>${unit}</small>` : ''}</b>${sub ? `<em>${sub}</em>` : ''}</div>`;
  const tiles = [
    tile('📏', '거리', km ? km.toFixed(2) : null, 'km'), tile('⏱', '시간', w.actual_time || null), tile('⚡', '페이스', ps ? fmtPace(ps) : null, '/km'),
    tile('❤', '평균 심박', w.avg_hr, 'bpm', w.max_hr ? `최대 ${w.max_hr}` : ''), tile('👣', '케이던스', w.cadence, 'spm'), tile('🔥', '칼로리', m.kcal, 'kcal'),
    tile('⛰', '상승 고도', m.elev, 'm'), tile('🔋', '평균 파워', m.power, 'W'), tile('🫁', 'VO2max', m.vo2max, '', '가민 추정'),
    tile('📈', '훈련 부하', m.load, '', m.te != null ? `유산소 효과 ${m.te}` : ''), tile('🦶', '지면접촉', m.gct, 'ms'), tile('↕', '수직진폭', m.vo, 'cm', m.vr ? `수직비 ${m.vr}%` : ''),
    tile('↔', '보폭', m.stride, 'm'), tile('🌡', '기온', m.temp, '°C'),
  ].join('');
  const z = m.zones;
  const ztot = z ? z.reduce((s, v) => s + v, 0) : 0;
  root.innerHTML = `
  <div class="rv">
    <div class="rv-top"><button class="icon-btn rv-back" id="rv-back" aria-label="뒤로">‹</button><b>오늘의 러닝</b><button class="btn primary sm" id="rv-card">카드 만들기</button></div>
    <section class="rv-hero">
      <div class="rv-when"><span class="rv-type" style="--c:${t.color}">${esc(t.label)}</span>${esc(korDate(w.date))}${startOf(w) ? ` · ${ampm(startOf(w))}` : ''}</div>
      <div class="rv-title">${esc(w.title)}</div>
      <div class="rv-hero-row">
        <div><div class="rv-big">${km ? km.toFixed(2) : '-'}<small>km</small></div>${rankText(w, all) ? `<div class="rv-rank">${rankText(w, all)}</div>` : ''}</div>
        <div class="rv-side"><div class="rv-dots">${last7.map(x => `<i title="${x.d} ${x.k ? x.k.toFixed(1) + 'km' : ''}" class="${x.k ? 'on' : ''} ${x.d === w.date ? 'me' : ''}"></i>`).join('')}</div>
          <div>이번 주 <b>${weekKm.toFixed(1)}</b> km</div><div>이번 달 <b>${monKm.toFixed(1)}</b> km</div></div>
      </div>
      <div class="rv-m4"><div><b>${esc(w.actual_time || '-')}</b><span>시간</span></div><div><b>${ps ? fmtPace(ps) : '-'}</b><span>페이스</span></div><div><b class="hr">${w.avg_hr || '-'}</b><span>심박</span></div><div><b class="cad">${w.cadence || '-'}</b><span>케이던스</span></div></div>
      ${!done ? '<div class="rv-plan">아직 완료하지 않은 훈련이에요. 계획 거리 기준으로 보여드려요.</div>' : ''}
    </section>

    <section class="card rv-ins">
      <div class="rv-h">오늘의 인사이트</div>
      <b class="rv-ins-t">${esc(ins.title)}</b><p>${esc(ins.text)}</p>
      ${ins.chips.length ? `<div class="rv-chips">${ins.chips.map(c => `<span>${esc(c)}</span>`).join('')}</div>` : ''}
      ${ins.lines.length ? `<div class="rv-lines">${ins.lines.map(l => `<div><i style="background:${l.dot}"></i><span>${esc(l.label)}</span><em>${esc(l.text)}</em></div>`).join('')}</div>` : ''}
    </section>

    <section class="card">
      <div class="rv-hrow"><span class="rv-h">운동 강도</span><b style="color:${rpeText(rpe) || 'var(--muted)'}">${rpe ? `${rpe} · ${rpeName(rpe)}` : '눌러서 입력'}</b></div>
      <div class="rv-rpe" id="rv-rpe">${cols.map((c, i) => `<button type="button" data-v="${i + 1}" class="${rpe === i + 1 ? 'sel' : ''}" style="background:${c};opacity:${rpe && i < rpe ? 1 : rpe ? .2 : .35}" aria-label="강도 ${i + 1}"></button>`).join('')}</div>
      <div class="rv-ax"><span>쉬움</span><span>보통</span><span>힘듦</span><span>전력</span></div>
    </section>

    <section class="card">
      <div class="rv-hrow"><span class="rv-h">러닝 일기</span><button class="btn sm" id="rv-edit">편집</button></div>
      ${w.memo ? `<p class="rv-memo">${esc(w.memo)}</p>` : '<p class="muted rv-memo">아직 메모가 없어요. 편집을 눌러 오늘 달리며 느낀 점을 남겨 보세요.</p>'}
      ${(w.images || []).length ? `<div class="rv-imgs">${w.images.map((p, i) => `<button type="button" class="thumb" data-i="${i}"><img data-path="${esc(p)}" alt="기록 이미지"></button>`).join('')}</div>` : ''}
      ${shoe ? `<div class="rv-shoe">👟 ${esc(shoe.nickname || `${shoe.brand} ${shoe.model}`)}</div>` : ''}
    </section>

    <section class="card">
      <div class="rv-hrow"><span class="rv-h">심박 영역</span><span class="muted" style="font-size:12px">가민 존 기준</span></div>
      ${ztot ? `<div class="rv-zone">${donut(z)}<div class="rv-zbars">${[1, 2, 3, 4, 5].map(i => `<div><span style="color:${ZONE_C[i]}">영역 ${i}</span><i><b style="width:${(z[i] / ztot * 100).toFixed(1)}%;background:${ZONE_C[i]}"></b></i><em>${fmtZ(z[i])}</em>${zoneRanges?.[i] ? `<small>${zoneRanges[i]}</small>` : ''}</div>`).join('')}${z[0] ? `<div><span class="muted">영역 미만</span><i><b style="width:${(z[0] / ztot * 100).toFixed(1)}%;background:${ZONE_C[0]}"></b></i><em>${fmtZ(z[0])}</em></div>` : ''}</div></div>`
        : '<p class="muted rv-empty">심박 존 데이터가 없어요. 가민 데이터 내보내기(JSON)를 가져오면 채워져요.</p>'}
    </section>

    <section>
      <div class="rv-sec">상세 데이터</div>
      <div class="rv-tiles">${tiles || '<p class="muted">기록된 수치가 없어요</p>'}</div>
    </section>

    <section class="card">
      <div class="rv-hrow"><span class="rv-h">구간 기록</span></div>
      <p class="muted rv-empty">1km 구간 기록은 가민·스트라바에서 이 러닝의 GPX 또는 FIT 파일을 받아 가져오기로 올리면 볼 수 있어요.</p>
    </section>
  </div>`;
  root.querySelectorAll('img[data-path]').forEach(async img => { try { img.src = await imgUrl(img.dataset.path); } catch { } });
}

/* ---------- 러닝 1회 공유 카드 ---------- */
export function runCardHTML(w, all, logs, races) {
  const t = TYPES[w.type] || TYPES.easy, m = w.metrics || {};
  const ps = paceSec(w), km = kmOf(w), rpe = w.rpe ? Math.round(w.rpe) : null;
  const z = m.zones, ztot = z ? z.reduce((s, v) => s + v, 0) : 0;
  const ins = runInsight(w, all, logs, races);
  return `<div class="rc-card run-card" id="run-card">
    <div class="rc-top"><div><div class="rc-brand">42<span>.195</span> TODAY'S RUN</div><div class="rc-title">${esc(w.title)}</div>
      <div class="rc-sub">${esc(korDate(w.date))}${startOf(w) ? ` · ${ampm(startOf(w))}` : ''}</div></div>
      <div class="rc-ytd"><small>훈련</small><b style="font-size:16px">${esc(t.label)}</b></div></div>
    <div class="rc-hero"><div class="rc-big"><b>${km ? km.toFixed(2) : '-'}</b><span>km</span></div></div>
    <div class="rc-stats"><div><small>시간</small><b>${esc(w.actual_time || '-')}</b></div><div><small>페이스</small><b>${ps ? fmtPace(ps) : '-'}<i>/km</i></b></div>
      <div><small>평균 심박</small><b>${w.avg_hr || '-'}<i>bpm</i></b></div><div><small>케이던스</small><b>${w.cadence || '-'}<i>spm</i></b></div></div>
    <div class="rc-box"><div class="rc-h">운동 강도 ${rpe ? `· ${rpe} ${rpeName(rpe)}` : ''}</div>
      <div class="run-rpe">${NEON.map((c, i) => `<i style="background:${c};opacity:${rpe && i < rpe ? 1 : .18}"></i>`).join('')}</div></div>
    ${ztot ? `<div class="rc-box"><div class="rc-h">심박 영역</div><div class="run-zone">${[1, 2, 3, 4, 5].map(i => `<i style="flex:${z[i] || 0.0001};background:${ZONE_C[i]}"></i>`).join('')}</div>
      <div class="run-zl">${[1, 2, 3, 4, 5].map(i => `<span style="color:${ZONE_C[i]}">Z${i} ${Math.round(z[i] / ztot * 100)}%</span>`).join('')}</div></div>` : ''}
    <div class="rc-box rc-hl"><div class="rc-h">${esc(ins.title)}</div><p class="rc-note" style="color:#e2e8f0">${esc(w.memo || ins.text).slice(0, 160)}</p></div>
    <div class="rc-foot">running-calendar · ${w.date.replaceAll('-', '.')}</div>
  </div>`;
}
