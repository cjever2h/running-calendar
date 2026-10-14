// 가민(Garmin) 기록 이미지 → 텍스트 인식(OCR) → 러닝 정보 추출
// OCR: Tesseract.js (브라우저에서 동작, 처음 1회 한국어/영어 인식 데이터 다운로드 후 캐시)

const TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let tessP = null, workerP = null, progressCb = null;

function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  tessP ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = TESS_URL;
    s.onload = () => res(window.Tesseract);
    s.onerror = () => { tessP = null; rej(new Error('인식 엔진을 불러오지 못했어요. 네트워크를 확인해 주세요.')); };
    document.head.appendChild(s);
  });
  return tessP;
}
async function getWorker() {
  const T = await loadTesseract();
  workerP ||= T.createWorker(['kor', 'eng'], 1, { logger: m => progressCb?.(m) }).catch(e => { workerP = null; throw e; });
  return workerP;
}

export function loadImg(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('이미지를 열 수 없어요'));
    img.src = typeof src === 'string' ? src : URL.createObjectURL(src);
  });
}

/** 저장용 압축 (JPEG) */
export async function compressImage(file, maxW = 1080, quality = 0.85) {
  const img = await loadImg(file);
  const s = Math.min(1, maxW / img.naturalWidth);
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(res, 'image/jpeg', quality));
}

/** OCR용 캔버스: 요약 영역(상단)만 잘라 확대 + 흑백/대비 보정, invert=true면 반전 */
function ocrCanvas(img, invert = false) {
  const W = img.naturalWidth, H = img.naturalHeight;
  const cropH = Math.min(H, Math.round(W * 2.9));
  const scale = Math.min(3, Math.max(1, 1200 / W));
  const c = document.createElement('canvas');
  c.width = Math.round(W * scale); c.height = Math.round(cropH * scale);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, W, cropH, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height); const p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    let v = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
    if (invert) v = 255 - v;
    v = Math.max(0, Math.min(255, (v - 128) * 1.35 + 128));
    p[i] = p[i + 1] = p[i + 2] = v;
  }
  g.putImageData(d, 0, 0);
  return c;
}

const pad = n => String(n).padStart(2, '0');

