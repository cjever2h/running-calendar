import * as store from './store.js';
import { DEFAULT_RACE, VAPID_PUBLIC_KEY } from './config.js';
import { renderStats, RANGES } from './stats.js';
import { buildMonthReport, reportCardHTML, reportText, cardToBlob, addMonths } from './report.js';
import { recognizeGarmin, compressImage, guessType, garminSummary } from './garmin.js';
import { TYPES, SHOE_PURPOSES, RACE_DISTANCES, PRIORITY, distLabel, racePace, paceOf, fmtPace, toSec, fmtDuration } from './plan.js';
import { paceZones, hrZones, zoneText, TYPE_ZONE } from './zones.js';
import { generatePlan, weeklyLoad, PHASES, DAY_NAMES, phaseSplit } from './planner.js';
import { parseFile } from './importers.js';
import { isMobile, sheetDrag, actionSheet, drawer, pullToRefresh, swipeToDelete, autocomplete, stepperHTML, skeleton } from './ui.js';
import { isActivitiesExport, isGearExport, parseActivities, parseGear, matchShoe, gearToShoe } from './garminExport.js';
import { renderStrategy } from './strategy.js';
import { conditionForm, readConditionForm, conditionAlerts, intensityWarning } from './condition.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const WD = ['일', '월', '화', '수', '목', '금', '토'];

const state = {
  workouts: [], shoes: [], races: [], logs: [], profile: {}, condAlerts: [],
  heatmap: false, offline: false, strategyRace: null,
  month: null, // Date (1일)
  selected: null, // 'YYYY-MM-DD'
  view: 'calendar',
  shoeFocus: null,
  statTab: 'week',
  statRange: { week: 'w12', month: 'm6', type: 'w12', cum: 'all', heat: 'y', cond: 'w12' },
  importQueue: [],
  sumPeriod: 'month', calMode: 'cal', boardWeek: null, journalFilter: 'all', journalQ: '', shoeFilter: 'all',
};

