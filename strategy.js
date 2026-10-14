// 대회 당일 전략: 구간별 페이스 밴드, 급수·젤 계획, 카보로딩, 준비물 체크리스트
import { toSec, fmtPace, fmtDuration } from './plan.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const DEFAULT_CHECKLIST = [
  ['전날', '배번·기록칩·옷핀 (배번 뒷면 비상연락처 작성)'], ['전날', '대회용 러닝화 (레이스 신발 확인)'], ['전날', '러닝 양말 (물집 방지)'],
  ['전날', '싱글렛·러닝 반바지 (날씨 확인)'], ['전날', '모자·선글라스'], ['전날', '시계 충전·대회 페이스 설정'],
  ['전날', '에너지젤 (계획 수량 + 1개 여유)'], ['전날', '바셀린·테이핑·밴드 (마찰 부위)'], ['전날', '버릴 옷/우비 (출발 대기용)'],
  ['전날', '물품보관 가방·갈아입을 옷·수건'], ['전날', '교통편·출발 시간·물품보관 마감 시간 확인'],
  ['당일 아침', '기상 (출발 3~4시간 전)'], ['당일 아침', '아침 식사: 탄수화물 위주 (체중 1kg당 1~3g)'], ['당일 아침', '화장실 2회 이상'],
  ['당일 아침', '출발 15분 전 젤 1개 + 물 몇 모금'], ['당일 아침', '가벼운 워밍업·동적 스트레칭'],
  ['완주 후', '회복 음료·간식 (단백질+탄수화물)'], ['완주 후', '보온 옷·슬리퍼'],
];

/** 구간별 목표 페이스 (초/km) 배열: 전략별 오프셋 → 총 시간 = 목표 기록이 되도록 보정 */
export function pacePlan(distKm, goalSec, mode = 'even') {
  const segs = [];
  for (let k = 5; k < distKm; k += 5) segs.push(k);
  segs.push(distKm);
  const base = goalSec / distKm;
  const off = (startKm, endKm) => {
    const mid = (startKm + endKm) / 2, f = mid / distKm;
    if (mode === 'negative') return f < 0.5 ? 6 : -6;
    if (mode === 'conservative') return startKm < 5 ? 10 : startKm < 10 ? 4 : endKm > distKm - 7.2 ? 0 : -2;
    return 0;
  };
  let prev = 0; const raw = segs.map(e => { const s = prev; prev = e; return { s, e, off: off(s, e) }; });
  const extra = raw.reduce((a, r) => a + r.off * (r.e - r.s), 0); // 보정
  const fix = -extra / distKm;
  let cum = 0;
  return raw.map(r => {
    const pace = base + r.off + fix; const t = pace * (r.e - r.s); cum += t;
    return { from: r.s, to: r.e, pace, segTime: t, cum, cumLo: cum - (r.e) * 5, cumHi: cum + (r.e) * 5 };
  });
}

/** 급수·젤 타임라인 */
export function fuelPlan(distKm, goalSec, opts) {
  const pace = goalSec / distKm;
  const gelEvery = Number(opts.gelEveryMin) || 40;
  const water = (opts.waterKm || '').split(/[,\s]+/).map(Number).filter(v => v > 0 && v < distKm).sort((a, b) => a - b);
  const ev = [{ km: 0, t: -15 * 60, what: `출발 15분 전: 젤 1개 + 물 2~3모금` }];
  for (let t = gelEvery * 60; t < goalSec - 15 * 60; t += gelEvery * 60) {
    const km = t / pace;
    const near = water.find(w => w >= km - 0.5) ?? null;
    ev.push({ km: near && near - km < 3 ? near : km, t: near && near - km < 3 ? near * pace : t, what: `젤 섭취${near && near - km < 3 ? ' (급수대에서 물과 함께)' : ' + 물'}`, gel: true });
  }
  for (const w of water) if (!ev.some(e => Math.abs(e.km - w) < 0.3)) ev.push({ km: w, t: w * pace, what: '급수: 물 또는 스포츠음료 몇 모금' });
  ev.sort((a, b) => a.t - b.t);
  const gels = ev.filter(e => e.gel).length + 1;
  const carbPerHour = Math.round((gels * 22) / (goalSec / 3600));
  return { events: ev, gels, carbPerHour };
}