/** OCR 텍스트에서 러닝 정보 추출 */
export function parseGarmin(raw) {
  const t = String(raw || '')
    .replace(/[|]/g, ' ')
    .replace(/[‘’`´′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[ \t]+/g, ' ');
  const r = {};
  let rest = t;

  // 날짜 + 시작 시각
  const dm = t.match(/(20\d{2})\s*[\/.\-]\s*(\d{1,2})\s*[\/.\-]\s*(\d{1,2})/);
  if (dm) {
    const mo = +dm[2], da = +dm[3];
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) r.date = `${dm[1]}-${pad(mo)}-${pad(da)}`;
    const endIdx = dm.index + dm[0].length;
    const after = t.slice(endIdx, endIdx + 24);
    const st = after.match(/(\d{1,2}:\d{2})(?!:)/);
    if (st) {
      r.start = st[1];
      const cut = endIdx + after.indexOf(st[1]) + st[1].length;
      rest = t.slice(0, dm.index) + ' ' + t.slice(cut);
    } else rest = t.slice(0, dm.index) + ' ' + t.slice(endIdx);
    // 같은 줄에서 날짜 앞의 텍스트 = 활동 이름
    const ls = t.lastIndexOf('\n', dm.index) + 1;
    const before = t.slice(ls, dm.index).replace(/[^\p{L}\p{N}_:()\-\s.]/gu, ' ').replace(/\s+/g, ' ').trim();
    if (/[\p{L}]{2,}/u.test(before) && before.length >= 2) r.title = before;
  }

  // 거리 (첫 번째 km 값 = 활동 거리, '월간 거리'는 뒤에 나옴)
  const km = rest.match(/(\d{1,3}[.,]\d{1,2})\s*k\s*m/i);
  if (km) { const v = parseFloat(km[1].replace(',', '.')); if (v > 0.2 && v < 200) r.distance = v; }

  // 운동 시간 (시작 시각을 제외한 첫 시간 값)
  const tm = rest.match(/(?<![\d:.])(\d{1,2}:\d{2}:\d{2}|\d{1,3}:\d{2})(?![\d:])/);
  if (tm) r.time = tm[1];

  // 평균 페이스 6'12"
  const pc = rest.match(/(\d{1,2})\s*'\s*(\d{2})/);
  if (pc) r.pace = `${+pc[1]}:${pc[2]}`;

  // 심박
  const hrs = [...rest.matchAll(/(\d{2,3})\s*bpm/gi)].map(m => +m[1]).filter(v => v >= 60 && v <= 220);
  if (hrs.length) { r.avgHr = hrs[0]; if (hrs[1] && hrs[1] > hrs[0]) r.maxHr = hrs[1]; }
  else {
    const h2 = rest.match(/(\d{2,3})\s*(?:bpm)?\s*\n?\s*평균\s*심박/);
    if (h2) r.avgHr = +h2[1];
  }

  // 케이던스
  const cd = rest.match(/(\d{3})\s*spm/i) || rest.match(/(\d{3})\s*\n?\s*평균\s*케이던스/);
  if (cd && +cd[1] > 120 && +cd[1] < 240) r.cadence = +cd[1];

  const el = rest.match(/(\d{1,4})\s*m\s*\n?\s*상승/); if (el) r.elevation = +el[1];
  const kc = rest.match(/([\d,]{2,6})\s*kcal/i); if (kc) r.kcal = kc[1];
  const ld = rest.match(/(\d{2,4})\s*\n?\s*운동\s*부하/); if (ld) r.load = +ld[1];
  const tp = t.match(/(-?\d{1,2}(?:\.\d)?)\s*°\s*C?/); if (tp) r.temp = tp[1];
  const hu = t.match(/°\s*C?[^\n%]{0,8}?(\d{2,3})\s*%/); if (hu) r.humidity = hu[1];
  const ps = rest.match(/(\d{1,2}:\d{2}(?::\d{2})?)\s*\n?\s*일시\s*중지\s*포함/); if (ps && ps[1] !== r.time) r.timeWithPause = ps[1];

  // 활동 이름 보조 추출
  if (!r.title) {
    const lines = t.split('\n').map(s => s.trim()).filter(Boolean);
    const kw = /(LSD|lsd|템포|인터벌|조깅|리커버리|회복|트레일|러닝|마라톤|런|빌드업|페이스|MP|대회)/;
    const ln = lines.find(l => kw.test(l) && !/GARMIN|SPORTS|Forerunner|월간|평균|일시/i.test(l));
    if (ln) r.title = ln.replace(/[^\p{L}\p{N}_:()\-\s.]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  }
  return r;
}

function score(r) { return ['date', 'distance', 'time', 'pace', 'avgHr'].filter(k => r[k] != null).length; }

/** 이미지 1장 인식. onStatus(문구, 진행률0~1) */
export async function recognizeGarmin(file, onStatus = () => {}) {
  const img = await loadImg(file);
  progressCb = m => {
    if (m.status === 'recognizing text') onStatus('글자 인식 중', m.progress);
    else if (/load|download|initializ/i.test(m.status)) onStatus('인식 엔진 준비 중 (처음 한 번은 시간이 걸려요)', m.progress || 0);
  };
  onStatus('인식 엔진 준비 중 (처음 한 번은 시간이 걸려요)', 0);
  const worker = await getWorker();
  const a = await worker.recognize(ocrCanvas(img, false));
  let best = parseGarmin(a.data.text), text = a.data.text;
  if (score(best) < 4) {
    onStatus('어두운 배경 다시 인식 중', 0);
    const b = await worker.recognize(ocrCanvas(img, true));
    const pb = parseGarmin(b.data.text);
    const [hi, lo] = score(pb) > score(best) ? [pb, best] : [best, pb];
    best = { ...lo, ...hi };
    text += '\n----- (반전) -----\n' + b.data.text;
  }
  onStatus('완료', 1);
  return { ...best, rawText: text };
}

/** 활동 이름/거리/페이스로 훈련 종류 추정 */
export function guessType(title = '', distance = 0, paceSec = null, mpSec = 298) {
  const s = String(title).toLowerCase();
  if (/인터벌|interval|반복|1km\s*[x×]/.test(s)) return 'interval';
  if (/템포|tempo|역치|threshold|빌드업/.test(s)) return 'tempo';
  if (/리커버리|회복|recovery|셰이크|샤키|shake/.test(s)) return 'recovery';
  if (/트레일|trail|업힐|hill|산\b|산 /.test(s)) return 'hill';
  if (/lsd|장거리|long/.test(s) || distance >= 18) return 'long';
  if (/\bmp\b|마라톤\s*페이스|페이스런/.test(s)) return 'mp';
  if (paceSec && paceSec <= mpSec + 15 && distance >= 8) return 'mp';
  return 'easy';
}

/** 가민 상세 기록 텍스트 블록 */
export function garminSummary(r) {
  const L = [];
  const head = [r.start && `시작 ${r.start}`, r.temp && `${r.temp}°C${r.humidity ? ` / 습도 ${r.humidity}%` : ''}`].filter(Boolean).join(' · ');
  if (head) L.push(head);
  const a = [r.pace && `평균 페이스 ${r.pace}/km`, r.avgHr && `평균 심박 ${r.avgHr}${r.maxHr ? ` / 최대 ${r.maxHr}` : ''}`].filter(Boolean).join(' · ');
  if (a) L.push(a);
  const b = [r.cadence && `케이던스 ${r.cadence}spm`, r.elevation != null && `상승 ${r.elevation}m`, r.load && `운동 부하 ${r.load}`, r.kcal && `${r.kcal}kcal`].filter(Boolean).join(' · ');
  if (b) L.push(b);
  if (r.timeWithPause) L.push(`일시중지 포함 ${r.timeWithPause}`);
  return L.length ? '[가민 기록]\n' + L.join('\n') : '';
}
