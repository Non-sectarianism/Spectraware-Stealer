'use strict';
const fs = require('fs');
const path = require('path');
const f = process.argv[2];
const s = fs.readFileSync(f, 'utf8');
console.log(s.includes('1543227') ? 'FAIL plaintext webhook' : 'PASS no plaintext webhook');
const m = s.match(/JSON\.parse\((_\w+)\("([A-Za-z0-9+/=]+)","([a-f0-9]+)"\)\)/);
if (!m) { console.log('FAIL no CFG blob'); process.exit(1); }
console.log('CFG blob len ' + m[2].length + ' decoder ' + m[1]);
// extract decoder fn
const dm = s.match(new RegExp('function ' + m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\(b,k\\)\\{[^\\n]*\\}'));
if (!dm) { console.log('FAIL no decoder'); process.exit(1); }
console.log('decoder found len ' + dm[0].length);
if (dm[0].includes(m[1] + '("')) console.log('FAIL decoder self-encrypts');
else console.log('PASS decoder clean');
// runtime decrypt in isolation
const fn = new Function('Buffer', dm[0] + '; return ' + m[1] + '("' + m[2] + '","' + m[3] + '");');
const json = fn(Buffer);
const cfg = JSON.parse(json);
console.log('MODE=' + cfg.MODE);
console.log('WEBHOOK=' + cfg.DISCORD_WEBHOOK.slice(0, 50) + '...');
console.log('C2=' + cfg.C2_URL);
console.log('decrypt OK');
