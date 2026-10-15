// 가민 커넥트 "데이터 내보내기" JSON 가져오기
// - *_summarizedActivities.json : 활동 요약 (거리 cm, 시간 ms, 상승 cm, 속도 0.1m/s 단위)
// - *_gear.json : 장비(러닝화)와 활동 연결

const pad = n => String(n).padStart(2, '0');
function hms(sec) {
  if (!sec) return null;
  const t = Math.round(sec), h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
const paceStr = (sec, km) => { if (!sec || !km) return null; const p = Math.round(sec / km); return `${Math.floor(p / 60)}:${pad(p % 60)}`; };

export const RUN_TYPES = ['running', 'trail_running', 'track_running', 'treadmill_running', 'street_running', 'virtual_run', 'ultra_run', 'indoor_running', 'obstacle_run'];
const CROSS_TYPES = { cycling: '사이클', mountain_biking: 'MTB', road_biking: '로드바이크', indoor_cycling: '실내 사이클', lap_swimming: '수영', open_water_swimming: '오픈워터 수영',
  indoor_rowing: '실내 로잉', indoor_cardio: '실내 유산소', strength_training: '근력 운동', elliptical: '일립티컬', hiking: '하이킹' };
const GENERIC = /^(러닝|트레일 러닝|트레드밀 러닝|트랙 러닝|조깅|아침 조깅|이지 러닝|러닝 \(.*\))$/;
const TE_KO = { AEROBIC_BASE: '유산소 기반', RECOVERY: '회복', TEMPO: '템포', LACTATE_THRESHOLD: '젖산 역치', VO2MAX: 'VO2 Max', ANAEROBIC_CAPACITY: '무산소', SPEED: '스피드' };
const TYPE_LABEL = { easy: '이지런', long: 'LSD', tempo: '템포', interval: '인터벌', recovery: '회복런', mp: '마라톤페이스', hill: '트레일·업힐', race: '대회', cross: '크로스', strength: '보강운동' };

export function isActivitiesExport(j) { return Array.isArray(j) && Array.isArray(j[0]?.summarizedActivitiesExport); }
export function isGearExport(j) { return Array.isArray(j) && Array.isArray(j[0]?.gearDTOS); }

/** 대회 여부 */
function isRace(a, km) {
  if (a.eventTypeId === 1 && km >= 4.5) return true;
  if (km < 9) return false;
  const n = a.name || '';
  return /마라톤|marathon|레이스|race/i.test(n) && !/D\s*-\s*\d|훈련|lsd|숨|\d+\s*k(?![a-z])|조깅|빌드업/i.test(n);
}
/** 러닝 종류 분류: 대회 → 이름 키워드 → 거리 → 가민 훈련 효과 */
function classify(a, km) {
  if (a.activityType === 'trail_running') return 'hill';
  if (isRace(a, km)) return 'race';
  const n = (a.name || '').toLowerCase();
  if (/인터벌|interval|스프린트|sprint|vo2|\d\s*[x×*]\s*\d|반복/.test(n)) return 'interval';
  if (/템포|tempo|빌드업|지속주|역치|threshold/.test(n)) return 'tempo';
  if (/lsd|장거리|시간주|long/.test(n)) return 'long';
  if (/회복|리커버리|recovery|셰이크|샤키/.test(n)) return 'recovery';
  if (/업힐|hill|노적봉|산\s|트레일/.test(n)) return 'hill';
  if (/\bmp\b|목표 페이스|마라톤 페이스/.test(n)) return 'mp';
  if (km >= 18) return 'long';
  const te = a.trainingEffectLabel;
  if (te === 'RECOVERY') return 'recovery';
  if (te === 'TEMPO' || te === 'LACTATE_THRESHOLD') return 'tempo';
  if (te === 'VO2MAX' || te === 'ANAEROBIC_CAPACITY' || te === 'SPEED') return 'interval';
  return 'easy';
}

/** 활동 목록 → 기록 */
export function parseActivities(j) {
  const out = [];
  for (const a of j[0].summarizedActivitiesExport) {
    const isRun = RUN_TYPES.includes(a.activityType);
    const crossName = CROSS_TYPES[a.activityType];
    if (!isRun && !crossName) continue;
    const local = new Date(a.startTimeLocal); // 로컬 시각을 UTC 필드로 읽음
    const date = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
    const start = `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
    const km = a.distance ? Math.round(a.distance / 1000) / 100 : 0; // cm → km
    const sec = a.duration ? a.duration / 1000 : null;
    const type = isRun ? classify(a, km) : (a.activityType === 'strength_training' ? 'strength' : 'cross');
    const cadence = a.avgDoubleCadence ? Math.round(a.avgDoubleCadence) : a.avgRunCadence ? a.avgRunCadence * 2 : null;
    const name = (a.name || '').trim();
    const title = !isRun ? (GENERIC.test(name) || !name ? crossName : name)
      : (GENERIC.test(name) || !name) ? `${TYPE_LABEL[type]} ${km}km` : name;
    const L = [];
    L.push([`시작 ${start}`, a.minTemperature != null && `기온 ${a.minTemperature}${a.maxTemperature != null && a.maxTemperature !== a.minTemperature ? `~${a.maxTemperature}` : ''}°C`].filter(Boolean).join(' · '));
    L.push([km && sec && `평균 페이스 ${paceStr(sec, km)}/km`, a.avgHr && `평균 심박 ${a.avgHr}${a.maxHr ? ` / 최대 ${a.maxHr}` : ''}`].filter(Boolean).join(' · '));
    L.push([cadence && `케이던스 ${cadence}spm`, a.avgStrideLength && `보폭 ${(a.avgStrideLength / 100).toFixed(2)}m`, a.elevationGain != null && `상승 ${Math.round(a.elevationGain / 100)}m`].filter(Boolean).join(' · '));
    L.push([a.aerobicTrainingEffect != null && `훈련 효과 유산소 ${a.aerobicTrainingEffect.toFixed(1)} / 무산소 ${(a.anaerobicTrainingEffect || 0).toFixed(1)}${TE_KO[a.trainingEffectLabel] ? ` (${TE_KO[a.trainingEffectLabel]})` : ''}`,
      a.activityTrainingLoad && `운동 부하 ${Math.round(a.activityTrainingLoad)}`].filter(Boolean).join(' · '));
    L.push([a.avgPower && `평균 파워 ${a.avgPower}W`, a.vO2MaxValue && `VO2max ${a.vO2MaxValue}`, a.calories && `${Math.round(a.calories / 4.184).toLocaleString()}kcal`].filter(Boolean).join(' · '));
    if (a.elapsedDuration && sec && a.elapsedDuration / 1000 - sec > 30) L.push(`일시중지 포함 ${hms(a.elapsedDuration / 1000)}`);
    out.push({
      garminId: a.activityId, kind: isRun ? 'run' : 'cross', activityType: a.activityType, name, type, title, date, start,
      distance: km || null, time: hms(sec), sec, avgHr: a.avgHr || null, maxHr: a.maxHr || null, cadence,
      details: '[가민 기록]\n' + L.filter(Boolean).join('\n'),
    });
  }
  return out.sort((x, y) => (x.date + x.start).localeCompare(y.date + y.start));
}

/** 장비 → 러닝화 정보 + 활동별 신발 (두 신발에 연결된 활동은 사용 중·나중에 등록된 신발 우선) */
export function parseGear(j) {
  const g = j[0];
  const gears = (g.gearDTOS || []).filter(x => x.gearTypeName === 'Shoes').map(x => ({
    pk: x.gearPk, nickname: x.displayName || null, makeModel: (x.customMakeModel || '').trim(), begin: x.dateBegin || null, end: x.dateEnd || null,
    retired: x.gearStatusName === 'retired', maxKm: x.maximumMeters ? Math.round(x.maximumMeters / 1000) : null,
  }));
  const rank = pk => { const x = gears.find(y => y.pk === pk); return x ? (x.retired ? 0 : 1e9) + Date.parse(x.begin || '2000-01-01') / 1e5 : -1; };
  const byActivity = new Map();
  for (const [pk, list] of Object.entries(g.gearActivityDTOs || {})) {
    for (const { activityId } of list) {
      const cur = byActivity.get(activityId);
      if (!cur || rank(+pk) > rank(cur)) byActivity.set(activityId, +pk);
    }
  }
  return { gears, byActivity };
}

const norm = s => String(s || '').toLowerCase().replace(/\s+/g, '');
/** 가민 신발 ↔ 앱 러닝화 매칭 */
export function matchShoe(gear, shoes) {
  if (gear.nickname) { const s = shoes.find(x => norm(x.nickname) === norm(gear.nickname)); if (s) return s; }
  const mm = norm(gear.makeModel);
  return shoes.find(x => {
    const bm = norm(`${x.brand}${x.model}`), b = norm(x.brand), m = norm(x.model);
    return mm && (bm === mm || (m && mm.includes(m)) || (!gear.nickname && b && mm === b && !x.nickname));
  }) || null;
}
export function gearToShoe(gear) {
  const parts = gear.makeModel.split(/\s+/);
  const brand = parts[0] || '기타', model = parts.slice(1).join(' ') || gear.nickname || brand;
  return { brand, model, nickname: gear.nickname, purchase_date: gear.begin, max_km: gear.maxKm || 700, retired: gear.retired, initial_km: 0,
    purpose: /트레일|gtx|trail/i.test(gear.makeModel + gear.nickname) ? '트레일' : null, color: gear.retired ? '#94a3b8' : '#0ea5e9',
    notes: `가민 장비에서 가져옴${gear.end ? ` · 은퇴 ${gear.end}` : ''}` };
}
