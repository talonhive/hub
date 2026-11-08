// Bee Engine: wallet connect, Mining Keys and mining sessions, following GOSH's official example
// (github.com/gosh-sh/bee-engine, examples/javascript/miner-react). The SDK (~9 MB) loads only when the user
// connects or mines. TalonHive never sees the wallet's seed phrase or keys: the wallet approves a connection,
// then approves separate Mining Keys that can only mine and can be revoked in the wallet.
import { MINING, pickNetwork } from "./mining.js";

const SDK_DIR = "./vendor/bee-sdk-6.0.0-ng/";   // GOSH 6.0.0 + community patches, built by us (tools/bee-sdk)
// Network: Shellnet unless this device opted into the private mainnet mode (?net=mainnet, see mining.js).
let savedNet = null;
try { savedNet = localStorage.getItem("th:net"); } catch { /* private mode */ }
const picked = pickNetwork(typeof location !== "undefined" ? location.search : "", savedNet);
if (picked.save) {
  try { localStorage.setItem("th:net", picked.save); } catch { /* private mode */ }
  try { history.replaceState(null, "", location.pathname + location.hash); } catch { /* ignore */ }   // keep the link private
}
export const NET = picked.net;
const EP = NET.endpoints;
const APP = MINING.appDappId;
const CLIENT = { network: { endpoints: EP } };

// Kept on this device only, separately per network. The Mining Keys secret can only mine for this app and is
// revocable in the wallet.
const prefix = NET.name === "shellnet" ? "th:bee:" : `th:bee:${NET.name}:`;
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(prefix + k) || "null"); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(prefix + k) : localStorage.setItem(prefix + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

let sdkP = null;
export function loadSdk() {
  if (!sdkP) {
    sdkP = import(SDK_DIR + "bee_sdk.js").then(async (m) => {
      await m.default({ module_or_path: new URL(SDK_DIR + "bee_sdk_bg.wasm", import.meta.url) });
      return m;
    });
    sdkP.catch(() => { sdkP = null; });
  }
  return sdkP;
}

/** Saved wallet connection ({ walletName, ... }) or null. */
export const connection = () => {
  const c = store.get("conn");
  return c && c.appId === APP ? c : null;
};
/** Saved Mining Keys record or null; .ready once the keys are live on chain. */
export const miningKeys = () => {
  const k = store.get("keys");
  const c = connection();
  return k && c && k.walletName === c.walletName && k.appId === APP ? k : null;
};

// The network API sometimes answers "502 Bad Gateway" (seen on mainnet ~half the time), which the SDK reports
// as an error. READ calls are retried through those blips until a deadline. Calls that SEND a message are not:
// a send can reach the node even when the reply fails, and an identical resend is then refused as
// DUPLICATE_MESSAGE. retryIf limits retries to errors that happened before anything was sent.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function retrying(fn, { untilMs = 30000, everyMs = 2000, stillWanted = () => true, retryIf = () => true } = {}) {
  const deadline = Date.now() + untilMs;
  for (;;) {
    try { return await fn(); } catch (e) {
      if (!stillWanted()) throw new Error("cancelled");
      if (!retryIf(e) || Date.now() + everyMs > deadline) throw e;
      await sleep(everyMs);
    }
  }
}
// Miner.new first reads the miner (safe to retry); only then may it send "cancel stale session". QUEUE_OVERFLOW
// ("Message queue is full") means the node refused the message without queueing it, so resending is safe too.
const failedBeforeSending = (e) => /Get miner details|QUEUE_OVERFLOW|Message queue is full/.test(fullError(e));

let connectToken = 0;
/** Step 1: connect the wallet. onLink(deepLink) is called first, so the page can show "Open wallet". */
export async function connectWallet(onLink) {
  const sdk = await loadSdk();
  const token = ++connectToken;
  const bc = new sdk.BeeConnect();
  const s = bc.create_shared_key_session(APP, 300, null);
  onLink(s.deep_link);
  const hello = await retrying(() => bc.wait_wallet_hello(EP, s.session_id, s.description, s.client_dh_secret, s.created_at, 150, 2000),
    { untilMs: 300000, stillWanted: () => token === connectToken });
  if (token !== connectToken) throw new Error("cancelled");
  const conn = {
    appId: APP, walletName: hello.wallet_name, walletAddress: hello.wallet_address, profileAddress: hello.profile_address,
    sessionId: s.session_id, description: s.description, sessionStateJson: hello.session_state_json,
  };
  store.set("conn", conn);
  return conn;
}
export function cancelConnect() { connectToken++; }

