// 목표 기록 기반 페이스 존(잭 대니얼스 VDOT 공식) + 심박 존(카보넨)
import { toSec, fmtPace } from './plan.js';

/** 레이스 거리(km)·기록(초) → VDOT */
export function vdotFrom(distKm, sec) {
  const t = sec / 60, v = distKm * 1000 / t;
  const vo2 = -4.60 + 0.182258 * v + 0.000104 * v * v;
  const pct = 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);
  return vo2 / pct;
}
function velAt(vo2) { const a = 0.000104, b = 0.182258, c = -4.60 - vo2; return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a); }
const paceAtPct = (vdot, pct) => 60000 / velAt(vdot * pct); // 초/km
/** VDOT → 해당 거리 예상 기록(초) */
export function predictTime(vdot, distKm) {
  let lo = distKm * 120, hi = distKm * 600;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (vdotFrom(distKm, mid) > vdot) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
const range = (a, b) => `${fmtPace(Math.min(a, b))}~${fmtPace(Math.max(a, b))}`;

/** 대회(목표 기록) → 페이스 존 */
export function paceZones(race) {
  const dist = Number(race?.distance_km) || 42.195;
  const goal = toSec(race?.goal_time) || (dist > 40 ? toSec('3:30:00') : null);
  if (!goal) return null;
  const vdot = vdotFrom(dist, goal);
  const M = predictTime(vdot, 42.195) / 42.195;
  const T = paceAtPct(vdot, 0.88), I = paceAtPct(vdot, 0.975), R = paceAtPct(vdot, 1.05);
  const racePace = goal / dist;
  return {
    vdot, basis: `${race?.name || '목표'} ${race?.goal_time || '3:30:00'}`,
    raw: { M, T, I, R, E1: M + 55, E2: M + 85, race: racePace },
    recovery: { label: '회복', pace: `${fmtPace(M + 85)}~${fmtPace(M + 115)}` },
    easy: { label: '이지', pace: range(M + 55, M + 85) },
    long: { label: 'LSD', pace: range(M + 45, M + 80) },
    mp: { label: '마라톤', pace: range(M - 3, M + 3) },
    tempo: { label: '템포(역치)', pace: range(T - 3, T + 3) },
    interval: { label: '인터벌', pace: range(I - 3, I + 3) },
    rep: { label: '반복', pace: range(R - 3, R + 3) },
    race: { label: '레이스', pace: fmtPace(racePace) },
  };
}

/** 심박 존: 최대심박(설정 또는 208-0.7×나이) · 안정시 심박 → 카보넨 */
export function hrZones(settings = {}, restingFallback) {
  const age = settings.birth_year ? new Date().getFullYear() - Number(settings.birth_year) : null;
  const max = Number(settings.max_hr) || (age ? Math.round(208 - 0.7 * age) : null);
  if (!max) return null;
  const rest = Number(settings.resting_hr) || Number(restingFallback) || 60;
  const z = (a, b) => `${Math.round(rest + a * (max - rest))}~${Math.round(rest + b * (max - rest))}`;
  return {
    max, rest, estimated: !settings.max_hr,
    recovery: z(0.5, 0.6), easy: z(0.6, 0.72), long: z(0.6, 0.75), mp: z(0.72, 0.82),
    tempo: z(0.82, 0.89), interval: z(0.9, 0.95), race: z(0.75, 0.88), hill: z(0.82, 0.92),
  };
}

/** 훈련 종류 → 표시할 존 키 */
export const TYPE_ZONE = { easy: 'easy', recovery: 'recovery', long: 'long', mp: 'mp', tempo: 'tempo', interval: 'interval', hill: 'tempo', race: 'race' };

export function zoneText(type, pz, hz) {
  const k = TYPE_ZONE[type];
  if (!k) return '';
  const p = pz?.[k]?.pace, h = hz?.[type === 'hill' ? 'hill' : k];
  return [p && `페이스 ${p}/km`, h && `심박 ${h}`].filter(Boolean).join(' · ');
}