/* ---------- 날짜 유틸 ---------- */
function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function parse(s) { return new Date(s + 'T00:00:00'); }
function todayIso() { return iso(new Date()); }
function diffDays(a, b) { return Math.round((parse(a) - parse(b)) / 86400000); }
function korDate(s) { const d = parse(s); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})`; }
function mondayOf(s) { const d = parse(s); const k = (d.getDay() + 6) % 7; d.setDate(d.getDate() - k); return iso(d); }

/* ---------- 상태 판단 ---------- */
function effStatus(w) {
  if (w.type === 'rest') return w.status === 'done' ? 'done' : 'rest';
  if (w.status === 'done') return 'done';
  if (w.status === 'skipped') return 'skipped';
  return w.date < todayIso() ? 'missed' : 'planned';
}
const STATUS_LABEL = { done: '완료', skipped: '미완료', missed: '미완료(기록 없음)', planned: '예정', rest: '휴식' };
function shoeName(s) { return s ? (s.nickname || `${s.brand} ${s.model}`) : ''; }
function shoeKm(s) {
  const runs = state.workouts.filter(w => w.shoe_id === s.id && w.status === 'done');
  const km = runs.reduce((a, w) => a + Number(w.actual_distance || w.planned_distance || 0), 0);
  return { total: Number(s.initial_km || 0) + km, runs };
}
function byDate(date) { return state.workouts.filter(w => w.date === date); }

/* ---------- 대회 ---------- */
function upcomingRaces(from = todayIso()) { return state.races.filter(r => r.date >= from).sort((a, b) => a.date.localeCompare(b.date)); }
function mainRace() { return upcomingRaces()[0] || null; }
/** 훈련 페이스 기준: 가장 가까운 풀코스 대회의 목표 기록 */
function paceRace() { return upcomingRaces().find(r => Math.abs(Number(r.distance_km) - 42.195) < 0.01 && r.goal_time) || null; }
function raceSummary(r) {
  const pace = racePace(r.goal_time, r.distance_km);
  return `${distLabel(r.distance_km)}${r.goal_time ? ` · 목표 ${r.goal_time}${pace ? ` (${pace}/km)` : ''}` : ''}`;
}

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), 2000);
}
async function guard(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg); return r; }
  catch (e) { console.error(e); toast('오류: ' + (e.message || e)); throw e; }
}

/* ---------- 데이터 로드 ---------- */
async function loadAll() {
  try {
    const [w, s, r, l, p] = await Promise.all([store.listWorkouts(), store.listShoes(), store.listRaces(), store.listLogs(), store.getSettings()]);
    state.workouts = w || []; state.shoes = s || []; state.races = r || []; state.logs = l || []; state.profile = p || {};
    state.offline = false;
    store.cacheSnapshot({ workouts: state.workouts, shoes: state.shoes, races: state.races, logs: state.logs, profile: state.profile });
  } catch (e) {
    const snap = store.readSnapshot();
    if (!snap) throw e;
    Object.assign(state, { workouts: snap.workouts || [], shoes: snap.shoes || [], races: snap.races || [], logs: snap.logs || [], profile: snap.profile || {}, offline: snap.at });
  }
  state.condAlerts = conditionAlerts(state.logs, todayIso());
}

/* ---------- 헤더 ---------- */
function renderHeader() {
  const up = upcomingRaces();
  if (up.length) {
    const r = up[0];
    const others = up.slice(1, 3).map(x => `${x.name} D-${diffDays(x.date, todayIso())}`).join(' · ');
    $('#race-line').innerHTML = `${esc(r.name)} · ${r.date.replaceAll('-', '.')} · ${esc(raceSummary(r))}`
      + (others ? `<span class="next-races">다음 대회: ${esc(others)}${up.length > 3 ? ` 외 ${up.length - 3}개` : ''}</span>` : '');
    const d = diffDays(r.date, todayIso());
    $('#dday').innerHTML = d > 0 ? `<b>D-${d}</b><small>${esc(r.name)}</small>` : `<b>D-DAY</b><small>화이팅!</small>`;
  } else {
    $('#race-line').textContent = '설정 탭에서 목표 대회를 추가하세요';
    $('#dday').innerHTML = '';
  }
}

/* ---------- 캘린더 ---------- */
/* ---------- 요약 통계: 세그먼트 버튼 (이번 주 / 이번 달 / 올해) ---------- */
function renderMonthStats() {
  const today = todayIso();
  const per = state.sumPeriod || 'month';
  $$('#sum-seg button').forEach(b => b.classList.toggle('on', b.dataset.k === per));
  let from, to, label;
  if (per === 'week') { from = mondayOf(today); to = addDaysIso(from, 6); label = '이번 주'; }
  else if (per === 'year') { from = today.slice(0, 4) + '-01-01'; to = today.slice(0, 4) + '-12-31'; label = `${today.slice(0, 4)}년`; }
  else {
    const y = state.month.getFullYear(), m = state.month.getMonth();
    const prefix = `${y}-${String(m + 1).padStart(2, '0')}`;
    from = prefix + '-01'; to = prefix + '-31'; label = `${m + 1}월`;
  }
  const list = state.workouts.filter(w => w.date >= from && w.date <= to && !['rest', 'cross', 'strength'].includes(w.type));
  const due = list.filter(w => w.date <= today);
  const done = list.filter(w => w.status === 'done');
  const plannedKm = list.reduce((a, w) => a + Number(w.planned_distance || 0), 0);
  const doneKm = done.reduce((a, w) => a + Number(w.actual_distance || w.planned_distance || 0), 0);
  const rate = due.length ? Math.round(done.filter(w => w.date <= today).length / due.length * 100) : 0;
  const missed = list.filter(w => ['missed', 'skipped'].includes(effStatus(w))).length;
  $('#month-stats').innerHTML = `
    <div class="stat"><div class="k">${label} 계획 거리</div><div class="v">${plannedKm.toFixed(1)}<small> km</small></div></div>
    <div class="stat"><div class="k">${label} 완료 거리</div><div class="v">${doneKm.toFixed(1)}<small> km</small></div>
      <div class="bar"><i style="width:${plannedKm ? Math.min(100, doneKm / plannedKm * 100) : 0}%"></i></div></div>
    <div class="stat"><div class="k">완료율 (오늘까지)</div><div class="v">${rate}<small> %</small></div></div>
    <div class="stat"><div class="k">완료 / 미완료 / 전체</div><div class="v">${done.length}<small> / ${missed} / ${list.length}회</small></div></div>`;
}

/* ---------- 상태 배지 ---------- */
function statusBadge(st) {
  const map = { done: ['done', '완료'], skipped: ['miss', '미완료'], missed: ['miss', '미완료'], planned: ['plan', '예정'], rest: ['rest', '휴식'] };
  const [c, t] = map[st] || map.planned;
  return `<span class="sbadge ${c}">${t}</span>`;
}
function shoeState(s) {
  const { pct } = shoeLevel(s);
  if (s.retired) return { k: 'retired', label: '은퇴', cls: 'rest' };
  if (pct >= 1) return { k: 'replace', label: '교체 필요', cls: 'miss' };
  if (pct >= 0.8) return { k: 'soon', label: '교체 임박', cls: 'warn' };
  return { k: 'ok', label: '양호', cls: 'done' };
}

/* ---------- 칸반: 주간 보드 ---------- */
const BOARD_COLS = [
  { k: 'planned', label: '예정', test: w => effStatus(w) === 'planned' },
  { k: 'done', label: '완료', test: w => w.status === 'done' },
  { k: 'skipped', label: '미완료', test: w => ['skipped', 'missed'].includes(effStatus(w)) },
];
async function setWorkoutStatus(w, st) {
  if (w.status === st || (st === 'planned' && effStatus(w) === 'planned')) return;
  const patch = { ...w, status: st };
  if (st === 'done' && w.type !== 'rest') {
    if (!patch.actual_distance && w.planned_distance) patch.actual_distance = w.planned_distance;
    if (!patch.shoe_id && !['cross', 'strength'].includes(w.type)) patch.shoe_id = lastShoeId() || null;
  }
  await guard(() => saveW(patch), st === 'done' ? `'${w.title}' 완료로 옮겼어요` : st === 'skipped' ? `'${w.title}' 미완료로 옮겼어요` : `'${w.title}' 예정으로 옮겼어요`);
}
function renderBoard() {
  const on = state.calMode === 'board';
  $$('#cal-mode button').forEach(b => b.classList.toggle('on', b.dataset.k === (on ? 'board' : 'cal')));
  $('#board-card').classList.toggle('hidden', !on);
  $('#cal-card').classList.toggle('hidden', on);
  if (!on) return;
  const mon = state.boardWeek || mondayOf(state.selected || todayIso());
  state.boardWeek = mon;
  const sun = addDaysIso(mon, 6);
  $('#board-title').textContent = `${+mon.slice(5, 7)}/${+mon.slice(8)} ~ ${+sun.slice(5, 7)}/${+sun.slice(8)}`;
  const ws = state.workouts.filter(w => w.date >= mon && w.date <= sun && w.type !== 'rest').sort((a, b) => a.date.localeCompare(b.date));
  $('#board').innerHTML = BOARD_COLS.map(c => {
    const list = ws.filter(c.test);
    const km = list.reduce((s, w) => s + Number((c.k === 'done' ? w.actual_distance : 0) || w.planned_distance || 0), 0);
    return `<div class="b-col" data-st="${c.k}"><div class="b-head"><b>${c.label}</b><span>${list.length}개 · ${km.toFixed(1)}km</span></div>
      ${list.map(w => { const t = TYPES[w.type] || TYPES.easy; const km2 = w.status === 'done' && w.actual_distance ? w.actual_distance : w.planned_distance;
        return `<div class="b-card" draggable="true" data-id="${w.id}" style="--c:${t.color}"><div class="b-top"><span class="badge" style="--c:${t.color}">${t.label}</span>${statusBadge(effStatus(w))}</div>
          <div class="b-title">${esc(w.title)}</div><div class="b-sub">${korDate(w.date)}${km2 ? ` · ${Number(km2)}km` : ''}${w.actual_time ? ` · ${esc(w.actual_time)}` : ''}</div></div>`; }).join('') || '<div class="b-empty">여기로 끌어 놓기</div>'}
    </div>`;
  }).join('');
  $$('#board .b-card').forEach(card => {
    const w = state.workouts.find(x => x.id === card.dataset.id);
    card.addEventListener('dragstart', e => { e.dataTransfer.setData('text/wid', w.id); card.classList.add('dragging'); });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
    card.addEventListener('click', () => {
      actionSheet(`${w.title} · ${korDate(w.date)}`, [
        { icon: '✓', label: '완료로 옮기기', onClick: () => setWorkoutStatus(w, 'done') },
        { icon: '✗', label: '미완료로 옮기기', onClick: () => setWorkoutStatus(w, 'skipped') },
        { icon: '○', label: '예정으로 옮기기', onClick: () => setWorkoutStatus(w, 'planned') },
        { icon: '↗', label: '날짜 상세 보기', onClick: () => { state.calMode = 'cal'; selectDate(w.date, true); } },
      ]);
    });
  });
  $$('#board .b-col').forEach(col => {
    col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('drop'); });
    col.addEventListener('dragleave', () => col.classList.remove('drop'));
    col.addEventListener('drop', e => {
      e.preventDefault(); col.classList.remove('drop');
      const w = state.workouts.find(x => x.id === e.dataTransfer.getData('text/wid'));
      if (w) setWorkoutStatus(w, col.dataset.st);
    });
  });
}

/* ---------- 바텀 탭바·서랍 메뉴·플로팅 추가 버튼 ---------- */
function openDrawer() {
  const go = v => () => switchView(v);
  drawer([
    { title: '화면', items: [
      { icon: '📅', label: '캘린더', active: state.view === 'calendar', onClick: go('calendar') },
      { icon: '🏁', label: '대회 전략', active: state.view === 'strategy', onClick: go('strategy') },
      { icon: '👟', label: '러닝화', active: state.view === 'shoes', onClick: go('shoes') },
      { icon: '📊', label: '통계·일지', active: state.view === 'journal' && state.statTab !== 'report', onClick: () => { state.statTab = state.statTab === 'report' ? 'week' : state.statTab; switchView('journal'); } },
      { icon: '🖼', label: '월간 리포트 (공유)', active: state.view === 'journal' && state.statTab === 'report', onClick: () => { state.statTab = 'report'; switchView('journal'); } },
      { icon: '⚙', label: '설정', active: state.view === 'settings', onClick: go('settings') },
    ] },
    { title: '기록·계획', items: [
      { icon: '📷', label: '가민 이미지로 기록 입력', onClick: () => $('#garmin-input').click() },
      { icon: '📂', label: '가민 데이터·GPX·FIT·CSV 가져오기', onClick: () => $('#file-import').click() },
      { icon: '🗓', label: '훈련 계획 만들기', onClick: () => openPlanModal(mainRace()) },
      { icon: '➕', label: '오늘 훈련 추가', onClick: () => openWorkoutModal({ date: todayIso(), type: 'easy', status: 'planned' }) },
    ] },
    { title: '계정', items: [
      { icon: '☁', label: '지금 백업', onClick: () => guard(() => store.autoBackup(true), '지금 백업했어요') },
      { icon: '🔑', label: '비밀번호 변경', onClick: () => openPasswordModal() },
      { icon: '⎋', label: '로그아웃', danger: true, onClick: async () => { await store.signOut(); location.reload(); } },
    ] },
  ], { title: '런닝 캘린더', sub: state.userEmail || '' });
}
function openAddSheet() {
  const d = state.view === 'calendar' && state.selected ? state.selected : todayIso();
  actionSheet('무엇을 기록할까요?', [
    { icon: '📷', label: '가민 이미지로 기록 입력', sub: '공유 이미지에서 거리·시간·심박 자동 인식', onClick: () => $('#garmin-input').click() },
    { icon: '📂', label: '가민 데이터·GPX·FIT·CSV 가져오기', onClick: () => $('#file-import').click() },
    { icon: '➕', label: `${korDate(d)} 훈련 추가`, onClick: () => openWorkoutModal({ date: d, type: 'easy', status: 'planned' }) },
    { icon: '💤', label: `${korDate(d)} 컨디션 기록`, onClick: () => { switchView('calendar'); selectDate(d, true); setTimeout(() => { const c = $('.cond-card'); if (c) { c.open = true; c.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }, 150); } },
  ]);
}

/* ---------- 당겨서 새로고침 ---------- */
async function reloadData() {
  await loadAll();
  refresh();
  toast('최신 데이터로 새로고침했어요');
}

/* ---------- 자동완성 데이터 ---------- */
function titleSuggestions(q) {
  const m = new Map();
  for (const w of [...state.workouts].reverse()) {
    if (!w.title || w.type === 'rest') continue;
    const key = w.title.trim(); if (m.has(key)) { m.get(key).n++; continue; }
    m.set(key, { label: key, w, n: 1 });
  }
  const ql = q.toLowerCase();
  return [...m.values()].filter(x => !ql || x.label.toLowerCase().includes(ql))
    .sort((a, b) => (b.label.toLowerCase().startsWith(ql) - a.label.toLowerCase().startsWith(ql)) || b.n - a.n)
    .map(x => ({ label: x.label, sub: `${(TYPES[x.w.type] || TYPES.easy).label}${x.w.planned_distance ? ` · ${Number(x.w.planned_distance)}km` : ''}${x.w.target_pace ? ` · ${x.w.target_pace}` : ''} · ${x.n}회`, w: x.w }));
}

/* ---------- 알림 배너: 오늘 훈련·부하·러닝화·컨디션 ---------- */
function renderAlerts() {
  const box = $('#alerts'); if (!box) return;
  const today = todayIso();
  const items = [];
  if (state.offline) items.push({ level: 'info', text: `오프라인 상태예요. ${new Date(state.offline).toLocaleString('ko-KR')}에 저장된 데이터를 보여주고 있어요 (수정은 온라인에서).` });
  const tw = byDate(today).filter(w => w.status !== 'done');
  if (tw.length) items.push({ level: 'today', text: `오늘 훈련: ${tw.map(w => `${w.title}${w.planned_distance ? ` (${Number(w.planned_distance)}km${w.target_pace ? ` @ ${w.target_pace}` : ''})` : ''}`).join(', ')}`, date: today });
  for (const a of state.condAlerts) items.push(a);
  for (const w of weeklyLoad(state.workouts, today).warns) items.push({ ...w, date: w.mon });
  for (const s of state.shoes.filter(s => !s.retired)) {
    const { total, max, pct } = shoeLevel(s);
    if (pct >= 1) items.push({ level: 'danger', text: `러닝화 ${shoeName(s)}: 누적 ${total.toFixed(0)}km로 교체 권장 거리(${max}km)를 넘었어요. 새 신발을 준비하세요.` });
    else if (pct >= 0.9) items.push({ level: 'warn', text: `러닝화 ${shoeName(s)}: 누적 ${total.toFixed(0)}km / ${max}km (${Math.round(pct * 100)}%). 교체 시기가 다가와요.` });
  }
  box.innerHTML = items.map(a => `<div class="alert ${a.level || 'info'}" ${a.date ? `data-date="${a.date}"` : ''}>${esc(a.text)}</div>`).join('');
  $$('.alert[data-date]', box).forEach(el => el.onclick = () => selectDate(el.dataset.date < today ? el.dataset.date : (el.dataset.date === today ? today : el.dataset.date), true));
}

function renderCalendar() {
  const y = state.month.getFullYear(), m = state.month.getMonth();
  $('#month-title').textContent = `${y}년 ${m + 1}월`;
  const first = new Date(y, m, 1);
  const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
  const today = todayIso();
  const raceByDate = new Map(state.races.map(r => [r.date, r]));
  let html = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const ds = iso(d);
    if (i >= 35 && d.getMonth() !== m) break;
    const ws = byDate(ds);
    const cls = ['day'];
    if (d.getMonth() !== m) cls.push('other');
    if (ds === today) cls.push('today');
    if (ds === state.selected) cls.push('selected');
    const dayRace = raceByDate.get(ds);
    if (dayRace || ws.some(w => w.type === 'race')) cls.push('race');
    const sts = ws.filter(w => w.type !== 'rest').map(effStatus);
    let mark = '';
    if (sts.length) {
      if (sts.every(s => s === 'done')) mark = '<span class="st" style="color:var(--done)">✓</span>';
      else if (sts.some(s => s === 'missed' || s === 'skipped')) mark = '<span class="st" style="color:var(--miss)">✗</span>';
    }
    const dow = d.getDay();
    const numColor = dow === 0 ? 'sun' : dow === 6 ? 'sat' : '';
    const doneKm = ws.filter(w => w.status === 'done' && w.type !== 'rest').reduce((s, w) => s + Number(w.actual_distance || w.planned_distance || 0), 0);
    const heat = state.heatmap && doneKm ? `style="background:rgba(37,99,235,${Math.min(0.75, 0.12 + doneKm / 40)})"` : '';
    if (state.heatmap && doneKm) cls.push('heat');
    html += `<div class="${cls.join(' ')}" data-date="${ds}" ${heat}>${state.heatmap && doneKm ? `<span class="heat-km">${doneKm.toFixed(1)}</span>` : ''}
      <div class="num"><span class="${numColor}">${d.getDate()}</span>${mark}</div>
      ${ws.map(w => {
        const st = effStatus(w); const t = TYPES[w.type] || TYPES.easy;
        const c = st === 'done' ? 'done' : (st === 'missed' || st === 'skipped') ? 'missed' : w.type === 'rest' ? 'rest' : '';
        const km = w.status === 'done' && w.actual_distance ? w.actual_distance : w.planned_distance;
        if (w.type === 'race') return `<div class="chip ${c}" draggable="true" data-wid="${w.id}" style="--c:${t.color}" title="${esc(w.title)}">${esc(dayRace?.name || w.title)}</div>`;
        return `<div class="chip ${c}" draggable="true" data-wid="${w.id}" style="--c:${t.color}" title="${esc(w.title)}">${esc(t.label)}${km ? `<span class="km"> ${Number(km)}k</span>` : ''}</div>`;
      }).join('')}
      ${dayRace && !ws.some(w => w.type === 'race') ? `<div class="chip" style="--c:${TYPES.race.color}" title="${esc(dayRace.name)}">${esc(dayRace.name)}</div>` : ''}
    </div>`;
  }
  $('#cal-grid').innerHTML = html;
  $$('#cal-grid .day').forEach(el => {
    el.addEventListener('click', () => selectDate(el.dataset.date, true));
    el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drop'); e.dataTransfer.dropEffect = e.ctrlKey || e.metaKey || e.altKey ? 'copy' : 'move'; });
    el.addEventListener('dragleave', () => el.classList.remove('drop'));
    el.addEventListener('drop', async e => {
      e.preventDefault(); el.classList.remove('drop');
      const w = state.workouts.find(x => x.id === e.dataTransfer.getData('text/wid')); if (!w) return;
      await moveOrCopy(w, el.dataset.date, e.ctrlKey || e.metaKey || e.altKey);
    });
  });
  $$('#cal-grid .chip[data-wid]').forEach(ch => ch.addEventListener('dragstart', e => { e.dataTransfer.setData('text/wid', ch.dataset.wid); e.dataTransfer.effectAllowed = 'copyMove'; }));
  $('#heat-btn')?.classList.toggle('on', state.heatmap);
  $('#legend').innerHTML = Object.values(TYPES).map(t => `<span><i style="background:${t.color}"></i>${t.label}</span>`).join('')
    + '<span><b style="color:var(--done)">✓</b> 완료</span><span><b style="color:var(--miss)">✗</b> 미완료</span>';
  renderMonthStats();
  renderAlerts();
}

function selectDate(ds, scroll = false) {
  state.selected = ds;
  const d = parse(ds);
  if (d.getMonth() !== state.month.getMonth() || d.getFullYear() !== state.month.getFullYear()) {
    state.month = new Date(d.getFullYear(), d.getMonth(), 1);
  }
  renderCalendar();
  renderDayPanel();
  if (scroll && window.innerWidth <= 1000) $('#day-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function shoeOptions(selected) {
  const active = state.shoes.filter(s => !s.retired || s.id === selected);
  return `<option value="">선택 안 함</option>` + active.map(s => `<option value="${s.id}" ${s.id === selected ? 'selected' : ''}>${esc(shoeName(s))}${s.retired ? ' (은퇴)' : ''}</option>`).join('');
}
function lastShoeId() {
  const done = state.workouts.filter(w => w.status === 'done' && w.shoe_id && state.shoes.find(s => s.id === w.shoe_id && !s.retired))
    .sort((a, b) => b.date.localeCompare(a.date));
  return done[0]?.shoe_id || state.shoes.find(s => !s.retired)?.id || '';
}

function raceOf(w) { return state.races.find(r => r.id === w.race_id) || null; }
function latestRestingHr() { const l = [...state.logs].reverse().find(x => x.resting_hr); return l?.resting_hr; }
function latestWeight() { const l = [...state.logs].reverse().find(x => x.weight); return l?.weight || state.profile.weight; }
function zonesFor(w) {
  const r = (raceOf(w)?.goal_time && raceOf(w)) || paceRace() || mainRace();
  const pz = paceZones(r || { name: '기본', distance_km: 42.195, goal_time: '3:30:00' });
  return { pz, hz: hrZones(state.profile, latestRestingHr()), basis: r ? `${r.name} ${r.goal_time || ''}`.trim() : '풀코스 3:30:00' };
}
/** "5:54~6:24" 범위와 실제 페이스 비교 */
function paceCheck(sec, str) {
  if (!sec || !str) return '';
  const m = String(str).match(/(\d{1,2}:\d{2})\s*~\s*(\d{1,2}:\d{2})/) || String(str).match(/(\d{1,2}:\d{2})/);
  if (!m) return '';
  const lo = toSec(m[1]), hi = m[2] ? toSec(m[2]) : lo;
  if (sec < lo - 3) return `<span class="pv fast">목표보다 빠름</span>`;
  if (sec > hi + 3) return `<span class="pv slow">목표보다 느림</span>`;
  return `<span class="pv ok">목표 범위</span>`;
}
function hrCheck(hr, str) {
  const m = String(str || '').match(/(\d{2,3})\s*~\s*(\d{2,3})/); if (!hr || !m) return '';
  return hr > +m[2] + 3 ? `<span class="pv fast">높음</span>` : hr < +m[1] - 5 ? `<span class="pv slow">낮음</span>` : `<span class="pv ok">범위</span>`;
}

function workoutCard(w) {
  const t = TYPES[w.type] || TYPES.easy;
  const st = effStatus(w);
  const isRest = w.type === 'rest';
  const pace = paceOf(w.actual_distance, w.actual_time);
  const shoe = state.shoes.find(s => s.id === w.shoe_id);
  const race = raceOf(w);
  const { pz, hz, basis } = zonesFor(w);
  const zk = TYPE_ZONE[w.type];
  const zone = zk ? zoneText(w.type, pz, hz) : '';
  const warn = intensityWarning(state.condAlerts || [], w.type);
  const dPlan = Number(w.planned_distance) || null, dAct = Number(w.actual_distance) || null;
  const diff = dPlan && dAct ? Math.round((dAct - dPlan) * 100) / 100 : null;
  return `<div class="workout" style="--c:${t.color}" data-id="${w.id}">
    <div class="w-head"><span class="badge" style="--c:${t.color}">${t.label}</span>
      <span class="status-badge ${st}">${STATUS_LABEL[st]}</span>
      ${race || w.phase ? `<span class="tag">${esc([race?.name, w.phase].filter(Boolean).join(' · '))}</span>` : ''}
      ${w.source && w.source !== 'manual' ? `<span class="tag">${{ 'garmin-image': '가민 이미지', gpx: 'GPX', fit: 'FIT', csv: 'CSV' }[w.source] || esc(w.source)}</span>` : ''}</div>
    <div class="w-title">${esc(w.title)}</div>
    ${zone ? `<div class="w-zone"><b>${pz?.[zk]?.label || ''} 존</b> ${esc(zone)} <span class="muted">(${esc(basis)} 기준)</span></div>` : ''}
    ${warn && st !== 'done' ? `<div class="w-warn">${esc(warn)}</div>` : ''}
    ${!isRest ? `<table class="pva">
      <thead><tr><th></th><th>계획</th><th>실제</th></tr></thead>
      <tbody>
        <tr><td>거리</td><td>${dPlan ? dPlan + 'km' : '-'}</td><td>${dAct ? `<b>${dAct}km</b>${diff ? ` <span class="muted">(${diff > 0 ? '+' : ''}${diff})</span>` : ''}` : '-'}</td></tr>
        <tr><td>시간</td><td>${esc(w.planned_duration || '-')}</td><td>${w.actual_time ? `<b>${esc(w.actual_time)}</b>` : '-'}</td></tr>
        <tr><td>페이스</td><td>${w.target_pace ? esc(w.target_pace) : (zk && pz?.[zk] ? esc(pz[zk].pace) : '-')}</td><td>${pace ? `<b>${fmtPace(pace)}</b> ${paceCheck(pace, w.target_pace || pz?.[zk]?.pace)}` : '-'}</td></tr>
        <tr><td>심박</td><td>${esc(w.target_hr || (zk && hz?.[zk]) || '-')}</td><td>${w.avg_hr ? `<b>${w.avg_hr}</b>${w.max_hr ? ` / 최대 ${w.max_hr}` : ''} ${hrCheck(w.avg_hr, w.target_hr || hz?.[zk])}` : '-'}</td></tr>
      </tbody></table>` : ''}
    ${shoe ? `<div class="w-meta"><span>러닝화 <b>${esc(shoeName(shoe))}</b></span></div>` : ''}
    ${w.details ? `<details class="w-det" ${st === 'done' ? '' : 'open'}><summary>상세 훈련 프로그램</summary><div class="w-details">${esc(w.details)}</div></details>` : ''}
    <div class="seg">
      <button data-st="done" class="${w.status === 'done' ? 'on done' : ''}">✓ 완료</button>
      <button data-st="skipped" class="${w.status === 'skipped' ? 'on skipped' : ''}">✗ 미완료</button>
      <button data-st="planned" class="${w.status === 'planned' || !w.status ? 'on planned' : ''}">○ 예정</button>
    </div>
    ${isRest ? `<form class="rec-form"><label>메모<textarea name="memo" placeholder="회복 상태, 크로스트레이닝 등">${esc(w.memo ?? '')}</textarea></label>
      <div style="margin-top:8px"><button class="btn primary" type="submit">메모 저장</button></div></form>` : `
    <form class="rec-form">
      <div class="rec-grid">
        <label>실제 거리 (km)<input name="actual_distance" type="number" step="0.01" min="0" value="${w.actual_distance ?? ''}" placeholder="${w.planned_distance ?? ''}"></label>
        <label>시간 (h:mm:ss)<input name="actual_time" value="${esc(w.actual_time ?? '')}" placeholder="${esc(w.planned_duration || '0:55:30')}"></label>
        <label>평균 심박<input name="avg_hr" type="number" min="0" value="${w.avg_hr ?? ''}" placeholder="bpm"></label>
        <label>최대 심박<input name="max_hr" type="number" min="0" value="${w.max_hr ?? ''}" placeholder="bpm"></label>
        <label class="full">체감 강도 RPE <span class="rpe-val">${w.rpe ?? '-'}</span><input name="rpe" type="range" min="1" max="10" value="${w.rpe ?? 5}"></label>
        <div class="full pace-out">평균 페이스: <b>${pace ? fmtPace(pace) + '/km' : '-'}</b></div>
        <label class="full">러닝화<select name="shoe_id">${shoeOptions(w.shoe_id || (w.status === 'done' ? '' : lastShoeId()))}</select></label>
        <label class="full">달리며 느낀 점 메모<textarea name="memo" placeholder="컨디션, 날씨, 페이스 느낌, 통증 여부, 보급 등">${esc(w.memo ?? '')}</textarea></label>
      </div>
      <button class="btn primary" type="submit">기록 저장</button>
    </form>`}
    ${(w.images || []).length ? `<div class="w-images">${w.images.map((p, i) => `<button type="button" class="thumb" data-i="${i}" title="크게 보기"><img data-path="${esc(p)}" alt="러닝 기록 이미지"></button>`).join('')}</div>` : ''}
    <div class="w-actions">
      <button class="btn sm" data-act="edit">계획 수정</button>
      <button class="btn sm" data-act="move">이동·복사</button>
      <label class="btn sm">기록 이미지 추가<input type="file" accept="image/*" data-act="img" hidden></label>
      <button class="btn sm danger" data-act="del">삭제</button>
    </div>
  </div>`;
}

/* ---------- 이미지 ---------- */
async function fillImages(root) {
  for (const img of $$('img[data-path]', root)) {
    if (img.src) continue;
    try { img.src = await store.imageUrl(img.dataset.path); } catch (e) { img.alt = '이미지를 불러오지 못했어요'; }
  }
}
async function openImageViewer(w, idx) {
  const path = w.images[idx];
  let url = ''; try { url = await store.imageUrl(path); } catch { }
  openModal(`${korDate(w.date)} · ${w.title}`, `
    <div class="viewer"><img src="${esc(url)}" alt="러닝 기록 이미지"></div>
    <div class="row gap" style="margin-top:12px">
      ${w.images.length > 1 ? `<button class="btn sm" id="iv-prev">‹ 이전</button><span class="muted">${idx + 1} / ${w.images.length}</span><button class="btn sm" id="iv-next">다음 ›</button>` : ''}
      <a class="btn sm" href="${esc(url)}" target="_blank" rel="noopener" style="margin-left:auto">원본 열기</a>
      <button class="btn sm danger" id="iv-del">이미지 삭제</button>
    </div>`, body => {
    const n = w.images.length;
    $('#iv-prev', body) && ($('#iv-prev', body).onclick = () => openImageViewer(w, (idx - 1 + n) % n));
    $('#iv-next', body) && ($('#iv-next', body).onclick = () => openImageViewer(w, (idx + 1) % n));
    $('#iv-del', body).onclick = async () => {
      if (!confirm('이 이미지를 삭제할까요?')) return;
      await guard(async () => {
        await store.removeImage(path).catch(() => { });
        await saveW({ ...w, images: w.images.filter((_, i) => i !== idx) });
      }, '이미지를 삭제했어요');
      closeModal();
    };
  }, true);
}

/* ---------- 가민 이미지로 기록 입력 ---------- */
function enqueueImports(files, target = null) {
  state.importQueue.push(...[...files].map(f => ({ file: f, target })));
  if ($('#modal').classList.contains('hidden')) nextImport();
}
function nextImport() {
  const job = state.importQueue.shift();
  if (job) openImportModal(job.file, job.target);
}
function targetOptions(date, selectedId) {
  const ws = date ? byDate(date).filter(w => w.type !== 'rest') : [];
  return `<option value="">새 훈련으로 추가</option>` + ws.map(w => `<option value="${w.id}" ${w.id === selectedId ? 'selected' : ''}>기존: ${esc(w.title)}${w.planned_distance ? ` (${Number(w.planned_distance)}km)` : ''} · ${STATUS_LABEL[effStatus(w)]}</option>`).join('');
}
function pickTarget(date, km, time = '') {
  const ws = byDate(date).filter(w => w.type !== 'rest');
  // 같은 러닝이 이미 기록된 경우(거리 거의 같음) → 그 기록에 이미지 첨부
  const tsec = toSec(time);
  const same = ws.find(w => w.status === 'done' && ((km && w.actual_distance && Math.abs(Number(w.actual_distance) - km) <= Math.max(0.3, km * 0.03)) || (tsec && toSec(w.actual_time) === tsec)));
  if (same) return same;
  const open = ws.filter(w => w.status !== 'done');
  if (!open.length) return null;
  return open.sort((a, b) => Math.abs((a.planned_distance || 0) - (km || 0)) - Math.abs((b.planned_distance || 0) - (km || 0)))[0];
}

function openImportModal(file, target = null) {
  const url = URL.createObjectURL(file);
  const remain = state.importQueue.length;
  const today = todayIso();
  openModal(`가민 이미지로 기록 입력${remain ? ` (남은 이미지 ${remain}장)` : ''}`, `
    <div class="imp-grid">
      <div class="imp-img"><img src="${url}" alt="업로드한 이미지"></div>
      <div>
        <div id="imp-steps">${stepperHTML(['이미지', '자동 인식', '확인·수정', '저장'], 1)}</div>
        <div class="ocr-status" id="ocr-status"><span id="ocr-msg">이미지 읽는 중...</span><div class="bar"><i id="ocr-bar" style="width:3%"></i></div></div>
        <form id="imp-form" class="form-grid">
          <label>날짜<input type="date" name="date" value="${target?.date || today}" required></label>
          <label>저장 위치<select name="target">${targetOptions(target?.date || today, target?.id)}</select></label>
          <label>종류<select name="type">${Object.entries(TYPES).filter(([k]) => k !== 'rest').map(([k, t]) => `<option value="${k}" ${k === (target?.type || 'easy') ? 'selected' : ''}>${t.label}</option>`).join('')}</select></label>
          <label>훈련 제목<input name="title" value="${esc(target?.title || '')}" placeholder="예: 이른아침 러닝"></label>
          <label>거리 (km)<input type="number" step="0.01" min="0" name="distance" value="${target?.actual_distance ?? ''}" required></label>
          <label>시간 (h:mm:ss)<input name="time" value="${esc(target?.actual_time || '')}" placeholder="0:49:44"></label>
          <label>평균 심박<input type="number" name="avg_hr" value="${target?.avg_hr ?? ''}"></label>
          <label>러닝화<select name="shoe_id">${shoeOptions(target?.shoe_id || '')}</select></label>
          <div class="full pace-out" id="imp-pace"></div>
          <label class="full">가민 상세 기록<textarea name="garmin" rows="4" placeholder="인식된 상세 기록 (심박·케이던스·날씨 등)"></textarea></label>
          <label class="full">달리며 느낀 점 메모<textarea name="memo" rows="3" placeholder="컨디션, 페이스 느낌, 통증 여부 등">${esc(target?.memo || '')}</textarea></label>
          <div class="full muted" style="font-size:12px">자동 인식 결과는 틀릴 수 있어요. 이미지와 비교해 확인한 뒤 저장하세요.</div>
          <div class="full row gap wrap"><button class="btn primary" type="submit">기록 저장</button><button class="btn" type="button" id="imp-skip">${remain ? '건너뛰기' : '취소'}</button></div>
          <details class="full"><summary class="muted" style="font-size:12px;cursor:pointer">인식된 원본 텍스트 보기</summary><pre id="ocr-text" class="ocr-text"></pre></details>
        </form>
      </div>
    </div>`, body => {
    const f = $('#imp-form', body);
    let ocr = null;
    const updPace = () => { const p = paceOf(f.distance.value, f.time.value); $('#imp-pace', body).innerHTML = p ? `평균 페이스: <b>${fmtPace(p)}/km</b>` : ''; };
    f.distance.oninput = updPace; f.time.oninput = updPace;
    f.date.onchange = () => {
      const t = pickTarget(f.date.value, Number(f.distance.value), f.time.value);
      f.target.innerHTML = targetOptions(f.date.value, t?.id);
      applyTarget();
    };
    const applyTarget = () => {
      const t = state.workouts.find(x => x.id === f.target.value);
      if (t) {
        f.type.value = t.type === 'rest' ? 'easy' : t.type; if (!f.title.dataset.edited) f.title.value = t.title;
        const gm = (t.details || '').match(/\[가민 기록\][\s\S]*$/);
        f.garmin.value = gm ? gm[0] : (ocr ? garminSummary(ocr) : f.garmin.value);
        if (t.status === 'done') {
          // 이미 기록된 러닝에 이미지를 붙이는 경우: 저장된 값을 우선 (인식 오차로 덮어쓰지 않음)
          if (t.actual_distance) f.distance.value = t.actual_distance;
          if (t.actual_time) f.time.value = t.actual_time;
          if (t.avg_hr) f.avg_hr.value = t.avg_hr;
          if (t.shoe_id && !f.shoe_id.value) f.shoe_id.value = t.shoe_id;
          if (t.memo && !f.memo.value) f.memo.value = t.memo;
        }
      } else if (ocr) f.garmin.value = garminSummary(ocr);
      if (!t && ocr) { f.type.value = guessType(ocr.title, Number(f.distance.value), paceOf(f.distance.value, f.time.value), toSec(paceRace()?.goal_time || '3:30:00') / 42.195); if (!f.title.dataset.edited) f.title.value = ocr.title || '러닝'; }
    };
    f.title.oninput = () => { f.title.dataset.edited = '1'; };
    f.target.onchange = applyTarget;
    $('#imp-skip', body).onclick = () => { URL.revokeObjectURL(url); closeModal(); };
    const setImpStep = s => { const el = $('#imp-steps', body); if (el) el.innerHTML = stepperHTML(['이미지', '자동 인식', '확인·수정', '저장'], s); };

    recognizeGarmin(file, (msg, p) => {
      $('#ocr-msg', body) && ($('#ocr-msg', body).textContent = msg + (p > 0 && p < 1 ? ` ${Math.round(p * 100)}%` : ''));
      $('#ocr-bar', body) && ($('#ocr-bar', body).style.width = Math.max(3, Math.round(p * 100)) + '%');
    }).then(r => {
      ocr = r;
      if (!$('#imp-form')) return;
      setImpStep(2);
      $('#ocr-text', body).textContent = r.rawText;
      const found = [r.date && '날짜', r.distance && '거리', r.time && '시간', r.avgHr && '심박'].filter(Boolean);
      $('#ocr-msg', body).textContent = found.length ? `인식 완료: ${found.join('·')} 자동 입력됨. 확인 후 저장하세요.` : '자동 인식에 실패했어요. 직접 입력해 주세요.';
      $('#ocr-status', body).classList.toggle('warn', found.length < 3 || r.distanceEstimated);
      if (r.distanceEstimated) $('#ocr-msg', body).textContent += ' 거리는 글자를 못 읽어 시간÷페이스로 계산했어요. 꼭 확인하세요.';
      if (r.date) f.date.value = r.date;
      else if (!target) { f.date.value = ''; $('#ocr-msg', body).textContent += ' 날짜를 찾지 못했어요. 날짜를 직접 선택하세요.'; $('#ocr-status', body).classList.add('warn'); }
      if (r.distance) f.distance.value = r.distance;
      if (r.time) f.time.value = r.time;
      if (r.avgHr) f.avg_hr.value = r.avgHr;
      f.garmin.value = garminSummary(r);
      if (!target) {
        const t = pickTarget(f.date.value, r.distance, r.time);
        f.target.innerHTML = targetOptions(f.date.value, t?.id);
      }
      applyTarget();
      updPace();
    }).catch(e => {
      $('#ocr-msg', body) && ($('#ocr-msg', body).textContent = '자동 인식 실패: ' + e.message + ' (직접 입력 후 저장할 수 있어요)');
      $('#ocr-status', body)?.classList.add('warn');
    });

    f.onsubmit = async e => {
      e.preventDefault();
      const btn = $('button[type=submit]', f); btn.disabled = true; btn.textContent = '저장 중...'; setImpStep(3);
      try {
        const existing = state.workouts.find(x => x.id === f.target.value);
        const id = existing?.id || crypto.randomUUID();
        const blob = await compressImage(file);
        const path = await store.uploadImage(id, blob);
        const g = f.garmin.value.trim();
        const base = existing || { id, date: f.date.value, type: f.type.value, title: f.title.value.trim() || '러닝', planned_distance: Number(f.distance.value) || null, details: '' };
        let details = base.details || '';
        if (g) details = details.includes('[가민 기록]') ? details.replace(/\[가민 기록\][\s\S]*$/, g) : (details ? details + '\n\n' + g : g);
        const saved = await saveW({
          ...base, date: f.date.value, type: f.type.value, title: f.title.value.trim() || base.title,
          status: 'done', actual_distance: f.distance.value, actual_time: f.time.value.trim(), avg_hr: f.avg_hr.value,
          shoe_id: f.shoe_id.value || null, memo: f.memo.value.trim() || base.memo || null, details,
          images: [...(base.images || []), path],
        });
        toast('기록과 이미지를 저장했어요');
        URL.revokeObjectURL(url);
        closeModal();
        if (state.view === 'calendar') selectDate(saved.date);
      } catch (err) {
        console.error(err); toast('저장 실패: ' + (err.message || err));
        btn.disabled = false; btn.textContent = '기록 저장';
      }
    };
  }, true);
}

function renderDayPanel() {
  const ds = state.selected;
  const panel = $('#day-panel');
  if (!ds) { panel.innerHTML = '<div class="empty">날짜를 선택하세요</div>'; return; }
  const ws = byDate(ds);
  const nr = upcomingRaces(ds)[0];
  const dd = nr ? diffDays(nr.date, ds) : null;
  const log = state.logs.find(l => l.date === ds);
  const mon = mondayOf(ds);
  const prevCount = state.workouts.filter(w => w.date >= addDaysIso(mon, -7) && w.date < mon).length;
  panel.innerHTML = `
    <div class="day-title"><h3>${korDate(ds)}</h3>${nr ? `<span class="muted">${dd === 0 ? `대회일: ${esc(nr.name)}` : `${esc(nr.name)} D-${dd}`}</span>` : ''}</div>
    ${ws.length ? ws.map(workoutCard).join('') : '<div class="empty">이 날짜에 등록된 훈련이 없어요</div>'}
    <button class="btn" id="add-workout" style="width:100%">+ 이 날짜에 훈련 추가</button>
    ${prevCount ? `<button class="btn sm" id="copy-week" style="width:100%;margin-top:6px">지난주(${addDaysIso(mon, -7).slice(5).replace('-', '/')}~) 계획 ${prevCount}개를 이번 주로 복사</button>` : ''}
    <details class="cond-card" ${log ? '' : ''}>
      <summary><b>컨디션 기록</b> ${log ? `<span class="muted">피로 ${log.fatigue ?? '-'} · 수면 ${log.sleep_hours ?? '-'}h${log.pain_areas?.length ? ` · 통증 ${esc(log.pain_areas.join(', '))}` : ''}${log.resting_hr ? ` · 안정시 ${log.resting_hr}` : ''}</span>` : '<span class="muted">피로도·수면·통증·체중·안정시 심박</span>'}</summary>
      ${conditionForm(log || {}, ds)}
    </details>
    ${!state.workouts.length && mainRace() ? `<div class="empty" style="margin-top:12px">아직 훈련 계획이 없어요.<br><button class="btn primary" id="quick-plan" style="margin-top:10px">훈련 계획 만들기</button></div>` : ''}`;
  $('#add-workout').onclick = () => openWorkoutModal({ date: ds, type: 'easy', status: 'planned' });
  $('#copy-week')?.addEventListener('click', () => copyLastWeek(mon));
  fillImages(panel);
  const qp = $('#quick-plan'); if (qp) qp.onclick = () => openPlanModal(mainRace());

  // 컨디션 폼
  const cf = $('.cond-form', panel);
  if (cf) {
    if (log?.fatigue != null) cf.dataset.hasFatigue = '1';
    cf.fatigue.oninput = e => { e.target.dataset.touched = '1'; $('.fat-val', cf).textContent = e.target.value; };
    cf.pain_level.oninput = e => { $('.pain-val', cf).textContent = e.target.value; };
    cf.onsubmit = async e => {
      e.preventDefault();
      const data = readConditionForm(cf);
      const saved = await guard(() => store.saveLog(data), '컨디션을 저장했어요');
      const i = state.logs.findIndex(l => l.date === saved.date);
      if (i >= 0) state.logs[i] = saved; else state.logs.push(saved);
      state.logs.sort((a, b) => a.date.localeCompare(b.date));
      state.condAlerts = conditionAlerts(state.logs, todayIso());
      refresh();
    };
  }

  $$('.workout', panel).forEach(card => {
    const w = state.workouts.find(x => x.id === card.dataset.id);
    const form = $('.rec-form', card);
    const collect = () => {
      if (!form) return {};
      const fd = Object.fromEntries(new FormData(form));
      if (form.rpe && !form.rpe.dataset.touched && w.rpe == null) delete fd.rpe;
      return fd;
    };
    if (form?.rpe) form.rpe.addEventListener('input', e => { e.target.dataset.touched = '1'; $('.rpe-val', card).textContent = e.target.value; });
    if (form?.actual_time) {
      const upd = () => {
        const p = paceOf(form.actual_distance.value || w.planned_distance, form.actual_time.value);
        $('.pace-out b', card).textContent = p ? fmtPace(p) + '/km' : '-';
      };
      form.actual_time.addEventListener('input', upd); form.actual_distance.addEventListener('input', upd);
    }
    $$('.seg button', card).forEach(b => b.addEventListener('click', async () => {
      const patch = { ...w, ...collect(), status: b.dataset.st };
      if (patch.status === 'done' && w.type !== 'rest') {
        if (!patch.actual_distance && w.planned_distance) patch.actual_distance = w.planned_distance;
        if (!patch.shoe_id) patch.shoe_id = lastShoeId() || null;
      }
      await guard(() => saveW(patch), patch.status === 'done' ? '완료로 기록했어요' : patch.status === 'skipped' ? '미완료로 표시했어요' : '예정으로 되돌렸어요');
    }));
    form?.addEventListener('submit', async e => {
      e.preventDefault();
      const patch = { ...w, ...collect() };
      if (w.type !== 'rest' && w.status !== 'done' && (patch.actual_distance || patch.actual_time)) patch.status = 'done';
      await guard(() => saveW(patch), '저장했어요');
    });
    $('[data-act=edit]', card).onclick = () => openWorkoutModal(w);
    $('[data-act=move]', card).onclick = () => openMoveModal(w);
    $('[data-act=img]', card).onchange = e => { const fl = e.target.files; if (fl?.length) enqueueImports(fl, w); e.target.value = ''; };
    $$('.thumb', card).forEach(b => b.onclick = () => openImageViewer(w, Number(b.dataset.i)));
    $('[data-act=del]', card).onclick = async () => {
      if (!confirm(`'${w.title}' 훈련을 삭제할까요?`)) return;
      for (const p of w.images || []) await store.removeImage(p).catch(() => { });
      await guard(() => store.deleteWorkout(w.id), '삭제했어요');
      state.workouts = state.workouts.filter(x => x.id !== w.id);
      refresh();
    };
  });
}

function addDaysIso(s, n) { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); }

/* ---------- 러닝화 교체 알림 ---------- */
function shoeLevel(s) { const { total } = shoeKm(s); const max = Number(s.max_km || 700); return { total, max, pct: total / max }; }
function notifyLocal(title, body) {
  try { if ('Notification' in window && Notification.permission === 'granted') navigator.serviceWorker?.ready.then(r => r.showNotification(title, { body, icon: 'icon-192.png' })); } catch { }
}

async function saveW(w) {
  const before = w.shoe_id ? state.shoes.find(s => s.id === w.shoe_id) : null;
  const pctBefore = before ? shoeLevel(before).pct : 0;
  const saved = await store.saveWorkout(w);
  const i = state.workouts.findIndex(x => x.id === saved.id);
  if (i >= 0) state.workouts[i] = saved; else state.workouts.push(saved);
  state.workouts.sort((a, b) => a.date.localeCompare(b.date));
  if (before && saved.status === 'done') {
    const { pct, total, max } = shoeLevel(before);
    for (const th of [1, 0.9, 0.8]) if (pctBefore < th && pct >= th) {
      const msg = th >= 1 ? `${shoeName(before)} 누적 ${total.toFixed(0)}km: 교체 권장 거리(${max}km)를 넘었어요. 새 러닝화를 준비하세요.` : `${shoeName(before)} 누적 ${total.toFixed(0)}km: 교체 권장 거리의 ${Math.round(th * 100)}%에 도달했어요.`;
      setTimeout(() => toast(msg), 2200); notifyLocal('러닝화 교체 알림', msg); break;
    }
  }
  refresh();
  return saved;
}

/* ---------- 모달 ---------- */
function openModal(title, html, onMount, wide = false) {
  $('.modal').classList.toggle('wide', wide);
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = html;
  $('#modal').classList.remove('hidden');
  onMount?.($('#modal-body'));
}
function closeModal() {
  const wasImport = !!$('#imp-form');
  $('#modal').classList.add('hidden');
  $('#modal-body').innerHTML = '';
  if (wasImport && state.importQueue.length) setTimeout(nextImport, 50);
}

function raceOptions(sel) {
  return `<option value="">연결 안 함</option>` + [...state.races].sort((a, b) => a.date.localeCompare(b.date)).map(r => `<option value="${r.id}" ${r.id === sel ? 'selected' : ''}>${esc(r.name)} (${r.date})</option>`).join('');
}

function openWorkoutModal(w) {
  const isNew = !w.id;
  const defRace = w.race_id ?? (isNew ? upcomingRaces(w.date)[0]?.id : '') ?? '';
  openModal(isNew ? '훈련 추가' : '훈련 계획 수정', `
    <form id="w-form" class="form-grid">
      <label>날짜<input type="date" name="date" value="${w.date}" required></label>
      <label>훈련 유형<select name="type">${Object.entries(TYPES).map(([k, t]) => `<option value="${k}" ${k === w.type ? 'selected' : ''}>${t.label}</option>`).join('')}</select></label>
      <label class="full">훈련 제목<input name="title" value="${esc(w.title ?? '')}" placeholder="예: 인터벌 1km × 5" required></label>
      <label>계획 거리 (km)<input type="number" step="0.1" min="0" name="planned_distance" value="${w.planned_distance ?? ''}"></label>
      <label>계획 시간 (h:mm:ss)<input name="planned_duration" value="${esc(w.planned_duration ?? '')}" placeholder="자동 계산"></label>
      <label>목표 페이스 (/km)<input name="target_pace" value="${esc(w.target_pace ?? '')}" placeholder="유형 선택 시 자동"></label>
      <label>목표 심박 (bpm)<input name="target_hr" value="${esc(w.target_hr ?? '')}" placeholder="예: 127~141"></label>
      <label class="full">대회 연결<select name="race_id">${raceOptions(defRace)}</select></label>
      <label class="full">상세 훈련 프로그램<textarea name="details" rows="6" placeholder="워밍업 / 본훈련 / 쿨다운 / 포인트">${esc(w.details ?? '')}</textarea></label>
      <div class="full zone-help" id="zone-help"></div>
      <div class="full row gap"><button class="btn primary" type="submit">${isNew ? '추가' : '저장'}</button><button class="btn" type="button" id="w-zone">존 값 채우기</button><button class="btn" type="button" id="w-cancel">취소</button></div>
    </form>`, body => {
    const f = $('#w-form', body);
    const help = () => {
      const r = state.races.find(x => x.id === f.race_id.value);
      const { pz, hz, basis } = zonesFor({ race_id: r?.id });
      $('#zone-help', body).innerHTML = pz ? `<b>페이스 존</b> (${esc(basis)} 기준) 회복 ${pz.recovery.pace} · 이지 ${pz.easy.pace} · LSD ${pz.long.pace} · 마라톤 ${pz.mp.pace} · 템포 ${pz.tempo.pace} · 인터벌 ${pz.interval.pace}${hz ? `<br><b>심박 존</b> (최대 ${hz.max}${hz.estimated ? ' 추정' : ''}) 이지 ${hz.easy} · 마라톤 ${hz.mp} · 템포 ${hz.tempo} · 인터벌 ${hz.interval}` : ''}` : '';
      return { pz, hz };
    };
    const fill = (force) => {
      const { pz, hz } = help(); const k = TYPE_ZONE[f.type.value];
      if (k && pz?.[k] && (force || !f.target_pace.value)) f.target_pace.value = pz[k].pace;
      if (k && hz?.[k] && (force || !f.target_hr.value)) f.target_hr.value = hz[k];
      const pk = toSec((f.target_pace.value.match(/\d{1,2}:\d{2}/g) || []).pop());
      if (f.planned_distance.value && pk && (force || !f.planned_duration.value)) f.planned_duration.value = fmtDuration(Math.round(Number(f.planned_distance.value) * pk));
    };
    help();
    autocomplete(f.title, q => titleSuggestions(q), it => {
      const s = it.w; f.type.value = s.type === 'race' ? f.type.value : s.type;
      if (s.planned_distance && !f.planned_distance.value) f.planned_distance.value = s.planned_distance;
      if (s.target_pace && !f.target_pace.value) f.target_pace.value = s.target_pace;
      const det = (s.details || '').replace(/^\[[^\]]*\]\n?/, '').replace(/\n*\[(가민|GPX|FIT|CSV) 기록\][\s\S]*$/, '').trim();
      if (det && !f.details.value) f.details.value = det;
      fill(false);
    });
    $('#w-cancel', body).onclick = closeModal;
    $('#w-zone', body).onclick = () => fill(true);
    f.type.onchange = () => { if (!f.title.value) f.title.value = TYPES[f.type.value].label; fill(false); };
    f.race_id.onchange = help;
    f.planned_distance.onchange = () => fill(false);
    f.onsubmit = async e => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(f));
      const saved = await guard(() => saveW({ ...w, ...fd, status: w.status || 'planned', source: w.source || 'manual' }), isNew ? '훈련을 추가했어요' : '수정했어요');
      closeModal();
      selectDate(saved.date);
    };
  });
}

/* ---------- 이동·복사 ---------- */
function freshCopy(w, date) {
  const { id, created_at, updated_at, status, actual_distance, actual_time, avg_hr, max_hr, cadence, rpe, memo, shoe_id, images, source, ...rest } = w;
  return { ...rest, date, status: 'planned', images: [], source: 'manual' };
}
async function moveOrCopy(w, date, copy) {
  if (!date || date === w.date && !copy) return;
  if (copy) await guard(() => saveW(freshCopy(w, date)), `${korDate(date)}에 복사했어요`);
  else await guard(() => saveW({ ...w, date }), `${korDate(date)}로 옮겼어요`);
}
function openMoveModal(w) {
  openModal('훈련 이동·복사', `
    <form id="mv-form" class="form-grid">
      <div class="full"><b>${esc(w.title)}</b> <span class="muted">(${korDate(w.date)})</span></div>
      <label>새 날짜<input type="date" name="date" value="${w.date}" required></label>
      <label>방식<select name="mode"><option value="move">이동</option><option value="copy">복사 (계획만)</option></select></label>
      <div class="full muted" style="font-size:12px">PC에서는 캘린더의 훈련 칩을 다른 날짜로 끌어다 놓으면 이동, Ctrl(⌘)을 누른 채 놓으면 복사돼요.</div>
      <div class="full row gap"><button class="btn primary" type="submit">확인</button><button class="btn" type="button" id="mv-cancel">취소</button></div>
    </form>`, body => {
    $('#mv-cancel', body).onclick = closeModal;
    $('#mv-form', body).onsubmit = async e => {
      e.preventDefault(); const f = e.target;
      await moveOrCopy(w, f.date.value, f.mode.value === 'copy');
      closeModal(); selectDate(f.date.value);
    };
  });
}
async function copyLastWeek(mon) {
  const src = state.workouts.filter(w => w.date >= addDaysIso(mon, -7) && w.date < mon);
  const busy = new Set(state.workouts.filter(w => w.date >= mon && w.date <= addDaysIso(mon, 6)).map(w => w.date));
  const add = src.filter(w => !busy.has(addDaysIso(w.date, 7))).map(w => freshCopy(w, addDaysIso(w.date, 7)));
  if (!add.length) { toast('이번 주 해당 날짜에 이미 훈련이 있어요'); return; }
  if (!confirm(`지난주 훈련 ${add.length}개를 이번 주 같은 요일로 복사할까요? (이미 훈련이 있는 날은 건너뜀)`)) return;
  const rows = await guard(() => store.insertWorkouts(add), `${add.length}개를 복사했어요`);
  state.workouts.push(...rows); state.workouts.sort((a, b) => a.date.localeCompare(b.date));
  refresh();
}

/* ---------- 러닝화 ---------- */
function renderShoes() {
  const grid = $('#shoe-grid');
  if (!state.shoes.length) {
    grid.innerHTML = '<div class="card empty" style="grid-column:1/-1">등록된 러닝화가 없어요. 오른쪽 위 버튼으로 추가해 보세요.</div>';
    $('#shoe-history').innerHTML = ''; return;
  }
  const counts = { all: state.shoes.length, ok: 0, soon: 0, replace: 0, retired: 0 };
  state.shoes.forEach(s => { counts[shoeState(s).k]++; });
  const sf = state.shoeFilter || 'all';
  $('#shoe-chips').innerHTML = [['all', '전체'], ['active', '사용 중'], ['soon', '교체 임박'], ['replace', '교체 필요'], ['retired', '은퇴']]
    .map(([k, l]) => { const n = k === 'active' ? counts.ok + counts.soon + counts.replace : counts[k]; return n || k === 'all' ? `<button type="button" class="fchip ${sf === k ? 'on' : ''}" data-k="${k}">${l} <small>${n}</small></button>` : ''; }).join('');
  $('#shoe-chips .fchip').forEach(b => b.onclick = () => { state.shoeFilter = b.dataset.k; renderShoes(); });
  const sorted = [...state.shoes].sort((a, b) => Number(a.retired) - Number(b.retired))
    .filter(s => { const k = shoeState(s).k; return sf === 'all' || (sf === 'active' ? k !== 'retired' : k === sf); });
  if (!sorted.length) { grid.innerHTML = '<div class="card empty" style="grid-column:1/-1">조건에 맞는 러닝화가 없어요.</div>'; renderShoeHistory(); return; }
  grid.innerHTML = sorted.map(s => {
    const { total, runs } = shoeKm(s);
    const max = Number(s.max_km || 700);
    const pct = Math.min(100, total / max * 100);
    const last = runs.map(r => r.date).sort().pop();
    return `<div class="shoe ${s.retired ? 'retired' : ''} ${state.shoeFocus === s.id ? 'active-sel' : ''}" style="--c:${s.color || '#3b82f6'}" data-id="${s.id}">
      <div class="s-name">${esc(shoeName(s))} <span class="sbadge ${shoeState(s).cls}">${shoeState(s).label}</span>${s.purpose ? `<span class="tag">${esc(s.purpose)}</span>` : ''}</div>
      <div class="s-sub">${esc(s.brand)} ${esc(s.model)}${s.purchase_date ? ` · 첫 사용 ${s.purchase_date}` : ''}</div>
      <div class="s-km">${total.toFixed(1)}<small> / ${max} km</small></div>
      <div class="bar ${pct >= 100 ? 'over' : pct >= 80 ? 'warn' : ''}"><i style="width:${pct}%"></i></div>
      <div class="s-foot"><span>러닝 ${runs.length}회${Number(s.initial_km) ? ` · 등록 전 ${Number(s.initial_km)}km` : ''}</span><span>${last ? `최근 ${last.slice(5).replace('-', '/')}` : '기록 없음'}</span></div>
      ${pct >= 80 ? `<div class="s-foot" style="color:${pct >= 100 ? 'var(--miss)' : '#c2410c'}">${pct >= 100 ? '교체 권장 거리를 넘었어요' : '교체 시기가 다가와요'}</div>` : ''}
      <div class="s-actions">
        <button class="btn sm" data-act="edit">수정</button>
        <button class="btn sm" data-act="retire">${s.retired ? '다시 사용' : '은퇴'}</button>
        <button class="btn sm danger" data-act="del">삭제</button>
      </div>
    </div>`;
  }).join('');
  $$('.shoe', grid).forEach(el => {
    const s = state.shoes.find(x => x.id === el.dataset.id);
    el.addEventListener('click', e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'edit') return openShoeModal(s);
      if (act === 'retire') return guard(async () => { await saveS({ ...s, retired: !s.retired }); }, s.retired ? '다시 사용으로 변경' : '은퇴 처리했어요');
      if (act === 'del') {
        if (!confirm(`'${shoeName(s)}'를 삭제할까요? (훈련 기록의 러닝화 연결만 해제됩니다)`)) return;
        return guard(async () => {
          await store.deleteShoe(s.id);
          state.shoes = state.shoes.filter(x => x.id !== s.id);
          state.workouts.forEach(w => { if (w.shoe_id === s.id) w.shoe_id = null; });
          if (state.shoeFocus === s.id) state.shoeFocus = null;
          refresh();
        }, '삭제했어요');
      }
      state.shoeFocus = state.shoeFocus === s.id ? null : s.id;
      renderShoes();
    });
  });
  renderShoeHistory();
}
function renderShoeHistory() {
  const box = $('#shoe-history');
  const s = state.shoes.find(x => x.id === state.shoeFocus);
  if (!s) { box.innerHTML = '<p class="muted" style="font-size:13px">러닝화 카드를 누르면 해당 신발로 달린 기록을 볼 수 있어요.</p>'; return; }
  const { runs } = shoeKm(s);
  box.innerHTML = `<div class="card"><h2>${esc(shoeName(s))} 러닝 기록</h2>
    ${s.notes ? `<p class="muted">${esc(s.notes)}</p>` : ''}
    ${runs.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>날짜</th><th>훈련</th><th>거리</th><th>시간</th><th>페이스</th><th>메모</th></tr></thead><tbody>
    ${[...runs].sort((a, b) => b.date.localeCompare(a.date)).map(w => {
      const p = paceOf(w.actual_distance, w.actual_time);
      return `<tr><td>${w.date}</td><td>${esc(w.title)}</td><td>${Number(w.actual_distance || w.planned_distance || 0)}km</td><td>${esc(w.actual_time || '-')}</td><td>${p ? fmtPace(p) : '-'}</td><td style="white-space:normal;min-width:200px">${esc(w.memo || '')}</td></tr>`;
    }).join('')}</tbody></table></div>` : '<div class="empty">아직 이 러닝화로 완료한 훈련이 없어요</div>'}</div>`;
}
async function saveS(s) {
  const saved = await store.saveShoe(s);
  const i = state.shoes.findIndex(x => x.id === saved.id);
  if (i >= 0) state.shoes[i] = saved; else state.shoes.push(saved);
  refresh();
  return saved;
}
function openShoeModal(s = {}) {
  const isNew = !s.id;
  openModal(isNew ? '러닝화 추가' : '러닝화 수정', `
    <form id="s-form" class="form-grid">
      <label>브랜드<input name="brand" value="${esc(s.brand ?? '')}" placeholder="예: 나이키" required></label>
      <label>모델명<input name="model" value="${esc(s.model ?? '')}" placeholder="예: 페가수스 41" required></label>
      <label>별칭<input name="nickname" value="${esc(s.nickname ?? '')}" placeholder="예: 데일리 페가"></label>
      <label>용도<select name="purpose"><option value="">선택</option>${SHOE_PURPOSES.map(p => `<option ${p === s.purpose ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
      <label>색상<input type="color" name="color" value="${s.color || '#3b82f6'}" style="height:42px;padding:4px"></label>
      <label>첫 사용일<input type="date" name="purchase_date" value="${s.purchase_date ?? ''}"></label>
      <label>등록 전 누적 거리 (km)<input type="number" step="0.1" min="0" name="initial_km" value="${s.initial_km ?? 0}"></label>
      <label>교체 권장 거리 (km)<input type="number" step="1" min="1" name="max_km" value="${s.max_km ?? 700}"></label>
      <label class="full">메모<textarea name="notes" placeholder="사이즈, 착화감, 장단점 등">${esc(s.notes ?? '')}</textarea></label>
      <div class="full row gap"><button class="btn primary" type="submit">${isNew ? '추가' : '저장'}</button><button class="btn" type="button" id="s-cancel">취소</button></div>
    </form>`, body => {
    $('#s-cancel', body).onclick = closeModal;
    $('#s-form', body).onsubmit = async e => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target));
      await guard(() => saveS({ ...s, ...fd, retired: s.retired || false }), isNew ? '러닝화를 추가했어요' : '수정했어요');
      closeModal();
    };
  });
}

/* ---------- 일지 / 통계 ---------- */
function renderJournal() {
  const tab = state.statTab, range = state.statRange[tab];
  $$('#stat-tabs button').forEach(b => b.classList.toggle('on', b.dataset.k === tab));
  const isReport = tab === 'report';
  $('#view-journal').classList.toggle('report-mode', isReport);
  if (isReport) renderReport();
  else {
  $('#stat-range').innerHTML = Object.entries(RANGES).map(([k, v]) => `<option value="${k}" ${k === range ? 'selected' : ''}>${v}</option>`).join('');
  $('#view-journal .chart-row').classList.add('loading');
  renderStats($('#view-journal'), {
    workouts: state.workouts, logs: state.logs, races: state.races, tab, range, today: todayIso(),
    onPickDate: d => { switchView('calendar'); selectDate(d < todayIso() ? d : todayIso(), true); },
    onPickMonth: m => { state.reportMonth = m; state.statTab = 'report'; renderJournal(); window.scrollTo({ top: 0, behavior: 'smooth' }); },
  }).catch(e => { console.error(e); $('#stat-note').textContent = '그래프를 불러오지 못했어요: ' + e.message; })
    .finally(() => $('#view-journal .chart-row').classList.remove('loading'));
  }

  renderJournalList();
}
/* 러닝 일지: 필터 칩 + 검색 + 밀어서 메모 삭제 */
function renderJournalList() {
  const q = (state.journalQ || '').trim().toLowerCase(), jf = state.journalFilter || 'all';
  const all = state.workouts.filter(w => w.memo).sort((a, b) => b.date.localeCompare(a.date));
  const types = Object.keys(TYPES).filter(k => all.some(w => w.type === k));
  if (jf !== 'all' && !types.includes(jf)) state.journalFilter = 'all';
  $('#journal-chips').innerHTML = [['all', '전체', all.length], ...types.map(k => [k, TYPES[k].label, all.filter(w => w.type === k).length])]
    .map(([k, l, n]) => `<button type="button" class="fchip ${(state.journalFilter || 'all') === k ? 'on' : ''}" data-k="${k}">${esc(l)} <small>${n}</small></button>`).join('');
  $$('#journal-chips .fchip').forEach(b => b.onclick = () => { state.journalFilter = b.dataset.k; renderJournalList(); });
  const entries = all.filter(w => ((state.journalFilter || 'all') === 'all' || w.type === state.journalFilter) && (!q || `${w.title} ${w.memo}`.toLowerCase().includes(q)));
  $('#journal-list').innerHTML = entries.length ? entries.map(w => {
    const t = TYPES[w.type] || TYPES.easy; const sh = state.shoes.find(s => s.id === w.shoe_id);
    const p = paceOf(w.actual_distance, w.actual_time);
    return `<div class="entry" data-id="${w.id}" data-date="${w.date}"><div class="e-head"><b>${korDate(w.date)}</b><span class="badge" style="--c:${t.color}">${t.label}</span>${statusBadge(effStatus(w))}
      <span>${esc(w.title)}</span>${w.actual_distance ? `<span>${Number(w.actual_distance)}km</span>` : ''}${p ? `<span>${fmtPace(p)}/km</span>` : ''}${w.rpe ? `<span>RPE ${w.rpe}</span>` : ''}${sh ? `<span>러닝화: ${esc(shoeName(sh))}</span>` : ''}</div>
      <div class="e-memo">${esc(w.memo)}</div></div>`;
  }).join('') : `<div class="empty">${all.length ? '조건에 맞는 메모가 없어요.' : '아직 작성한 메모가 없어요. 캘린더에서 날짜를 눌러 느낀 점을 남겨보세요.'}</div>`;
  $$('#journal-list .entry').forEach(el => {
    el.onclick = () => { switchView('calendar'); selectDate(el.dataset.date, true); };
    const w = state.workouts.find(x => x.id === el.dataset.id);
    swipeToDelete(el, async () => {
      if (!confirm(`${korDate(w.date)} '${w.title}'의 메모를 삭제할까요? (훈련 기록은 남아요)`)) { renderJournalList(); return; }
      await guard(() => store.saveWorkout({ ...w, memo: null }).then(s => { const i = state.workouts.findIndex(x => x.id === s.id); state.workouts[i] = s; }), '메모를 삭제했어요');
      renderJournalList();
    }, { label: '메모 삭제' });
  });
}

/* ---------- 가민 내보내기(JSON) 가져오기 ---------- */
async function handleImportFiles(files) {
  const jsons = files.filter(f => /\.json$/i.test(f.name));
  const others = files.filter(f => !/\.json$/i.test(f.name));
  if (jsons.length) {
    const acts = [], errs = []; let gear = null;
    toast('가민 파일 읽는 중...');
    for (const f of jsons) {
      try {
        const j = JSON.parse(await f.text());
        if (isActivitiesExport(j)) acts.push(...parseActivities(j));
        else if (isGearExport(j)) gear = parseGear(j);
        else errs.push(`${f.name}: 가민 활동(summarizedActivities)·장비(gear) 파일이 아니에요`);
      } catch (e) { errs.push(`${f.name}: ${e.message}`); }
    }
    if (acts.length || gear) { openGarminImport(acts, gear, errs); return; }
    if (errs.length) toast(errs[0]);
  }
  if (others.length) openFileImport(others);
}

function planGarminImport(acts, gear, opts) {
  const seen = new Set();
  acts = acts.filter(a => !seen.has(a.garminId) && seen.add(a.garminId)).sort((x, y) => (x.date + x.start).localeCompare(y.date + y.start));
  const byGid = new Map(state.workouts.filter(w => w.garmin_id).map(w => [Number(w.garmin_id), w]));
  const used = new Set();
  const plan = { add: [], merge: [], complete: [], skip: [], cross: 0, races: [] };
  // 러닝화 매칭
  const gearShoe = new Map(), newShoes = [];
  if (gear) for (const g of gear.gears) {
    const s = matchShoe(g, state.shoes);
    if (s) gearShoe.set(g.pk, { shoe: s, gear: g });
    else { const ns = { id: crypto.randomUUID(), ...gearToShoe(g) }; newShoes.push(ns); gearShoe.set(g.pk, { shoe: ns, gear: g, isNew: true }); }
  }
  const shoeFor = a => { const pk = gear?.byActivity.get(a.garminId); return pk ? gearShoe.get(pk)?.shoe.id : null; };
  for (const a of acts) {
    if (a.kind === 'cross' && !opts.cross) continue;
    if (a.kind === 'cross') plan.cross++;
    if (byGid.has(a.garminId)) { plan.skip.push(a); continue; }
    const day = state.workouts.filter(w => w.date === a.date && !used.has(w.id));
    const tsec = Math.round(a.sec || 0);
    const same = a.kind === 'run' && day.find(w => w.status === 'done' && !w.garmin_id && (
      (w.actual_distance && a.distance && Math.abs(Number(w.actual_distance) - a.distance) <= Math.max(0.35, a.distance * 0.04)) ||
      (toSec(w.actual_time) && Math.abs(toSec(w.actual_time) - tsec) <= 2)));
    if (same) { used.add(same.id); plan.merge.push({ a, w: same }); continue; }
    const planned = a.kind === 'run' && day.filter(w => w.status !== 'done' && !['rest', 'cross', 'strength'].includes(w.type))
      .sort((x, y) => Math.abs((x.planned_distance || 0) - a.distance) - Math.abs((y.planned_distance || 0) - a.distance))[0];
    if (planned) { used.add(planned.id); plan.complete.push({ a, w: planned }); continue; }
    plan.add.push(a);
    if (a.type === 'race') plan.races.push(a);
  }
  plan.races = plan.races.filter(a => !state.races.some(r => r.date === a.date));
  return { ...plan, newShoes, gearShoe, shoeFor, total: acts.length };
}

function garminRow(a, how) {
  const t = TYPES[a.type] || TYPES.easy; const p = paceOf(a.distance, a.time);
  return `<tr><td>${a.date} ${a.start}</td><td><span class="badge" style="--c:${t.color}">${t.label}</span></td><td>${esc(a.title)}</td><td>${a.distance ? a.distance + 'km' : '-'}</td><td>${esc(a.time || '-')}</td><td>${p ? fmtPace(p) : '-'}</td><td>${a.avgHr || '-'}</td><td>${how}</td></tr>`;
}

function openGarminImport(acts, gear, errs = []) {
  acts = [...acts].sort((x, y) => (x.date + x.start).localeCompare(y.date + y.start));
  const opts = { cross: true, recalc: true, races: true };
  const render = () => {
    const P = planGarminImport(acts, gear, opts);
    const runs = acts.filter(a => a.kind === 'run');
    const first = acts[0]?.date, last = acts[acts.length - 1]?.date;
    const runKm = runs.reduce((s, a) => s + (a.distance || 0), 0);
    const shoeRows = gear ? [...P.gearShoe.values()].map(({ shoe, gear: g, isNew }) => {
      const km = [...gear.byActivity].filter(([aid, pk]) => pk === g.pk && acts.some(x => x.garminId === aid)).reduce((s, [aid]) => s + (acts.find(x => x.garminId === aid)?.distance || 0), 0);
      return `<tr><td><b>${esc(g.nickname || g.makeModel)}</b> <span class="muted">${esc(g.makeModel)}</span></td><td>${g.retired ? '은퇴' : '사용 중'}</td><td>${isNew ? '<span class="tag">새로 추가</span>' : `기존: ${esc(shoeName(shoe))}`}</td><td>${km.toFixed(1)}km</td></tr>`;
    }).join('') : '';
    $('#modal-body').innerHTML = `
      ${errs.map(e => `<div class="alert warn">${esc(e)}</div>`).join('')}
      ${acts.length ? `<div class="alert today">가민 활동 ${acts.length}개 · ${first} ~ ${last} · 러닝 ${runs.length}회 ${runKm.toFixed(0)}km</div>` : ''}
      <div class="stats-row" style="margin:10px 0">
        <div class="stat"><div class="k">새로 추가</div><div class="v">${P.add.length}<small> 개</small></div></div>
        <div class="stat"><div class="k">기존 기록 보강</div><div class="v">${P.merge.length}<small> 개</small></div></div>
        <div class="stat"><div class="k">계획 → 완료 처리</div><div class="v">${P.complete.length}<small> 개</small></div></div>
        <div class="stat"><div class="k">이미 가져옴</div><div class="v">${P.skip.length}<small> 개</small></div></div>
      </div>
      <p class="muted" style="font-size:13px">같은 날 거리·시간이 같은 기존 기록은 새로 만들지 않고 가민 데이터(심박·케이던스·훈련 효과 등)로 보강해요. 메모·이미지·직접 정한 훈련 종류는 그대로 둬요. 다시 가져와도 가민 활동 ID로 중복을 막아요.</p>
      <label class="ck"><input type="checkbox" id="gi-cross" ${opts.cross ? 'checked' : ''}><span>크로스트레이닝(사이클·수영·로잉 등) ${acts.filter(a => a.kind === 'cross').length}개도 가져오기 (러닝 거리 통계에서는 제외)</span></label>
      ${gear ? `<label class="ck"><input type="checkbox" id="gi-recalc" ${opts.recalc ? 'checked' : ''}><span>러닝화 누적 거리를 가민 활동 기준으로 다시 계산 (등록 전 거리 0으로, 활동마다 신발 연결)</span></label>` : '<p class="muted" style="font-size:12px">gear.json 파일도 함께 선택하면 활동별 러닝화가 자동으로 연결돼요.</p>'}
      ${P.races.length ? `<label class="ck"><input type="checkbox" id="gi-races" ${opts.races ? 'checked' : ''}><span>지난 대회 ${P.races.length}개를 결과 기록과 함께 대회 목록에 추가 (${P.races.map(a => `${esc(a.title)} ${a.time}`).join(', ')})</span></label>` : ''}
      ${gear ? `<h3 style="margin-top:14px;font-size:15px">러닝화 연결</h3><div class="table-wrap"><table class="table"><thead><tr><th>가민 장비</th><th>상태</th><th>앱 러닝화</th><th>가져올 활동 거리</th></tr></thead><tbody>${shoeRows}</tbody></table></div>` : ''}
      <details style="margin-top:12px"><summary class="muted" style="cursor:pointer;font-size:13px">가져올 기록 보기 (최근 순)</summary>
        <div class="table-wrap" style="max-height:340px;overflow:auto"><table class="table"><thead><tr><th>날짜</th><th>종류</th><th>제목</th><th>거리</th><th>시간</th><th>페이스</th><th>심박</th><th>처리</th></tr></thead><tbody>
        ${[...P.add.map(a => [a, '새 기록']), ...P.merge.map(({ a, w }) => [a, `보강: ${esc(w.title)}`]), ...P.complete.map(({ a, w }) => [a, `완료: ${esc(w.title)}`])]
          .sort((x, y) => (y[0].date + y[0].start).localeCompare(x[0].date + x[0].start)).slice(0, 300).map(([a, h]) => garminRow(a, h)).join('')}
        </tbody></table></div></details>
      <div class="row gap" style="margin-top:14px"><button class="btn primary" id="gi-go" ${P.add.length + P.merge.length + P.complete.length + P.newShoes.length ? '' : 'disabled'}>가져오기</button><button class="btn" id="gi-cancel">취소</button><span class="msg" id="gi-msg"></span></div>`;
    $('#gi-cross')?.addEventListener('change', e => { opts.cross = e.target.checked; render(); });
    $('#gi-recalc')?.addEventListener('change', e => { opts.recalc = e.target.checked; });
    $('#gi-races')?.addEventListener('change', e => { opts.races = e.target.checked; });
    $('#gi-cancel').onclick = closeModal;
    $('#gi-go').onclick = () => runGarminImport(P, opts);
  };
  openModal('가민 데이터 가져오기', '', render, true);
}

async function runGarminImport(P, opts) {
  const btn = $('#gi-go'), msg = $('#gi-msg');
  btn.disabled = true;
  const step = t => { msg.textContent = t; };
  try {
    // 1) 러닝화
    if (opts.recalc || P.newShoes.length) {
      step('러닝화 정리 중...');
      for (const s of P.newShoes) { const saved = await store.saveShoe(s); state.shoes.push(saved); }
      if (opts.recalc) for (const { shoe, isNew, gear: g } of P.gearShoe.values()) if (!isNew) {
        const saved = await store.saveShoe({ ...shoe, initial_km: 0, purchase_date: shoe.purchase_date || g.begin, max_km: shoe.max_km || g.maxKm, retired: g.retired || shoe.retired });
        const i = state.shoes.findIndex(x => x.id === saved.id); state.shoes[i] = saved;
      }
    }
    const shoeOf = a => opts.recalc || !P.shoeFor ? P.shoeFor(a) : null;
    // 2) 지난 대회
    const raceIdByDate = {};
    if (opts.races) for (const a of P.races) {
      const d = a.distance >= 40 ? 42.195 : a.distance >= 20 ? 21.0975 : a.distance >= 9.5 && a.distance <= 10.6 ? 10 : a.distance;
      const r = await store.saveRace({ name: a.title.replace(/\s*(풀코스|\(.*\))\s*$/, '').trim(), date: a.date, distance_km: d, result_time: a.time, goal_time: null,
        priority: d > 40 ? 'A' : d > 20 ? 'B' : 'C', notes: '가민 기록에서 가져온 지난 대회' });
      state.races.push(r); raceIdByDate[a.date] = r.id;
    }
    // 3) 새 기록 (묶음 저장)
    const rows = P.add.map(a => ({
      date: a.date, type: a.type, title: a.title, planned_distance: a.distance, status: 'done', actual_distance: a.distance, actual_time: a.time,
      avg_hr: a.avgHr, max_hr: a.maxHr, cadence: a.cadence, details: a.details, source: 'garmin', garmin_id: a.garminId,
      shoe_id: a.kind === 'run' ? shoeOf(a) : null, race_id: raceIdByDate[a.date] || (a.type === 'race' ? state.races.find(r => r.date === a.date)?.id : null) || null, images: [],
    }));
    for (let i = 0; i < rows.length; i += 150) {
      step(`새 기록 저장 중... ${Math.min(rows.length, i + 150)}/${rows.length}`);
      const saved = await store.insertWorkouts(rows.slice(i, i + 150));
      state.workouts.push(...saved);
    }
    // 4) 기존 기록 보강·계획 완료
    const upd = [...P.merge.map(x => ({ ...x, merge: true })), ...P.complete];
    let k = 0;
    for (const { a, w, merge } of upd) {
      step(`기존 기록 업데이트 중... ${++k}/${upd.length}`);
      const keepDetails = (w.details || '').replace(/\n*\[(가민|GPX|FIT|CSV) 기록\][\s\S]*$/, '').trim();
      const saved = await store.saveWorkout({ ...w, status: 'done', actual_distance: a.distance, actual_time: a.time, avg_hr: a.avgHr, max_hr: a.maxHr, cadence: a.cadence,
        garmin_id: a.garminId, source: w.images?.length ? w.source : 'garmin', shoe_id: shoeOf(a) || w.shoe_id || null,
        details: keepDetails ? `${keepDetails}\n\n${a.details}` : a.details,
        ...(merge ? {} : {}) });
      const i = state.workouts.findIndex(x => x.id === saved.id); state.workouts[i] = saved;
    }
    state.workouts.sort((x, y) => x.date.localeCompare(y.date));
    closeModal();
    toast(`가민 기록 ${rows.length + upd.length}개를 반영했어요`);
    refresh();
  } catch (e) {
    console.error(e); msg.className = 'msg err'; msg.textContent = '오류: ' + (e.message || e); btn.disabled = false;
  }
}

/* ---------- 월간 리포트 (공유용) ---------- */
function reportPrefs() { return state.profile.report_prefs || {}; }
let prefTimer = null;
function saveReportPrefs(patch) {
  const p = { ...reportPrefs(), ...patch };
  state.profile = { ...state.profile, report_prefs: p };
  clearTimeout(prefTimer);
  prefTimer = setTimeout(() => store.saveProfile({ report_prefs: p }).catch(e => console.warn(e)), 600);
}
function monthPref(m) { return reportPrefs().months?.[m] || {}; }
function setMonthPref(m, patch) { const months = { ...(reportPrefs().months || {}) }; months[m] = { ...(months[m] || {}), ...patch }; saveReportPrefs({ months }); }
function currentReport() {
  const m = state.reportMonth;
  const mp = monthPref(m);
  const d = buildMonthReport(m, { workouts: state.workouts, races: state.races, logs: state.logs, shoes: state.shoes, name: reportPrefs().name || '', note: mp.note || '', today: todayIso() });
  const hidden = new Set(mp.hide || []);
  d.allHighlights = d.highlights;
  d.highlights = d.highlights.filter(h => !hidden.has(h.replace(/[\d.,:+%-]+/g, '#')));
  return d;
}
const hlKey = h => h.replace(/[\d.,:+%-]+/g, '#'); // 숫자가 바뀌어도 같은 항목으로 인식

function renderReport() {
  const box = $('#report-view');
  state.reportMonth ||= todayIso().slice(0, 7);
  const m = state.reportMonth;
  const d = currentReport();
  const mp = monthPref(m);
  const hidden = new Set(mp.hide || []);
  box.innerHTML = `
    <div class="rp-bar">
      <button class="icon-btn" id="rp-prev" aria-label="이전 달">‹</button>
      <b class="rp-month">${esc(d.label)}</b>
      <button class="icon-btn" id="rp-next" aria-label="다음 달" ${m >= todayIso().slice(0, 7) ? 'disabled' : ''}>›</button>
      <label class="rp-name">표시 이름<input id="rp-name" value="${esc(reportPrefs().name || '')}" placeholder="예: 네오" maxlength="20"></label>
    </div>
    <div class="rp-layout">
      <div class="rp-preview"><div class="rp-scale">${reportCardHTML(d)}</div></div>
      <div class="rp-side">
        <div class="rp-actions">
          <button class="btn primary sheet-only" id="rp-sheet">공유하기</button>
          <button class="btn primary" id="rp-img">이미지 저장</button>
          <button class="btn" id="rp-share-img">이미지 공유</button>
          <button class="btn" id="rp-link">공유 링크 만들기</button>
          <button class="btn" id="rp-text">텍스트 복사</button>
        </div>
        <div id="rp-link-box" class="rp-link-box"></div>
        <h3>특이사항 <span class="muted" style="font-size:12px;font-weight:500">체크한 항목 중 위에서부터 카드에 들어가는 만큼 보여요 (공간이 부족하면 덜 중요한 항목을 해제하세요)</span></h3>
        ${d.allHighlights.length ? d.allHighlights.map(h => `<label class="ck"><input type="checkbox" class="rp-hl" data-k="${esc(hlKey(h))}" ${hidden.has(hlKey(h)) ? '' : 'checked'}><span>${esc(h)}</span></label>`).join('') : '<p class="muted">이 달에는 자동 특이사항이 없어요.</p>'}
        <label style="margin-top:10px">직접 쓰는 특이사항·한 줄 소감<textarea id="rp-note" rows="4" maxlength="300" placeholder="예: JTBC 서울마라톤 앞두고 테이퍼링 시작. 발목 통증 관리하며 마무리!">${esc(mp.note || '')}</textarea></label>
        <p class="muted" style="font-size:12px">이미지는 인스타그램 4:5 비율(1080×1350)로 저장돼요. 공유 링크는 로그인 없이 볼 수 있는 이 달의 요약 페이지예요 (메모·이미지·위치 같은 상세 기록은 포함되지 않아요).</p>
      </div>
    </div>`;
  const rerender = () => { const sc = box.querySelector('.rp-scale'); sc.innerHTML = reportCardHTML(currentReport()); };
  $('#rp-prev').onclick = () => { state.reportMonth = addMonths(m, -1); renderReport(); };
  $('#rp-next').onclick = () => { state.reportMonth = addMonths(m, 1); renderReport(); };
  $('#rp-name').oninput = e => { saveReportPrefs({ name: e.target.value.trim() }); rerender(); };
  $('#rp-note').oninput = e => { setMonthPref(m, { note: e.target.value }); rerender(); };
  $$('.rp-hl', box).forEach(cb => cb.onchange = () => {
    const hide = $$('.rp-hl', box).filter(c => !c.checked).map(c => c.dataset.k);
    setMonthPref(m, { hide }); rerender();
  });
  const fileName = () => `running-report-${m}.png`;
  $('#rp-sheet').onclick = () => actionSheet(`${d.label} 리포트 공유`, [
    { icon: '📤', label: '이미지로 공유', sub: '카카오톡·인스타그램 등', onClick: () => $('#rp-share-img').click() },
    { icon: '🔗', label: $('#rp-link-box').dataset.url ? '공유 링크 업데이트' : '공유 링크 만들기', sub: '로그인 없이 볼 수 있는 페이지', onClick: () => $('#rp-link').click() },
    { icon: '📝', label: '텍스트 복사', sub: '캡션·블로그용 요약', onClick: () => $('#rp-text').click() },
    { icon: '💾', label: '이미지 저장', onClick: () => $('#rp-img').click() },
  ]);
  $('#rp-img').onclick = async () => {
    await guard(async () => {
      const blob = await cardToBlob($('#report-card'));
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fileName(); a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, '이미지를 저장했어요');
  };
  $('#rp-share-img').onclick = async () => {
    try {
      const blob = await cardToBlob($('#report-card'));
      const file = new File([blob], fileName(), { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: `${d.label} 러닝 리포트`, text: reportText(currentReport()) });
      else { toast('이 브라우저는 이미지 공유를 지원하지 않아 저장으로 대신할게요'); $('#rp-img').click(); }
    } catch (e) { if (e.name !== 'AbortError') toast('공유 실패: ' + e.message); }
  };
  $('#rp-text').onclick = async () => {
    const url = $('#rp-link-box').dataset.url;
    try { await navigator.clipboard.writeText(reportText(currentReport(), { url })); toast('리포트 텍스트를 복사했어요'); }
    catch { toast('복사하지 못했어요'); }
  };
  const showLink = (id, at) => {
    const url = `${location.origin}/share.html?id=${id}`;
    const lb = $('#rp-link-box'); lb.dataset.url = url;
    lb.innerHTML = `<div class="alert today"><div style="word-break:break-all"><a href="${url}" target="_blank" rel="noopener">${url}</a></div>
      <div class="row gap wrap" style="margin-top:8px"><button class="btn sm" id="rp-copy-link">링크 복사</button>${navigator.share ? '<button class="btn sm" id="rp-share-link">링크 공유</button>' : ''}<button class="btn sm danger" id="rp-unshare">공유 중지</button>
      <span class="muted" style="font-size:12px">${at ? `마지막 업데이트 ${new Date(at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}</span></div></div>`;
    $('#rp-link').textContent = '공유 링크 업데이트';
    $('#rp-copy-link').onclick = async () => { try { await navigator.clipboard.writeText(url); toast('링크를 복사했어요'); } catch { toast(url); } };
    $('#rp-share-link')?.addEventListener('click', () => navigator.share({ title: `${d.label} 러닝 리포트`, url }).catch(() => {}));
    $('#rp-unshare').onclick = async () => {
      if (!confirm('공유를 중지할까요? 이 링크로는 더 이상 볼 수 없어요.')) return;
      await guard(() => store.unshareReport(m), '공유를 중지했어요'); renderReport();
    };
  };
  $('#rp-link').onclick = async () => {
    const data = currentReport(); delete data.allHighlights;
    const id = await guard(() => store.shareReport(m, data), '공유 링크를 만들었어요');
    showLink(id, new Date().toISOString());
  };
  store.getMySharedReport(m).then(r => { if (r && state.reportMonth === m) showLink(r.id, r.updated_at); }).catch(() => {});
}

/* ---------- 설정 ---------- */
function racePlanStats(r) {
  const ws = state.workouts.filter(w => w.race_id === r.id && w.type !== 'rest' && w.type !== 'race');
  return { n: ws.length, done: ws.filter(w => w.status === 'done').length, km: ws.reduce((s, w) => s + Number(w.planned_distance || 0), 0) };
}
function renderRaces() {
  const today = todayIso();
  const list = [...state.races].sort((a, b) => {
    const pa = a.date < today, pb = b.date < today;
    if (pa !== pb) return pa ? 1 : -1;
    return pa ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date);
  });
  $('#race-list').innerHTML = list.length ? list.map(r => {
    const d = diffDays(r.date, today); const ps = racePlanStats(r);
    return `<div class="race-item ${d < 0 ? 'past' : ''} pri-${esc(r.priority || 'A')}" data-id="${r.id}">
      <div class="race-d">${d > 0 ? `D-${d}` : d === 0 ? 'D-DAY' : '지남'}</div>
      <div class="race-info">
        <div class="race-name">${esc(r.name)} ${d > 0 ? '<span class="sbadge plan">준비 중</span>' : d === 0 ? '<span class="sbadge warn">오늘 대회</span>' : r.result_time ? '<span class="sbadge done">완주</span>' : '<span class="sbadge miss">결과 미입력</span>'}${r.priority ? `<span class="tag">${PRIORITY[r.priority] || ''}</span>` : ''}${r.result_time ? `<span class="tag pb">결과 ${esc(r.result_time)}</span>` : ''}</div>
        <div class="race-sub">${r.date.replaceAll('-', '.')} (${WD[parse(r.date).getDay()]}) · ${esc(raceSummary(r))}${r.location ? ` · ${esc(r.location)}` : ''}</div>
        <div class="race-sub">훈련 계획 ${ps.n}개 (완료 ${ps.done}) · 계획 거리 ${ps.km.toFixed(0)}km</div>
        ${d < 0 && !r.result_time ? '<div class="race-sub" style="color:#c2410c">대회가 끝났어요. 결과 기록을 입력해 주세요.</div>' : ''}
      </div>
      <div class="race-act">
        ${d >= 0 ? '<button class="btn sm primary" data-act="plan">계획 만들기</button><button class="btn sm" data-act="strategy">전략</button>' : '<button class="btn sm primary" data-act="result">결과 입력</button>'}
        <button class="btn sm" data-act="edit">수정</button>
        ${ps.n - ps.done > 0 ? '<button class="btn sm" data-act="clear">예정 계획 삭제</button>' : ''}
        <button class="btn sm danger" data-act="del">삭제</button>
      </div>
    </div>`;
  }).join('') : '<div class="empty">등록된 대회가 없어요. 오른쪽 위 버튼으로 추가하세요.</div>';
  $$('#race-list .race-item').forEach(el => {
    const r = state.races.find(x => x.id === el.dataset.id);
    const on = (a, fn) => { const b = $(`[data-act=${a}]`, el); if (b) b.onclick = fn; };
    on('edit', () => openRaceModal(r)); on('del', () => removeRace(r));
    on('plan', () => openPlanModal(r)); on('strategy', () => { state.strategyRace = r.id; switchView('strategy'); });
    on('result', () => openRaceModal(r, true)); on('clear', () => clearRacePlan(r));
    swipeToDelete(el, async () => { await removeRace(r); if (state.races.includes(r)) renderRaces(); });
  });
  const up = upcomingRaces();
  const sel = $('#plan-race'); const prev = sel.value;
  sel.innerHTML = up.length ? up.map(r => `<option value="${r.id}">${esc(r.name)} (${r.date})</option>`).join('') : '<option value="">예정된 대회 없음</option>';
  if (up.some(r => r.id === prev)) sel.value = prev;
}

function raceWorkout(date) { return state.workouts.find(w => w.type === 'race' && w.date === date); }

function openRaceModal(r = {}, resultMode = false) {
  const isNew = !r.id;
  const dist = r.distance_km ?? 42.195;
  const preset = RACE_DISTANCES.find(x => Math.abs(x.km - Number(dist)) < 0.01);
  openModal(isNew ? '대회 추가' : resultMode ? '대회 결과 입력' : '대회 수정', `
    <form id="r-form" class="form-grid">
      <label class="full">대회명<input name="name" value="${esc(r.name ?? '')}" placeholder="예: 인천마라톤" required></label>
      <label>대회 날짜<input type="date" name="date" value="${r.date ?? ''}" required></label>
      <label>종목<select name="dist_sel">${RACE_DISTANCES.map(x => `<option value="${x.km}" ${preset?.km === x.km ? 'selected' : ''}>${x.label}</option>`).join('')}<option value="custom" ${preset ? '' : 'selected'}>기타 (직접 입력)</option></select></label>
      <label class="${preset ? 'hidden' : ''}" id="r-custom">거리 (km)<input type="number" step="0.001" min="0" name="custom_km" value="${preset ? '' : dist}"></label>
      <label>목표 기록 (h:mm:ss)<input name="goal_time" value="${esc(r.goal_time ?? '')}" placeholder="3:30:00"></label>
      <label>우선순위<select name="priority">${Object.entries(PRIORITY).map(([k, v]) => `<option value="${k}" ${(r.priority || 'A') === k ? 'selected' : ''}>${k} · ${v}</option>`).join('')}</select></label>
      <label>장소<input name="location" value="${esc(r.location ?? '')}" placeholder="예: 광화문"></label>
      <label>결과 기록 (완주 후)<input name="result_time" value="${esc(r.result_time ?? '')}" placeholder="3:28:45" ${resultMode ? 'autofocus' : ''}></label>
      <div class="full pace-out" id="r-pace"></div>
      <label class="full">메모<textarea name="notes" placeholder="배번, 출발 시간, 전략 등">${esc(r.notes ?? '')}</textarea></label>
      ${isNew ? '<label class="full" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" name="add_cal" checked style="width:auto"> 캘린더에 대회 일정도 추가</label>' : ''}
      <div class="full row gap"><button class="btn primary" type="submit">${isNew ? '추가' : '저장'}</button><button class="btn" type="button" id="r-cancel">취소</button></div>
    </form>`, body => {
    const f = $('#r-form', body);
    const KNOWN = ['JTBC 서울마라톤', '서울마라톤 (동아마라톤)', '춘천마라톤', '경주국제마라톤', '대구마라톤', '인천마라톤', '고구려마라톤', '서울레이스', '손기정평화마라톤', '경기수원국제하프마라톤', '공주백제마라톤', '군산새만금마라톤', '부산바다마라톤', '상주곶감마라톤', '진주남강마라톤', '여수마라톤', '김포한강마라톤', '서울신문하프마라톤', '국민마라톤'];
    autocomplete(f.name, q => {
      const past = [...state.races].reverse().map(x => ({ label: x.name, sub: `${x.date} · ${distLabel(x.distance_km)}${x.result_time ? ` · 기록 ${x.result_time}` : ''}`, r: x }));
      const seen = new Set(past.map(x => x.label));
      const all = [...past, ...KNOWN.filter(n => !seen.has(n)).map(n => ({ label: n, sub: '자주 쓰는 대회' }))];
      const ql = q.toLowerCase().replace(/\s/g, '');
      return all.filter(x => !ql || x.label.toLowerCase().replace(/\s/g, '').includes(ql));
    }, it => { if (it.r) { const k = String(it.r.distance_km); const o = [...f.dist_sel.options].find(op => Math.abs(Number(op.value) - Number(k)) < 0.01); if (o) f.dist_sel.value = o.value; if (it.r.location && !f.location.value) f.location.value = it.r.location; f.dist_sel.onchange?.(); } });
    const km = () => f.dist_sel.value === 'custom' ? Number(f.custom_km.value) : Number(f.dist_sel.value);
    const upd = () => {
      $('#r-custom', body).classList.toggle('hidden', f.dist_sel.value !== 'custom');
      const p = racePace(f.goal_time.value, km());
      const pz = toSec(f.goal_time.value) ? paceZones({ distance_km: km(), goal_time: f.goal_time.value }) : null;
      $('#r-pace', body).innerHTML = p ? `목표 평균 페이스 <b>${p}/km</b>${pz ? ` · 훈련 존: 이지 ${pz.easy.pace} · 마라톤 ${pz.mp.pace} · 템포 ${pz.tempo.pace} · 인터벌 ${pz.interval.pace} (VDOT ${pz.vdot.toFixed(1)})` : ''}` : '';
    };
    f.dist_sel.onchange = upd; f.goal_time.oninput = upd; f.custom_km.oninput = upd; upd();
    $('#r-cancel', body).onclick = closeModal;
    f.onsubmit = async e => {
      e.preventDefault();
      const goal = f.goal_time.value.trim(), result = f.result_time.value.trim();
      if (goal && !toSec(goal)) { toast('목표 기록 형식: 3:30:00'); return; }
      if (result && !toSec(result)) { toast('결과 기록 형식: 3:28:45'); return; }
      if (!km()) { toast('거리를 입력하세요'); return; }
      const data = { ...r, name: f.name.value.trim(), date: f.date.value, distance_km: km(), goal_time: goal, result_time: result || null,
        priority: f.priority.value, location: f.location.value.trim(), notes: f.notes.value.trim() };
      const old = isNew ? null : { ...r };
      const saved = await guard(() => store.saveRace(data), isNew ? '대회를 추가했어요' : '저장했어요');
      const i = state.races.findIndex(x => x.id === saved.id);
      if (i >= 0) state.races[i] = saved; else state.races.push(saved);
      const pace = racePace(saved.goal_time, saved.distance_km);
      const rw = old ? raceWorkout(old.date) : null;
      if (rw) {
        const patch = { ...rw, date: saved.date, title: saved.name, planned_distance: saved.distance_km, target_pace: pace || rw.target_pace, race_id: saved.id };
        if (saved.result_time) Object.assign(patch, { status: 'done', actual_time: saved.result_time, actual_distance: rw.actual_distance || saved.distance_km });
        await saveW(patch);
      } else if (isNew && f.add_cal?.checked && !raceWorkout(saved.date)) {
        await saveW({ date: saved.date, type: 'race', title: saved.name, planned_distance: saved.distance_km, target_pace: pace, race_id: saved.id, planned_duration: saved.goal_time || null,
          details: `대회: ${saved.name} (${distLabel(saved.distance_km)})${saved.goal_time ? `\n목표 기록: ${saved.goal_time}${pace ? ` (평균 ${pace}/km)` : ''}` : ''}${saved.location ? `\n장소: ${saved.location}` : ''}`, status: 'planned', source: 'manual' });
      }
      closeModal();
      refresh();
    };
  });
}

async function removeRace(r) {
  if (!confirm(`'${r.name}' 대회를 삭제할까요?`)) return;
  await guard(() => store.deleteRace(r.id), '대회를 삭제했어요');
  state.races = state.races.filter(x => x.id !== r.id);
  const rw = raceWorkout(r.date);
  if (rw && confirm('캘린더에 있는 이 대회 일정도 삭제할까요?')) {
    await store.deleteWorkout(rw.id);
    state.workouts = state.workouts.filter(x => x.id !== rw.id);
  }
  state.workouts.forEach(w => { if (w.race_id === r.id) w.race_id = null; });
  refresh();
}
async function clearRacePlan(r) {
  const del = state.workouts.filter(w => w.race_id === r.id && w.status !== 'done' && w.type !== 'race');
  if (!del.length || !confirm(`${r.name}의 예정(미완료) 훈련 ${del.length}개를 삭제할까요? 완료한 기록은 남아요.`)) return;
  await guard(async () => { for (const w of del) await store.deleteWorkout(w.id); }, `${del.length}개를 삭제했어요`);
  const ids = new Set(del.map(w => w.id));
  state.workouts = state.workouts.filter(w => !ids.has(w.id));
  refresh();
}

/* ---------- 전체 훈련 계획 만들기 ---------- */
function recentWeeklyKm() {
  const rows = weeklyLoad(state.workouts, todayIso(), 4, 0).rows.filter(r => r.kind === 'past' && r.km > 0);
  return rows.length ? Math.round(rows.reduce((s, r) => s + r.km, 0) / rows.length / 5) * 5 : 40;
}
function defaultPeak(r) {
  const g = toSec(r.goal_time), d = Number(r.distance_km) || 42.195;
  if (d < 15) return 45; if (d < 30) return 55;
  if (!g) return 65; if (g <= 3 * 3600) return 90; if (g <= 3.5 * 3600) return 75; if (g <= 4 * 3600) return 65; return 55;
}
function openPlanModal(r) {
  if (!r) { toast('먼저 대회를 추가하세요'); return; }
  const today = todayIso();
  const weeksLeft = Math.max(1, Math.round((parse(mondayOf(r.date)) - parse(mondayOf(today))) / 604800000) + 1);
  const prev = state.races.filter(x => x.id !== r.id && x.date < r.date && x.date >= addDaysIso(today, -14)).sort((a, b) => b.date.localeCompare(a.date))[0];
  const defStart = prev && prev.date >= today ? addDaysIso(prev.date, 1) : addDaysIso(today, 1);
  const sk = recentWeeklyKm();
  openModal(`${r.name} 훈련 계획 만들기`, `
    <form id="pl-form" class="form-grid">
      <div class="full" id="pl-steps">${stepperHTML(['기간·거리', '훈련 요일', '미리보기·적용'], 0)}</div>
      <div class="full muted" style="font-size:13px">${r.date} · ${esc(raceSummary(r))} · 대회까지 ${weeksLeft}주 (대회 주 포함)</div>
      <div class="full form-grid pl-step" data-s="0">
        <label>전체 계획 기간<select name="weeks">${[12, 13, 14, 15, 16].map(n => `<option value="${n}" ${n === 16 ? 'selected' : ''}>${n}주</option>`).join('')}</select></label>
        <label>시작일<input type="date" name="start" value="${defStart}"></label>
        <label>현재 주간 거리 (km)<input type="number" name="startKm" min="10" max="200" value="${sk}"></label>
        <label>피크 주간 거리 (km)<input type="number" name="peakKm" min="15" max="250" value="${Math.max(sk, defaultPeak(r))}"></label>
        <p class="full muted" style="font-size:12px;margin:0">현재 주간 거리는 최근 4주 평균(${sk}km)으로 채웠어요.</p>
      </div>
      <div class="full form-grid pl-step hidden" data-s="1">
        <div class="full"><div class="muted" style="font-size:13px;font-weight:600;margin-bottom:4px">훈련 요일</div>
          <div class="chips">${[1, 2, 3, 4, 5, 6, 0].map(d => `<label class="pchip"><input type="checkbox" name="days" value="${d}" ${[2, 3, 4, 6, 0].includes(d) ? 'checked' : ''}><span>${DAY_NAMES[d]}</span></label>`).join('')}</div></div>
        <label>장거리 요일<select name="longDay">${[0, 6, 5, 3].map(d => `<option value="${d}">${DAY_NAMES[d]}요일</option>`).join('')}</select></label>
        <label>기존 예정 훈련<select name="mode"><option value="fill">빈 날짜만 채우기</option><option value="replace">이 기간 예정 훈련을 새 계획으로 교체</option></select></label>
        ${prev ? `<label class="full" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" name="recover" checked style="width:auto"> 직전 대회(${esc(prev.name)} ${prev.date}) 후 10일 회복 기간 반영</label>` : ''}
      </div>
      <div class="full pl-step hidden" data-s="2"><div id="pl-out"></div></div>
      <div class="full row gap wrap pl-nav"><button class="btn" type="button" id="pl-back">이전</button><button class="btn primary" type="button" id="pl-next">다음</button><button class="btn primary hidden" type="submit" id="pl-apply">캘린더에 넣기</button><button class="btn" type="button" id="pl-cancel">취소</button></div>
    </form>`, body => {
    const f = $('#pl-form', body);
    const build = () => {
      const runDays = $$('input[name=days]:checked', f).map(i => Number(i.value));
      if (runDays.length < 3) { toast('훈련 요일을 3일 이상 선택하세요'); return null; }
      const longDay = Number(f.longDay.value);
      if (!runDays.includes(longDay)) runDays.push(longDay);
      return generatePlan({ race: r, weeks: Number(f.weeks.value), startDate: f.start.value || today, startKm: Number(f.startKm.value) || 40, peakKm: Number(f.peakKm.value) || 60,
        runDays, longDay, settings: state.profile, restHr: latestRestingHr(), recoverFrom: f.recover?.checked ? prev.date : null });
    };
    const show = () => {
      const res = build(); if (!res) return null;
      const inc = res.weeks.filter(w => w.included);
      const rows = inc.map((w, k) => {
        const sum = w.items.reduce((s, x) => s + (x.type === 'race' ? 0 : Number(x.planned_distance || 0)), 0);
        const prevSum = k ? inc[k - 1].items.reduce((s, x) => s + (x.type === 'race' ? 0 : Number(x.planned_distance || 0)), 0) : null;
        const ch = prevSum ? Math.round((sum - prevSum) / prevSum * 100) : null;
        const longR = w.items.find(x => x.type === 'long') || w.items.find(x => x.type === 'race');
        const key = w.items.filter(x => ['interval', 'tempo', 'mp', 'hill'].includes(x.type)).map(x => x.title).join(', ');
        return `<tr><td>${w.idx}주</td><td>${w.mon.slice(5).replace('-', '/')}~</td><td><span class="badge" style="--c:${PHASES[w.phase].color}">${PHASES[w.phase].label} ${w.pw}</span>${w.isRec ? ' <span class="tag">회복주</span>' : ''}</td><td><b>${sum.toFixed(1)}km</b></td><td>${ch == null ? '-' : k && inc[k - 1].items.some(x => /대회 후 회복/.test(x.title)) ? `<span class="muted">대회 회복 후 복귀</span>` : `<span class="${ch > 10 ? 'pv fast' : ''}">${ch > 0 ? '+' : ''}${ch}%</span>`}</td><td>${longR ? esc(longR.title) : '-'}</td><td style="white-space:normal;min-width:180px">${esc(key || '-')}</td></tr>`;
      }).join('');
      const sp = res.split;
      $('#pl-out', body).innerHTML = `
        <div class="phase-bar">${['base', 'build', 'peak', 'taper'].filter(p => sp[p]).map(p => `<div style="flex:${sp[p]};background:${PHASES[p].color}">${PHASES[p].label} ${sp[p]}주</div>`).join('')}</div>
        <p class="muted" style="font-size:12px">${['base', 'build', 'peak', 'taper'].map(p => `${PHASES[p].label}: ${PHASES[p].desc}`).join(' · ')}</p>
        ${res.notes.map(n => `<div class="alert info">${esc(n)}</div>`).join('')}
        <div class="alert today">페이스 존 (${esc(res.zones.basis)}, VDOT ${res.zones.vdot.toFixed(1)}): 이지 ${res.zones.easy.pace} · LSD ${res.zones.long.pace} · 마라톤 ${res.zones.mp.pace} · 템포 ${res.zones.tempo.pace} · 인터벌 ${res.zones.interval.pace}</div>
        <div class="table-wrap"><table class="table"><thead><tr><th>주차</th><th>시작</th><th>단계</th><th>주간 거리</th><th>전주 대비</th><th>장거리</th><th>핵심 훈련</th></tr></thead><tbody>${rows}</tbody></table></div>
        <p class="muted" style="font-size:12px">총 ${res.workouts.length}일 · 일반적인 원칙(주간 증가 10% 이내, 4주마다 회복주, 장거리 최대 32km)으로 만든 참고용 계획이에요. 몸 상태에 맞게 조정하세요.</p>`;
      return res;
    };
    let step = 0;
    const goStep = s => {
      if (s === 2 && !show()) return;
      step = s;
      $('.pl-step', body).forEach(el => el.classList.toggle('hidden', +el.dataset.s !== s));
      $('#pl-steps', body).innerHTML = stepperHTML(['기간·거리', '훈련 요일', '미리보기·적용'], s);
      $('#pl-steps li', body).forEach(li => li.onclick = () => { if (+li.dataset.step < step) goStep(+li.dataset.step); });
      $('#pl-back', body).classList.toggle('hidden', s === 0);
      $('#pl-next', body).classList.toggle('hidden', s === 2);
      $('#pl-apply', body).classList.toggle('hidden', s !== 2);
    };
    $('#pl-next', body).onclick = () => goStep(step + 1);
    $('#pl-back', body).onclick = () => goStep(step - 1);
    goStep(0);
    $('#pl-cancel', body).onclick = closeModal;
    f.onsubmit = async e => {
      e.preventDefault();
      const res = show(); if (!res) return;
      const replace = f.mode.value === 'replace';
      const start = f.start.value || today;
      const inRange = w => w.date >= start && w.date <= r.date;
      const toDelete = replace ? state.workouts.filter(w => inRange(w) && w.status !== 'done' && (w.race_id === r.id || !w.race_id) && !(w.type === 'race' && w.race_id && w.race_id !== r.id)) : [];
      const delIds = new Set(toDelete.map(w => w.id));
      const remaining = state.workouts.filter(w => !delIds.has(w.id));
      const busy = new Set(remaining.filter(inRange).map(w => w.date));
      const raceExists = remaining.some(w => w.type === 'race' && w.date === r.date);
      const add = res.workouts.filter(w => w.type === 'race' ? !raceExists : !busy.has(w.date)).map(w => ({ ...w, source: 'plan' }));
      if (!confirm(`${replace ? `예정 훈련 ${toDelete.length}개를 지우고 ` : ''}새 훈련 ${add.length}개를 넣을까요?${!replace && res.workouts.length - add.length ? ` (이미 훈련이 있는 ${res.workouts.length - add.length}일은 건너뜀)` : ''}`)) return;
      await guard(async () => {
        for (const w of toDelete) await store.deleteWorkout(w.id);
        state.workouts = remaining;
        const rows = add.length ? await store.insertWorkouts(add) : [];
        state.workouts.push(...rows); state.workouts.sort((a, b) => a.date.localeCompare(b.date));
      }, `${add.length}개 훈련을 넣었어요`);
      closeModal();
      state.selected = add[0]?.date || today;
      switchView('calendar'); selectDate(state.selected);
    };
  }, true);
}

/* ---------- 파일 가져오기 (GPX/FIT/CSV) ---------- */
async function openFileImport(files) {
  let recs = [];
  const errs = [];
  for (const f of files) { try { recs.push(...(await parseFile(f))); } catch (e) { errs.push(`${f.name}: ${e.message}`); } }
  recs = recs.filter(r => r.date && r.distance).sort((a, b) => a.date.localeCompare(b.date));
  const dup = r => state.workouts.find(w => w.date === r.date && w.status === 'done' && Math.abs(Number(w.actual_distance || 0) - r.distance) <= Math.max(0.3, r.distance * 0.03));
  const planFor = r => state.workouts.find(w => w.date === r.date && w.status !== 'done' && w.type !== 'rest');
  openModal('기록 파일 가져오기', `
    ${errs.map(e => `<div class="alert warn">${esc(e)}</div>`).join('')}
    ${recs.length ? `<p class="muted" style="font-size:13px">${recs.length}개 기록을 찾았어요. 같은 날 같은 거리의 완료 기록은 중복으로 보고 기본 선택 해제했어요. 계획된 훈련이 있는 날은 그 훈련을 완료 처리해요.</p>
    <div class="table-wrap"><table class="table"><thead><tr><th><input type="checkbox" id="fi-all" checked></th><th>날짜</th><th>제목</th><th>거리</th><th>시간</th><th>페이스</th><th>심박</th><th>저장 방식</th></tr></thead><tbody>
    ${recs.map((r, i) => { const d = dup(r), p = planFor(r), pc = paceOf(r.distance, r.time); return `<tr><td><input type="checkbox" class="fi-cb" data-i="${i}" ${d ? '' : 'checked'}></td><td>${r.date}${r.start ? ` ${r.start}` : ''}</td><td>${esc(r.title || '')}</td><td>${r.distance}km</td><td>${esc(r.time || '-')}</td><td>${pc ? fmtPace(pc) : '-'}</td><td>${r.avgHr || '-'}</td><td>${d ? '<span class="pv slow">중복</span>' : p ? `계획 완료: ${esc(p.title)}` : '새 기록'}</td></tr>`; }).join('')}
    </tbody></table></div>
    <div class="row gap" style="margin-top:12px"><button class="btn primary" id="fi-go">선택한 기록 가져오기</button><button class="btn" id="fi-cancel">취소</button></div>` : '<div class="empty">가져올 러닝 기록이 없어요</div>'}`, body => {
    $('#fi-cancel', body)?.addEventListener('click', closeModal);
    $('#fi-all', body)?.addEventListener('change', e => $$('.fi-cb', body).forEach(c => c.checked = e.target.checked));
    $('#fi-go', body)?.addEventListener('click', async () => {
      const sel = $$('.fi-cb:checked', body).map(c => recs[+c.dataset.i]);
      let n = 0;
      await guard(async () => {
        for (const r of sel) {
          const p = planFor(r);
          const extra = [r.start && `시작 ${r.start}`, r.cadence && `케이던스 ${r.cadence}spm`, r.elevation != null && `상승 ${r.elevation}m`, r.kcal && `${r.kcal}kcal`].filter(Boolean).join(' · ');
          const block = `[${r.source.toUpperCase()} 기록]${extra ? '\n' + extra : ''}`;
          const base = p || { date: r.date, type: guessType(r.title, r.distance, paceOf(r.distance, r.time)), title: r.title || '러닝', planned_distance: r.distance, details: '', race_id: upcomingRaces(r.date)[0]?.id || null };
          await saveW({ ...base, status: 'done', actual_distance: r.distance, actual_time: r.time, avg_hr: r.avgHr, max_hr: r.maxHr, cadence: r.cadence, source: r.source,
            details: base.details ? `${base.details}\n\n${block}` : block });
          n++;
        }
      }, `${n}개 기록을 가져왔어요`);
      closeModal();
    });
  }, true);
}

/* ---------- 설정 ---------- */
function fmtWhen(s) { if (!s) return '없음'; const d = new Date(s); return d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
async function renderBackups() {
  const box = $('#backup-list'); if (!box || !store.isCloud) return;
  box.innerHTML = '<span class="muted">백업 목록 불러오는 중...</span>';
  try {
    const list = await store.listBackups();
    box.innerHTML = list.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>백업</th><th>크기</th><th></th></tr></thead><tbody>${list.slice(0, 10).map(b => `<tr><td>${esc(b.name.replace('backup-', '').replace('.json', ''))}</td><td>${b.size ? Math.round(b.size / 1024) + 'KB' : '-'}</td><td><button class="btn sm" data-restore="${esc(b.path)}">이 백업으로 복원</button></td></tr>`).join('')}</tbody></table></div>` : '<span class="muted">아직 자동 백업이 없어요.</span>';
    $$('[data-restore]', box).forEach(b => b.onclick = async () => {
      if (!confirm('이 백업의 데이터를 불러올까요? (같은 항목은 백업 내용으로 덮어씁니다)')) return;
      await guard(async () => { await store.importAll(await store.downloadBackup(b.dataset.restore)); await loadAll(); }, '복원했어요');
      refresh();
    });
  } catch (e) { box.innerHTML = `<span class="msg err">백업 목록 오류: ${esc(e.message)}</span>`; }
}
function renderSettings() {
  renderRaces();
  const p = state.profile;
  const pf = $('#profile-form');
  pf.birth_year.value = p.birth_year ?? ''; pf.max_hr.value = p.max_hr ?? ''; pf.resting_hr.value = p.resting_hr ?? ''; pf.weight.value = p.weight ?? '';
  const hz = hrZones(p, latestRestingHr());
  $('#profile-zones').innerHTML = hz ? `심박 존 (최대 ${hz.max}${hz.estimated ? ', 나이로 추정' : ''} · 안정시 ${hz.rest}): 회복 ${hz.recovery} · 이지 ${hz.easy} · 마라톤 ${hz.mp} · 템포 ${hz.tempo} · 인터벌 ${hz.interval}` : '출생연도나 최대심박을 입력하면 심박 존이 계산돼요.';
  $('#notify-hour').value = String(p.notify_hour ?? 6);
  $('#notify-state').textContent = p.notify_enabled ? '켜짐' : '꺼짐';
  $('#notify-btn').textContent = p.notify_enabled ? '알림 끄기' : '알림 켜기';
  $('#mode-line').innerHTML = store.isCloud
    ? `<b>자동 저장 켜짐</b> · 모든 변경은 즉시 클라우드(Supabase)에 저장돼요 · 로그인: ${esc(state.userEmail || '')}<br>마지막 저장: ${fmtWhen(store.lastSync() || state.workouts.map(w => w.updated_at || w.created_at).filter(Boolean).sort().pop())} · 마지막 자동 백업: ${fmtWhen(p.last_backup_at)} (하루 1회, 최근 30개 보관)`
    : '로컬 모드 · 이 브라우저에만 저장됩니다. 백업을 자주 받아두세요.';
  $('#logout-btn').classList.toggle('hidden', !store.isCloud);
  renderBackups();
}

/* ---------- 대회 전략 ---------- */
function renderStrategyView() {
  const up = upcomingRaces();
  const sel = $('#strategy-race');
  const id = state.strategyRace && state.races.some(r => r.id === state.strategyRace) ? state.strategyRace : up[0]?.id;
  const opts = [...up, ...state.races.filter(r => !up.includes(r) && r.id === id)];
  sel.innerHTML = opts.length ? opts.map(r => `<option value="${r.id}" ${r.id === id ? 'selected' : ''}>${esc(r.name)} (${r.date})</option>`).join('') : '<option value="">예정된 대회 없음</option>';
  const race = state.races.find(r => r.id === id);
  renderStrategy($('#strategy-body'), {
    race, weight: latestWeight(),
    onSave: async strategy => {
      const saved = await guard(() => store.saveRace({ ...race, strategy }));
      const i = state.races.findIndex(x => x.id === saved.id); state.races[i] = saved;
      renderStrategyView();
    },
  });
}

/* ---------- 공통 ---------- */
function refresh() {
  renderHeader();
  if (state.view === 'calendar') { renderCalendar(); renderBoard(); renderDayPanel(); }
  if (state.view === 'strategy') renderStrategyView();
  if (state.view === 'shoes') renderShoes();
  if (state.view === 'journal') renderJournal();
  if (state.view === 'settings') renderSettings();
}
function switchView(v) {
  state.view = v;
  $('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === v));
  $('#bottom-tabs button[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  $$('.view').forEach(el => el.classList.toggle('hidden', el.id !== `view-${v}`));
  refresh();
}

/* ---------- 푸시 알림 ---------- */
function b64ToU8(b64) { const p = '='.repeat((4 - b64.length % 4) % 4); const s = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, c => c.charCodeAt(0)); }
async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window))
    throw new Error('이 브라우저는 푸시 알림을 지원하지 않아요. 아이폰은 Safari 공유 버튼 → "홈 화면에 추가" 후, 홈 화면의 앱에서 켜 주세요.');
  if (!VAPID_PUBLIC_KEY) throw new Error('푸시 서버 설정이 아직 없어요');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('알림 권한이 허용되지 않았어요. 브라우저/기기 설정에서 알림을 허용해 주세요.');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(VAPID_PUBLIC_KEY) });
  await store.savePushSub(sub);
  state.profile = await store.saveProfile({ notify_enabled: true, notify_hour: Number($('#notify-hour').value) });
}
async function disablePush() {
  try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); if (sub) { await store.deletePushSub(sub.endpoint); await sub.unsubscribe(); } } catch { }
  state.profile = await store.saveProfile({ notify_enabled: false });
}

