// 전체 훈련 계획 생성(베이스 → 빌드업 → 피크 → 테이퍼링) + 주간 부하 분석
import { fmtPace, fmtDuration } from './plan.js';
import { paceZones, hrZones } from './zones.js';

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = s => new Date(s + 'T00:00:00');
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
export const mondayOf = s => { const d = parse(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); };
const r05 = v => Math.max(0, Math.round(v * 2) / 2);

export const PHASES = {
  base: { label: '베이스', color: '#22c55e', desc: '유산소 기반·주간 거리 늘리기' },
  build: { label: '빌드업', color: '#3b82f6', desc: '템포·인터벌로 역치 향상' },
  peak: { label: '피크', color: '#ef4444', desc: '최장 거리·마라톤 페이스 집중' },
  taper: { label: '테이퍼링', color: '#eab308', desc: '거리 줄이고 강도 유지·회복' },
};
export const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

/** 단계 배분 (N주, 대회 주 포함) */
export function phaseSplit(N) {
  const taper = N >= 10 ? 3 : N >= 6 ? 2 : Math.min(N, 1 + (N >= 3 ? 1 : 0));
  const peak = N >= 12 ? 3 : N >= 8 ? 2 : N >= 5 ? 1 : 0;
  const rest = Math.max(0, N - taper - peak);
  const build = Math.round(rest * 0.55), base = rest - build;
  return { base, build, peak, taper };
}

/** 주간 거리 목표 (대회 주 = 대회 제외 거리) */
function weeklyVolumes(N, split, startKm, peakKm) {
  const vols = [], notes = [];
  const ramp = split.base + split.build;
  let prevNonRec = startKm;
  for (let i = 0; i < ramp; i++) {
    const isRec = i % 4 === 3;
    if (isRec) { vols.push(r05(prevNonRec * 0.75)); continue; }
    const remainNonRec = [...Array(ramp - i).keys()].filter(k => (i + k) % 4 !== 3).length;
    const ideal = prevNonRec * Math.pow(peakKm / prevNonRec, 1 / Math.max(1, remainNonRec + 1));
    const v = i === 0 ? startKm : Math.min(ideal, prevNonRec * 1.1);
    vols.push(r05(v)); prevNonRec = v;
  }
  const reachable = Math.min(peakKm, prevNonRec * 1.1);
  if (split.peak && reachable < peakKm - 0.5) notes.push(`주간 증가율 10% 제한 때문에 피크 주간 거리는 약 ${Math.round(reachable)}km가 돼요 (목표 ${peakKm}km).`);
  const pk = split.peak ? reachable : prevNonRec;
  for (let i = 0; i < split.peak; i++) vols.push(r05(pk * [1, 0.92, 1][i % 3]));
  const taperPct = split.taper >= 3 ? [0.75, 0.6, 0.4] : split.taper === 2 ? [0.65, 0.4] : [0.4];
  for (let i = 0; i < split.taper; i++) vols.push(r05(pk * taperPct[i]));
  return { vols, notes };
}

/** 주간 요일 배치: 장거리·포인트1·포인트2·이지·회복 */
function weekLayout(runDays, longDay) {
  const order = [1, 2, 3, 4, 5, 6, 0]; // 월~일
  const days = order.filter(d => runDays.includes(d));
  const pos = d => order.indexOf(d);
  const gap = (a, b) => (pos(b) - pos(a) + 7) % 7;
  const roles = {};
  if (days.includes(longDay)) roles[longDay] = 'long';
  const cands = days.filter(d => d !== longDay);
  const q1 = cands.find(d => gap(longDay, d) >= 2 && gap(d, longDay) >= 3) ?? cands[0];
  if (q1 != null) roles[q1] = 'q1';
  const q2 = cands.find(d => d !== q1 && gap(q1, d) >= 2 && gap(d, longDay) >= 2);
  if (q2 != null && days.length >= 4) roles[q2] = 'q2';
  for (const d of cands) if (!roles[d]) roles[d] = gap(longDay, d) === 1 ? 'recovery' : 'easy';
  return roles;
}

const durOf = (km, paceSec) => km && paceSec ? fmtDuration(Math.round(km * paceSec)) : null;

