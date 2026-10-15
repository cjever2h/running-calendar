// 데이터 저장소: Supabase(클라우드) 또는 localStorage(로컬) 모드
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const isCloud = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
let sb = null;

const W_FIELDS = ['id', 'date', 'type', 'title', 'planned_distance', 'target_pace', 'details', 'status',
  'actual_distance', 'actual_time', 'avg_hr', 'rpe', 'memo', 'shoe_id', 'images',
  'planned_duration', 'target_hr', 'phase', 'race_id', 'source', 'max_hr', 'cadence', 'garmin_id'];
const S_FIELDS = ['id', 'brand', 'model', 'nickname', 'color', 'purpose', 'purchase_date', 'initial_km',
  'max_km', 'retired', 'notes'];
const R_FIELDS = ['id', 'name', 'date', 'distance_km', 'goal_time', 'priority', 'location', 'notes', 'result_time', 'strategy'];
const L_FIELDS = ['date', 'fatigue', 'sleep_hours', 'sleep_quality', 'pain_areas', 'pain_level', 'weight', 'resting_hr', 'note'];
const P_FIELDS = ['birth_year', 'max_hr', 'resting_hr', 'weight', 'notify_enabled', 'notify_hour'];
const NUMERIC = new Set(['garmin_id', 'planned_distance', 'actual_distance', 'avg_hr', 'rpe', 'initial_km', 'max_km', 'distance_km', 'max_hr', 'cadence',
  'fatigue', 'sleep_hours', 'sleep_quality', 'pain_level', 'weight', 'resting_hr', 'birth_year', 'notify_hour']);

function clean(obj, fields) {
  const out = {};
  for (const f of fields) {
    if (!(f in obj)) continue;
    let v = obj[f];
    if (v === '' || v === undefined) v = null;
    if (v !== null && NUMERIC.has(f)) { v = Number(v); if (Number.isNaN(v)) v = null; }
    out[f] = v;
  }
  if (!out.id) out.id = crypto.randomUUID();
  return out;
}

/* ---------- local ---------- */
const LKEY = 'running-calendar-v1';
function lload() {
  let d;
  try { d = JSON.parse(localStorage.getItem(LKEY)) || {}; } catch { d = {}; }
  d.workouts ||= []; d.shoes ||= []; d.settings ||= {};
  if (!d.races) { // 예전 단일 대회 설정을 대회 목록으로 이전
    d.races = d.settings.race_date ? [{ id: crypto.randomUUID(), name: d.settings.race_name || '목표 대회', date: d.settings.race_date,
      distance_km: 42.195, goal_time: d.settings.goal_time || null, priority: 'A', created_at: new Date().toISOString() }] : [];
    lsave(d);
  }
  return d;
}
function lsave(d) { localStorage.setItem(LKEY, JSON.stringify(d)); }

/* ---------- init / auth ---------- */
export async function init() {
  if (!isCloud) return;
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
}
export async function getUser() {
  if (!isCloud) return { id: 'local', email: '로컬 모드' };
  const { data } = await sb.auth.getSession();
  return data.session?.user ?? null;
}
export async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}
export async function signUp(email, password) {
  const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin } });
  if (error) throw error;
  return data;
}
export async function signOut() { if (isCloud) await sb.auth.signOut(); }
export function onAuth(cb) { if (isCloud) sb.auth.onAuthStateChange((_e, s) => cb(s?.user ?? null)); }

function chk({ data, error }) { if (error) throw error; return data; }
/** 쓰기 성공 시 마지막 저장 시각 기록 */
function wchk(res) { const d = chk(res); localStorage.setItem('rc-last-sync', new Date().toISOString()); return d; }
export const lastSync = () => localStorage.getItem('rc-last-sync');

/* ---------- workouts ---------- */
export async function listWorkouts() {
  if (!isCloud) return lload().workouts;
  return chk(await sb.from('workouts').select('*').order('date').order('created_at'));
}
export async function saveWorkout(w) {
  const row = clean(w, W_FIELDS);
  if (!isCloud) {
    const d = lload(); const i = d.workouts.findIndex(x => x.id === row.id);
    const merged = { ...(i >= 0 ? d.workouts[i] : { created_at: new Date().toISOString() }), ...row };
    if (i >= 0) d.workouts[i] = merged; else d.workouts.push(merged);
    lsave(d); return merged;
  }
  row.updated_at = new Date().toISOString();
  return wchk(await sb.from('workouts').upsert(row).select().single());
}
export async function insertWorkouts(list) {
  const rows = list.map(w => clean(w, W_FIELDS));
  if (!rows.length) return [];
  if (!isCloud) { const d = lload(); d.workouts.push(...rows.map(r => ({ ...r, created_at: new Date().toISOString() }))); lsave(d); return rows; }
  return wchk(await sb.from('workouts').insert(rows).select());
}
export async function deleteWorkout(id) {
  if (!isCloud) { const d = lload(); d.workouts = d.workouts.filter(x => x.id !== id); lsave(d); return; }
  wchk(await sb.from('workouts').delete().eq('id', id));
}

