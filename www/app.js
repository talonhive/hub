// TalonHive Hub — walk sessions on the web/PWA build. Motion is processed here and never sent anywhere.
import { createStepDetector } from "./stepcore.js";
import { MARK_VIEWBOX, MARK_PATH } from "./mark.js";

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
  t.steps += n; store.set("today", t); renderToday(t.steps);
}
function renderToday(n) {
  $("#today-steps").textContent = n.toLocaleString("en-US");
  $("#today-sub").textContent = n ? `About ${(n * 0.00075).toFixed(2)} km today. Keep going!` : "Start a walk to begin. Steps are counted on your phone. No location is used.";
}
{ const t = store.get("today", { day: todayKey(), steps: 0 }); renderToday(t.day === todayKey() ? t.steps : 0); }

// ---- walk session ----
let detector = null, walking = false, startedAt = 0, sessionSteps = 0, timer = null, wakeLock = null;

function onMotion(e) {
  const a = e.accelerationIncludingGravity;
  if (!a || a.x == null) return;
  const n = detector.feed(e.timeStamp || performance.now(), a.x, a.y, a.z);
  if (n) { sessionSteps += n; addToday(n); }
}

function render() {
  const s = detector ? detector.stats() : { steps: 0, cadence: 0, reason: "" };
  $("#w-steps").textContent = sessionSteps.toLocaleString("en-US");
  $("#w-cadence").textContent = walking ? s.cadence : 0;
  const sec = walking ? Math.floor((Date.now() - startedAt) / 1000) : 0;
  $("#w-time").textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  $("#w-reason").textContent = walking && s.reason ? `Ignored: ${s.reason}` : "";
}

async function start() {
  if (typeof DeviceMotionEvent === "undefined") { $("#w-reason").textContent = "This device has no motion sensor. Try on your phone."; return; }
  // iPhone/iPad: motion access needs a permission prompt from a tap. Some browsers report "denied" without
  // asking yet still deliver events, so we don't trust the answer alone: start, and judge by whether data arrives.
  let permission = "granted";
  if (typeof DeviceMotionEvent.requestPermission === "function") {
    permission = await DeviceMotionEvent.requestPermission().catch(() => "denied");
  }
  detector = createStepDetector();
  sessionSteps = 0; startedAt = Date.now(); walking = true;
  window.addEventListener("devicemotion", onMotion);
  try { wakeLock = await navigator.wakeLock?.request("screen"); } catch { wakeLock = null; }
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
  walking = false;
  window.removeEventListener("devicemotion", onMotion);
  clearInterval(timer);
  wakeLock?.release?.().catch(() => {}); wakeLock = null;
  $("#w-toggle").textContent = "Start walk";
  $("#walk-pill").textContent = "Not walking"; $("#walk-pill").className = "pill";
  $("#sensor-pill").textContent = "Sensor off"; $("#sensor-pill").className = "pill";
  $("#w-reason").textContent = sessionSteps ? `Walk saved: ${sessionSteps.toLocaleString("en-US")} steps.` : "";
  render();
}

$("#w-toggle").addEventListener("click", () => (walking ? stop() : start()));
$("#act-walk").addEventListener("click", () => $("#walk").scrollIntoView({ behavior: "smooth" }));
document.addEventListener("visibilitychange", async () => {   // the screen lock is dropped when hidden
  if (walking && document.visibilityState === "visible") { try { wakeLock = await navigator.wakeLock?.request("screen"); } catch { /* ignore */ } }
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
render();