/** 단계·역할별 훈련 내용 */
function sessionFor(role, phase, wk, km, Z, H, isRec, dist) {
  const P = Z.raw, longCap = dist > 40 ? 32 : dist > 20 ? 20 : 15;
  const s = (type, title, details, paceStr, paceSec, hr) => ({ type, title, details, target_pace: paceStr, planned_duration: durOf(km, paceSec), target_hr: hr || null });
  const wu = '워밍업: 2km 조깅 + 동적 스트레칭·드릴', cd = '쿨다운: 1~2km 조깅';
  if (role === 'long') {
    if (phase === 'base' || isRec) return s('long', `LSD ${km}km`, `${km}km 편안한 장거리 @ ${Z.long.pace}/km\n대화 가능한 강도 유지, 보급 연습`, Z.long.pace, (P.E1 + P.E2) / 2 - 5, H?.long);
    if (phase === 'build') { const mp = Math.min(8, Math.round(km * 0.25)); return s('long', `LSD ${km}km (후반 MP ${mp}km)`, `${km - mp}km 이지 @ ${Z.long.pace}/km → 마지막 ${mp}km 마라톤 페이스 @ ${Z.mp.pace}/km\n대회용 신발·보급 리허설`, `${Z.long.pace} → MP ${fmtPace(P.M)}`, P.M + 35, H?.long); }
    if (phase === 'peak') { const mp = Math.min(14, Math.round(km * 0.4)); return s('long', `장거리 ${km}km (MP ${mp}km 포함)`, `${km - mp}km 이지 @ ${Z.long.pace}/km + ${mp}km 마라톤 페이스 @ ${Z.mp.pace}/km\n대회 페이스·보급·신발 최종 점검`, `MP ${Z.mp.pace}`, P.M + 25, H?.mp); }
    return s('long', `장거리 ${km}km`, `${km}km 이지 @ ${Z.long.pace}/km (마지막 3km 마라톤 페이스 터치 가능)\n테이퍼 기간: 무리하지 않기`, Z.long.pace, P.E1, H?.long);
  }
  if (role === 'q1') {
    if (phase === 'base' || isRec) {
      if (phase === 'base' && wk % 2 === 1 && !isRec) return s('hill', `업힐 반복 + 이지 ${km}km`, `${wu}\n본훈련: 언덕 150~200m × ${6 + Math.min(4, wk)}회 (힘 있게 오르고 걸어/조깅으로 내려오기)\n나머지 이지 @ ${Z.easy.pace}/km\n${cd}`, Z.easy.pace, P.E1, H?.hill);
      return s('easy', `이지 ${km}km + 스트라이드`, `${km}km 이지 @ ${Z.easy.pace}/km\n마무리: 스트라이드 100m × 6회`, Z.easy.pace, P.E1 + 10, H?.easy);
    }
    if (phase === 'build') { const reps = Math.min(6, 4 + Math.floor(wk / 2)); return s('interval', `인터벌 1km × ${reps}`, `${wu}\n본훈련: 1km × ${reps}회 @ ${Z.interval.pace}/km, 회복 400m 조깅(2~3분)\n${cd}`, Z.interval.pace, P.I + 70, H?.interval); }
    if (phase === 'peak') return s('interval', wk % 2 ? '인터벌 1.6km × 3' : '인터벌 1km × 6', `${wu}\n본훈련: ${wk % 2 ? '1.6km × 3회' : '1km × 6회'} @ ${Z.interval.pace}/km, 회복 400~600m 조깅\n${cd}`, Z.interval.pace, P.I + 70, H?.interval);
    return s('interval', '인터벌 1km × 4 (짧게)', `${wu}\n본훈련: 1km × 4회 @ ${Z.interval.pace}/km, 회복 400m 조깅\n${cd}\n테이퍼: 개수 늘리지 않기`, Z.interval.pace, P.I + 80, H?.interval);
  }
  if (role === 'q2') {
    if (isRec) return s('easy', `이지 ${km}km`, `${km}km 이지 @ ${Z.easy.pace}/km (회복 주간)`, Z.easy.pace, P.E1 + 10, H?.easy);
    if (phase === 'base') return wk >= 2
      ? s('tempo', `템포 ${Math.max(3, Math.round(km * 0.35))}km 포함 ${km}km`, `${wu}\n본훈련: 템포 ${Math.max(3, Math.round(km * 0.35))}km @ ${Z.tempo.pace}/km ('편하게 힘든' 강도)\n${cd}`, Z.tempo.pace, (P.T + P.E1) / 2, H?.tempo)
      : s('easy', `이지 ${km}km`, `${km}km 이지 @ ${Z.easy.pace}/km`, Z.easy.pace, P.E1 + 10, H?.easy);
    if (phase === 'build') { const t = Math.max(4, Math.min(10, Math.round(km * 0.55))); return s('tempo', `템포 ${t}km`, `${wu}\n본훈련: 템포 ${t}km @ ${Z.tempo.pace}/km (또는 크루즈 인터벌 ${Math.round(t / 2)}km × 2, 회복 2분)\n${cd}`, Z.tempo.pace, (P.T + P.E1) / 2 + 10, H?.tempo); }
    if (phase === 'peak') { const m = Math.max(6, Math.min(16, Math.round(km * 0.7))); return s('mp', `MP런 ${m}km`, `${wu}\n본훈련: 마라톤 페이스 ${m}km @ ${Z.mp.pace}/km\n${cd}\n대회 페이스 감각·호흡 확인`, Z.mp.pace, P.M + 20, H?.mp); }
    return s('mp', `MP 터치 ${Math.max(3, Math.round(km * 0.5))}km`, `${wu}\n본훈련: 마라톤 페이스 ${Math.max(3, Math.round(km * 0.5))}km @ ${Z.mp.pace}/km\n${cd}`, Z.mp.pace, P.M + 30, H?.mp);
  }
  if (role === 'recovery') return s('recovery', `회복런 ${km}km`, `${km}km 아주 편하게 @ ${Z.recovery.pace}/km\n장거리 다음 날 회복 목적`, Z.recovery.pace, P.E2 + 15, H?.recovery);
  return s('easy', `이지 ${km}km`, `${km}km 이지 @ ${Z.easy.pace}/km`, Z.easy.pace, P.E1 + 10, H?.easy);
}

