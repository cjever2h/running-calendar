// 훈련 종류, 페이스 계산, 기본 테이퍼링 계획

export const TYPES = {
  easy:     { label: '이지런',       color: '#22c55e' },
  recovery: { label: '회복런',       color: '#84cc16' },
  long:     { label: '장거리',       color: '#3b82f6' },
  mp:       { label: '마라톤페이스', color: '#a855f7' },
  tempo:    { label: '템포/역치',    color: '#f97316' },
  interval: { label: '인터벌',       color: '#ef4444' },
  hill:     { label: '업힐',         color: '#b45309' },
  strength: { label: '보강운동',     color: '#14b8a6' },
  rest:     { label: '휴식',         color: '#94a3b8' },
  race:     { label: '대회',         color: '#eab308' },
};

export const RACE_DISTANCES = [
  { km: 42.195, label: '풀코스' },
  { km: 21.0975, label: '하프' },
  { km: 10, label: '10km' },
  { km: 5, label: '5km' },
];
export const PRIORITY = { A: '메인 목표', B: '중요 대회', C: '연습/페이스런' };
export function distLabel(km) {
  const d = RACE_DISTANCES.find(x => Math.abs(x.km - Number(km)) < 0.01);
  return d ? d.label : (km ? Number(km) + 'km' : '');
}
/** 대회 목표 기록 -> 평균 페이스 */
export function racePace(goal, distKm) {
  const s = toSec(goal);
  return s && distKm ? fmtPace(s / Number(distKm)) : null;
}

export const SHOE_PURPOSES = ['데일리', '장거리', '스피드/인터벌', '레이스', '회복', '트레일'];

