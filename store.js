// 데이터 저장소: Supabase(클라우드) 또는 localStorage(로컬) 모드
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const isCloud = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
let sb = null;

const W_FIELDS = ['id', 'date', 'type', 'title', 'planned_distance', 'target_pace', 'details', 'status',
  'actual_distance', 'actual_time', 'avg_hr', 'rpe', 'memo', 'shoe_id'];
const S_FIELDS = ['id', 'brand', 'model', 'nickname', 'color', 'purpose', 'purchase_date', 'initial_km',
  'max_km', 'retired', 'notes'];
const NUMERIC = new Set(['planned_distance', 'actual_distance', 'avg_hr', 'rpe', 'initial_km', 'max_km']);

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
  try { return JSON.parse(localStorage.getItem(LKEY)) || { workouts: [], shoes: [], settings: {} }; }
  catch { return { workouts: [], shoes: [], settings: {} }; }
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

/* ---------- backup ---------- */
export async function exportAll() {
  return { exported_at: new Date().toISOString(), settings: await getSettings(), shoes: await listShoes(), workouts: await listWorkouts() };
}
export async function importAll(data) {
  if (data.settings) await saveSettings(data.settings);
  for (const s of data.shoes || []) await saveShoe(s);
  for (const w of data.workouts || []) await saveWorkout(w);
}