/**
 * 계획 생성
 * opts: { race, weeks, startDate, startKm, peakKm, runDays:[0..6], longDay, settings, restHr }
 * 반환: { weeks:[{idx, mon, phase, vol, isRec, items}], workouts:[...], notes:[] }
 */
export function generatePlan(opts) {
  const { race, weeks: N, startKm, peakKm, runDays, longDay, settings } = opts;
  const dist = Number(race.distance_km) || 42.195;
  const Z = paceZones(race) || paceZones({ ...race, distance_km: 42.195, goal_time: '3:30:00' });
  const H = hrZones(settings || {}, opts.restHr);
  const raceMon = mondayOf(race.date);
  const firstMon = addDays(raceMon, -7 * (N - 1));
  const split = phaseSplit(N);
  const { vols, notes } = weeklyVolumes(N, split, startKm, peakKm);
  const roles = weekLayout(runDays, longDay);
  const startDate = opts.startDate || firstMon;
  const out = [], weeksOut = [];
  const phaseOf = i => i < split.base ? 'base' : i < split.base + split.build ? 'build' : i < split.base + split.build + split.peak ? 'peak' : 'taper';
  const phaseWeek = i => { const p = phaseOf(i); const st = { base: 0, build: split.base, peak: split.base + split.build, taper: split.base + split.build + split.peak }[p]; return i - st + 1; };
  for (let i = 0; i < N; i++) {
    const mon = addDays(firstMon, 7 * i);
    const phase = phaseOf(i), pw = phaseWeek(i);
    const isRec = (phase === 'base' || phase === 'build') && i % 4 === 3;
    const isRaceWeek = i === N - 1;
    const vol = vols[i];
    const items = [];
    const dayList = [1, 2, 3, 4, 5, 6, 0].map(d => ({ d, date: addDays(mon, (d + 6) % 7), role: roles[d] || 'rest' }));
    // 거리 배분
    const share = { long: phase === 'peak' ? 0.32 : phase === 'base' ? 0.28 : 0.3, q1: 0.16, q2: 0.17 };
    const runL = dayList.filter(x => x.role !== 'rest');
    const longCap = dist > 40 ? 32 : dist > 20 ? 21 : 16;
    // 장거리 진행: 시작 → 피크 최장 거리까지 점진 증가, 회복주 75%, 테이퍼 75%·55%
    const ramp = split.base + split.build + split.peak;
    const longStart = Math.min(longCap * 0.7, Math.max(12, startKm * 0.32));
    let longTarget;
    if (phase === 'taper') longTarget = longCap * ([0.75, 0.55][i - ramp] ?? 0.5);
    else longTarget = longStart + (longCap - longStart) * Math.min(1, i / Math.max(1, ramp - 2));
    if (isRec) longTarget *= 0.75;
    let km = {};
    if (isRaceWeek) {
      // 대회 주: 대회일 이전 날만, 가볍게
      const pre = runL.filter(x => x.date < race.date);
      for (const x of pre) {
        const dl = Math.round((parse(race.date) - parse(x.date)) / 86400000);
        km[x.d] = dl >= 5 ? 7 : dl === 4 ? 6 : dl === 3 ? 5 : 3;
      }
    } else {
      km[longDay] = Math.min(longCap, r05(Math.min(Math.max(vol * share.long, longTarget), vol * 0.45)));
      for (const x of runL) if (x.role === 'q1') km[x.d] = r05(vol * share.q1);
      for (const x of runL) if (x.role === 'q2') km[x.d] = r05(vol * share.q2);
      const rest = vol - Object.values(km).reduce((a, b) => a + b, 0);
      const others = runL.filter(x => km[x.d] == null);
      const w = others.map(x => x.role === 'recovery' ? 0.8 : 1), ws = w.reduce((a, b) => a + b, 0) || 1;
      others.forEach((x, k) => { km[x.d] = Math.max(4, r05(rest * w[k] / ws)); });
    }
    const pinfo = `${PHASES[phase].label} ${pw}주차${isRec ? ' (회복 주)' : ''} · 전체 ${i + 1}/${N}주 · 주간 ${vol}km`;
    for (const x of dayList) {
      if (x.date > race.date) continue;
      let w;
      if (x.date === race.date) {
        w = { type: 'race', title: race.name, planned_distance: dist, target_pace: Z.race.pace, planned_duration: race.goal_time || null, target_hr: H?.race || null,
          details: `대회: ${race.name}\n목표 기록: ${race.goal_time || '-'} (평균 ${Z.race.pace}/km)\n전략은 '대회 전략' 탭 참고` };
      } else if (x.role === 'rest' || km[x.d] == null) {
        w = { type: 'rest', title: '휴식', planned_distance: null, details: isRaceWeek ? '완전 휴식 · 수면·탄수화물 챙기기' : '휴식 또는 가벼운 스트레칭·폼롤러 (원하면 크로스트레이닝 30분)' };
      } else if (isRaceWeek) {
        const dleft = Math.round((parse(race.date) - parse(x.date)) / 86400000);
        if (dleft === 1) w = { type: 'recovery', title: '셰이크아웃 3km', planned_distance: 3, target_pace: Z.recovery.pace, details: `3km 가볍게 + 스트라이드 2회\n대회 준비물·동선 확인, 일찍 취침` };
        else if (dleft <= 2) { w = { type: 'rest', title: '휴식 + 카보로딩', planned_distance: null, details: '완전 휴식, 탄수화물 위주 식사' }; }
        else w = (x.role === 'q1' || x.role === 'q2') && dleft >= 4
          ? { type: 'mp', title: `MP 터치 ${km[x.d]}km`, planned_distance: km[x.d], target_pace: Z.mp.pace, details: `이지 → 마라톤 페이스 2~3km @ ${Z.mp.pace}/km → 이지\n몸이 가벼워도 더 하지 않기` }
          : { type: 'easy', title: `이지 ${km[x.d]}km`, planned_distance: km[x.d], target_pace: Z.easy.pace, details: `${km[x.d]}km 이지 @ ${Z.easy.pace}/km + 스트라이드 2~4회` };
      } else {
        w = { ...sessionFor(x.role, phase, pw, km[x.d], Z, H, isRec, dist), planned_distance: km[x.d] };
      }
      // 직전 대회 후 회복 기간 (대회 다음 날~3일 휴식, 4~10일 짧은 회복 조깅)
      if (opts.recoverFrom && x.date > opts.recoverFrom && w.type !== 'race') {
        const after = Math.round((parse(x.date) - parse(opts.recoverFrom)) / 86400000);
        if (after <= 3) w = { type: 'rest', title: '대회 후 회복 휴식', planned_distance: null, details: `직전 대회 후 ${after}일째: 완전 휴식·가벼운 걷기·수면` };
        else if (after <= 10 && w.type !== 'rest') {
          const k2 = Math.min(after <= 6 ? 5 : 8, Number(w.planned_distance) || 6);
          w = { type: 'recovery', title: `회복 조깅 ${k2}km`, planned_distance: k2, target_pace: Z.recovery.pace, details: `직전 대회 후 ${after}일째: ${k2}km 아주 편하게 @ ${Z.recovery.pace}/km\n통증·피로가 남아 있으면 휴식으로 대체` };
        }
      }
      if (!w.planned_duration && w.planned_distance && w.type !== 'race') w.planned_duration = durOf(w.planned_distance, Z.raw.E1);
      if (!w.target_hr && H) w.target_hr = { easy: H.easy, recovery: H.recovery, mp: H.mp, long: H.long }[w.type] || null;
      w = { ...w, date: x.date, status: 'planned', race_id: race.id, phase: `${PHASES[phase].label} ${pw}주차`, details: `[${pinfo}]\n${w.details || ''}` };
      if (x.date >= startDate) { out.push(w); items.push(w); }
    }
    weeksOut.push({ idx: i + 1, mon, phase, pw, vol, isRec, isRaceWeek, items, included: addDays(mon, 6) >= startDate });
  }
  if (opts.recoverFrom) notes.push(`직전 대회(${opts.recoverFrom}) 직후 10일은 회복 위주로 넣었어요.`);
  if (startDate > firstMon) notes.push(`대회까지 남은 기간이 짧아 ${startDate} 이후 일정만 넣어요 (앞 단계는 건너뜀).`);
  if (H?.estimated) notes.push(`심박 존은 최대심박 추정치(${H.max})로 계산했어요. 설정에서 실제 최대심박을 입력하면 더 정확해져요.`);
  return { weeks: weeksOut, workouts: out, notes, split, zones: Z };
}

