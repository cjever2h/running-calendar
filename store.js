// 데이터 저장소: Supabase(클라우드) 또는 localStorage(로컬) 모드
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const isCloud = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
let sb = null;

const W_FIELDS = ['id', 'date', 'type', 'title', 'planned_distance', 'target_pace', 'details', 'status',
  'actual_distance', 'actual_time', 'avg_hr', 'rpe', 'memo', 'shoe_id', 'images'];
const S_FIELDS = ['id', 'brand', 'model', 'nickname', 'color', 'purpose', 'purchase_date', 'initial_km',
  'max_km', 'retired', 'notes'];
const R_FIELDS = ['id', 'name', 'date', 'distance_km', 'goal_time', 'priority', 'location', 'notes'];
const NUMERIC = new Set(['planned_distance', 'actual_distance', 'avg_hr', 'rpe', 'initial_km', 'max_km', 'distance_km']);

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
  return chk(await sb.from('workouts').upsert(row).select().single());
}
export async function insertWorkouts(list) {
  const rows = list.map(w => clean(w, W_FIELDS));
  if (!rows.length) return [];
  if (!isCloud) { const d = lload(); d.workouts.push(...rows.map(r => ({ ...r, created_at: new Date().toISOString() }))); lsave(d); return rows; }
  return chk(await sb.from('workouts').insert(rows).select());
}
export async function deleteWorkout(id) {
  if (!isCloud) { const d = lload(); d.workouts = d.workouts.filter(x => x.id !== id); lsave(d); return; }
  chk(await sb.from('workouts').delete().eq('id', id));
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
  return chk(await sb.from('shoes').upsert(row).select().single());
}
export async function deleteShoe(id) {
  if (!isCloud) {
    const d = lload(); d.shoes = d.shoes.filter(x => x.id !== id);
    d.workouts.forEach(w => { if (w.shoe_id === id) w.shoe_id = null; }); lsave(d); return;
  }
  chk(await sb.from('shoes').delete().eq('id', id));
}

/* ---------- settings ---------- */
export async function getSettings() {
  if (!isCloud) return lload().settings || {};
  const data = chk(await sb.from('settings').select('*').maybeSingle());
  return data || {};
}
export async function saveSettings(s) {
  const row = { race_name: s.race_name || null, race_date: s.race_date || null, goal_time: s.goal_time || null };
  if (!isCloud) { const d = lload(); d.settings = row; lsave(d); return row; }
  const user = await getUser();
  return chk(await sb.from('settings').upsert({ user_id: user.id, ...row, updated_at: new Date().toISOString() }).select().single());
}

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
  return chk(await sb.from('races').upsert(row).select().single());
}
export async function deleteRace(id) {
  if (!isCloud) { const d = lload(); d.races = d.races.filter(x => x.id !== id); lsave(d); return; }
  chk(await sb.from('races').delete().eq('id', id));
}

/* ---------- backup ---------- */
export async function exportAll() {
  return { exported_at: new Date().toISOString(), races: await listRaces(), shoes: await listShoes(), workouts: await listWorkouts() };
}
export async function importAll(data) {
  for (const r of data.races || []) await saveRace(r);
  if (!data.races && data.settings?.race_date) {
    await saveRace({ name: data.settings.race_name || '목표 대회', date: data.settings.race_date, distance_km: 42.195, goal_time: data.settings.goal_time, priority: 'A' });
  }
  for (const s of data.shoes || []) await saveShoe(s);
  for (const w of data.workouts || []) await saveWorkout(w);
}
