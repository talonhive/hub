// Tests for the mining panel logic (setup stages, daily cap, when mining may start).   node test/mining.test.mjs
import { miningState, countedSteps, limitTaps, useTaps, pickNetwork, MINING } from "../www/mining.js";
let fail = 0;
const eq = (name, want, got) => { const ok = want === got; if (!ok) fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (${got})`); };
const cfg = { ...MINING, dailyStepCap: 10000, maxStepsPerMin: 200, burstSteps: 30 };
const st = (o) => miningState({ appDappId: null, walletConnected: false, keysAllowed: false, minedToday: 0, mining: false, ...o }, cfg);

eq("steps are capped per day", 10000, countedSteps(25000, 10000));
eq("bad step values count as 0", 0, countedSteps(-5) + countedSteps("x"));

let s = st({ minedToday: 50000, walletConnected: true, keysAllowed: true });
eq("without an app id nothing can start, whatever else is set", false, s.canStart);
eq("without an app id the status is waiting", "waiting", s.status);
eq("without an app id the first stage is current", "app", s.stages.find((x) => x.current).id);
eq("without an app id later stages are not shown as done", false, s.stages.find((x) => x.id === "wallet").done);

s = st({ appDappId: "abc" });
eq("with an app id the wallet is next", "wallet", s.stages.find((x) => x.current).id);
eq("with an app id but no wallet the status is setup", "setup", s.status);

s = st({ appDappId: "abc", walletConnected: true });
eq("wallet connected: allow mining is next", "keys", s.stages.find((x) => x.current).id);

s = st({ appDappId: "abc", walletConnected: true, keysAllowed: true, minedToday: 0 });
eq("keys allowed: can start", true, s.canStart);
eq("keys allowed: status ready", "ready", s.status);
eq("keys allowed: no blocking reason", "", s.reason);

s = st({ appDappId: "abc", walletConnected: true, keysAllowed: true, minedToday: 10000 });
eq("daily cap reached: cannot start", false, s.canStart);
eq("daily cap reached: says so", true, s.reason.startsWith("You've mined today's"));

const D = "2026-10-22", T = 1_800_000_000_000;
let r = limitTaps(null, 5, T, D, cfg);
eq("taps: a fresh day allows normal steps", 5, r.allowed);
let ls = useTaps(r.state, 5);
eq("taps: mined steps are recorded", 5, ls.mined);
r = limitTaps(ls, 3000, T + 1000, D, cfg);
eq("taps: a batch of 3000 steps at once is held to the burst allowance", 28, r.allowed);
ls = useTaps(r.state, r.allowed);
r = limitTaps(ls, 1000, T + 61000, D, cfg);
eq("taps: after a pause, the catch-up is held to the burst allowance", 30, r.allowed);
let walk = useTaps(r.state, r.allowed), sent = 0;
for (let i = 1; i <= 600; i++) { const q = limitTaps(walk, 2, T + 200000 + i * 500, D, cfg); walk = useTaps(q.state, q.allowed); sent += q.allowed; }
eq("taps: steady fast walking (240/min) is limited to ~200/min over 5 min", true, sent >= 990 && sent <= 1030);
r = limitTaps({ day: D, mined: 9998, tokens: 30, at: T }, 5, T + 1000, D, cfg);
eq("taps: only the steps up to the daily cap", 2, r.allowed);
r = limitTaps({ day: D, mined: 10000, tokens: 30, at: T }, 5, T + 1000, D, cfg);
eq("taps: none once the daily cap is reached", 0, r.allowed);
r = limitTaps({ day: D, mined: 10000, tokens: 0, at: T }, 5, T + 1000, "2026-10-23", cfg);
eq("taps: a new day starts fresh", 5, r.allowed);
r = limitTaps({ day: D, mined: 0, tokens: 0, at: T }, 5, T - 3_600_000, D, cfg);
eq("taps: moving the clock back gives no extra steps", 0, r.allowed);
eq("taps: bad input counts nothing", 0, limitTaps(null, -3, T, D, cfg).allowed + limitTaps(null, "x", T, D, cfg).allowed);

s = st({ appDappId: "abc", walletConnected: true, keysAllowed: true, minedToday: 12000, mining: true });
eq("already mining: cannot start twice", false, s.canStart);
eq("already mining: status mining", "mining", s.status);
eq("over the cap: energy is full", 1, s.energy);
eq("over the cap: flagged", true, s.capReached);

console.log(fail ? `\n${fail} FAILED` : "\nall passed");
process.exit(fail ? 1 : 0);
