// Bee Engine: wallet connect, Mining Keys and mining sessions, following GOSH's official example
// (github.com/gosh-sh/bee-engine, examples/javascript/miner-react). The SDK (~9 MB) loads only when the user
// connects or mines. TalonHive never sees the wallet's seed phrase or keys: the wallet approves a connection,
// then approves separate Mining Keys that can only mine and can be revoked in the wallet.
import { MINING, pickNetwork } from "./mining.js";

const SDK_DIR = "./vendor/bee-sdk-6.0.0/";
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
// as an error. Retry through those blips until a deadline instead of failing the whole step.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function retrying(fn, { untilMs = 30000, everyMs = 2000, stillWanted = () => true } = {}) {
  const deadline = Date.now() + untilMs;
  for (;;) {
    try { return await fn(); } catch (e) {
      if (!stillWanted()) throw new Error("cancelled");
      if (Date.now() + everyMs > deadline) throw e;
      await sleep(everyMs);
    }
  }
}

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
  const req = await retrying(() => bc.request_set_mining_keys(EP, conn.sessionId, conn.description, conn.sessionStateJson, APP, gen.public, 30, 1000));
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

// Support log: raw miner callbacks and SDK console errors (no keys, no session secrets), so problems can be
// reported to GOSH exactly as the SDK says them. Kept in memory only; copied by the user from the panel.
const log = [];
let tapsLogged = 0, consoleHooked = false;
function logLine(line) {
  log.push(`${new Date().toISOString().slice(11, 19)} ${String(line).slice(0, 4000)}`);
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
  return [`TalonHive Hub mining log`, `bee-sdk 6.0.0 (npm, unmodified) | network ${NET.name} | endpoint ${EP.join(",")}`,
    `app_id ${APP} | miner ${k?.minerAddress || "-"} | wallet ${k?.walletName || "-"} | session ${MINING.sessionMs} ms`,
    `taps sent this page load: ${tapsLogged}`, ``, ...log].join(String.fromCharCode(10));
}

async function getMiner() {
  if (miner) return miner;
  hookConsole();
  const k = miningKeys();
  if (!k || !k.ready) throw new Error("Mining Keys are not ready yet.");
  const sdk = await loadSdk();
  try { miner = await retrying(() => sdk.Miner.new(EP, APP, k.minerAddress, k.ownerPublic, k.ownerSecret)); }
  catch (e) { logLine("Miner.new error " + fullError(e)); throw e; }
  logLine(`Miner.new ok (${k.minerAddress})`);
  return miner;
}

function onMinerMessage(msg) {
  let p = null;
  try { p = JSON.parse(msg); } catch { logLine("callback (not JSON) " + msg); return; }
  if (p.action !== "tap_computed") logLine("callback " + msg);   // per-tap callbacks are only counted
  if (p.error) onEvent({ type: "error", message: String(p.error) });
  if (p.action === "status_updated" && p.data && p.data.status) {
    const st = p.data.status;
    if (st === "computing") computing = true;
    if (st === "submitting" || st === "finished" || st === "removed") computing = false;
    onEvent({ type: "status", status: st });
  } else if (p.action) {
    onEvent({ type: p.action, data: p.data || null });
  }
}

/** Turn mining on. listener({type, ...}) gets session events. */
export async function startMining(listener) {
  onEvent = listener || (() => {});
  const m = await getMiner();
  on = true;
  const tick = () => {
    if (!on || computing) return;
    try { if (m.can_start()) { logLine(`Miner.start(${MINING.sessionMs})`); m.start(MINING.sessionMs, onMinerMessage); computing = true; } }
    catch (e) { logLine("start error " + (e.message || e)); onEvent({ type: "error", message: e.message || String(e) }); }
  };
  tick();
  clearInterval(loop);
  loop = setInterval(tick, 1000);
}

export function stopMining() {
  on = false; computing = false;
  clearInterval(loop); loop = null;
  try { miner?.stop(); } catch { /* not running */ }
}

export const isMining = () => on;

/** Feed n verified steps as taps. Returns how many were accepted by the running session. */
export function addSteps(n, cadence) {
  if (!on || !computing || !miner) return 0;
  let ok = 0;
  for (let i = 0; i < n; i++) {
    try { taps++; miner.add_tap(taps % 1000000, Math.max(0, Math.round(cadence || 0))); ok++; tapsLogged++; }
    catch (e) { logLine("add_tap error " + (e.message || e)); break; }
  }
  return ok;
}

/** Ask the miner contract to pay out accumulated rewards to the wallet. */
export async function collectRewards() {
  const m = await getMiner();
  try { await retrying(() => m.get_reward()); logLine("get_reward ok"); }
  catch (e) { logLine("get_reward error " + fullError(e)); throw e; }
}

/** On-chain activity counters of the miner ({ tapSum, tapSum5m }) or null. */
export async function minerStats() {
  try {
    const m = await getMiner();
    const d = await retrying(() => m.get_miner_data(), { untilMs: 15000 });
    const r = { tapSum: d.tap_sum.toString(), tapSum5m: d.tap_sum_5m.toString() };
    d.free();
    return r;
  } catch { return null; }
}
