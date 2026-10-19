// Step detector tests with synthetic accelerometer signals (50 Hz).   node test/stepcore.test.mjs
import { createStepDetector } from "../www/stepcore.js";

const G = 9.81;
let fail = 0;
const check = (name, ok, detail) => { if (!ok) fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (${detail})`); };

// Deterministic pseudo-random numbers so the tests always give the same result.
let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

/** Simulate a walk: each step is a smooth vertical bump; step intervals jitter like real gait. */
function walk({ seconds, spm, amp, jitter, noise = 0.25 }) {
  const samples = [];
  let t = 0, nextStep = 500, steps = 0;
  const base = 60000 / spm;
  while (t < seconds * 1000) {
    let a = 0;
    // bump shape around each step time (~200 ms wide)
    const dt = t - nextStep;
    if (dt > -100 && dt < 100) a = amp * Math.cos((dt / 100) * (Math.PI / 2)) ** 2;
    if (dt >= 100) { nextStep += base * (1 + (rnd() * 2 - 1) * jitter); steps++; }
    samples.push([t, (rnd() - 0.5) * noise, (rnd() - 0.5) * noise, G + a + (rnd() - 0.5) * noise]);
    t += 20;
  }
  return { samples, steps };
}

function run(samples) {
  const d = createStepDetector();
  for (const [t, x, y, z] of samples) d.feed(t, x, y, z);
  return d.stats();
}

// 1. Normal walk: 60 s at ~108 steps/min with natural 4% variation.
{
  const w = walk({ seconds: 60, spm: 108, amp: 3.5, jitter: 0.04 });
  const s = run(w.samples);
  const err = Math.abs(s.steps - w.steps) / w.steps;
  check("normal walk counted within 5%", err <= 0.05, `real ${w.steps}, counted ${s.steps}, cadence ${s.cadence}`);
}
// 2. Brisk walk: 140 steps/min.
{
  const w = walk({ seconds: 60, spm: 140, amp: 4.5, jitter: 0.035 });
  const s = run(w.samples);
  const err = Math.abs(s.steps - w.steps) / w.steps;
  check("brisk walk counted within 5%", err <= 0.05, `real ${w.steps}, counted ${s.steps}`);
}
// 3. Gentle walk with a weaker signal (phone in a loose pocket).
{
  const w = walk({ seconds: 60, spm: 95, amp: 1.8, jitter: 0.05 });
  const s = run(w.samples);
  const err = Math.abs(s.steps - w.steps) / w.steps;
  check("gentle walk counted within 8%", err <= 0.08, `real ${w.steps}, counted ${s.steps}`);
}
// 4. Hand shaking: fast (5 Hz) and violent → nothing credited.
{
  const samples = [];
  for (let t = 0; t < 30000; t += 20) samples.push([t, 0, 0, G + 16 * Math.sin(2 * Math.PI * 5 * t / 1000)]);
  const s = run(samples);
  check("hand shaking is rejected", s.steps <= 4, `counted ${s.steps}, rejected ${s.rejected}`);
}
// 5. Mechanical shaker at a walking pace, perfectly regular → rejected as machine-like.
{
  const w = walk({ seconds: 60, spm: 110, amp: 3.5, jitter: 0, noise: 0 });
  const s = run(w.samples);
  check("machine-perfect rhythm is rejected", s.steps <= 10, `counted ${s.steps} of ${w.steps}, reason "${s.reason}"`);
}
// 6. Phone at rest with sensor noise → zero steps.
{
  const samples = [];
  for (let t = 0; t < 30000; t += 20) samples.push([t, (rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.3, G + (rnd() - 0.5) * 0.3]);
  const s = run(samples);
  check("phone at rest counts nothing", s.steps === 0, `counted ${s.steps}`);
}
// 7. A few isolated bumps (phone tapped / put down) → zero steps.
{
  const samples = [];
  for (let t = 0; t < 20000; t += 20) {
    const bump = [3000, 9000, 15000].some((b) => Math.abs(t - b) < 60) ? 4 : 0;
    samples.push([t, 0, 0, G + bump]);
  }
  const s = run(samples);
  check("isolated bumps count nothing", s.steps === 0, `counted ${s.steps}`);
}

// 8-10. Realistic gait: each step = heel strike + a weaker push-off bump ~180-200 ms later, 60 Hz sensor
// (found by a real phone test: 64 of 100 counted before gait-aware double-peak handling).
function realWalk({ amp, second, lag, seconds = 60, spm = 105 }) {
  const samples = []; let next = 500, steps = 0; const base = 60000 / spm;
  for (let t = 0; t < seconds * 1000; t += 16) {
    let a = 0; const dt = t - next, dt2 = dt - lag;
    if (dt > -90 && dt < 90) a += amp * Math.cos((dt / 90) * Math.PI / 2) ** 2;
    if (dt2 > -70 && dt2 < 70) a += amp * second * Math.cos((dt2 / 70) * Math.PI / 2) ** 2;
    if (dt >= lag + 70) { next += base * (1 + (rnd() * 2 - 1) * 0.05); steps++; }
    samples.push([t, (rnd() - .5) * .6, (rnd() - .5) * .6, G + a + (rnd() - .5) * .6]);
  }
  return { samples, steps };
}
for (const [label, amp, second, lag, tol] of [
  ["real gait, phone in hand", 2.2, 0.55, 180, 0.05],
  ["real gait, phone in pocket (strong push-off)", 4, 0.6, 200, 0.06],
  ["real gait, gentle steps", 1.2, 0.5, 170, 0.06],
]) {
  const w = realWalk({ amp, second, lag });
  const s = run(w.samples);
  const err = Math.abs(s.steps - w.steps) / w.steps;
  check(`${label} within ${tol * 100}%`, err <= tol, `real ${w.steps}, counted ${s.steps}`);
}

// 11-12. REAL phone recordings (Android 10, Chrome, ~59 Hz), ~100-step walks recorded with the app's
// "Save walk data". Counted 87 (hand) and 7 (pocket) before tuning to real signals.
import { readFileSync } from "node:fs";
const trace = (f) => readFileSync(new URL(`./traces/${f}.csv`, import.meta.url), "utf8")
  .split("\n").filter((l) => /^\d/.test(l)).map((l) => l.split(",").map(Number));
for (const [file, label] of [["walk1", "real phone walk 1, in hand (~100 steps)"], ["walk2", "real phone walk 2, in pocket (~100 steps)"],
                             ["walk3", "real phone walk 3, in hand (100 steps)"], ["walk4", "real phone walk 4, in pocket (100 steps)"],
                             ["walk5", "real phone walk 5, in pocket (100 steps, deployed build)"]]) {
  const s = run(trace(file));
  check(label, s.steps >= 90 && s.steps <= 112, `counted ${s.steps}`);
}

// 14. Long shaking sessions must not farm steps (rules re-trigger instead of paying out repeatedly).
for (const [hz, amp] of [[3.5, 25], [3, 12], [2.5, 10], [2, 12], [4, 8], [5, 16]]) {
  const samples = [];
  for (let t = 0; t < 60000; t += 16) samples.push([t, 0, 0, G + amp * Math.sin(2 * Math.PI * hz * t / 1000) + (rnd() - .5) * .3]);
  const s = run(samples);
  check(`60 s of shaking ${hz} Hz @ ${amp} pays at most 6`, s.steps <= 6, `counted ${s.steps} of ${Math.round(hz * 60)} bumps`);
}

// 13. More shake patterns (slow-hard, fast-gentle, very violent) must credit nothing.
for (const [hz, amp] of [[4, 8], [3.5, 25], [6, 30]]) {
  const samples = [];
  for (let t = 0; t < 20000; t += 16) samples.push([t, 0, 0, G + amp * Math.sin(2 * Math.PI * hz * t / 1000)]);
  const s = run(samples);
  check(`shaking ${hz} Hz at ${amp} m/s^2 rejected`, s.steps <= 6, `counted ${s.steps}`);
}

console.log(fail ? `\n${fail} FAILED` : "\nall passed");
process.exit(fail ? 1 : 0);