function openPasswordModal(title = '비밀번호 변경') {
  openModal(title, `
    <form id="pw-form" class="form-grid">
      <label class="full">새 비밀번호<input type="password" name="pw1" minlength="6" required autocomplete="new-password"></label>
      <label class="full">새 비밀번호 확인<input type="password" name="pw2" minlength="6" required autocomplete="new-password"></label>
      <div class="full row gap"><button class="btn primary" type="submit">변경</button><button class="btn" type="button" id="pw-cancel">취소</button></div>
    </form>`, body => {
    $('#pw-cancel', body).onclick = closeModal;
    $('#pw-form', body).onsubmit = async e => {
      e.preventDefault(); const f = e.target;
      if (f.pw1.value !== f.pw2.value) { toast('두 비밀번호가 달라요'); return; }
      await guard(() => store.updatePassword(f.pw1.value), '비밀번호를 변경했어요');
      closeModal();
      if (location.search.includes('reset=1')) history.replaceState(null, '', location.pathname);
    };
  });
}

function bindStatic() {
  $$('.tab').forEach(t => t.onclick = () => switchView(t.dataset.view));
  $('#prev-month').onclick = () => { state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1); renderCalendar(); };
  $('#next-month').onclick = () => { state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1); renderCalendar(); };
  $('#today-btn').onclick = () => selectDate(todayIso());
  $('#heat-btn').onclick = () => { state.heatmap = !state.heatmap; renderCalendar(); };
  $('#modal-close').onclick = closeModal;
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
  $('#add-shoe').onclick = () => openShoeModal();
  $('#add-race').onclick = () => openRaceModal();
  $('#garmin-input').onchange = e => { const fl = e.target.files; if (fl?.length) enqueueImports(fl); e.target.value = ''; };
  $('#file-import').onchange = e => { const fl = [...e.target.files]; if (fl.length) handleImportFiles(fl); e.target.value = ''; };
  $$('#stat-tabs button').forEach(b => b.onclick = () => { state.statTab = b.dataset.k; renderJournal(); });
  $('#stat-range').onchange = e => { state.statRange[state.statTab] = e.target.value; renderJournal(); };
  $('#load-plan').onclick = () => openPlanModal(state.races.find(r => r.id === $('#plan-race').value));
  $('#strategy-race').onchange = e => { state.strategyRace = e.target.value; renderStrategyView(); };
  $('#profile-form').onsubmit = async e => {
    e.preventDefault(); const f = e.target;
    state.profile = await guard(() => store.saveProfile({ birth_year: f.birth_year.value, max_hr: f.max_hr.value, resting_hr: f.resting_hr.value, weight: f.weight.value }), '프로필을 저장했어요');
    renderSettings();
  };
  $('#notify-btn').onclick = async () => {
    try { if (state.profile.notify_enabled) { await disablePush(); toast('알림을 껐어요'); } else { await enablePush(); toast('매일 아침 오늘 훈련 알림을 보내드릴게요'); } }
    catch (e) { toast(e.message); }
    renderSettings();
  };
  $('#notify-hour').onchange = async e => { if (state.profile.notify_enabled) state.profile = await guard(() => store.saveProfile({ notify_hour: Number(e.target.value) }), '알림 시간을 바꿨어요'); };
  $('#notify-test').onclick = async () => {
    try {
      if (Notification.permission !== 'granted' && (await Notification.requestPermission()) !== 'granted') throw new Error('알림 권한이 필요해요');
      const reg = await navigator.serviceWorker.ready;
      const tw = byDate(todayIso()).filter(w => w.type !== 'rest');
      await reg.showNotification('오늘의 훈련 (테스트)', { body: tw.length ? tw.map(w => `${w.title}${w.target_pace ? ` @ ${w.target_pace}` : ''}`).join(', ') : '오늘은 휴식일이에요', icon: 'icon-192.png', badge: 'icon-192.png' });
    } catch (e) { toast(e.message); }
  };
  $('#backup-now').onclick = async () => {
    const d = await guard(() => store.autoBackup(true), '지금 백업했어요');
    if (d) state.profile.last_backup_at = d.toISOString(); renderSettings();
  };
  $('#pw-btn').onclick = () => openPasswordModal();
  $('#export-btn').onclick = async () => {
    const data = await store.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `running-calendar-${todayIso()}.json`; a.click();
  };
  $('#import-file').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!confirm('백업 파일의 데이터를 불러올까요? (같은 ID는 덮어씁니다)')) return;
      await guard(() => store.importAll(data), '복원했어요');
      await loadAll(); refresh();
    } catch (err) { $('#data-msg').textContent = '파일을 읽을 수 없어요: ' + err.message; }
    e.target.value = '';
  };
  $('#logout-btn').onclick = async () => { await store.signOut(); location.reload(); };
  // 모바일 UI 패턴
  $('#menu-btn').onclick = openDrawer;
  $('#more-btn').onclick = openDrawer;
  $('#fab').onclick = openAddSheet;
  $('#bottom-tabs button[data-view]').forEach(b => b.onclick = () => { if (b.dataset.view === 'journal' && state.statTab === 'report') state.statTab = 'week'; switchView(b.dataset.view); window.scrollTo({ top: 0 }); });
  $('#sum-seg button').forEach(b => b.onclick = () => { state.sumPeriod = b.dataset.k; renderMonthStats(); });
  $('#cal-mode button').forEach(b => b.onclick = () => { state.calMode = b.dataset.k === 'board' ? 'board' : 'cal'; state.boardWeek = mondayOf(state.selected || todayIso()); renderBoard(); });
  $('#board-prev').onclick = () => { state.boardWeek = addDaysIso(state.boardWeek, -7); renderBoard(); };
  $('#board-next').onclick = () => { state.boardWeek = addDaysIso(state.boardWeek, 7); renderBoard(); };
  $('#board-today').onclick = () => { state.boardWeek = mondayOf(todayIso()); renderBoard(); };
  $('#journal-q').addEventListener('input', e => { state.journalQ = e.target.value; renderJournalList(); });
  autocomplete($('#journal-q'), q => q ? titleSuggestions(q).filter(x => state.workouts.some(w => w.memo && w.title === x.label)) : [], it => { state.journalQ = it.label; renderJournalList(); });
  sheetDrag($('.modal'), closeModal);
  pullToRefresh(reloadData, { isEnabled: () => isMobile() && !$('#app').classList.contains('hidden') });
}