/* ---------- shoes ---------- */
export async function listShoes() {
  if (!isCloud) return lload().shoes;
  return chk(await sb.from('shoes').select('*').order('created_at'));
}
export async function saveShoe(s) {
  const row = clean(s, S_FIELDS);
  row.retired = Boolean(row.retired);
  if (!isCloud) {
    const d = lload(); const i = d.shoes.findIndex(x => x.id === row.id);
    const merged = { ...(i >= 0 ? d.shoes[i] : { created_at: new Date().toISOString() }), ...row };
    if (i >= 0) d.shoes[i] = merged; else d.shoes.push(merged);
    lsave(d); return merged;
  }
  return wchk(await sb.from('shoes').upsert(row).select().single());
}
export async function deleteShoe(id) {
  if (!isCloud) {
    const d = lload(); d.shoes = d.shoes.filter(x => x.id !== id);
    d.workouts.forEach(w => { if (w.shoe_id === id) w.shoe_id = null; }); lsave(d); return;
  }
  wchk(await sb.from('shoes').delete().eq('id', id));
}

/* ---------- settings ---------- */
export async function getSettings() {
  if (!isCloud) return lload().settings || {};
  const data = chk(await sb.from('settings').select('*').maybeSingle());
  return data || {};
}
export async function saveSettings(s) {
  const row = { race_name: s.race_name || null, race_date: s.race_date || null, goal_time: s.goal_time || null };
  if (!isCloud) { const d = lload(); d.settings = { ...d.settings, ...row }; lsave(d); return d.settings; }
  const user = await getUser();
  return wchk(await sb.from('settings').upsert({ user_id: user.id, ...row, updated_at: new Date().toISOString() }).select().single());
}
/** 프로필(나이·심박·체중)·알림 설정 */
export async function saveProfile(p) {
  const row = {};
  for (const f of P_FIELDS) if (f in p) { let v = p[f]; if (v === '' || v === undefined) v = null; if (v !== null && NUMERIC.has(f)) v = Number(v); row[f] = v; }
  if (!isCloud) { const d = lload(); d.settings = { ...d.settings, ...row }; lsave(d); return d.settings; }
  const user = await getUser();
  return wchk(await sb.from('settings').upsert({ user_id: user.id, ...row, updated_at: new Date().toISOString() }).select().single());
}

/* ---------- daily logs (컨디션) ---------- */
export async function listLogs() {
  if (!isCloud) return lload().logs || [];
  return chk(await sb.from('daily_logs').select('*').order('date'));
}
export async function saveLog(l) {
  const row = {};
  for (const f of L_FIELDS) if (f in l) { let v = l[f]; if (v === '' || v === undefined) v = null; if (v !== null && NUMERIC.has(f)) v = Number(v); row[f] = v; }
  row.pain_areas ||= [];
  if (!isCloud) { const d = lload(); d.logs ||= []; const i = d.logs.findIndex(x => x.date === row.date); if (i >= 0) d.logs[i] = { ...d.logs[i], ...row }; else d.logs.push(row); lsave(d); return row; }
  const user = await getUser();
  return wchk(await sb.from('daily_logs').upsert({ user_id: user.id, ...row, updated_at: new Date().toISOString() }, { onConflict: 'user_id,date' }).select().single());
}

/* ---------- auth: 비밀번호 ---------- */
export async function sendPasswordReset(email) {
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/?reset=1' });
  if (error) throw error;
}
export async function updatePassword(pw) {
  const { error } = await sb.auth.updateUser({ password: pw });
  if (error) throw error;
}
export function onPasswordRecovery(cb) { if (isCloud) sb.auth.onAuthStateChange(e => { if (e === 'PASSWORD_RECOVERY') cb(); }); }

/* ---------- push 구독 ---------- */
export async function savePushSub(sub) {
  const j = sub.toJSON();
  const user = await getUser();
  return wchk(await sb.from('push_subscriptions').upsert({ user_id: user.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_agent: navigator.userAgent.slice(0, 200) }, { onConflict: 'endpoint' }).select().single());
}
export async function deletePushSub(endpoint) { if (isCloud) await sb.from('push_subscriptions').delete().eq('endpoint', endpoint); }

