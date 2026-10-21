// TalonHive Hub — walk sessions on the web/PWA build. Motion is processed here and never sent anywhere.
import { createStepDetector } from "./stepcore.js";
import { MARK_VIEWBOX, MARK_PATH } from "./mark.js";
import { getNativeStepCounter, stepsSince } from "./native-steps.js";
import { MINING, miningState, limitTaps, useTaps } from "./mining.js";
import * as bee from "./bee.js";

const $ = (s) => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem("th:" + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("th:" + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

// Brand mark (white on black).
$("#mark").setAttribute("viewBox", MARK_VIEWBOX);
$("#mark").innerHTML = `<path fill="#fff" fill-rule="evenodd" d="${MARK_PATH}"/>`;

// ---- today's total (per-device convenience only) ----
const todayKey = () => new Date().toISOString().slice(0, 10);
function addToday(n) {
  const t = store.get("today", { day: todayKey(), steps: 0 });
  if (t.day !== todayKey()) { t.day = todayKey(); t.steps = 0; }
  if (bee.isMining()) mineSteps(n);
  t.steps += n; store.set("today", t); renderToday(t.steps); renderMining();
}
function renderToday(n) {
  $("#today-steps").textContent = n.toLocaleString("en-US");
  $("#today-sub").textContent = n ? `About ${(n * 0.00075).toFixed(2)} km today. Keep going!` : "Start a walk to begin. Steps are counted on your phone. No location is used.";
}
const todaySteps = () => { const t = store.get("today", { day: todayKey(), steps: 0 }); return t.day === todayKey() ? t.steps : 0; };
renderToday(todaySteps());

// ---- mining panel ----
// Setup (wallet, Mining Keys) and sessions are in bee.js. Mining runs only during a walk; each verified step
// becomes one Bee Engine tap, up to the daily cap.
let mining = false, busy = false, connecting = false, connectRun = 0, minedNow = 0, sessions = 0, chainTaps = null;
const say = (t) => { $("#m-reason").textContent = t; };
function showLink(url) { const a = $("#m-link"); if (url) { a.href = url; a.hidden = false; } else { a.hidden = true; a.removeAttribute("href"); } }
// Daily cap and speed limit (mining.js limitTaps); the mined count is saved per day on this device.
// The Miner contract enforces its own rules on chain too.
const minedToday = () => { const m = store.get("mined", null); return m && m.day === todayKey() ? m.mined : 0; };
function mineSteps(n) {
  const r = limitTaps(store.get("mined", null), n, Date.now(), todayKey());
  const cad = walking && startedAt ? sessionSteps / Math.max(1 / 60, (Date.now() - startedAt) / 60000) : 0;
  const ok = r.allowed ? bee.addSteps(r.allowed, cad) : 0;
  const st = useTaps(r.state, ok);
  store.set("mined", st);
  minedNow += ok;
  if (st.mined >= MINING.dailyStepCap) stopMiningUi("You've mined today's 10,000 steps. Mining continues tomorrow.");
}

function renderMining() {
  const conn = bee.connection(), keys = bee.miningKeys();
  const m = miningState({ appDappId: MINING.appDappId, walletConnected: !!conn, keysAllowed: !!(keys && keys.ready),
    minedToday: minedToday(), mining });
  $("#m-count").textContent = `${m.steps.toLocaleString("en-US")} / ${m.cap.toLocaleString("en-US")}`;
  $("#m-fill").style.width = `${Math.round(m.energy * 100)}%`;
  $("#m-meter").setAttribute("aria-valuenow", String(Math.round(m.energy * 100)));
  $("#m-meter").classList.toggle("full", m.capReached);
  $("#m-cap").textContent = m.capReached ? "Today's mining is complete. Nice walking!"
    : `Up to ${m.cap.toLocaleString("en-US")} steps a day can be mined, at up to ${MINING.maxStepsPerMin} steps a minute. Walking more is great, it just doesn't add more.`;
  const ol = $("#m-stages"); ol.textContent = "";
  m.stages.forEach((st, i) => {
    const li = document.createElement("li");
    li.className = st.done ? "done" : st.current ? "current" : "";
    const dot = document.createElement("span"); dot.className = "dot"; dot.textContent = st.done ? "✓" : String(i + 1);
    const txt = document.createElement("div");
    const b = document.createElement("b"); b.textContent = st.title;
    const sm = document.createElement("small"); sm.textContent = st.hint;
    txt.append(b, sm); li.append(dot, txt); ol.append(li);
  });
  $("#m-wallet").hidden = !conn;
  if (conn) $("#m-wallet").textContent = `Wallet: ${conn.walletName}`;
  const btn = $("#m-start");
  const current = m.stages.find((x) => x.current)?.id;
  btn.textContent = mining ? "Stop mining" : current === "wallet" ? "Connect wallet" : current === "keys" ? "Allow mining" : "Start mining";
  btn.disabled = busy || (!mining && current !== "wallet" && current !== "keys" && !m.canStart);
  if (connecting) { btn.textContent = "Cancel"; btn.disabled = false; }
  if (!busy && !mining) say(m.reason);
  $("#m-stats").hidden = !(keys && keys.ready);
  $("#ms-taps").textContent = minedNow.toLocaleString("en-US");
  $("#ms-sessions").textContent = String(sessions);
  $("#ms-chain").textContent = chainTaps == null ? "–" : Number(chainTaps).toLocaleString("en-US");
  $("#m-collect").hidden = !(keys && keys.ready);
  $("#m-collect").disabled = busy;
  $("#m-disconnect").hidden = !conn || busy;
  const label = { waiting: "Waiting for app id", setup: "Set up", ready: "Ready", mining: "Mining" }[m.status];
  $("#m-pill").textContent = label; $("#m-pill").className = m.status === "mining" || m.canStart ? "pill on" : "pill";
  $("#mine-pill").textContent = m.status === "mining" ? "Mining: on" : m.status === "ready" ? "Mining: ready" : "Mining: set up";
}

const errText = (e) => { const t = (e && e.message) || String(e); return t.length > 160 ? t.slice(0, 160) + "…" : t; };

async function doConnect() {
  const run = ++connectRun;
  busy = true; connecting = true; renderMining();
  say("Opening a connection…");
  try {
    await bee.connectWallet((link) => { showLink(link); say("Tap Open Acki Nacki Wallet below and approve TalonHive Hub, then come back here."); });
    say("Wallet connected.");
  } catch (e) {
    if (errText(e) !== "cancelled") say(`Couldn't connect: ${errText(e)}. Try again.`);
  } finally { if (run === connectRun) { busy = false; connecting = false; showLink(null); renderMining(); } }
}

async function doAllow() {
  busy = true; renderMining();
  say("Asking your wallet to allow mining…");
  try {
    await bee.allowMining((link) => showLink(link), (t) => say(t));
    say("Mining Keys are live. You're ready to mine!");
  } catch (e) { say(`Mining Keys not confirmed: ${errText(e)}. Try Allow mining again.`); }
  finally { busy = false; showLink(null); renderMining(); }
}

function onBee(ev) {
  if (ev.type === "status" && ev.status === "computing") { sessions++; say("Mining. Keep walking with the app open."); }
  if (ev.type === "status" && ev.status === "submitting") say("Sending your mining session to the network…");
  if (ev.type === "error") say(`Mining note: ${ev.message.slice(0, 140)}`);
  renderMining();
}

async function startMiningUi() {
  busy = true; renderMining(); say("Starting the miner…");
  try {
    await bee.startMining(onBee);
    mining = true;
    if (!walking) await start();
    if (SC) SC.keepAwake({ on: true }).catch(() => {});
    say("Mining. Keep walking with the app open.");
  } catch (e) { bee.stopMining(); mining = false; say(`Couldn't start mining: ${errText(e)}`); }
  finally { busy = false; renderMining(); }
}
function stopMiningUi(msg) {
  if (!mining) return;
  bee.stopMining(); mining = false;
  if (SC && nativeOn) SC.keepAwake({ on: false }).catch(() => {});
  renderMining();
  say(msg || `Mining stopped. ${minedNow.toLocaleString("en-US")} steps mined this time.`);
  refreshChain();
}
async function refreshChain() {
  const k = bee.miningKeys();
  if (!k || !k.ready) return;
  const st = await bee.minerStats();
  if (st) { chainTaps = st.tapSum; $("#ms-chain").textContent = Number(chainTaps).toLocaleString("en-US"); }
}

$("#m-start").addEventListener("click", () => {
  const conn = bee.connection(), keys = bee.miningKeys();
  if (connecting) { bee.cancelConnect(); connectRun++; connecting = false; busy = false; showLink(null); renderMining(); say("Cancelled."); }
  else if (mining) stopMiningUi();
  else if (!conn) doConnect();
  else if (!keys || !keys.ready) doAllow();
  else startMiningUi();
});
$("#m-collect").addEventListener("click", async () => {
  busy = true; renderMining(); say("Asking the miner to send your rewards to your wallet…");
  try { await bee.collectRewards(); say("Done. Rewards appear in your Acki Nacki Wallet shortly."); }
  catch (e) { say(`Couldn't collect yet: ${errText(e)}`); }
  finally { busy = false; renderMining(); }
});
$("#m-disconnect").addEventListener("click", () => {
  stopMiningUi(); bee.disconnect(); minedNow = 0; sessions = 0; chainTaps = null;
  renderMining();
  say("Disconnected on this phone. To fully revoke the Mining Keys, remove them in your Acki Nacki Wallet.");
});
renderMining();
// Keys requested before the app was closed: keep waiting for them.
{
  const k = bee.miningKeys();
  if (k && !k.ready) {
    busy = true; renderMining();
    bee.resumeKeys(say).then(() => say("Mining Keys are live. You're ready to mine!"))
      .catch((e) => say(`Mining Keys not confirmed yet: ${errText(e)}. Try Allow mining again.`))
      .finally(() => { busy = false; renderMining(); });
  } else if (k) refreshChain();
}

// ---- hardware step counter (APK) ----
// When available it is the source of truth: accurate in a pocket with the screen off, and it also counts while
// the app is closed (credited to today when the app next opens).
const SC = getNativeStepCounter();
let nativeOn = false, nativeListening = false;
function onHardwareTotal(total) {
  const hw = store.get("hw", { last: null });
  const n = stepsSince(hw.last, total);
  hw.last = total; store.set("hw", hw);
  if (n > 0) { addToday(n); if (walking && nativeOn) sessionSteps += n; render(); }
}
async function startHardware(askPermission) {
  if (!SC) return false;
  try {
    const a = await SC.isAvailable();
    if (!a.available) return false;
    if (!a.permission) {
      if (!askPermission) return false;
      const p = await SC.ensurePermission();
      if (!p.granted) { $("#w-reason").textContent = "Allow Physical activity for TalonHive Hub in Android settings to use the step sensor."; return false; }
    }
    if (!nativeListening) { await SC.addListener("steps", (d) => onHardwareTotal(d.total)); nativeListening = true; }
    const r = await SC.start();
    if (r && r.total >= 0) onHardwareTotal(r.total);
    nativeOn = true;
    return true;
  } catch { return false; }
}
// If permission was granted before, start reading the sensor straight away (shows steps taken while closed).
startHardware(false);

// ---- walk session ----
let detector = null, walking = false, startedAt = 0, sessionSteps = 0, timer = null, wakeLock = null;
// Raw readings of the last walk, kept in memory only, so the user can choose to save them for tuning.
// Timestamps and acceleration only; no location. Capped at ~10 minutes.
let trace = [];
const TRACE_MAX = 40000;

function onMotion(e) {
  const a = e.accelerationIncludingGravity;
  if (!a || a.x == null) return;
  const ts = e.timeStamp || performance.now();
  if (trace.length < TRACE_MAX) trace.push([Math.round(ts), +a.x.toFixed(3), +a.y.toFixed(3), +a.z.toFixed(3)]);
  const n = detector.feed(ts, a.x, a.y, a.z);
  if (n) { sessionSteps += n; addToday(n); }
}

function render() {
  const s = nativeOn ? { cadence: walking ? Math.round(sessionSteps / Math.max(1, (Date.now() - startedAt) / 60000)) : 0, reason: "" }
    : detector ? detector.stats() : { steps: 0, cadence: 0, reason: "" };
  $("#w-steps").textContent = sessionSteps.toLocaleString("en-US");
  $("#w-cadence").textContent = walking ? s.cadence : 0;
  const sec = walking ? Math.floor((Date.now() - startedAt) / 1000) : 0;
  $("#w-time").textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  $("#w-reason").textContent = walking && s.reason ? `Ignored: ${s.reason}` : "";
}

async function start() {
  // APK: prefer the phone's hardware step counter (works in a pocket with the screen off).
  if (SC && await startHardware(true)) {
    sessionSteps = 0; startedAt = Date.now(); walking = true; detector = null; trace = [];
    $("#w-save").hidden = true;
    timer = setInterval(render, 1000);
    $("#w-toggle").textContent = "End walk";
    $("#walk-pill").textContent = "Walking"; $("#walk-pill").className = "pill on";
    $("#sensor-pill").textContent = "Step sensor"; $("#sensor-pill").className = "pill on";
    $("#w-reason").textContent = "Using your phone's step sensor. You can lock the screen and pocket it.";
    render();
    return;
  }
  if (typeof DeviceMotionEvent === "undefined") { $("#w-reason").textContent = "This device has no motion sensor. Try on your phone."; return; }
  // iPhone/iPad: motion access needs a permission prompt from a tap. Some browsers report "denied" without
  // asking yet still deliver events, so we don't trust the answer alone: start, and judge by whether data arrives.
  let permission = "granted";
  if (typeof DeviceMotionEvent.requestPermission === "function") {
    permission = await DeviceMotionEvent.requestPermission().catch(() => "denied");
  }
  detector = createStepDetector();
  trace = []; $("#w-save").hidden = true;
  sessionSteps = 0; startedAt = Date.now(); walking = true;
  window.addEventListener("devicemotion", onMotion);
  try { wakeLock = await navigator.wakeLock?.request("screen"); } catch { wakeLock = null; }
  if (SC) SC.keepAwake({ on: true }).catch(() => {});   // APK without a hardware counter: keep the screen on natively
  timer = setInterval(render, 500);
  $("#w-toggle").textContent = "End walk";
  $("#walk-pill").textContent = "Walking"; $("#walk-pill").className = "pill on";
  $("#sensor-pill").textContent = "Sensor on"; $("#sensor-pill").className = "pill on";
  // If no motion events arrive (desktop, blocked sensor), say so instead of looking broken.
  gotMotion = false;
  setTimeout(() => {
    if (!walking || gotMotion) return;
    $("#w-reason").textContent = permission === "granted"
      ? "No motion data yet. Open this on your phone."
      : "Motion access isn't allowed. Turn on Motion & Orientation access for this site in your browser settings.";
  }, 3000);
}

let gotMotion = false;
window.addEventListener("devicemotion", (e) => { if (e.accelerationIncludingGravity?.x != null) gotMotion = true; });

function stop() {
  stopMiningUi();
  walking = false;
  window.removeEventListener("devicemotion", onMotion);
  clearInterval(timer);
  wakeLock?.release?.().catch(() => {}); wakeLock = null;
  if (SC) SC.keepAwake({ on: false }).catch(() => {});
  $("#w-toggle").textContent = "Start walk";
  $("#walk-pill").textContent = "Not walking"; $("#walk-pill").className = "pill";
  $("#sensor-pill").textContent = "Sensor off"; $("#sensor-pill").className = "pill";
  const st = detector && !nativeOn ? detector.stats() : { rejected: 0 };
  $("#w-reason").textContent = sessionSteps || st.rejected
    ? `Walk done: ${sessionSteps.toLocaleString("en-US")} steps counted${st.rejected ? `, ${st.rejected} ignored` : ""}.` : "";
  $("#w-save").hidden = trace.length < 50;
  render();
}

$("#w-toggle").addEventListener("click", () => (walking ? stop() : start()));
$("#w-save").addEventListener("click", () => {
  const NL = String.fromCharCode(10);
  const ua = navigator.userAgent.split(",").join(" ").split(NL).join(" ");
  const meta = `# TalonHive walk trace v1, steps_counted=${sessionSteps}, ua=${ua}` + NL;
  const csv = meta + "t_ms,ax,ay,az" + NL + trace.map((r) => r.join(",")).join(NL);
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `talonhive-walk-${Date.now()}.csv` });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
});
$("#act-walk").addEventListener("click", () => $("#walk").scrollIntoView({ behavior: "smooth" }));
document.addEventListener("visibilitychange", async () => {   // the screen lock is dropped when hidden
  if (walking && document.visibilityState === "visible") { try { wakeLock = await navigator.wakeLock?.request("screen"); } catch { /* ignore */ } }
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
render();