/* ---------- 인증 ---------- */
function showAuth() {
  $('#auth-view').classList.remove('hidden'); $('#app').classList.add('hidden');
  const msg = $('#auth-msg');
  const run = async (mode) => {
    const email = $('#auth-email').value.trim(), pw = $('#auth-password').value;
    if (!email || pw.length < 6) { msg.className = 'msg err'; msg.textContent = '이메일과 6자 이상 비밀번호를 입력하세요.'; return; }
    msg.className = 'msg'; msg.textContent = '처리 중...';
    try {
      if (mode === 'signup') {
        const r = await store.signUp(email, pw);
        if (!r.session) { msg.textContent = '가입 확인 메일을 보냈어요. 메일의 링크를 누른 뒤 로그인하세요.'; return; }
      } else {
        await store.signIn(email, pw);
      }
      await start();
    } catch (e) { msg.className = 'msg err'; msg.textContent = e.message === 'Invalid login credentials' ? '이메일 또는 비밀번호가 맞지 않아요.' : e.message; }
  };
  $('#auth-form').onsubmit = e => { e.preventDefault(); run('signin'); };
  $('#auth-signup').onclick = () => run('signup');
  $('#auth-forgot').onclick = async () => {
    const email = $('#auth-email').value.trim();
    if (!email) { msg.className = 'msg err'; msg.textContent = '먼저 이메일을 입력하세요.'; return; }
    msg.className = 'msg'; msg.textContent = '재설정 메일 보내는 중...';
    try { await store.sendPasswordReset(email); msg.textContent = `${email}로 비밀번호 재설정 메일을 보냈어요. 메일의 링크를 누르면 새 비밀번호를 설정할 수 있어요.`; }
    catch (e) { msg.className = 'msg err'; msg.textContent = e.message; }
  };
}