/* ---------- 오프라인 캐시 ---------- */
const CKEY = 'rc-offline-cache';
export function cacheSnapshot(data) { try { localStorage.setItem(CKEY, JSON.stringify({ at: new Date().toISOString(), ...data })); } catch { } }
export function readSnapshot() { try { return JSON.parse(localStorage.getItem(CKEY)); } catch { return null; } }

/* ---------- images (가민 기록 이미지) ---------- */
const BUCKET = 'run-images';
const urlCache = new Map();
function blobToDataURL(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
}
export async function uploadImage(workoutId, blob) {
  if (!isCloud) return blobToDataURL(blob);
  const user = await getUser();
  const path = `${user.id}/${workoutId}/${Date.now()}.jpg`;
  chk(await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false }));
  return path;
}
export async function imageUrl(path) {
  if (!path || path.startsWith('data:')) return path;
  const c = urlCache.get(path);
  if (c && c.exp > Date.now()) return c.url;
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error) throw error;
  urlCache.set(path, { url: data.signedUrl, exp: Date.now() + 50 * 60 * 1000 });
  return data.signedUrl;
}
export async function removeImage(path) {
  if (!isCloud || !path || path.startsWith('data:')) return;
  await sb.storage.from(BUCKET).remove([path]);
  urlCache.delete(path);
}

/* ---------- races (목표 대회 여러 개) ---------- */
export async function listRaces() {
  if (!isCloud) return lload().races;
  return chk(await sb.from('races').select('*').order('date'));
}
export async function saveRace(r) {
  const row = clean(r, R_FIELDS);
  if (!isCloud) {
    const d = lload(); const i = d.races.findIndex(x => x.id === row.id);
    const merged = { ...(i >= 0 ? d.races[i] : { created_at: new Date().toISOString() }), ...row };
    if (i >= 0) d.races[i] = merged; else d.races.push(merged);
    lsave(d); return merged;
  }
  return wchk(await sb.from('races').upsert(row).select().single());
}
export async function deleteRace(id) {
  if (!isCloud) { const d = lload(); d.races = d.races.filter(x => x.id !== id); lsave(d); return; }
  wchk(await sb.from('races').delete().eq('id', id));
}

/* ---------- backup ---------- */
export async function exportAll() {
  return { exported_at: new Date().toISOString(), version: 2, races: await listRaces(), shoes: await listShoes(), workouts: await listWorkouts(), logs: await listLogs(), profile: await getSettings() };
}
/** 자동 백업: 하루 1회 스냅샷을 Storage(backups)에 저장, 최근 30개 유지 */
export async function autoBackup(force = false) {
  if (!isCloud) return null;
  const st = await getSettings();
  const last = st.last_backup_at ? new Date(st.last_backup_at) : null;
  if (!force && last && Date.now() - last < 20 * 3600 * 1000) return last;
  const user = await getUser();
  const data = await exportAll();
  const name = `${user.id}/backup-${new Date().toISOString().slice(0, 10)}.json`;
  chk(await sb.storage.from('backups').upload(name, new Blob([JSON.stringify(data)], { type: 'application/json' }), { upsert: true, contentType: 'application/json' }));
  const now = new Date().toISOString();
  await sb.from('settings').upsert({ user_id: user.id, last_backup_at: now });
  const { data: files } = await sb.storage.from('backups').list(user.id, { sortBy: { column: 'name', order: 'desc' }, limit: 100 });
  const old = (files || []).slice(30).map(f => `${user.id}/${f.name}`);
  if (old.length) await sb.storage.from('backups').remove(old);
  return new Date(now);
}
export async function listBackups() {
  if (!isCloud) return [];
  const user = await getUser();
  const { data, error } = await sb.storage.from('backups').list(user.id, { sortBy: { column: 'name', order: 'desc' }, limit: 30 });
  if (error) throw error;
  return (data || []).map(f => ({ name: f.name, path: `${user.id}/${f.name}`, size: f.metadata?.size, updated: f.updated_at || f.created_at }));
}
export async function downloadBackup(path) {
  const { data, error } = await sb.storage.from('backups').download(path);
  if (error) throw error;
  return JSON.parse(await data.text());
}
export async function importAll(data) {
  for (const r of data.races || []) await saveRace(r);
  for (const l of data.logs || []) await saveLog(l);
  if (!data.races && data.settings?.race_date) {
    await saveRace({ name: data.settings.race_name || '목표 대회', date: data.settings.race_date, distance_km: 42.195, goal_time: data.settings.goal_time, priority: 'A' });
  }
  for (const s of data.shoes || []) await saveShoe(s);
  for (const w of data.workouts || []) await saveWorkout(w);
}