/** Step 2: ask the wallet to allow Mining Keys, then wait until they are live on chain. */
export async function allowMining(onLink, onStatus) {
  const sdk = await loadSdk();
  const conn = connection();
  if (!conn) throw new Error("Connect your wallet first.");
  const gen = await sdk.gen_mining_keys(APP);
  const bc = new sdk.BeeConnect();
  const req = await bc.request_set_mining_keys(EP, conn.sessionId, conn.description, conn.sessionStateJson, APP, gen.public, 30, 1000);   // sends: no retry
  if (req.updated_session_state_json) { conn.sessionStateJson = req.updated_session_state_json; store.set("conn", conn); }
  const rec = { appId: APP, walletName: conn.walletName, ownerPublic: gen.public, ownerSecret: gen.secret, minerAddress: null, ready: false };
  store.set("keys", rec);
  onLink(gen.deep_link);   // fallback: opens the approval straight in the wallet if its prompt didn't appear
  return waitKeysReady(sdk, rec, onStatus);
}

/** Resume waiting after an app restart (keys requested but not yet confirmed). */
export async function resumeKeys(onStatus) {
  const rec = miningKeys();
  if (!rec || rec.ready) return rec;
  return waitKeysReady(await loadSdk(), rec, onStatus);
}

async function waitKeysReady(sdk, rec, onStatus) {
  rec.minerAddress = await retrying(() => sdk.get_miner_address_by_wallet_name({ client_config: CLIENT, wallet_name: rec.walletName }));
  store.set("keys", rec);
  onStatus("Tap Open Acki Nacki Wallet below and approve Mining Keys, then come back here. Waiting for confirmation…");
  await retrying(() => sdk.ensure_mining_keys_propagated({
    client_config: CLIENT, miner_address: rec.minerAddress, app_id: APP, expected_owner_public: rec.ownerPublic,
    max_attempts: 150, interval_ms: 2000,
  }), { untilMs: 300000 });
  rec.ready = true;
  store.set("keys", rec);
  return rec;
}

/** Forget the connection and keys on this device (the wallet can also revoke the keys). */
export function disconnect() {
  stopMining();
  try { miner?.free(); } catch { /* already freed */ }
  miner = null;
  store.set("keys", null); store.set("conn", null);
}

// ---- mining sessions ----
// While mining is on, Bee Engine sessions (MINING.sessionMs each) run back to back. Each verified step becomes
// one tap in the running session. Steps between sessions (a second or two) are not mined.
let miner = null, on = false, computing = false, loop = null, taps = 0, onEvent = () => {};
let roundSent = 0, roundDone = 0;   // taps sent / computed in the current session (logged when it ends)
let computingWorker = "";           // worker_id of the round taking taps (premine runs two rounds at once)
let rootsLanding = false;           // the last round summary was delivered; only then is premining worthwhile
// Taps the phone can finish in one round: every tap is a high-difficulty hash and unfinished ones are wasted
// (mainnet 2026-11-02: 23 sent, 11 computed). Starts at the configured limit, then follows what was computed.
let tapCap = MINING.maxTapsPerSession;

// Support log: raw miner callbacks and SDK console errors (no keys, no session secrets), so problems can be
// reported to GOSH exactly as the SDK says them. Kept in memory only; copied by the user from the panel.
const log = [];
let tapsLogged = 0, consoleHooked = false;
let lastLine = "", lastRepeats = 0;
function logLine(line) {
  const text = String(line).slice(0, 4000);
  const stamp = new Date().toISOString().slice(11, 19);
  if (text === lastLine && log.length) {   // the same line again: count it instead of repeating it
    lastRepeats++;
    log[log.length - 1] = `${stamp} ${text} (x${lastRepeats + 1})`;
    return;
  }
  lastLine = text; lastRepeats = 0;
  log.push(`${stamp} ${text}`);
  if (log.length > 400) log.shift();
}
// The whole error, including the node's reason (SDK errors carry it beyond the first line).
function fullError(e) {
  if (!e) return String(e);
  let t = e.message || String(e);
  try { if (e.data) t += " | data " + JSON.stringify(e.data); } catch { /* not serialisable */ }
  return t;
}
function hookConsole() {
  if (consoleHooked) return;
  consoleHooked = true;
  const orig = console.error.bind(console);
  console.error = (...a) => { logLine("console.error " + a.map((x) => (x && x.message) || String(x)).join(" ")); orig(...a); };
}
export function miningLog() {
  const k = miningKeys();
  return [`TalonHive Hub mining log`, `bee-sdk ${SDK_DIR.includes("-ng") ? "6.0.0 + community patches (tools/bee-sdk)" : "6.0.0 (npm)"} | network ${NET.name} | endpoint ${EP.join(",")}`,
    `app_id ${APP} | miner ${k?.minerAddress || "-"} | wallet ${k?.walletName || "-"} | session ${MINING.sessionMs} ms`,
    `taps sent this page load: ${tapsLogged}`, ``, ...log].join(String.fromCharCode(10));
}