let started = false;
async function start() {
  const user = await store.getUser();
  if (!user) return showAuth();
  state.userEmail = user.email;
  $('#auth-view').classList.add('hidden'); $('#app').classList.remove('hidden');
  $('#month-stats').innerHTML = skeleton('stats'); $('#cal-grid').innerHTML = skeleton('calendar'); $('#day-panel').innerHTML = skeleton('panel');
  await loadAll();
  if (!state.races.length && DEFAULT_RACE?.race_date && !state.workouts.length) {
    try {
      state.races.push(await store.saveRace({ name: DEFAULT_RACE.race_name, date: DEFAULT_RACE.race_date, distance_km: 42.195, goal_time: DEFAULT_RACE.goal_time, priority: 'A' }));
    } catch (e) { console.warn(e); }
  }
  const t = new Date();
  state.month = new Date(t.getFullYear(), t.getMonth(), 1);
  state.selected = todayIso();
  const hashView = location.hash.replace('#', '');
  if (['calendar', 'strategy', 'shoes', 'journal', 'settings'].includes(hashView)) state.view = hashView;
  switchView(state.view);
  if (!started) {
    started = true;
    if (location.search.includes('reset=1') || location.hash.includes('type=recovery')) setTimeout(() => openPasswordModal('새 비밀번호 설정'), 300);
    if (!state.offline) store.autoBackup().then(d => { if (d) state.profile.last_backup_at = d.toISOString?.() || d; }).catch(e => console.warn('backup', e));
  }
}

(async function main() {
  bindStatic();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(e => console.warn('sw', e));
  try { await store.init(); store.onPasswordRecovery(() => openPasswordModal('새 비밀번호 설정')); }
  catch (e) { document.body.insertAdjacentHTML('afterbegin', `<p style="padding:12px;color:#dc2626">Supabase 연결 실패: ${esc(e.message)}</p>`); }
  await start();
})();