/** "h:mm:ss" | "mm:ss" -> 초 */
export function toSec(t) {
  if (!t) return null;
  const p = String(t).trim().split(':').map(Number);
  if (p.some(Number.isNaN)) return null;
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  if (p.length === 2) return p[0] * 60 + p[1];
  if (p.length === 1) return p[0] * 60;
  return null;
}
export function fmtPace(secPerKm) {
  if (!secPerKm || !isFinite(secPerKm)) return '-';
  const s = Math.round(secPerKm);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
export function fmtDuration(sec) {
  if (!sec) return '-';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.round(sec % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
export function paceOf(distKm, timeStr) {
  const sec = toSec(timeStr);
  if (!sec || !distKm) return null;
  return sec / Number(distKm);
}

/** 목표 기록으로 훈련 페이스 산출 (대략적인 잭 대니얼스 비율 기반 추정) */
export function trainingPaces(goalTime) {
  const mp = (toSec(goalTime) || toSec('3:30:00')) / 42.195;
  return {
    mp: fmtPace(mp),
    easy: `${fmtPace(mp + 55)}~${fmtPace(mp + 80)}`,
    recovery: `${fmtPace(mp + 85)} 이상`,
    tempo: `${fmtPace(mp - 18)}~${fmtPace(mp - 13)}`,
    interval: `${fmtPace(mp - 38)}~${fmtPace(mp - 33)}`,
    mpRaw: mp,
  };
}

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 대회 3주 전 테이퍼링 계획 (주 5일: 화·수·목·토·일 / 월·금 휴식)
 * offset = 대회일 기준 며칠 전 (대회가 일요일일 때 요일이 맞습니다)
 */
export function taperPlan(raceDate, goalTime = '3:30:00', raceName = '대회') {
  const P = trainingPaces(goalTime);
  const safety = '햄스트링·종아리 당김이 느껴지면 강도를 낮추고 이지런 또는 휴식으로 전환하기.';
  const items = [
    [-19, 'easy', '이지런 10km + 스트라이드', 10, P.easy,
      `본훈련: 10km 이지런 @ ${P.easy}/km (대화 가능한 강도)\n마무리: 스트라이드 100m × 4회 (빠르게 80%, 걸어서 회복)\n${safety}`],
    [-18, 'tempo', '역치런 2km × 3', 11, P.tempo,
      `워밍업: 2km 조깅 + 동적 스트레칭\n본훈련: 2km × 3회 @ ${P.tempo}/km, 회복 2분 조깅\n쿨다운: 2~3km 조깅\n강도: '편하게 힘든' 정도, 마지막 세트도 페이스 유지`],
    [-17, 'easy', '이지런 8km + 하체 보강', 8, P.easy,
      `본훈련: 8km 이지런 @ ${P.easy}/km\n보강(20분): 노르딕 햄스트링 커브 3×6, 싱글레그 브릿지 3×12, 카프레이즈 3×15, 플랭크 3×40초`],
    [-16, 'rest', '휴식', null, null, '완전 휴식 또는 가벼운 스트레칭·폼롤러 15분\n수면 7시간 이상 확보'],
    [-15, 'easy', '그룹 이지런 6~8km', 7, P.easy,
      `본훈련: 6~8km 편안한 이지런 @ ${P.easy}/km\n내일 장거리를 위해 무리하지 않기`],
    [-14, 'long', '마지막 장거리 24km (MP 8km 포함)', 24, P.mp,
      `구성: 16km 이지 @ ${P.easy}/km → 마지막 8km 마라톤페이스 @ ${P.mp}/km\n보급: 7km·14km·20km 지점 젤 (대회 보급 연습)\n대회 때 신을 러닝화·양말·복장으로 리허설\n${safety}`],
    [-13, 'rest', '휴식', null, null, '완전 휴식. 장거리 후 회복 (단백질·수분 보충, 폼롤러)'],
    [-12, 'easy', '이지런 8km + 스트라이드', 8, P.easy,
      `본훈련: 8km 이지런 @ ${P.easy}/km\n마무리: 스트라이드 100m × 4회`],
    [-11, 'interval', '인터벌 1km × 5', 10, P.interval,
      `워밍업: 2.5km 조깅 + 드릴\n본훈련: 1km × 5회 @ ${P.interval}/km, 회복 400m 조깅\n쿨다운: 2.5km 조깅\n테이퍼 기간이므로 개수 늘리지 않기`],
    [-10, 'easy', '이지런 8km + 가벼운 보강', 8, P.easy,
      `본훈련: 8km 이지런 @ ${P.easy}/km\n보강(15분, 가볍게): 싱글레그 브릿지 2×12, 카프레이즈 2×15, 코어 10분`],
    [-9, 'rest', '휴식', null, null, '완전 휴식 또는 스트레칭'],
    [-8, 'easy', '그룹 이지런 6km', 6, P.easy, `본훈련: 6km 이지런 @ ${P.easy}/km`],
    [-7, 'long', '중장거리 18km (MP 8km 포함)', 18, P.mp,
      `구성: 10km 이지 @ ${P.easy}/km → 8km 마라톤페이스 @ ${P.mp}/km\n대회 페이스 감각 익히기, 보급 1회 연습\n${safety}`],
    [-6, 'rest', '휴식', null, null, '완전 휴식. 대회 주간 시작: 수면·식사 관리'],
    [-5, 'mp', '이지 8km (MP 3km 포함)', 8, P.mp,
      `구성: 3km 이지 → 3km 마라톤페이스 @ ${P.mp}/km → 2km 이지\n몸이 가볍게 느껴져도 더 하지 않기`],
    [-4, 'easy', '이지런 6km + 스트라이드', 6, P.easy,
      `본훈련: 6km 이지런 @ ${P.easy}/km\n마무리: 스트라이드 100m × 4회`],
    [-3, 'recovery', '가벼운 조깅 5km (선택)', 5, P.recovery,
      `5km 아주 편한 조깅. 피곤하면 휴식으로 대체\n오늘부터 탄수화물 비중 늘리기 (카보로딩)`],
    [-2, 'rest', '휴식 + 카보로딩', null, null, '완전 휴식\n탄수화물 위주 식사, 수분 충분히\n배번·칩·젤·복장 미리 챙겨두기'],
    [-1, 'recovery', '셰이크아웃 3~4km', 4, P.recovery,
      `3~4km 가벼운 조깅 + 스트라이드 2~3회\n대회 동선·출발 시간·보관소 확인, 일찍 취침`],
    [0, 'race', `${raceName} 풀코스`, 42.195, P.mp,
      `목표 기록: ${goalTime} (평균 ${P.mp}/km)\n전략: 0~5km는 목표보다 5~10초 느리게 → 5~30km 목표 페이스 유지 → 30km 이후 남은 힘 사용\n보급: 5km마다 물, 젤은 출발 전·10·20·30km\n즐겁게 완주하기!`],
  ];
  return items.map(([off, type, title, dist, pace, details]) => ({
    date: addDays(raceDate, off), type, title, planned_distance: dist, target_pace: pace, details, status: 'planned',
  }));
}