// Mainnet's miner message queue is often full (QUEUE_OVERFLOW) or slow to answer (timeout). Miner.new may send
// "cancel stale session", so it runs once at a time (minerP: a second caller waits for the first instead of sending
// its own) and retries patiently: 20 s after a full queue, 30 s after a timeout. Every attempt starts by re-reading
// the miner, so if an earlier cancel did land, the next attempt has nothing to cancel and sends nothing.
const isBusy = (e) => /QUEUE_OVERFLOW|Message queue is full/.test(fullError(e));
const isTimeout = (e) => /fetch operation timeout|timed? ?out/i.test(fullError(e));
export const BUSY_MESSAGE = "The Acki Nacki network is busy right now (its message queue is full). Please try again in a few minutes.";
let minerP = null;
async function getMiner(onWait = () => {}) {
  if (miner) return miner;
  if (!minerP) {
    minerP = (async () => {
      hookConsole();
      const k = miningKeys();
      if (!k || !k.ready) throw new Error("Mining Keys are not ready yet.");
      const sdk = await loadSdk();
      const deadline = Date.now() + 180000;
      for (let attempt = 1; ; attempt++) {
        try {
          miner = await retrying(() => sdk.Miner.new(EP, APP, k.minerAddress, k.ownerPublic, k.ownerSecret), { retryIf: failedBeforeSending, untilMs: 10000 });
          logLine(`Miner.new ok (${k.minerAddress})`);
          // Patched SDK (tools/bee-sdk): resend a refused round summary / proof with the same signed message,
          // for up to 210 s / 240 s, waiting 2 s then longer (up to 30 s) between tries.
          if (typeof miner.set_submit_policy === "function") {
            miner.set_submit_policy(210000, 240000, 2000, 30000);
            logLine("submit policy: resend round 210 s, proof 240 s, every 2-30 s");
          }
          return miner;
        } catch (e) {
          logLine(`Miner.new error (attempt ${attempt}) ` + fullError(e));
          const wait = isBusy(e) ? 20000 : isTimeout(e) ? 30000 : 0;
          if (!wait || Date.now() + wait > deadline) throw isBusy(e) || isTimeout(e) ? new Error(BUSY_MESSAGE) : e;
          onWait(wait);
          await sleep(wait);
        }
      }
    })();
    minerP.catch(() => {}).finally(() => { minerP = null; });
  }
  return minerP;
}

function onMinerMessage(msg) {
  let p = null;
  try { p = JSON.parse(msg); } catch { logLine("callback (not JSON) " + msg); return; }
  if (p.action === "tap_computed") roundDone++;
  else logLine("callback " + msg);   // per-tap callbacks are only counted
  if (p.action === "submit_session_root") rootsLanding = !p.error;
  if (p.action === "send_attempt" && p.data && p.data.outcome === "ambiguous") {
    onEvent({ type: "resending", attempt: p.data.attempt, kind: p.data.kind });
  }
  if (p.action === "preflight_failed" && /too_few/.test(msg)) {
    onEvent({ type: "error", message: "That round had too few steps to count (at least 2 per round). Keep walking." });
    return;
  }
  if (p.error) {
    const busy = /QUEUE_OVERFLOW|Message queue is full/.test(msg);
    onEvent({ type: "error", message: busy ? "The network was too busy to take that round (its queue is full). Keep walking: the next rounds try again." : String(p.error) });
  }
  if (p.action === "status_updated" && p.data && p.data.status) {
    const st = p.data.status;
    // With premine two rounds overlap: only the round that is computing decides whether taps are taken.
    const wid = String(p.data.worker_id ?? "");
    const mine = wid === computingWorker;
    if (st === "computing") { computing = true; computingWorker = wid; roundSent = 0; roundDone = 0; }
    if (st === "submitting" && mine) {
      logLine(`round taps: ${roundSent} sent, ${roundDone} computed`);
      if (roundSent > roundDone) tapCap = Math.max(4, Math.min(MINING.maxTapsPerSession, roundDone + 2));
      else if (roundSent >= tapCap) tapCap = Math.min(MINING.maxTapsPerSession, tapCap + 2);
    }
    if ((st === "submitting" || st === "held" || st === "finished" || st === "removed") && mine) { computing = false; computingWorker = ""; }
    onEvent({ type: "status", status: st });
  } else if (p.action) {
    onEvent({ type: p.action, data: p.data || null });
  }
}

