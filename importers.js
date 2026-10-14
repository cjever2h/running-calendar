// 외부 기록 파일 가져오기: GPX / FIT / CSV(가민 커넥트·스트라바 내보내기)
import { fmtDuration } from './plan.js';

const pad = n => String(n).padStart(2, '0');
const localIso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const R = 6371008.8;
function hav(a, b) {
  const toR = x => x * Math.PI / 180;
  const dLat = toR(b.lat - a.lat), dLon = toR(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/* ---------- GPX ---------- */
export function parseGPX(text, fileName = '') {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('GPX 파일 형식이 올바르지 않아요');
  const pts = [...doc.getElementsByTagName('trkpt')].map(p => {
    const t = p.getElementsByTagName('time')[0]?.textContent;
    const hrEl = [...p.getElementsByTagName('*')].find(e => /(^|:)hr$/i.test(e.tagName));
    const cadEl = [...p.getElementsByTagName('*')].find(e => /(^|:)cad$/i.test(e.tagName));
    const ele = p.getElementsByTagName('ele')[0]?.textContent;
    return { lat: +p.getAttribute('lat'), lon: +p.getAttribute('lon'), t: t ? new Date(t) : null, hr: hrEl ? +hrEl.textContent : null, cad: cadEl ? +cadEl.textContent : null, ele: ele != null ? +ele : null };
  }).filter(p => isFinite(p.lat) && isFinite(p.lon));
  if (pts.length < 2) throw new Error('GPX에 경로 데이터가 없어요');
  let dist = 0, moving = 0, gain = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = hav(pts[i - 1], pts[i]); dist += d;
    if (pts[i].t && pts[i - 1].t) {
      const dt = (pts[i].t - pts[i - 1].t) / 1000;
      if (dt > 0 && (dt <= 10 || d / dt > 0.8)) moving += dt; // 멈춘 구간 제외
    }
    if (pts[i].ele != null && pts[i - 1].ele != null && pts[i].ele > pts[i - 1].ele) gain += pts[i].ele - pts[i - 1].ele;
  }
  const hrs = pts.map(p => p.hr).filter(Boolean), cads = pts.map(p => p.cad).filter(Boolean);
  const start = pts.find(p => p.t)?.t;
  const name = doc.querySelector('trk > name, metadata > name')?.textContent?.trim();
  return [{
    date: start ? localIso(start) : null, start: start ? localTime(start) : null,
    title: name || fileName.replace(/\.[^.]+$/, '') || 'GPX 러닝',
    distance: Math.round(dist / 10) / 100, time: moving ? fmtDuration(Math.round(moving)) : null,
    avgHr: hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null,
    maxHr: hrs.length ? Math.max(...hrs) : null,
    cadence: cads.length ? Math.round(cads.reduce((a, b) => a + b, 0) / cads.length * (cads[0] < 120 ? 2 : 1)) : null,
    elevation: Math.round(gain), source: 'gpx',
  }];
}

/* ---------- FIT (가민 원본 파일) ---------- */
const FIT_EPOCH = Date.UTC(1989, 11, 31, 0, 0, 0);
export function parseFIT(buf) {
  const dv = new DataView(buf);
  const hSize = dv.getUint8(0);
  const sig = String.fromCharCode(dv.getUint8(8), dv.getUint8(9), dv.getUint8(10), dv.getUint8(11));
  if (sig !== '.FIT') throw new Error('FIT 파일이 아니에요');
  const dataSize = dv.getUint32(4, true);
  let off = hSize; const end = Math.min(buf.byteLength, hSize + dataSize);
  const defs = {}; const sessions = [], records = [];
  let lastTs = 0;
  const readVal = (pos, size, base, le) => {
    const t = base & 0x1f;
    try {
      if (t === 0 || t === 2 || t === 10 || t === 13) return size === 1 ? dv.getUint8(pos) : null;
      if (t === 1) return dv.getInt8(pos);
      if (t === 3) return size >= 2 ? dv.getInt16(pos, le) : null;
      if (t === 4 || t === 11) return size >= 2 ? dv.getUint16(pos, le) : null;
      if (t === 5) return size >= 4 ? dv.getInt32(pos, le) : null;
      if (t === 6 || t === 12) return size >= 4 ? dv.getUint32(pos, le) : null;
      if (t === 8) return size >= 4 ? dv.getFloat32(pos, le) : null;
    } catch { return null; }
    return null;
  };
  const INVALID = { 0: 0xff, 2: 0xff, 10: 0, 13: 0xff, 1: 0x7f, 3: 0x7fff, 4: 0xffff, 11: 0, 5: 0x7fffffff, 6: 0xffffffff, 12: 0 };
  while (off < end) {
    const h = dv.getUint8(off); off++;
    if (h & 0x80) { // compressed timestamp
      const lt = (h >> 5) & 0x3; const def = defs[lt]; if (!def) break;
      const tsOff = h & 0x1f;
      lastTs = (lastTs & ~0x1f) + tsOff + ((tsOff < (lastTs & 0x1f)) ? 0x20 : 0);
      const msg = { 253: lastTs };
      for (const f of def.fields) { const v = readVal(off, f.size, f.base, def.le); if (v !== INVALID[f.base & 0x1f]) msg[f.num] = v; off += f.size; }
      off += def.devSize;
      if (def.global === 20) records.push(msg); else if (def.global === 18) sessions.push(msg);
      continue;
    }
    const local = h & 0x0f;
    if (h & 0x40) { // definition
      off++; const arch = dv.getUint8(off); off++;
      const le = arch === 0;
      const global = dv.getUint16(off, le); off += 2;
      const n = dv.getUint8(off); off++;
      const fields = [];
      for (let i = 0; i < n; i++) { fields.push({ num: dv.getUint8(off), size: dv.getUint8(off + 1), base: dv.getUint8(off + 2) }); off += 3; }
      let devSize = 0;
      if (h & 0x20) { const dn = dv.getUint8(off); off++; for (let i = 0; i < dn; i++) { devSize += dv.getUint8(off + 1); off += 3; } }
      defs[local] = { global, fields, le, devSize };
    } else {
      const def = defs[local]; if (!def) throw new Error('FIT 파일을 해석할 수 없어요');
      const msg = {};
      for (const f of def.fields) { const v = readVal(off, f.size, f.base, def.le); if (v !== INVALID[f.base & 0x1f]) msg[f.num] = v; off += f.size; }
      off += def.devSize;
      if (msg[253] != null) lastTs = msg[253];
      if (def.global === 18) sessions.push(msg); else if (def.global === 20) records.push(msg);
    }
  }
  const toDate = s => new Date(FIT_EPOCH + s * 1000);
  const out = [];
  for (const s of sessions) {
    const sport = s[5];
    if (sport != null && sport !== 1 && sport !== 11 && sport !== 0) continue; // 1=running, 11=walking? 0=generic
    const st = s[2] != null ? toDate(s[2]) : (s[253] != null ? toDate(s[253]) : null);
    out.push({
      date: st ? localIso(st) : null, start: st ? localTime(st) : null, title: '러닝 (FIT)',
      distance: s[9] != null ? Math.round(s[9] / 1000) / 100 : null,
      time: s[8] != null ? fmtDuration(Math.round(s[8] / 1000)) : (s[7] != null ? fmtDuration(Math.round(s[7] / 1000)) : null),
      avgHr: s[16] ?? null, maxHr: s[17] ?? null, cadence: s[18] != null ? s[18] * 2 : null,
      elevation: s[22] ?? null, kcal: s[11] ?? null, source: 'fit',
    });
  }
  if (!out.length && records.length) {
    const ds = records.filter(r => r[5] != null), hr = records.map(r => r[3]).filter(Boolean);
    const t0 = records.find(r => r[253] != null)?.[253], t1 = [...records].reverse().find(r => r[253] != null)?.[253];
    out.push({ date: t0 ? localIso(toDate(t0)) : null, start: t0 ? localTime(toDate(t0)) : null, title: '러닝 (FIT)',
      distance: ds.length ? Math.round(ds[ds.length - 1][5] / 1000) / 100 : null, time: t0 && t1 ? fmtDuration(t1 - t0) : null,
      avgHr: hr.length ? Math.round(hr.reduce((a, b) => a + b, 0) / hr.length) : null, maxHr: hr.length ? Math.max(...hr) : null, source: 'fit' });
  }
  if (!out.length) throw new Error('FIT 파일에서 러닝 기록을 찾지 못했어요');
  return out;
}

/* ---------- CSV ---------- */
function splitCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}
const normH = s => s.replace(/^\uFEFF/, '').trim().toLowerCase();
function findCol(headers, keys) { for (const k of keys) { const i = headers.findIndex(h => h === k || h.includes(k)); if (i >= 0) return i; } return -1; }
function toHms(v) {
  if (!v) return null; v = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(v)) return fmtDuration(Math.round(+v)); // 초
  const m = v.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/); if (!m) return null;
  return m[3] != null ? `${+m[1]}:${m[2]}:${m[3]}` : `${+m[1]}:${m[2]}`;
}
function toDateStr(v) {
  if (!v) return null; v = String(v).trim();
  const m = v.match(/(20\d{2})[-./](\d{1,2})[-./](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (m) return { date: `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`, start: m[4] ? `${pad(+m[4])}:${m[5]}` : null };
  const d = new Date(v); if (!isNaN(d)) return { date: localIso(d), start: localTime(d) };
  return null;
}
export function parseCSV(text) {
  const rows = splitCSV(text);
  if (rows.length < 2) throw new Error('CSV에 데이터가 없어요');
  const H = rows[0].map(normH);
  const ci = {
    type: findCol(H, ['activity type', '활동 유형', '활동 종류', 'type']),
    date: findCol(H, ['activity date', 'date', '날짜', '시작 시간', 'start time']),
    title: findCol(H, ['activity name', 'title', '제목', 'name', '이름']),
    dist: findCol(H, ['distance', '거리']),
    time: findCol(H, ['moving time', '이동 시간', 'time', '시간', 'elapsed time', '경과 시간']),
    hr: findCol(H, ['avg hr', 'average heart rate', '평균 심박', '평균심박']),
    maxhr: findCol(H, ['max hr', 'max heart rate', '최대 심박', '최대심박']),
    cad: findCol(H, ['avg run cadence', '평균 달리기 케이던스', 'average cadence', '평균 케이던스']),
    elev: findCol(H, ['total ascent', 'elevation gain', '총 상승', '상승']),
  };
  if (ci.date < 0 || ci.dist < 0) throw new Error('날짜·거리 열을 찾지 못했어요 (가민 커넥트/스트라바 CSV를 사용해 주세요)');
  const out = [];
  for (const r of rows.slice(1)) {
    const type = ci.type >= 0 ? r[ci.type] || '' : '';
    if (type && !/run|러닝|달리기|트레일|트랙|런/i.test(type)) continue;
    const d = toDateStr(r[ci.date]); if (!d) continue;
    let dist = parseFloat(String(r[ci.dist] || '').replace(/,/g, ''));
    if (!isFinite(dist) || dist <= 0) continue;
    if (dist > 300) dist = dist / 1000; // 미터 단위
    const num = i => i >= 0 ? parseFloat(String(r[i] || '').replace(/,/g, '')) || null : null;
    out.push({ date: d.date, start: d.start, title: ci.title >= 0 ? r[ci.title] : (type || '러닝'), distance: Math.round(dist * 100) / 100,
      time: ci.time >= 0 ? toHms(r[ci.time]) : null, avgHr: num(ci.hr), maxHr: num(ci.maxhr), cadence: num(ci.cad), elevation: num(ci.elev), source: 'csv' });
  }
  if (!out.length) throw new Error('러닝 기록을 찾지 못했어요');
  return out;
}

export async function parseFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.gpx')) return parseGPX(await file.text(), file.name);
  if (name.endsWith('.fit')) return parseFIT(await file.arrayBuffer());
  if (name.endsWith('.csv')) return parseCSV(await file.text());
  throw new Error(`지원하지 않는 형식이에요: ${file.name}`);
}
