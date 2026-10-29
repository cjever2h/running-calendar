// 모바일 UI 패턴 모음: 바텀시트·서랍 메뉴·당겨서 새로고침·밀어서 삭제·자동완성·단계 표시·스켈레톤
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const isMobile = () => window.matchMedia('(max-width: 760px)').matches;

/* ---------- 바텀시트: 아래로 끌어서 닫기 ---------- */
export function sheetDrag(sheetEl, onClose) {
  const handle = sheetEl;
  let y0 = null, dy = 0;
  const start = e => {
    if (!isMobile()) return;
    const body = sheetEl.querySelector('.modal-scroll') || sheetEl;
    if (e.target.closest('input,textarea,select,button,a,label') && !e.target.closest('.sheet-handle')) return;
    if (body.scrollTop > 0 && !e.target.closest('.sheet-handle,.modal-head')) return;
    y0 = e.touches[0].clientY; dy = 0; sheetEl.style.transition = 'none';
  };
  const move = e => {
    if (y0 == null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    if (dy > 4) { sheetEl.style.transform = `translateY(${dy}px)`; e.cancelable && e.preventDefault(); }
  };
  const end = () => {
    if (y0 == null) return;
    sheetEl.style.transition = '';
    if (dy > 110) { sheetEl.style.transform = 'translateY(100%)'; setTimeout(() => { sheetEl.style.transform = ''; onClose(); }, 180); }
    else sheetEl.style.transform = '';
    y0 = null;
  };
  handle.addEventListener('touchstart', start, { passive: true });
  sheetEl.addEventListener('touchmove', move, { passive: false });
  sheetEl.addEventListener('touchend', end);
}

/* ---------- 액션 시트 (선택지를 아래에서 띄우기) ---------- */
export function actionSheet(title, actions) {
  document.querySelector('.asheet-backdrop')?.remove();
  const bd = document.createElement('div');
  bd.className = 'asheet-backdrop';
  bd.innerHTML = `<div class="asheet" role="dialog" aria-label="${esc(title)}"><div class="sheet-handle"><i></i></div>
    ${title ? `<div class="asheet-title">${esc(title)}</div>` : ''}
    ${actions.map((a, i) => `<button class="asheet-item ${a.danger ? 'danger' : ''}" data-i="${i}">${a.icon ? `<span class="ai">${a.icon}</span>` : ''}<span>${esc(a.label)}${a.sub ? `<small>${esc(a.sub)}</small>` : ''}</span></button>`).join('')}
    <button class="asheet-item cancel">취소</button></div>`;
  document.body.appendChild(bd);
  requestAnimationFrame(() => bd.classList.add('open'));
  const close = () => { bd.classList.remove('open'); setTimeout(() => bd.remove(), 200); };
  bd.addEventListener('click', e => {
    if (e.target === bd || e.target.closest('.cancel')) return close();
    const b = e.target.closest('.asheet-item[data-i]'); if (!b) return;
    close(); actions[+b.dataset.i].onClick?.();
  });
  sheetDrag(bd.querySelector('.asheet'), close);
  return close;
}

/* ---------- 서랍 메뉴 ---------- */
export function drawer(sections, { title = '', sub = '' } = {}) {
  document.querySelector('.drawer-backdrop')?.remove();
  const bd = document.createElement('div');
  bd.className = 'drawer-backdrop';
  bd.innerHTML = `<nav class="drawer" aria-label="메뉴"><div class="drawer-head"><div class="logo sm">42<span>.195</span></div><div><b>${esc(title)}</b><small>${esc(sub)}</small></div></div>
    ${sections.map((s, si) => `<div class="drawer-sec">${s.title ? `<div class="drawer-st">${esc(s.title)}</div>` : ''}${s.items.map((it, ii) => `<button class="drawer-item ${it.active ? 'on' : ''} ${it.danger ? 'danger' : ''}" data-s="${si}" data-i="${ii}"><span class="ai">${it.icon || ''}</span>${esc(it.label)}</button>`).join('')}</div>`).join('')}</nav>`;
  document.body.appendChild(bd);
  requestAnimationFrame(() => bd.classList.add('open'));
  const close = () => { bd.classList.remove('open'); setTimeout(() => bd.remove(), 220); };
  bd.addEventListener('click', e => {
    if (e.target === bd) return close();
    const b = e.target.closest('.drawer-item'); if (!b) return;
    close(); sections[+b.dataset.s].items[+b.dataset.i].onClick?.();
  });
  // 왼쪽으로 밀어서 닫기
  const nav = bd.querySelector('.drawer'); let x0 = null;
  nav.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
  nav.addEventListener('touchmove', e => { if (x0 == null) return; const dx = Math.min(0, e.touches[0].clientX - x0); nav.style.transform = `translateX(${dx}px)`; }, { passive: true });
  nav.addEventListener('touchend', e => { const dx = (e.changedTouches[0].clientX - (x0 ?? 0)); nav.style.transform = ''; if (dx < -70) close(); x0 = null; });
  return close;
}

/* ---------- 당겨서 새로고침 ---------- */
export function pullToRefresh(onRefresh, { isEnabled = () => true } = {}) {
  const ind = document.createElement('div');
  ind.className = 'ptr'; ind.innerHTML = '<i class="ptr-spin"></i><span>당겨서 새로고침</span>';
  document.body.appendChild(ind);
  let y0 = null, dy = 0, busy = false;
  window.addEventListener('touchstart', e => {
    if (busy || window.scrollY > 0 || !isEnabled() || document.querySelector('.modal-backdrop:not(.hidden),.asheet-backdrop,.drawer-backdrop')) { y0 = null; return; }
    y0 = e.touches[0].clientY; dy = 0;
  }, { passive: true });
  window.addEventListener('touchmove', e => {
    if (y0 == null) return;
    dy = e.touches[0].clientY - y0;
    if (dy <= 0 || window.scrollY > 0) { ind.style.transform = ''; ind.classList.remove('show', 'ready'); return; }
    const d = Math.min(110, dy * 0.5);
    ind.classList.add('show'); ind.classList.toggle('ready', d >= 70);
    ind.style.transform = `translate(-50%, ${d}px)`;
    ind.querySelector('span').textContent = d >= 70 ? '놓으면 새로고침' : '당겨서 새로고침';
  }, { passive: true });
  window.addEventListener('touchend', async () => {
    if (y0 == null) return;
    y0 = null;
    if (!ind.classList.contains('ready')) { ind.style.transform = ''; ind.classList.remove('show'); return; }
    busy = true; ind.classList.add('loading'); ind.querySelector('span').textContent = '새로 불러오는 중...';
    ind.style.transform = 'translate(-50%, 70px)';
    try { await onRefresh(); } finally {
      busy = false; ind.classList.remove('loading', 'ready', 'show'); ind.style.transform = '';
    }
  });
}

/* ---------- 밀어서 삭제 ---------- */
export function swipeToDelete(row, onDelete, { label = '삭제' } = {}) {
  if (row.dataset.swipe) return;
  row.dataset.swipe = '1';
  row.classList.add('swipe-row');
  const inner = document.createElement('div'); inner.className = 'swipe-inner';
  while (row.firstChild) inner.appendChild(row.firstChild);
  const del = document.createElement('button'); del.type = 'button'; del.className = 'swipe-del'; del.textContent = label;
  row.append(del, inner);
  const W = 84; let x0 = null, y0 = null, dx = 0, open = false, horiz = null;
  const set = x => { inner.style.transform = x ? `translateX(${x}px)` : ''; };
  const closeAll = () => document.querySelectorAll('.swipe-row.open').forEach(r => { if (r !== row) { r.classList.remove('open'); r.querySelector('.swipe-inner').style.transform = ''; } });
  inner.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') { if (e.button !== 0) return; e.preventDefault(); } x0 = e.clientX; y0 = e.clientY; dx = 0; horiz = null; inner.style.transition = 'none'; });
  inner.addEventListener('pointermove', e => {
    if (x0 == null) return;
    const mx = e.clientX - x0, my = e.clientY - y0;
    if (horiz == null && (Math.abs(mx) > 8 || Math.abs(my) > 8)) { horiz = Math.abs(mx) > Math.abs(my); if (horiz) { closeAll(); inner.setPointerCapture?.(e.pointerId); } }
    if (!horiz) return;
    dx = Math.max(-W * 1.6, Math.min(0, (open ? -W : 0) + mx)); set(dx);
  });
  const end = () => {
    if (x0 == null) return;
    inner.style.transition = '';
    if (horiz) {
      if (dx < -W * 1.4) { set(-row.offsetWidth); setTimeout(onDelete, 120); }
      else { open = dx < -W / 2; row.classList.toggle('open', open); set(open ? -W : 0); }
    }
    x0 = null;
  };
  inner.addEventListener('pointerup', end);
  inner.addEventListener('pointercancel', () => { if (x0 == null) return; inner.style.transition = ''; set(open ? -W : 0); x0 = null; horiz = null; });
  // 밀다가 놓았을 때 클릭으로 처리되지 않도록
  inner.addEventListener('click', e => { if (horiz || open) { e.stopPropagation(); e.preventDefault(); if (open && !horiz) { open = false; row.classList.remove('open'); set(0); } horiz = null; } }, true);
  del.addEventListener('click', e => { e.stopPropagation(); onDelete(); });
}

/* ---------- 자동완성 ---------- */
export function autocomplete(input, getItems, onPick, { max = 8 } = {}) {
  const wrap = document.createElement('div'); wrap.className = 'ac-wrap';
  input.parentNode.insertBefore(wrap, input); wrap.appendChild(input);
  const list = document.createElement('div'); list.className = 'ac-list hidden'; list.setAttribute('role', 'listbox');
  wrap.appendChild(list);
  input.setAttribute('autocomplete', 'off');
  let items = [], idx = -1;
  const hl = (t, q) => { if (!q) return esc(t); const i = t.toLowerCase().indexOf(q.toLowerCase()); return i < 0 ? esc(t) : esc(t.slice(0, i)) + '<mark>' + esc(t.slice(i, i + q.length)) + '</mark>' + esc(t.slice(i + q.length)); };
  const render = () => {
    const q = input.value.trim();
    items = getItems(q).slice(0, max); idx = -1;
    if (!items.length || (items.length === 1 && items[0].label === q)) { list.classList.add('hidden'); return; }
    list.innerHTML = items.map((it, i) => `<div class="ac-item" role="option" data-i="${i}"><span>${hl(it.label, q)}</span>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</div>`).join('');
    list.classList.remove('hidden');
  };
  const pick = i => { const it = items[i]; if (!it) return; input.value = it.label; list.classList.add('hidden'); onPick?.(it); input.dispatchEvent(new Event('change')); };
  input.addEventListener('input', render);
  input.addEventListener('focus', render);
  input.addEventListener('keydown', e => {
    if (list.classList.contains('hidden')) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); idx = (idx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; $$(list).forEach((el, i) => el.classList.toggle('on', i === idx)); }
    else if (e.key === 'Enter' && idx >= 0) { e.preventDefault(); pick(idx); }
    else if (e.key === 'Escape') { list.classList.add('hidden'); e.stopPropagation(); }
  });
  list.addEventListener('mousedown', e => { e.preventDefault(); const el = e.target.closest('.ac-item'); if (el) pick(+el.dataset.i); });
  input.addEventListener('blur', () => setTimeout(() => list.classList.add('hidden'), 120));
  function $$(l) { return [...l.querySelectorAll('.ac-item')]; }
}