export function carbLoading(weightKg, raceDate) {
  const w = Number(weightKg) || null;
  const d = n => { const x = new Date(raceDate + 'T00:00:00'); x.setDate(x.getDate() - n); return `${x.getMonth() + 1}/${x.getDate()}`; };
  const g = (a, b) => w ? `${Math.round(w * a)}~${Math.round(w * b)}g` : `체중×${a}~${b}g`;
  return [
    { day: `D-3 (${d(3)})`, carb: g(7, 8), tip: '평소 식사에서 밥·면·빵 비중 늘리기, 섬유질·지방은 조금 줄이기' },
    { day: `D-2 (${d(2)})`, carb: g(8, 10), tip: '간식으로 떡·바나나·카스텔라 등 추가, 수분 충분히' },
    { day: `D-1 (${d(1)})`, carb: g(8, 10), tip: '익숙한 음식만, 매운 음식·과식 피하기, 저녁은 일찍' },
    { day: '대회 당일 아침', carb: w ? `${Math.round(w * 1)}~${Math.round(w * 2)}g` : '체중×1~2g', tip: '출발 3~4시간 전 식사 (예: 밥/빵 + 바나나 + 꿀), 카페인은 평소 습관대로' },
  ];
}

export function renderStrategy(root, { race, weight, onSave }) {
  if (!race) { root.innerHTML = '<div class="card empty">예정된 대회가 없어요. 설정에서 대회를 추가하세요.</div>'; return; }
  const st = { mode: 'even', gelEveryMin: 40, waterKm: '5, 10, 15, 20, 25, 30, 35, 40', checklist: null, custom: [], ...(race.strategy || {}) };
  const dist = Number(race.distance_km) || 42.195;
  const goal = toSec(st.goal_override || race.goal_time) || toSec('3:30:00');
  const plan = pacePlan(dist, goal, st.mode);
  const fuel = fuelPlan(dist, goal, st);
  const carbs = carbLoading(weight, race.date);
  const items = st.checklist || DEFAULT_CHECKLIST.map(([g, t]) => ({ g, t, done: false }));
  const half = plan.find(p => p.to >= dist / 2);
  const halfTime = half ? half.cum - (half.to - dist / 2) * half.pace : null;
  root.innerHTML = `
    <div class="card">
      <div class="section-head wrap"><h2>${esc(race.name)} 레이스 전략</h2>
        <span class="muted">${race.date} · ${dist}km · 목표 ${fmtDuration(goal)} (평균 ${fmtPace(goal / dist)}/km)</span></div>
      <div class="row gap wrap">
        <label style="flex-direction:row;align-items:center;gap:6px">전략
          <select id="st-mode" style="width:auto">
            <option value="even" ${st.mode === 'even' ? 'selected' : ''}>이븐 페이스 (일정하게)</option>
            <option value="conservative" ${st.mode === 'conservative' ? 'selected' : ''}>초반 보수적 (첫 5km 여유)</option>
            <option value="negative" ${st.mode === 'negative' ? 'selected' : ''}>네거티브 스플릿 (후반 빠르게)</option>
          </select></label>
        <label style="flex-direction:row;align-items:center;gap:6px">목표 기록<input id="st-goal" value="${esc(st.goal_override || race.goal_time || '')}" style="width:110px"></label>
      </div>
      <h3 style="margin-top:16px">구간별 페이스 밴드</h3>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>구간</th><th>목표 페이스</th><th>허용 밴드 (±5초)</th><th>구간 시간</th><th>통과 목표 시각</th><th>통과 허용 범위</th></tr></thead>
        <tbody>${plan.map(p => `<tr><td>${p.from}~${p.to === dist ? 'Finish' : p.to + 'km'}</td><td><b>${fmtPace(p.pace)}</b></td><td>${fmtPace(p.pace - 5)}~${fmtPace(p.pace + 5)}</td><td>${fmtDuration(p.segTime)}</td><td><b>${fmtDuration(p.cum)}</b></td><td class="muted">${fmtDuration(p.cumLo)}~${fmtDuration(p.cumHi)}</td></tr>`).join('')}</tbody>
      </table></div>
      ${halfTime ? `<p class="muted" style="font-size:13px">하프 지점 통과 목표: <b>${fmtDuration(halfTime)}</b> · 30km 이후 페이스가 밴드보다 느려지면 젤·물 먼저 챙기고 자세(팔치기·케이던스)에 집중</p>` : ''}
    </div>
    <div class="card">
      <h3>급수·젤 섭취 계획</h3>
      <div class="row gap wrap">
        <label style="flex-direction:row;align-items:center;gap:6px">젤 간격(분)<input id="st-gel" type="number" min="20" max="90" value="${st.gelEveryMin}" style="width:80px"></label>
        <label style="flex-direction:row;align-items:center;gap:6px;flex:1">급수대 위치(km)<input id="st-water" value="${esc(st.waterKm)}" placeholder="5, 10, 15 ..."></label>
      </div>
      <p class="muted" style="font-size:13px">젤 총 ${fuel.gels}개 (출발 전 포함) · 시간당 탄수화물 약 ${fuel.carbPerHour}g (젤 1개 약 22g 기준, 권장 시간당 30~60g+)</p>
      <div class="table-wrap"><table class="table"><thead><tr><th>지점</th><th>예상 시각</th><th>할 일</th></tr></thead>
        <tbody>${fuel.events.map(e => `<tr class="${e.gel ? 'cur' : ''}"><td>${e.km ? e.km.toFixed(1) + 'km' : '출발 전'}</td><td>${e.t < 0 ? '-15분' : fmtDuration(e.t)}</td><td>${esc(e.what)}</td></tr>`).join('')}</tbody></table></div>
    </div>
    <div class="card">
      <h3>카보로딩</h3>
      ${weight ? `<p class="muted" style="font-size:13px">체중 ${weight}kg 기준 하루 탄수화물 목표</p>` : '<p class="muted" style="font-size:13px">설정 또는 컨디션 기록에 체중을 입력하면 g 단위로 계산돼요.</p>'}
      <div class="table-wrap"><table class="table"><thead><tr><th>날짜</th><th>탄수화물</th><th>방법</th></tr></thead>
        <tbody>${carbs.map(c => `<tr><td>${c.day}</td><td><b>${c.carb}</b></td><td style="white-space:normal">${esc(c.tip)}</td></tr>`).join('')}</tbody></table></div>
      <p class="muted" style="font-size:12px">참고: 밥 1공기 약 65g, 바나나 1개 약 25g, 식빵 1장 약 20g, 떡 100g 약 45g</p>
    </div>
    <div class="card">
      <div class="section-head"><h3 style="margin:0">준비물 체크리스트</h3><span class="muted">${items.filter(i => i.done).length}/${items.length} 완료</span></div>
      ${['전날', '당일 아침', '완주 후', '내 항목'].map(g => {
        const list = items.map((it, i) => ({ ...it, i })).filter(it => (it.g || '내 항목') === g);
        return list.length ? `<h4 class="ck-group">${g}</h4>${list.map(it => `<label class="ck"><input type="checkbox" data-i="${it.i}" ${it.done ? 'checked' : ''}><span>${esc(it.t)}</span>${it.g === '내 항목' ? `<button type="button" class="icon-btn sm" data-del="${it.i}" aria-label="삭제">×</button>` : ''}</label>`).join('')}` : '';
      }).join('')}
      <div class="row gap" style="margin-top:10px"><input id="st-new" placeholder="항목 추가 (예: 파워젤 카페인)"><button class="btn" id="st-add">추가</button><button class="btn sm" id="st-reset" style="margin-left:auto">체크 초기화</button></div>
    </div>`;
  const save = patch => onSave({ ...st, checklist: items, ...patch });
  root.querySelector('#st-mode').onchange = e => save({ mode: e.target.value });
  root.querySelector('#st-goal').onchange = e => { const v = e.target.value.trim(); if (!v || toSec(v)) save({ goal_override: v || null }); };
  root.querySelector('#st-gel').onchange = e => save({ gelEveryMin: Number(e.target.value) || 40 });
  root.querySelector('#st-water').onchange = e => save({ waterKm: e.target.value });
  root.querySelectorAll('.ck input').forEach(cb => cb.onchange = () => { items[+cb.dataset.i].done = cb.checked; save({}); });
  root.querySelectorAll('[data-del]').forEach(b => b.onclick = e => { e.preventDefault(); items.splice(+b.dataset.del, 1); save({}); });
  root.querySelector('#st-add').onclick = () => { const v = root.querySelector('#st-new').value.trim(); if (v) { items.push({ g: '내 항목', t: v, done: false }); save({}); } };
  root.querySelector('#st-reset').onclick = () => { items.forEach(i => i.done = false); save({}); };
}
