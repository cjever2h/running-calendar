// 통계 > 성장: 연속 달리기·러닝 흐름·유형별 강도·같은 페이스 심박·지표 추세·습관·PR·나의 여정
import { toSec, fmtPace, fmtDuration } from './plan.js';
import { TYPE_RPE, esc, parse, iso, addDays, mondayOf, isRunDone, kmOf, paceSec, startOf, typeLabel, rpeColor, rpeText, rpeName, isDark } from './runview.js';

const pad = n => String(n).padStart(2, '0');
const median = a => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
const short = s => `${+s.slice(5, 7)}/${+s.slice(8)}`;
const yy = s => `${s.slice(2, 4)}.${+s.slice(5, 7)}.${+s.slice(8)}`;
const WD = ['일', '월', '화', '수', '목', '금', '토'];

function streakWeeks(runs, today) {
  const weeks = new Set(runs.map(w => mondayOf(w.date)));
  let m = mondayOf(today); if (!weeks.has(m)) m = addDays(m, -7);
  let n = 0; while (weeks.has(m)) { n++; m = addDays(m, -7); }
  return n;
}

/* SVG 선 그리기 (값 배열 → path) */
function linePath(pts, x, y) { return pts.filter(p => p.v != null).map((p, i) => `${i ? 'L' : 'M'}${x(p.i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' '); }
function spark(vals, color) {
  const v = vals.filter(x => x != null); if (v.length < 2) return '';
  const lo = Math.min(...v), hi = Math.max(...v), W = 120, H = 30, rng = hi - lo || 1;
  const pts = vals.map((val, i) => ({ i, v: val }));
  const x = i => 4 + i * (W - 8) / (vals.length - 1), y = val => H - 4 - (val - lo) / rng * (H - 8);
  return `<svg viewBox="0 0 ${W} ${H}" class="gr-spark" preserveAspectRatio="none"><path d="${linePath(pts, x, y)}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>${pts.filter(p => p.v != null).map(p => `<circle cx="${x(p.i)}" cy="${y(p.v)}" r="2.2" fill="${color}"/>`).join('')}</svg>`;
}

export function renderGrowth(root, { workouts, logs, races, today, flowOffset = 0, onPick, onShift, onRun }) {
  const runs = workouts.filter(isRunDone).sort((a, b) => a.date.localeCompare(b.date));
  if (!runs.length) { root.innerHTML = '<div class="empty">완료한 러닝이 쌓이면 성장 기록이 보여요.</div>'; return; }
  const acc = isDark() ? '#facc15' : '#1e3a8a';

  /* 지난주 */
  const thisMon = mondayOf(today), lastMon = addDays(thisMon, -7);
  const lw = runs.filter(w => w.date >= lastMon && w.date < thisMon);
  const lwKm = lw.reduce((s, w) => s + kmOf(w), 0), lwSec = lw.reduce((s, w) => s + (toSec(w.actual_time) || 0), 0);
  const streak = streakWeeks(runs, today);
  const tw = runs.filter(w => w.date >= thisMon);

  /* 18주 히트맵 */
  const hmStart = addDays(thisMon, -17 * 7);
  const dayKm = {}; runs.forEach(w => { dayKm[w.date] = (dayKm[w.date] || 0) + kmOf(w); });
  const days18 = new Set(runs.filter(w => w.date >= hmStart).map(w => w.date)).size;
  let hm = '<div class="gr-hm-days"><span></span>' + ['월', '', '수', '', '금', '토', '일'].map(d => `<span>${d}</span>`).join('') + '</div><div class="gr-hm">';
  for (let c = 0; c < 18; c++) {
    const mon = addDays(hmStart, c * 7);
    hm += `<div class="gr-col"><span class="gr-m">${c % 4 === 0 ? short(mon) : ''}</span>`;
    for (let r = 0; r < 7; r++) { const d = addDays(mon, r); const k = dayKm[d] || 0; const lv = d > today ? 'f' : !k ? 0 : k < 6 ? 1 : k < 11 ? 2 : k < 20 ? 3 : 4; hm += `<i class="l${lv}" data-d="${d}" title="${d} ${k ? k.toFixed(1) + 'km' : ''}"></i>`; }
    hm += '</div>';
  }
  hm += '</div>';

  /* 러닝 흐름 (30일) */
  const fEnd = addDays(today, -30 * flowOffset), fStart = addDays(fEnd, -29);
  const fr = runs.filter(w => w.date >= fStart && w.date <= fEnd);
  const prev = runs.filter(w => w.date >= addDays(fStart, -30) && w.date < fStart);
  const fKm = fr.reduce((s, w) => s + kmOf(w), 0);
  const paces = fr.map(paceSec).filter(Boolean);
  const hrAvg = l => { const h = l.filter(w => w.avg_hr); return h.length ? Math.round(h.reduce((s, w) => s + w.avg_hr, 0) / h.length) : null; };
  const easyN = fr.filter(w => (w.rpe ? w.rpe <= 4 : ['easy', 'recovery', 'long'].includes(w.type))).length;
  const W = 640, H = 210, L = 40, R = 34, T = 14, B = 26;
  const xd = d => L + (Math.round((parse(d) - parse(fStart)) / 86400000) + .5) * (W - L - R) / 30;
  const maxKm = Math.max(10, ...fr.map(kmOf)); const kmY = k => H - B - k / maxKm * (H - T - B);
  const pMin = paces.length ? Math.min(...paces) - 10 : 280, pMax = paces.length ? Math.max(...paces) + 10 : 420;
  const pY = p => T + (p - pMin) / (pMax - pMin || 1) * (H - T - B) * .9;
  const hrs = fr.map(w => w.avg_hr).filter(Boolean); const hMin = Math.min(...hrs, 200) - 5, hMax = Math.max(...hrs, 0) + 5;
  const hY = h => T + (1 - (h - hMin) / (hMax - hMin || 1)) * (H - T - B) * .55;
  const bw = Math.max(5, (W - L - R) / 30 * .6);
  const bars = fr.map(w => { const est = !w.rpe && TYPE_RPE[w.type]; const c = rpeColor(w.rpe || TYPE_RPE[w.type]) || (isDark() ? '#475569' : '#cbd5e1'); return `<rect class="gr-bar" data-id="${w.id}" opacity="${est ? .45 : .9}" x="${(xd(w.date) - bw / 2).toFixed(1)}" y="${kmY(kmOf(w)).toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - B - kmY(kmOf(w))).toFixed(1)}" rx="3" fill="${c}"><title>${w.date} ${w.title} ${kmOf(w).toFixed(1)}km${paceSec(w) ? ' ' + fmtPace(paceSec(w)) : ''}${w.avg_hr ? ' ' + w.avg_hr + 'bpm' : ''}${w.rpe ? ' 강도' + w.rpe : ''}</title></rect>`; }).join('');
  const pp = fr.filter(paceSec).map(w => `${xd(w.date).toFixed(1)},${pY(paceSec(w)).toFixed(1)}`);
  const hp = fr.filter(w => w.avg_hr).map(w => `${xd(w.date).toFixed(1)},${hY(w.avg_hr).toFixed(1)}`);
  const ticks = [0, 7, 14, 21, 29].map(k => addDays(fStart, k));
  const flowSvg = `<svg viewBox="0 0 ${W} ${H}" class="gr-flow" preserveAspectRatio="none">
    <line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" class="gr-axis"/>
    ${bars}
    ${pp.length > 1 ? `<polyline points="${pp.join(' ')}" fill="none" stroke="${acc}" stroke-width="2.4" stroke-linejoin="round"/>${pp.map(p => `<circle cx="${p.split(',')[0]}" cy="${p.split(',')[1]}" r="3" fill="${acc}"/>`).join('')}` : ''}
    ${hp.length > 1 ? `<polyline points="${hp.join(' ')}" fill="none" stroke="#f43f5e" stroke-width="2" stroke-linejoin="round"/>` : ''}
    ${paces.length ? `<text x="4" y="${pY(Math.min(...paces)) + 4}" class="gr-tk">${fmtPace(Math.min(...paces))}</text><text x="4" y="${pY(Math.max(...paces)) + 4}" class="gr-tk">${fmtPace(Math.max(...paces))}</text>` : ''}
    <text x="${W - 4}" y="${kmY(maxKm) + 10}" class="gr-tk" text-anchor="end">${Math.round(maxKm)}km</text>
    ${ticks.map(d => `<text x="${xd(d)}" y="${H - 8}" class="gr-tk" text-anchor="middle">${short(d)}</text>`).join('')}
  </svg>`;
  const hrPrev = hrAvg(prev), hrNow = hrAvg(fr);
  const prevKm = prev.reduce((s, w) => s + kmOf(w), 0);
  const flowMsg = !fr.length ? '이 기간에는 러닝이 없어요.' : prevKm && fKm < prevKm * .8 ? '거리를 줄인 구간입니다.' : prevKm && fKm > prevKm * 1.2 ? '거리를 늘린 구간입니다.' : '비슷한 거리를 유지한 구간입니다.';

  /* 유형별 평소 강도 */
  const typesR = ['easy', 'long', 'tempo', 'interval', 'mp', 'recovery', 'race'].map(k => {
    let l = runs.filter(w => w.type === k && w.rpe && w.date >= addDays(today, -56)), span = 8;
    if (l.length < 3) { l = runs.filter(w => w.type === k && w.rpe && w.date >= addDays(today, -84)); span = 12; }
    const md = median(l.map(w => w.rpe)); return md ? { k, md: Math.round(md), n: l.length, span } : null;
  }).filter(Boolean);

  /* 같은 페이스 심박 (5'45"~6'05" 이지 계열) */
  const sp = runs.filter(w => w.avg_hr && paceSec(w) >= 345 && paceSec(w) <= 365 && !['interval', 'tempo', 'mp', 'race', 'hill'].includes(w.type) && w.date >= addDays(today, -26 * 7));
  const wkMap = {}; sp.forEach(w => { const k = mondayOf(w.date); (wkMap[k] ||= []).push(w.avg_hr); });
  const wks = []; for (let m = mondayOf(addDays(today, -25 * 7)); m <= mondayOf(today); m = addDays(m, 7)) wks.push(m);
  const roll = wks.map((m, i) => { const pool = wks.slice(Math.max(0, i - 3), i + 1).flatMap(x => wkMap[x] || []); return pool.length >= 3 ? median(pool) : null; });
  const rv = roll.filter(v => v != null);
  const firstI = roll.findIndex(v => v != null), lastI = roll.length - 1 - [...roll].reverse().findIndex(v => v != null);

  /* 지표 추세 (주간 평균, 최근 12주) */
  const wk12 = []; for (let m = mondayOf(addDays(today, -11 * 7)); m <= mondayOf(today); m = addDays(m, 7)) wk12.push(m);
  const metricTile = (label, get, unit, color, lowerBetter) => {
    const vals = wk12.map(m => { const v = runs.filter(w => mondayOf(w.date) === m).map(get).filter(x => x != null && x > 0); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; });
    const idx = vals.map((v, i) => v != null ? i : -1).filter(i => i >= 0);
    if (!idx.length) return `<div class="gr-mt"><span>${label}</span><p class="muted">데이터 없음</p></div>`;
    const last = vals[idx[idx.length - 1]], prevV = idx.length > 1 ? vals[idx[idx.length - 2]] : null;
    let d = prevV != null ? last - prevV : null;
    if (d != null && Math.abs(d) < (unit === 'pace' ? 1 : Math.abs(last) < 20 ? 0.05 : 0.5)) d = 0;
    const better = d == null || Math.abs(d) < 1e-9 ? null : lowerBetter ? d < 0 : d > 0;
    const fmt = v => unit === 'pace' ? fmtPace(v) : unit === 'm' ? v.toFixed(2) : Math.abs(v) < 20 ? v.toFixed(1) : Math.round(v);
    return `<div class="gr-mt"><span>${label}</span><b>${fmt(last)}<small>${unit === 'pace' ? '/km' : unit}</small></b>
      <em class="${better == null ? '' : better ? 'up' : 'down'}">${d == null ? '' : d === 0 ? '변화 없음' : `${d > 0 ? '+' : '−'}${unit === 'pace' ? Math.abs(Math.round(d)) + '초' : fmt(Math.abs(d))} · 직전 기록 주 대비`}</em>
      ${spark(vals, color)}<small class="gr-mt-w">마지막 ${short(wk12[idx[idx.length - 1]])} 주</small></div>`;
  };
  const tiles = [
    metricTile('케이던스', w => w.cadence, 'spm', '#eab308', false),
    metricTile('쉬운 날 페이스', w => ['easy', 'recovery', 'long'].includes(w.type) ? paceSec(w) : null, 'pace', acc, true),
    metricTile('평균 파워', w => w.metrics?.power, 'W', '#a855f7', false),
    metricTile('VO2max', w => w.metrics?.vo2max, '', '#22c55e', false),
    metricTile('지면접촉 시간', w => w.metrics?.gct, 'ms', '#06b6d4', true),
    metricTile('보폭', w => w.metrics?.stride, 'm', '#3b82f6', false),
    metricTile('수직 진폭', w => w.metrics?.vo, 'cm', '#f97316', true),
    '',
  ];
  // 안정시 심박은 컨디션 기록 기준
  const rhrW = wk12.map(m => { const v = logs.filter(l => l.resting_hr && mondayOf(l.date) === m).map(l => l.resting_hr); return v.length ? median(v) : null; });
  tiles[7] = rhrW.some(v => v != null) ? `<div class="gr-mt"><span>안정시 심박</span><b>${Math.round(rhrW.filter(v => v != null).pop())}<small>bpm</small></b><em></em>${spark(rhrW, '#f43f5e')}</div>` : '<div class="gr-mt"><span>안정시 심박</span><p class="muted">컨디션 기록에 입력하면 보여요</p></div>';

  /* 러닝 습관 */
  const r90 = runs.filter(w => w.date > addDays(today, -90));
  const ly = runs.filter(w => w.date > addDays(today, -455) && w.date <= addDays(today, -365));
  const wdC = Array(7).fill(0); r90.forEach(w => wdC[parse(w.date).getDay()]++);
  const topWd = wdC.map((n, i) => [i, n]).sort((a, b) => b[1] - a[1]).filter(x => x[1]).slice(0, 2).map(x => WD[x[0]]);
  const hrsS = r90.map(startOf).filter(Boolean).map(s => +s.split(':')[0]);
  const hrMode = hrsS.length ? Object.entries(hrsS.reduce((o, h) => (o[h] = (o[h] || 0) + 1, o), {})).sort((a, b) => b[1] - a[1])[0][0] : null;

  /* 쉬어간 기간 */
  const gaps = []; for (let i = 1; i < runs.length; i++) { const g = Math.round((parse(runs[i].date) - parse(runs[i - 1].date)) / 86400000); if (g > 14) gaps.push({ from: runs[i - 1].date, to: runs[i].date, g: g - 1 }); }

  /* PR */
  const pr = (D, label) => {
    const c = runs.filter(w => !['hill', 'recovery'].includes(w.type) && w.actual_time && kmOf(w) >= D * .99 && kmOf(w) <= D * 1.05)
      .map(w => { const dd = kmOf(w), raw = toSec(w.actual_time); return { t: dd >= D ? raw : raw * D / dd, date: w.date, w }; });
    for (const r of races) if (r.result_time && Math.abs(Number(r.distance_km) - D) < .3) c.push({ t: toSec(r.result_time), date: r.date });
    const b = c.filter(x => x.t).sort((a, b) => a.t - b.t)[0];
    return b ? `<div class="gr-pr ${b.date >= addDays(today, -30) ? 'new' : ''}" ${b.w ? `data-id="${b.w.id}"` : ''}><span>${label}${b.date >= addDays(today, -30) ? '<em>NEW</em>' : ''}</span><b>${fmtDuration(b.t)}</b><i>${fmtPace(b.t / D)}/km</i><small>${yy(b.date)}</small></div>`
      : `<div class="gr-pr"><span>${label}</span><b class="muted">-</b><small>기록 없음</small></div>`;
  };

  /* 나의 여정 */
  const ev = [];
  ev.push({ d: runs[0].date, t: '첫 러닝 기록', s: `${kmOf(runs[0]).toFixed(2)} km`, c: 'a' });
  for (const [D, n] of [[5, '첫 5K 완주'], [10, '첫 10K 완주'], [21.0975, '첫 하프 완주'], [42.195, '첫 풀 완주']]) { const f = runs.find(w => kmOf(w) >= D * .99); if (f) ev.push({ d: f.date, t: n, s: `${kmOf(f).toFixed(2)} km${f.type === 'race' ? ` · ${f.title}` : ''}`, c: 'a', id: f.id }); }
  let cum = 0; const ms = [100, 300, 500, 1000, 2000, 3000, 4000, 5000, 7500, 10000]; let mi = 0;
  for (const w of runs) { cum += kmOf(w); while (mi < ms.length && cum >= ms[mi]) { ev.push({ d: w.date, t: `누적 ${ms[mi].toLocaleString()}km 돌파`, s: `총 ${Math.round(cum).toLocaleString()}km`, c: 'b' }); mi++; } }
  const longest = [...runs].sort((a, b) => kmOf(b) - kmOf(a))[0];
  ev.push({ d: longest.date, t: '현재 최장 거리', s: `${kmOf(longest).toFixed(2)} km · ${longest.title}`, c: 'c', id: longest.id });
  for (const r of races.filter(r => r.result_time && Number(r.distance_km) > 40)) ev.push({ d: r.date, t: `풀코스 완주 ${r.result_time}`, s: r.name, c: 'c' });
  ev.sort((a, b) => a.d.localeCompare(b.d));

  root.innerHTML = `
  <div class="gr">
    <div class="gr-sec"><h3>지난주</h3><span>${short(lastMon)}~${short(addDays(lastMon, 6))} · 월요일부터 일요일까지</span></div>
    <div class="gr-4">
      <div><b>${lwKm.toFixed(1)}<small>km</small></b><span>거리</span></div>
      <div><b>${lwSec ? fmtDuration(lwSec) : '-'}</b><span>시간</span></div>
      <div><b>${lw.length}<small>회</small></b><span>횟수</span></div>
      <div class="hero"><b>${streak}<small>주</small></b><span>연속</span></div>
    </div>

    <div class="card gr-card">
      <h3>연속 달리기</h3>
      <div class="gr-3"><div><span>연속</span><b>${streak}주</b></div><div><span>최근 18주간</span><b>${days18}일</b></div><div><span>이번 주</span><b>${tw.length}회 ${tw.reduce((s, w) => s + kmOf(w), 0).toFixed(1)}km</b></div></div>
      <div class="gr-hmwrap">${hm}</div>
      <div class="gr-lg">적음 <i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i> 많음</div>
    </div>

    <div class="gr-sec row-between"><h3>러닝 흐름</h3><div class="gr-nav"><button class="icon-btn" id="gr-prev" aria-label="이전 30일">‹</button><span>${flowOffset ? `${short(fStart)}~${short(fEnd)}` : '최근 30일'}</span><button class="icon-btn" id="gr-next" ${flowOffset ? '' : 'disabled'} aria-label="다음 30일">›</button></div></div>
    <div class="card gr-card">
      <div class="gr-flowhead"><div><span class="gr-lgd">강도 ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => `<i style="background:${rpeColor(n)}"></i>`).join('')}</span>
        <div class="gr-sub">평균 ${paces.length ? fmtPace(paces.reduce((s, p) => s + p, 0) / paces.length) : '-'} · 가장 빠른 ${paces.length ? fmtPace(Math.min(...paces)) : '-'}</div></div>
        <div class="gr-right"><span>거리</span><b>${fKm.toFixed(1)} km · ${fr.length}회</b></div></div>
      ${flowSvg}
      <div class="gr-key"><span><i style="background:${acc}"></i>페이스</span><span><i style="background:#f43f5e"></i>평균 심박 ${hrPrev && hrNow ? `그 전 ${hrPrev} → ${hrNow}` : hrNow ? hrNow : ''}</span><span class="muted">막대 = 거리(색 = 강도, 연한 막대는 강도 미입력이라 훈련 종류로 추정)</span></div>
      <p class="gr-msg">✦ ${short(fStart)}~${short(fEnd)} · ${fr.length}회 · ${fKm.toFixed(0)} km${fr.length ? ` · 쉬운 날 ${Math.round(easyN / fr.length * 100)}%` : ''}<br><b>${flowMsg}</b></p>
    </div>

    <div class="card gr-card">
      <div class="row-between"><h3>유형별 평소 강도</h3><span class="muted gr-small">최근 8주 중앙값 · 3회 미만이면 12주</span></div>
      ${typesR.length ? typesR.map(x => `<div class="gr-tr"><span>${typeLabel(x.k)}</span><b style="color:${rpeText(x.md)}">${x.md} · ${rpeName(x.md)}</b><i>${x.span}주 ${x.n}회</i></div>`).join('') : '<p class="muted">강도(RPE)가 기록된 러닝이 부족해요</p>'}
    </div>

    <div class="card gr-card">
      <h3>같은 페이스 심박</h3>
      ${rv.length >= 2 ? (() => {
        const lo = Math.min(...rv) - 2, hi = Math.max(...rv) + 2, Wd = 600, Hd = 120;
        const x = i => 10 + i * (Wd - 20) / (roll.length - 1), y = v => 8 + (1 - (v - lo) / (hi - lo)) * (Hd - 24);
        const pts = roll.map((v, i) => ({ i, v }));
        return `<div class="gr-big"><b>${Math.round(roll[lastI])}bpm</b><span>5'45"~6'05" 이지런 · 최근 4주 중앙값</span></div>
        <div class="gr-sub">${short(wks[firstI])} 주 ${Math.round(roll[firstI])} → ${short(wks[lastI])} 주 ${Math.round(roll[lastI])} · 같은 페이스에서 심박이 낮아지면 같은 노력으로 더 빨리 달릴 수 있다는 뜻이에요.</div>
        <svg viewBox="0 0 ${Wd} ${Hd}" class="gr-line" preserveAspectRatio="none"><path d="${linePath(pts, x, y)}" fill="none" stroke="#f43f5e" stroke-width="2.5"/>
        ${wks.map((m, i) => (wkMap[m] || []).map(v => `<circle cx="${x(i)}" cy="${y(Math.min(hi, Math.max(lo, v)))}" r="2.5" fill="#f43f5e" opacity=".35"/>`).join('')).join('')}
        <text x="${Wd - 4}" y="${Hd - 4}" text-anchor="end" class="gr-tk">${short(wks[wks.length - 1])}</text><text x="4" y="${Hd - 4}" class="gr-tk">${short(wks[0])}</text></svg>
        <p class="muted gr-small">점: 해당 주 러닝 평균 심박 · 선: 최근 4주(3회 이상) 중앙값 · 인터벌·템포·대회·트레일 제외 · 더위·피로·수면에 따라 몇 bpm씩 흔들려요</p>`;
      })() : '<p class="muted">5\'45"~6\'05" 페이스 이지런 기록이 더 쌓이면 보여요.</p>'}
    </div>

    <div class="gr-sec"><h3>지표 추세</h3><span>주간 평균 · 최근 12주</span></div>
    <div class="gr-mts">${tiles.join('')}</div>

    <div class="card gr-card">
      <h3>러닝 습관</h3>
      <p class="gr-habit">${topWd.length ? `주로 ${topWd.join('·')}요일` : ''}${hrMode != null ? `, 보통 ${hrMode < 12 ? '오전' : '오후'} ${hrMode % 12 || 12}시쯤` : ''} 달립니다</p>
      <div class="gr-3"><div><span>최근 90일</span><b>${r90.length}회 ${Math.round(r90.reduce((s, w) => s + kmOf(w), 0))}km</b></div><div><span>작년 같은 기간</span><b class="muted">${ly.length}회 ${Math.round(ly.reduce((s, w) => s + kmOf(w), 0))}km</b></div></div>
    </div>

    <div class="card gr-card">
      <div class="gr-sub" style="margin:0 0 4px">건강 이야기</div>
      <b class="gr-story">주 1시간 미만으로 달려도 오래 달리는 사람과 비슷한 이득을 얻습니다.</b>
      <p class="muted gr-small" style="font-size:13px">55,137명을 15년 추적한 연구에서 러너는 전체 사망 위험이 30%, 심혈관 사망 위험이 45% 낮았고 평균 3년 더 살았습니다.</p>
      <p class="muted gr-small">Lee DC et al., 2014, J Am Coll Cardiol</p>
    </div>

    <details class="card gr-card gr-gaps"><summary><b>쉬어간 기간 · ${gaps.length}회</b> <span class="muted gr-small">14일 이상 러닝 없음</span></summary>
      ${gaps.length ? gaps.reverse().map(g => `<div class="gr-tr"><span>${yy(g.from)} ~ ${yy(g.to)}</span><b>${g.g}일</b></div>`).join('') : '<p class="muted">없어요. 꾸준히 달려 왔어요!</p>'}
    </details>

    <div class="gr-sec"><h3>PR 타임라인</h3><span>거리별 최고 기록</span></div>
    <div class="gr-prs">${pr(5, '5K')}${pr(10, '10K')}${pr(21.0975, '하프')}${pr(42.195, '풀')}</div>

    <div class="gr-sec"><h3>나의 여정</h3><span>첫 러닝 기록부터 지금까지</span></div>
    <div class="card gr-card gr-tl">${ev.map(e => `<div class="ev ${e.c}" ${e.id ? `data-id="${e.id}"` : ''}><small>${yy(e.d)}</small><b>${esc(e.t)}</b><span>${esc(e.s)}</span></div>`).join('')}</div>
  </div>`;
  root.querySelector('#gr-prev').onclick = () => onShift(flowOffset + 1);
  root.querySelector('#gr-next').onclick = () => onShift(Math.max(0, flowOffset - 1));
  root.querySelectorAll('.gr-hm i[data-d]').forEach(el => el.onclick = () => onPick?.(el.dataset.d));
  root.querySelectorAll('.gr-bar, [data-id]').forEach(el => { if (el.dataset.id) el.addEventListener('click', () => onRun?.(el.dataset.id)); });
}
