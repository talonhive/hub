// Bee Engine: wallet connect, Mining Keys and mining sessions, following GOSH's official example
// (github.com/gosh-sh/bee-engine, examples/javascript/miner-react). The SDK (~9 MB) loads only when the user
// connects or mines. TalonHive never sees the wallet's seed phrase or keys: the wallet approves a connection,
// then approves separate Mining Keys that can only mine and can be revoked in the wallet.
import { MINING } from "./mining.js";

const SDK_DIR = "./vendor/bee-sdk-6.0.0/";
const EP = MINING.endpoints;
const APP = MINING.appDappId;
const CLIENT = { network: { endpoints: EP } };

// Kept on this device only. The Mining Keys secret can only mine for this app and is revocable in the wallet.
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem("th:bee:" + k) || "null"); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem("th:bee:" + k) : localStorage.setItem("th:bee:" + k, JSON.stringify(v)); } catch { /* private mode */ } },
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

let connectToken = 0;
/** Step 1: connect the wallet. onLink(deepLink) is called first, so the page can show "Open wallet". */
export async function connectWallet(onLink) {
  const sdk = await loadSdk();
  const token = ++connectToken;
  const bc = new sdk.BeeConnect();
  const s = bc.create_shared_key_session(APP, 300, null);
  onLink(s.deep_link);
  const hello = await bc.wait_wallet_hello(EP, s.session_id, s.description, s.client_dh_secret, s.created_at, 150, 2000);
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
  const req = await bc.request_set_mining_keys(EP, conn.sessionId, conn.description, conn.sessionStateJson, APP, gen.public, 30, 1000);
  if (req.updated_session_state_json) { conn.sessionStateJson = req.updated_session_state_json; store.set("conn", conn); }
  const rec = { appId: APP, walletName: conn.walletName, ownerPublic: gen.public, ownerSecret: gen.secret, minerAddress: null, ready: false };
  store.set("keys", rec);
  onLink(gen.deep_link);   // fallback: opens the approval straight in the wallet if its prompt didn't appear
  onStatus("Approve Mining Keys in your Acki Nacki Wallet…");
  return waitKeysReady(sdk, rec, onStatus);
}

/** Resume waiting after an app restart (keys requested but not yet confirmed). */
export async function resumeKeys(onStatus) {
  const rec = miningKeys();
  if (!rec || rec.ready) return rec;
  return waitKeysReady(await loadSdk(), rec, onStatus);
}

async function waitKeysReady(sdk, rec, onStatus) {
  rec.minerAddress = await sdk.get_miner_address_by_wallet_name({ client_config: CLIENT, wallet_name: rec.walletName });
  store.set("keys", rec);
  onStatus("Waiting for the network to confirm your Mining Keys…");
  await sdk.ensure_mining_keys_propagated({
    client_config: CLIENT, miner_address: rec.minerAddress, app_id: APP, expected_owner_public: rec.ownerPublic,
    max_attempts: 150, interval_ms: 2000,
  });
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

async function getMiner() {
  if (miner) return miner;
  const k = miningKeys();
  if (!k || !k.ready) throw new Error("Mining Keys are not ready yet.");
  const sdk = await loadSdk();
  miner = await sdk.Miner.new(EP, APP, k.minerAddress, k.ownerPublic, k.ownerSecret);
  return miner;
}

function onMinerMessage(msg) {
  let p = null;
  try { p = JSON.parse(msg); } catch { return; }
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
    try { if (m.can_start()) { m.start(MINING.sessionMs, onMinerMessage); computing = true; } } catch (e) { onEvent({ type: "error", message: e.message || String(e) }); }
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
    try { taps++; miner.add_tap(taps % 1000000, Math.max(0, Math.round(cadence || 0))); ok++; } catch { break; }
  }
  return ok;
}

/** Ask the miner contract to pay out accumulated rewards to the wallet. */
export async function collectRewards() { await (await getMiner()).get_reward(); }

/** On-chain activity counters of the miner ({ tapSum, tapSum5m }) or null. */
export async function minerStats() {
  try {
    const d = await (await getMiner()).get_miner_data();
    const r = { tapSum: d.tap_sum.toString(), tapSum5m: d.tap_sum_5m.toString() };
    d.free();
    return r;
  } catch { return null; }
}
