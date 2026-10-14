import * as store from './store.js';
import { DEFAULT_RACE } from './config.js';
import { renderStats, RANGES } from './stats.js';
import { recognizeGarmin, compressImage, guessType, garminSummary } from './garmin.js';
import { TYPES, SHOE_PURPOSES, RACE_DISTANCES, PRIORITY, distLabel, racePace, taperPlan, trainingPaces, paceOf, fmtPace, toSec, fmtDuration } from './plan.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const WD = ['일', '월', '화', '수', '목', '금', '토'];

const state = {
  workouts: [], shoes: [], races: [],
  month: null, // Date (1일)
  selected: null, // 'YYYY-MM-DD'
  view: 'calendar',
  shoeFocus: null,
  statTab: 'week',
  statRange: { week: 'w12', month: 'm6', type: 'w12' },
  importQueue: [],
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
  const [w, s, r] = await Promise.all([store.listWorkouts(), store.listShoes(), store.listRaces()]);
  state.workouts = w || []; state.shoes = s || []; state.races = r || [];
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
function renderMonthStats() {
  const y = state.month.getFullYear(), m = state.month.getMonth();
  const prefix = `${y}-${String(m + 1).padStart(2, '0')}`;
  const list = state.workouts.filter(w => w.date.startsWith(prefix) && w.type !== 'rest');
  const due = list.filter(w => w.date <= todayIso());
  const done = list.filter(w => w.status === 'done');
  const plannedKm = list.reduce((a, w) => a + Number(w.planned_distance || 0), 0);
  const doneKm = done.reduce((a, w) => a + Number(w.actual_distance || w.planned_distance || 0), 0);
  const rate = due.length ? Math.round(done.filter(w => w.date <= todayIso()).length / due.length * 100) : 0;
  const missed = list.filter(w => ['missed', 'skipped'].includes(effStatus(w))).length;
  $('#month-stats').innerHTML = `
    <div class="stat"><div class="k">${m + 1}월 계획 거리</div><div class="v">${plannedKm.toFixed(1)}<small> km</small></div></div>
    <div class="stat"><div class="k">완료 거리</div><div class="v">${doneKm.toFixed(1)}<small> km</small></div>
      <div class="bar"><i style="width:${plannedKm ? Math.min(100, doneKm / plannedKm * 100) : 0}%"></i></div></div>
    <div class="stat"><div class="k">완료율 (오늘까지)</div><div class="v">${rate}<small> %</small></div></div>
    <div class="stat"><div class="k">완료 / 미완료 / 전체</div><div class="v">${done.length}<small> / ${missed} / ${list.length}회</small></div></div>`;
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
    html += `<div class="${cls.join(' ')}" data-date="${ds}">
      <div class="num"><span class="${numColor}">${d.getDate()}</span>${mark}</div>
      ${ws.map(w => {
        const st = effStatus(w); const t = TYPES[w.type] || TYPES.easy;
        const c = st === 'done' ? 'done' : (st === 'missed' || st === 'skipped') ? 'missed' : w.type === 'rest' ? 'rest' : '';
        const km = w.status === 'done' && w.actual_distance ? w.actual_distance : w.planned_distance;
        if (w.type === 'race') return `<div class="chip ${c}" style="--c:${t.color}" title="${esc(w.title)}">${esc(dayRace?.name || w.title)}</div>`;
        return `<div class="chip ${c}" style="--c:${t.color}" title="${esc(w.title)}">${esc(t.label)}${km ? `<span class="km"> ${Number(km)}k</span>` : ''}</div>`;
      }).join('')}
      ${dayRace && !ws.some(w => w.type === 'race') ? `<div class="chip" style="--c:${TYPES.race.color}" title="${esc(dayRace.name)}">${esc(dayRace.name)}</div>` : ''}
    </div>`;
  }
  $('#cal-grid').innerHTML = html;
  $$('#cal-grid .day').forEach(el => el.addEventListener('click', () => selectDate(el.dataset.date, true)));
  $('#legend').innerHTML = Object.values(TYPES).map(t => `<span><i style="background:${t.color}"></i>${t.label}</span>`).join('')
    + '<span><b style="color:var(--done)">✓</b> 완료</span><span><b style="color:var(--miss)">✗</b> 미완료</span>';
  renderMonthStats();
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

function workoutCard(w) {
  const t = TYPES[w.type] || TYPES.easy;
  const st = effStatus(w);
  const isRest = w.type === 'rest';
  const pace = paceOf(w.actual_distance, w.actual_time);
  const shoe = state.shoes.find(s => s.id === w.shoe_id);
  return `<div class="workout" style="--c:${t.color}" data-id="${w.id}">
    <div class="w-head"><span class="badge" style="--c:${t.color}">${t.label}</span>
      <span class="status-badge ${st}">${STATUS_LABEL[st]}</span></div>
    <div class="w-title">${esc(w.title)}</div>
    <div class="w-meta">
      ${w.planned_distance ? `<span>계획 <b>${Number(w.planned_distance)}km</b></span>` : ''}
      ${w.target_pace ? `<span>목표 페이스 <b>${esc(w.target_pace)}/km</b></span>` : ''}
      ${shoe ? `<span>러닝화 <b>${esc(shoeName(shoe))}</b></span>` : ''}
    </div>
    ${w.details ? `<div class="w-details">${esc(w.details)}</div>` : ''}
    <div class="seg">
      <button data-st="done" class="${w.status === 'done' ? 'on done' : ''}">✓ 완료</button>
      <button data-st="skipped" class="${w.status === 'skipped' ? 'on skipped' : ''}">✗ 미완료</button>
      <button data-st="planned" class="${w.status === 'planned' || !w.status ? 'on planned' : ''}">○ 예정</button>
    </div>
    ${isRest ? '' : `
    <form class="rec-form">
      <div class="rec-grid">
        <label>실제 거리 (km)<input name="actual_distance" type="number" step="0.01" min="0" value="${w.actual_distance ?? ''}" placeholder="${w.planned_distance ?? ''}"></label>
        <label>시간 (h:mm:ss)<input name="actual_time" value="${esc(w.actual_time ?? '')}" placeholder="0:55:30"></label>
        <label>평균 심박<input name="avg_hr" type="number" min="0" value="${w.avg_hr ?? ''}" placeholder="bpm"></label>
        <label>체감 강도 RPE <span class="rpe-val">${w.rpe ?? '-'}</span><input name="rpe" type="range" min="1" max="10" value="${w.rpe ?? 5}"></label>
        <div class="full pace-out">평균 페이스: <b>${pace ? fmtPace(pace) + '/km' : '-'}</b></div>
        <label class="full">러닝화<select name="shoe_id">${shoeOptions(w.shoe_id || (w.status === 'done' ? '' : lastShoeId()))}</select></label>
        <label class="full">달리며 느낀 점 메모<textarea name="memo" placeholder="컨디션, 날씨, 페이스 느낌, 통증 여부, 보급 등">${esc(w.memo ?? '')}</textarea></label>
      </div>
      <button class="btn primary" type="submit">기록 저장</button>
    </form>`}
    ${isRest ? `<form class="rec-form"><label>메모<textarea name="memo" placeholder="회복 상태, 수면, 컨디션">${esc(w.memo ?? '')}</textarea></label>
      <div style="margin-top:8px"><button class="btn primary" type="submit">메모 저장</button></div></form>` : ''}
    ${(w.images || []).length ? `<div class="w-images">${w.images.map((p, i) => `<button type="button" class="thumb" data-i="${i}" title="크게 보기"><img data-path="${esc(p)}" alt="러닝 기록 이미지"></button>`).join('')}</div>` : ''}
    <div class="w-actions">
      <button class="btn sm" data-act="edit">계획 수정</button>
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
function pickTarget(date, km) {
  const ws = byDate(date).filter(w => w.type !== 'rest');
  // 같은 러닝이 이미 기록된 경우(거리 거의 같음) → 그 기록에 이미지 첨부
  if (km) {
    const same = ws.find(w => w.status === 'done' && w.actual_distance && Math.abs(Number(w.actual_distance) - km) <= Math.max(0.3, km * 0.03));
    if (same) return same;
  }
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
      const t = pickTarget(f.date.value, Number(f.distance.value));
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
          if (!f.avg_hr.value && t.avg_hr) f.avg_hr.value = t.avg_hr;
          if (!f.time.value && t.actual_time) f.time.value = t.actual_time;
          if (t.shoe_id && !f.shoe_id.value) f.shoe_id.value = t.shoe_id;
          if (t.memo && !f.memo.value) f.memo.value = t.memo;
        }
      } else if (ocr) f.garmin.value = garminSummary(ocr);
      if (!t && ocr) { f.type.value = guessType(ocr.title, Number(f.distance.value), paceOf(f.distance.value, f.time.value), toSec(paceRace()?.goal_time || '3:30:00') / 42.195); if (!f.title.dataset.edited) f.title.value = ocr.title || '러닝'; }
    };
    f.title.oninput = () => { f.title.dataset.edited = '1'; };
    f.target.onchange = applyTarget;
    $('#imp-skip', body).onclick = () => { URL.revokeObjectURL(url); closeModal(); };

    recognizeGarmin(file, (msg, p) => {
      $('#ocr-msg', body) && ($('#ocr-msg', body).textContent = msg + (p > 0 && p < 1 ? ` ${Math.round(p * 100)}%` : ''));
      $('#ocr-bar', body) && ($('#ocr-bar', body).style.width = Math.max(3, Math.round(p * 100)) + '%');
    }).then(r => {
      ocr = r;
      if (!$('#imp-form')) return;
      $('#ocr-text', body).textContent = r.rawText;
      const found = [r.date && '날짜', r.distance && '거리', r.time && '시간', r.avgHr && '심박'].filter(Boolean);
      $('#ocr-msg', body).textContent = found.length ? `인식 완료: ${found.join('·')} 자동 입력됨. 확인 후 저장하세요.` : '자동 인식에 실패했어요. 직접 입력해 주세요.';
      $('#ocr-status', body).classList.toggle('warn', found.length < 3);
      if (r.date) f.date.value = r.date;
      else if (!target) { f.date.value = ''; $('#ocr-msg', body).textContent += ' 날짜를 찾지 못했어요. 날짜를 직접 선택하세요.'; $('#ocr-status', body).classList.add('warn'); }
      if (r.distance) f.distance.value = r.distance;
      if (r.time) f.time.value = r.time;
      if (r.avgHr) f.avg_hr.value = r.avgHr;
      f.garmin.value = garminSummary(r);
      if (!target) {
        const t = pickTarget(f.date.value, r.distance);
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
      const btn = $('button[type=submit]', f); btn.disabled = true; btn.textContent = '저장 중...';
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
  panel.innerHTML = `
    <div class="day-title"><h3>${korDate(ds)}</h3>${nr ? `<span class="muted">${dd === 0 ? `대회일: ${esc(nr.name)}` : `${esc(nr.name)} D-${dd}`}</span>` : ''}</div>
    ${ws.length ? ws.map(workoutCard).join('') : '<div class="empty">이 날짜에 등록된 훈련이 없어요</div>'}
    <button class="btn" id="add-workout" style="width:100%">+ 이 날짜에 훈련 추가</button>
    ${!state.workouts.length && mainRace() ? `<div class="empty" style="margin-top:12px">아직 훈련 계획이 없어요.<br>대회 기준 3주 테이퍼링 계획을 넣어볼까요?<br><button class="btn primary" id="quick-plan" style="margin-top:10px">테이퍼링 계획 넣기</button></div>` : ''}`;
  $('#add-workout').onclick = () => openWorkoutModal({ date: ds, type: 'easy', status: 'planned' });
  fillImages(panel);
  const qp = $('#quick-plan'); if (qp) qp.onclick = () => loadPlan(mainRace()?.id);

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

async function saveW(w) {
  const saved = await store.saveWorkout(w);
  const i = state.workouts.findIndex(x => x.id === saved.id);
  if (i >= 0) state.workouts[i] = saved; else state.workouts.push(saved);
  state.workouts.sort((a, b) => a.date.localeCompare(b.date));
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

function openWorkoutModal(w) {
  const isNew = !w.id;
  const pr = paceRace();
  const P = trainingPaces(pr?.goal_time);
  openModal(isNew ? '훈련 추가' : '훈련 계획 수정', `
    <form id="w-form" class="form-grid">
      <label>날짜<input type="date" name="date" value="${w.date}" required></label>
      <label>종류<select name="type">${Object.entries(TYPES).map(([k, t]) => `<option value="${k}" ${k === w.type ? 'selected' : ''}>${t.label}</option>`).join('')}</select></label>
      <label class="full">훈련 제목<input name="title" value="${esc(w.title ?? '')}" placeholder="예: 인터벌 1km × 5" required></label>
      <label>계획 거리 (km)<input type="number" step="0.1" min="0" name="planned_distance" value="${w.planned_distance ?? ''}"></label>
      <label>목표 페이스 (/km)<input name="target_pace" value="${esc(w.target_pace ?? '')}" placeholder="${P.easy}"></label>
      <label class="full">상세 훈련 프로그램<textarea name="details" rows="6" placeholder="워밍업 / 본훈련 / 쿨다운 / 포인트">${esc(w.details ?? '')}</textarea></label>
      <div class="full muted" style="font-size:12px">참고 페이스(${pr ? `${esc(pr.name)} 목표 ${esc(pr.goal_time)}` : '풀코스 3:30:00'} 기준 추정): 이지 ${P.easy} · 마라톤 ${P.mp} · 역치 ${P.tempo} · 인터벌 ${P.interval}</div>
      <div class="full row gap"><button class="btn primary" type="submit">${isNew ? '추가' : '저장'}</button><button class="btn" type="button" id="w-cancel">취소</button></div>
    </form>`, body => {
    $('#w-cancel', body).onclick = closeModal;
    const typeSel = $('[name=type]', body), titleIn = $('[name=title]', body);
    typeSel.onchange = () => { if (!titleIn.value) titleIn.value = TYPES[typeSel.value].label; };
    $('#w-form', body).onsubmit = async e => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target));
      const saved = await guard(() => saveW({ ...w, ...fd, status: w.status || 'planned' }), isNew ? '훈련을 추가했어요' : '수정했어요');
      closeModal();
      selectDate(saved.date);
    };
  });
}

/* ---------- 러닝화 ---------- */
function renderShoes() {
  const grid = $('#shoe-grid');
  if (!state.shoes.length) {
    grid.innerHTML = '<div class="card empty" style="grid-column:1/-1">등록된 러닝화가 없어요. 오른쪽 위 버튼으로 추가해 보세요.</div>';
    $('#shoe-history').innerHTML = ''; return;
  }
  const sorted = [...state.shoes].sort((a, b) => Number(a.retired) - Number(b.retired));
  grid.innerHTML = sorted.map(s => {
    const { total, runs } = shoeKm(s);
    const max = Number(s.max_km || 700);
    const pct = Math.min(100, total / max * 100);
    const last = runs.map(r => r.date).sort().pop();
    return `<div class="shoe ${s.retired ? 'retired' : ''} ${state.shoeFocus === s.id ? 'active-sel' : ''}" style="--c:${s.color || '#3b82f6'}" data-id="${s.id}">
      <div class="s-name">${esc(shoeName(s))}${s.retired ? '<span class="tag">은퇴</span>' : ''}${s.purpose ? `<span class="tag">${esc(s.purpose)}</span>` : ''}</div>
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
  $('#stat-range').innerHTML = Object.entries(RANGES).map(([k, v]) => `<option value="${k}" ${k === range ? 'selected' : ''}>${v}</option>`).join('');
  renderStats($('#view-journal'), {
    workouts: state.workouts, tab, range, today: todayIso(),
    onPickDate: d => { switchView('calendar'); selectDate(d < todayIso() ? d : todayIso(), true); },
  }).catch(e => { console.error(e); $('#stat-note').textContent = '그래프를 불러오지 못했어요: ' + e.message; });

  const entries = state.workouts.filter(w => w.memo).sort((a, b) => b.date.localeCompare(a.date));
  $('#journal-list').innerHTML = entries.length ? entries.map(w => {
    const t = TYPES[w.type] || TYPES.easy; const sh = state.shoes.find(s => s.id === w.shoe_id);
    const p = paceOf(w.actual_distance, w.actual_time);
    return `<div class="entry" data-date="${w.date}"><div class="e-head"><b>${korDate(w.date)}</b><span class="badge" style="--c:${t.color}">${t.label}</span>
      <span>${esc(w.title)}</span>${w.actual_distance ? `<span>${Number(w.actual_distance)}km</span>` : ''}${p ? `<span>${fmtPace(p)}/km</span>` : ''}${w.rpe ? `<span>RPE ${w.rpe}</span>` : ''}${sh ? `<span>러닝화: ${esc(shoeName(sh))}</span>` : ''}</div>
      <div class="e-memo">${esc(w.memo)}</div></div>`;
  }).join('') : '<div class="empty">아직 작성한 메모가 없어요. 캘린더에서 날짜를 눌러 느낀 점을 남겨보세요.</div>';
  $$('#journal-list .entry').forEach(el => el.onclick = () => { switchView('calendar'); selectDate(el.dataset.date, true); });
}

/* ---------- 설정 ---------- */
function renderRaces() {
  const today = todayIso();
  const list = [...state.races].sort((a, b) => {
    const pa = a.date < today, pb = b.date < today; // 예정 대회 먼저, 지난 대회는 최근순
    if (pa !== pb) return pa ? 1 : -1;
    return pa ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date);
  });
  $('#race-list').innerHTML = list.length ? list.map(r => {
    const d = diffDays(r.date, today);
    return `<div class="race-item ${d < 0 ? 'past' : ''} pri-${esc(r.priority || 'A')}" data-id="${r.id}">
      <div class="race-d">${d > 0 ? `D-${d}` : d === 0 ? 'D-DAY' : '지남'}</div>
      <div class="race-info">
        <div class="race-name">${esc(r.name)}${r.priority ? `<span class="tag">${PRIORITY[r.priority] || ''}</span>` : ''}</div>
        <div class="race-sub">${r.date.replaceAll('-', '.')} (${WD[parse(r.date).getDay()]}) · ${esc(raceSummary(r))}${r.location ? ` · ${esc(r.location)}` : ''}</div>
        ${r.notes ? `<div class="race-sub">${esc(r.notes)}</div>` : ''}
      </div>
      <div class="race-act"><button class="btn sm" data-act="edit">수정</button><button class="btn sm danger" data-act="del">삭제</button></div>
    </div>`;
  }).join('') : '<div class="empty">등록된 대회가 없어요. 오른쪽 위 버튼으로 추가하세요.</div>';
  $$('#race-list .race-item').forEach(el => {
    const r = state.races.find(x => x.id === el.dataset.id);
    $('[data-act=edit]', el).onclick = () => openRaceModal(r);
    $('[data-act=del]', el).onclick = () => removeRace(r);
  });
  const up = upcomingRaces();
  const sel = $('#plan-race'); const prev = sel.value;
  sel.innerHTML = up.length ? up.map(r => `<option value="${r.id}">${esc(r.name)} (${r.date})</option>`).join('') : '<option value="">예정된 대회 없음</option>';
  if (up.some(r => r.id === prev)) sel.value = prev;
}