/* ---------- 단계 표시 ---------- */
export function stepperHTML(steps, cur) {
  return `<ol class="stepper">${steps.map((s, i) => `<li class="${i < cur ? 'done' : i === cur ? 'cur' : ''}" data-step="${i}"><i>${i < cur ? '✓' : i + 1}</i><span>${esc(s)}</span></li>`).join('')}</ol>`;
}

/* ---------- 스켈레톤 ---------- */
export function skeleton(kind) {
  const L = (w, h = 12) => `<i class="sk" style="width:${w};height:${h}px"></i>`;
  if (kind === 'stats') return Array.from({ length: 4 }, () => `<div class="stat">${L('60%', 10)}${L('45%', 22)}</div>`).join('');
  if (kind === 'calendar') return Array.from({ length: 35 }, () => `<div class="day sk-day">${L('22px', 10)}${L('80%', 14)}</div>`).join('');
  if (kind === 'panel') return `${L('50%', 18)}<div class="sk-card">${L('30%', 14)}${L('70%', 16)}${L('100%', 60)}${L('100%', 38)}</div><div class="sk-card">${L('40%', 14)}${L('90%', 40)}</div>`;
  if (kind === 'chart') return `<div class="sk-chart">${Array.from({ length: 10 }, (_, i) => `<i class="sk" style="height:${30 + ((i * 37) % 60)}%"></i>`).join('')}</div>`;
  if (kind === 'list') return Array.from({ length: 4 }, () => `<div class="sk-card">${L('35%', 12)}${L('85%', 14)}</div>`).join('');
  return L('100%', 14);
}
