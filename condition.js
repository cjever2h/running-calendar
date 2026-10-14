// 컨디션·부상 기록 + 반복 통증/피로 감지
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const parse = s => new Date(s + 'T00:00:00');
const daysBetween = (a, b) => Math.round((parse(a) - parse(b)) / 86400000);

export const PAIN_AREAS = ['햄스트링(좌)', '햄스트링(우)', '종아리(좌)', '종아리(우)', '무릎', '정강이', '발목', '발바닥/족저근막', '아킬레스건', '고관절/엉덩이', '허리', '기타'];

export function conditionForm(log = {}, date) {
  const areas = log.pain_areas || [];
  return `
  <form class="cond-form" data-date="${date}">
    <div class="rec-grid">
      <label>피로도 (RPE 1~10) <span class="fat-val">${log.fatigue ?? '-'}</span><input type="range" name="fatigue" min="1" max="10" value="${log.fatigue ?? 5}"></label>
      <label>수면 시간 (시간)<input type="number" step="0.5" min="0" max="14" name="sleep_hours" value="${log.sleep_hours ?? ''}" placeholder="7"></label>
      <label>수면의 질<select name="sleep_quality"><option value="">-</option>${[5, 4, 3, 2, 1].map(v => `<option value="${v}" ${log.sleep_quality == v ? 'selected' : ''}>${['', '매우 나쁨', '나쁨', '보통', '좋음', '매우 좋음'][v]}</option>`).join('')}</select></label>
      <label>안정시 심박 (bpm)<input type="number" name="resting_hr" min="30" max="120" value="${log.resting_hr ?? ''}" placeholder="아침 기상 직후"></label>
      <label>체중 (kg)<input type="number" step="0.1" name="weight" value="${log.weight ?? ''}"></label>
      <label>통증 정도 (0~10) <span class="pain-val">${log.pain_level ?? 0}</span><input type="range" name="pain_level" min="0" max="10" value="${log.pain_level ?? 0}"></label>
      <div class="full"><div class="muted" style="font-size:13px;font-weight:600;margin-bottom:4px">통증 부위</div>
        <div class="chips">${PAIN_AREAS.map(a => `<label class="pchip"><input type="checkbox" name="pain_areas" value="${esc(a)}" ${areas.includes(a) ? 'checked' : ''}><span>${esc(a)}</span></label>`).join('')}</div></div>
      <label class="full">메모<textarea name="note" rows="2" placeholder="컨디션, 스트레스, 식사 등">${esc(log.note ?? '')}</textarea></label>
    </div>
    <button class="btn primary" type="submit">컨디션 저장</button>
  </form>`;
}

export function readConditionForm(form) {
  const fd = new FormData(form);
  const num = k => { const v = fd.get(k); return v === '' || v == null ? null : Number(v); };
  return {
    date: form.dataset.date,
    fatigue: form.fatigue.dataset.touched || form.dataset.hasFatigue ? num('fatigue') : null,
    sleep_hours: num('sleep_hours'), sleep_quality: num('sleep_quality'), resting_hr: num('resting_hr'), weight: num('weight'),
    pain_level: num('pain_level') || 0, pain_areas: fd.getAll('pain_areas'), note: (fd.get('note') || '').trim() || null,
  };
}

/** 최근 기록으로 경고 생성 */
export function conditionAlerts(logs, today) {
  const recent = logs.filter(l => l.date <= today && daysBetween(today, l.date) < 14);
  const alerts = [];
  const byArea = {};
  for (const l of recent) for (const a of l.pain_areas || []) (byArea[a] ||= []).push(l);
  for (const [a, ls] of Object.entries(byArea)) {
    const in7 = ls.filter(l => daysBetween(today, l.date) < 7).length;
    const maxLv = Math.max(...ls.map(l => l.pain_level || 0));
    if (ls.length >= 3 || in7 >= 2 || maxLv >= 6) {
      alerts.push({ level: maxLv >= 6 || ls.length >= 4 ? 'danger' : 'warn', area: a,
        text: `${a} 통증이 최근 14일 중 ${ls.length}일 기록됐어요 (최고 ${maxLv}/10). 이번 주 강도 훈련(인터벌·템포·MP)은 이지런으로 바꾸고 장거리 거리를 20~30% 줄이거나 1~2일 쉬는 걸 권장해요.${maxLv >= 6 ? ' 통증이 심하거나 계속되면 진료를 받아보세요.' : ''}` });
    }
  }
  const last3 = recent.filter(l => daysBetween(today, l.date) < 3 && l.fatigue);
  if (last3.length >= 2 && last3.reduce((s, l) => s + l.fatigue, 0) / last3.length >= 8)
    alerts.push({ level: 'warn', text: `최근 피로도가 높아요 (평균 ${(last3.reduce((s, l) => s + l.fatigue, 0) / last3.length).toFixed(1)}/10). 다음 포인트 훈련 전 회복일을 하루 더 두세요.` });
  const sleeps = recent.filter(l => daysBetween(today, l.date) < 4 && l.sleep_hours != null);
  if (sleeps.length >= 3 && sleeps.every(l => l.sleep_hours < 6))
    alerts.push({ level: 'info', text: '최근 3일 이상 수면이 6시간 미만이에요. 강도 훈련 효과가 떨어지고 부상 위험이 커져요.' });
  const rhr = recent.filter(l => l.resting_hr).sort((a, b) => a.date.localeCompare(b.date));
  if (rhr.length >= 4) {
    const last = rhr[rhr.length - 1], base = rhr.slice(0, -1).reduce((s, l) => s + l.resting_hr, 0) / (rhr.length - 1);
    if (last.resting_hr - base >= 7) alerts.push({ level: 'warn', text: `안정시 심박이 평소보다 ${Math.round(last.resting_hr - base)}bpm 높아요 (${last.resting_hr}bpm). 피로 누적·컨디션 저하 신호일 수 있어요.` });
  }
  return alerts;
}

/** 통증 부위가 오늘 강도 훈련과 겹칠 때 카드에 보여줄 경고 */
export function intensityWarning(alerts, type) {
  if (!['interval', 'tempo', 'mp', 'hill', 'long'].includes(type)) return '';
  const pain = alerts.filter(a => a.area);
  return pain.length ? `최근 ${pain.map(a => a.area).join(', ')} 통증이 반복돼요. 오늘은 강도를 낮추거나 이지런으로 대체하세요.` : '';
}