function raceWorkout(date) { return state.workouts.find(w => w.type === 'race' && w.date === date); }

function openRaceModal(r = {}) {
  const isNew = !r.id;
  const dist = r.distance_km ?? 42.195;
  const preset = RACE_DISTANCES.find(x => Math.abs(x.km - Number(dist)) < 0.01);
  openModal(isNew ? '대회 추가' : '대회 수정', `
    <form id="r-form" class="form-grid">
      <label class="full">대회명<input name="name" value="${esc(r.name ?? '')}" placeholder="예: 인천마라톤" required></label>
      <label>대회 날짜<input type="date" name="date" value="${r.date ?? ''}" required></label>
      <label>종목<select name="dist_sel">${RACE_DISTANCES.map(x => `<option value="${x.km}" ${preset?.km === x.km ? 'selected' : ''}>${x.label}</option>`).join('')}<option value="custom" ${preset ? '' : 'selected'}>기타 (직접 입력)</option></select></label>
      <label class="${preset ? 'hidden' : ''}" id="r-custom">거리 (km)<input type="number" step="0.001" min="0" name="custom_km" value="${preset ? '' : dist}"></label>
      <label>목표 기록 (h:mm:ss)<input name="goal_time" value="${esc(r.goal_time ?? '')}" placeholder="3:30:00"></label>
      <label>우선순위<select name="priority">${Object.entries(PRIORITY).map(([k, v]) => `<option value="${k}" ${(r.priority || 'A') === k ? 'selected' : ''}>${k} · ${v}</option>`).join('')}</select></label>
      <label>장소<input name="location" value="${esc(r.location ?? '')}" placeholder="예: 광화문"></label>
      <div class="full pace-out" id="r-pace"></div>
      <label class="full">메모<textarea name="notes" placeholder="배번, 출발 시간, 전략 등">${esc(r.notes ?? '')}</textarea></label>
      ${isNew ? '<label class="full" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" name="add_cal" checked style="width:auto"> 캘린더에 대회 일정도 추가</label>' : ''}
      <div class="full row gap"><button class="btn primary" type="submit">${isNew ? '추가' : '저장'}</button><button class="btn" type="button" id="r-cancel">취소</button></div>
    </form>`, body => {
    const f = $('#r-form', body);
    const km = () => f.dist_sel.value === 'custom' ? Number(f.custom_km.value) : Number(f.dist_sel.value);
    const upd = () => {
      $('#r-custom', body).classList.toggle('hidden', f.dist_sel.value !== 'custom');
      const p = racePace(f.goal_time.value, km());
      $('#r-pace', body).innerHTML = p ? `목표 평균 페이스: <b>${p}/km</b>` : '';
    };
    f.dist_sel.onchange = upd; f.goal_time.oninput = upd; f.custom_km.oninput = upd; upd();
    $('#r-cancel', body).onclick = closeModal;
    f.onsubmit = async e => {
      e.preventDefault();
      const goal = f.goal_time.value.trim();
      if (goal && !toSec(goal)) { toast('목표 기록 형식: 3:30:00'); return; }
      if (!km()) { toast('거리를 입력하세요'); return; }
      const data = { ...r, name: f.name.value.trim(), date: f.date.value, distance_km: km(), goal_time: goal,
        priority: f.priority.value, location: f.location.value.trim(), notes: f.notes.value.trim() };
      const old = isNew ? null : { ...r };
      const saved = await guard(() => store.saveRace(data), isNew ? '대회를 추가했어요' : '수정했어요');
      const i = state.races.findIndex(x => x.id === saved.id);
      if (i >= 0) state.races[i] = saved; else state.races.push(saved);
      // 캘린더의 대회 일정 동기화
      const pace = racePace(saved.goal_time, saved.distance_km);
      const rw = old ? raceWorkout(old.date) : null;
      if (rw) {
        await saveW({ ...rw, date: saved.date, title: saved.name, planned_distance: saved.distance_km, target_pace: pace || rw.target_pace });
      } else if (isNew && f.add_cal?.checked && !raceWorkout(saved.date)) {
        await saveW({ date: saved.date, type: 'race', title: saved.name, planned_distance: saved.distance_km, target_pace: pace,
          details: `대회: ${saved.name} (${distLabel(saved.distance_km)})${saved.goal_time ? `\n목표 기록: ${saved.goal_time}${pace ? ` (평균 ${pace}/km)` : ''}` : ''}${saved.location ? `\n장소: ${saved.location}` : ''}`, status: 'planned' });
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
  refresh();
}

async function loadPlan(raceId) {
  const r = state.races.find(x => x.id === raceId) || mainRace();
  if (!r) { $('#plan-msg').textContent = '먼저 대회를 추가하세요.'; return; }
  const plan = taperPlan(r.date, r.goal_time || '3:30:00', r.name);
  const last = plan[plan.length - 1];
  last.title = r.name; last.planned_distance = r.distance_km; last.target_pace = racePace(r.goal_time, r.distance_km) || last.target_pace;
  const taken = new Set(state.workouts.map(w => w.date));
  const add = plan.filter(p => !taken.has(p.date) && p.date >= todayIso());
  if (!add.length) { $('#plan-msg').textContent = '해당 기간의 모든 날짜에 이미 훈련이 있어요.'; toast('이미 훈련이 들어 있어요'); return; }
  if (!confirm(`${r.name} 기준 테이퍼링 훈련 ${add.length}개를 빈 날짜에 추가할까요?`)) return;
  const rows = await guard(() => store.insertWorkouts(add), `${add.length}개 훈련을 추가했어요`);
  state.workouts.push(...rows); state.workouts.sort((a, b) => a.date.localeCompare(b.date));
  $('#plan-msg').textContent = `${add.length}개 추가 완료`;
  state.selected = todayIso();
  switchView('calendar');
}

function renderSettings() {
  renderRaces();
  $('#mode-line').textContent = store.isCloud
    ? `클라우드 동기화 모드 (Supabase) · 로그인: ${state.userEmail || ''} · 휴대폰·PC 어디서든 같은 데이터가 보여요.`
    : '로컬 모드 · 이 브라우저에만 저장됩니다. 백업을 자주 받아두세요.';
  $('#logout-btn').classList.toggle('hidden', !store.isCloud);
}

/* ---------- 공통 ---------- */
function refresh() {
  renderHeader();
  if (state.view === 'calendar') { renderCalendar(); renderDayPanel(); }
  if (state.view === 'shoes') renderShoes();
  if (state.view === 'journal') renderJournal();
  if (state.view === 'settings') renderSettings();
}
function switchView(v) {
  state.view = v;
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === v));
  $$('.view').forEach(el => el.classList.toggle('hidden', el.id !== `view-${v}`));
  refresh();
}

function bindStatic() {
  $$('.tab').forEach(t => t.onclick = () => switchView(t.dataset.view));
  $('#prev-month').onclick = () => { state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1); renderCalendar(); };
  $('#next-month').onclick = () => { state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1); renderCalendar(); };
  $('#today-btn').onclick = () => selectDate(todayIso());
  $('#modal-close').onclick = closeModal;
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
  $('#add-shoe').onclick = () => openShoeModal();

  $('#add-race').onclick = () => openRaceModal();
  $('#garmin-input').onchange = e => { const fl = e.target.files; if (fl?.length) enqueueImports(fl); e.target.value = ''; };
  $$('#stat-tabs button').forEach(b => b.onclick = () => { state.statTab = b.dataset.k; renderJournal(); });
  $('#stat-range').onchange = e => { state.statRange[state.statTab] = e.target.value; renderJournal(); };
  $('#load-plan').onclick = () => loadPlan($('#plan-race').value);
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
}

async function start() {
  const user = await store.getUser();
  if (!user) return showAuth();
  state.userEmail = user.email;
  $('#auth-view').classList.add('hidden'); $('#app').classList.remove('hidden');
  await loadAll();
  if (!state.races.length && DEFAULT_RACE?.race_date && !state.workouts.length) {
    try {
      state.races.push(await store.saveRace({ name: DEFAULT_RACE.race_name, date: DEFAULT_RACE.race_date, distance_km: 42.195, goal_time: DEFAULT_RACE.goal_time, priority: 'A' }));
    } catch (e) { console.warn(e); }
  }
  const t = new Date();
  state.month = new Date(t.getFullYear(), t.getMonth(), 1);
  state.selected = todayIso();
  switchView(state.view);
}

(async function main() {
  bindStatic();
  try { await store.init(); }
  catch (e) { document.body.insertAdjacentHTML('afterbegin', `<p style="padding:12px;color:#dc2626">Supabase 연결 실패: ${esc(e.message)}</p>`); }
  await start();
})();