/* ---------- 주간 부하 분석 ---------- */
/** 주별 거리(지난 주=실제, 이번 주=실제+남은 계획, 이후=계획) + 경고 */
export function weeklyLoad(workouts, today, back = 8, ahead = 3) {
  const thisMon = mondayOf(today);
  const rows = [];
  for (let k = -back; k <= ahead; k++) {
    const m = addDays(thisMon, 7 * k), e = addDays(m, 6);
    const ws = workouts.filter(w => !['rest', 'cross', 'strength'].includes(w.type) && w.date >= m && w.date <= e);
    const done = ws.filter(w => w.status === 'done').reduce((s, w) => s + Number(w.actual_distance || w.planned_distance || 0), 0);
    const plan = ws.reduce((s, w) => s + Number(w.planned_distance || 0), 0);
    const remain = ws.filter(w => w.status !== 'done' && w.date >= today).reduce((s, w) => s + Number(w.planned_distance || 0), 0);
    const km = k < 0 ? done : k === 0 ? done + remain : plan;
    rows.push({ mon: m, km, done, plan, kind: k < 0 ? 'past' : k === 0 ? 'current' : 'future', hasRace: ws.some(w => w.type === 'race') });
  }
  const warns = [];
  rows.forEach((r, i) => {
    const p = rows[i - 1];
    r.change = p && p.km >= 10 ? (r.km - p.km) / p.km : null;
    r.over = r.change != null && r.change > 0.1 && !r.hasRace && r.kind !== 'past';
    r.overPast = r.change != null && r.change > 0.1 && !r.hasRace && r.kind === 'past';
  });
  // 회복주 제안: 직전 3주 연속 감소 없이 유지·증가했으면 다음 주는 회복주 권장
  const cur = rows.findIndex(r => r.kind === 'current');
  const last3 = rows.slice(cur - 2, cur + 1);
  const noDown = last3.length === 3 && last3.every((r, i) => i === 0 || r.km >= rows[cur - 3 + i].km * 0.85) && last3.every(r => r.km >= 15);
  for (const r of rows) if (r.over) warns.push({ level: 'warn', mon: r.mon, text: `${r.mon.slice(5).replace('-', '/')} 주 거리 ${r.km.toFixed(1)}km: 전주 대비 +${Math.round(r.change * 100)}% (10% 초과)` });
  const nextRow = rows[cur + 1];
  if (noDown && nextRow && !nextRow.hasRace && !(nextRow.km <= rows[cur].km * 0.8)) {
    warns.push({ level: 'info', mon: nextRow.mon, text: `최근 3주 동안 거리를 유지·증가했어요. 다음 주(${nextRow.mon.slice(5).replace('-', '/')}~)는 회복주로 20~30% 줄이는 걸 권장해요 (약 ${Math.round(rows[cur].km * 0.75)}km).` });
  }
  return { rows, warns };
}
