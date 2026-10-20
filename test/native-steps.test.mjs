// Tests for the hardware step-counter bookkeeping (reboots, first reading, impossible jumps).   node test/native-steps.test.mjs
import { stepsSince } from "../www/native-steps.js";
let fail = 0;
const eq = (name, want, got) => { const ok = want === got; if (!ok) fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (${got})`); };
eq("first reading only sets the baseline", 0, stepsSince(null, 12345));
eq("normal progress counts the difference", 250, stepsSince(12345, 12595));
eq("no change counts nothing", 0, stepsSince(500, 500));
eq("after a reboot the counter restarts from 0", 40, stepsSince(98000, 40));
eq("impossible jump is ignored", 0, stepsSince(100, 100 + 200000));
eq("a big but plausible day (40k) counts", 40000, stepsSince(1000, 41000));
console.log(fail ? `\n${fail} FAILED` : "\nall passed");
process.exit(fail ? 1 : 0);