/** Turn mining on. listener({type, ...}) gets session events. */
export async function startMining(listener) {
  onEvent = listener || (() => {});
  const m = await getMiner((ms) => onEvent({ type: "busy", waitMs: ms }));
  on = true;
  let lastWaitLog = Date.now();
  const tick = () => {
    if (!on || computing) return;
    if (Date.now() - lastWaitLog >= 60000) {
      lastWaitLog = Date.now();
      let can = "?"; try { can = String(m.can_start()); } catch { /* reported below */ }
      logLine(`waiting for a round: can_start=${can}, screen ${typeof document !== "undefined" ? document.visibilityState : "?"}`);
    }
    try {
      if (m.can_start()) { logLine(`Miner.start(${MINING.sessionMs})`); m.start(MINING.sessionMs, onMinerMessage); computing = true; }
      else if (rootsLanding && typeof m.can_premine === "function" && m.can_premine()) {
        // Patched SDK: the previous round is still being delivered; mine the next one now, and let it be
        // sent as soon as the previous one is through (release_submit is safe to call early).
        logLine(`Miner.premine(${MINING.sessionMs})`);
        m.premine(MINING.sessionMs, onMinerMessage); computing = true;
        m.release_submit();
      }
    }
    catch (e) { logLine("start error " + (e.message || e)); onEvent({ type: "error", message: e.message || String(e) }); }
  };
  tick();
  tickFn = tick;
  clearInterval(loop);
  loop = setInterval(tick, 1000);
}

// With the screen off (APK background mining) the page's own timers are slowed, so the app also calls this from
// the native once-a-second heartbeat. Starting a round twice is impossible: tick() checks computing/can_start.
let tickFn = null;
export function tickNow() { if (tickFn) tickFn(); }

export function stopMining() {
  on = false; computing = false; computingWorker = ""; tickFn = null;
  clearInterval(loop); loop = null;
  try { miner?.stop(); } catch { /* not running */ }
}

export const isMining = () => on;

/** Feed n verified steps as taps (at most MINING.maxTapsPerSession per session). Returns how many were accepted. */
export function addSteps(n, cadence) {
  if (!on || !computing || !miner) return 0;
  const room = Math.max(0, tapCap - roundSent);
  let ok = 0;
  for (let i = 0; i < Math.min(n, room); i++) {
    // Coordinates are the app's choice (Bee Engine docs); kept small like GOSH's example add_tap(1, 1):
    // x = step number within the round, y = walking cadence (steps/min), both under 256.
    try { taps++; miner.add_tap(roundSent + 1, Math.min(255, Math.max(1, Math.round(cadence || 1)))); ok++; roundSent++; tapsLogged++; }
    catch (e) {
      logLine("add_tap error " + (e.message || e));
      if (/No running workers/.test(String(e.message || e))) { computing = false; computingWorker = ""; }
      break;
    }
  }
  return ok;
}

/** Ask the miner contract to pay out accumulated rewards to the wallet. */
export async function collectRewards() {
  const m = await getMiner();
  try { await m.get_reward(); logLine("get_reward ok"); }   // sends: no retry
  catch (e) { logLine("get_reward error " + fullError(e)); throw e; }
}

/** On-chain activity counters of the miner ({ tapSum, tapSum5m }) or null. */
export async function minerStats() {
  try {
    // Read-only: never set up the miner just to show stats (that can send "cancel stale session").
    const m = miner || (minerP && await minerP);
    if (!m) return null;
    const d = await retrying(() => m.get_miner_data(), { untilMs: 15000 });
    const r = { tapSum: d.tap_sum.toString(), tapSum5m: d.tap_sum_5m.toString() };
    d.free();
    return r;
  } catch { return null; }
}
