// Tests for the mining panel logic (setup stages, daily cap, when mining may start).   node test/mining.test.mjs
import { miningState, countedSteps, MINING } from "../www/mining.js";
let fail = 0;
const eq = (name, want, got) => { const ok = want === got; if (!ok) fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (${got})`); };
const cfg = { ...MINING, dailyStepCap: 10000, minStepsToMine: 1000 };
const st = (o) => miningState({ appDappId: null, walletConnected: false, keysAllowed: false, todaySteps: 0, mining: false, ...o }, cfg);

eq("steps are capped per day", 10000, countedSteps(25000, 10000));
eq("bad step values count as 0", 0, countedSteps(-5) + countedSteps("x"));

let s = st({ todaySteps: 50000, walletConnected: true, keysAllowed: true });
eq("without an app id nothing can start, whatever else is set", false, s.canStart);
eq("without an app id the status is waiting", "waiting", s.status);
eq("without an app id the first stage is current", "app", s.stages.find((x) => x.current).id);
eq("without an app id later stages are not shown as done", false, s.stages.find((x) => x.id === "wallet").done);

s = st({ appDappId: "abc" });
eq("with an app id the wallet is next", "wallet", s.stages.find((x) => x.current).id);
eq("with an app id but no wallet the status is setup", "setup", s.status);

s = st({ appDappId: "abc", walletConnected: true });
eq("wallet connected: allow mining is next", "keys", s.stages.find((x) => x.current).id);

s = st({ appDappId: "abc", walletConnected: true, keysAllowed: true, todaySteps: 400 });
eq("too few steps: cannot start", false, s.canStart);
eq("too few steps: says how many more", "Walk 600 more steps to start.", s.reason);
eq("too few steps: status ready (only walking left)", "ready", s.status);

s = st({ appDappId: "abc", walletConnected: true, keysAllowed: true, todaySteps: 1000 });
eq("enough steps: can start", true, s.canStart);
eq("enough steps: no blocking reason", "", s.reason);

s = st({ appDappId: "abc", walletConnected: true, keysAllowed: true, todaySteps: 12000, mining: true });
eq("already mining: cannot start twice", false, s.canStart);
eq("already mining: status mining", "mining", s.status);
eq("over the cap: energy is full", 1, s.energy);
eq("over the cap: flagged", true, s.capReached);

console.log(fail ? `\n${fail} FAILED` : "\nall passed");
process.exit(fail ? 1 : 0);
