// Mining panel logic: where the user is in the setup, and how much of today's walking counts toward mining.
// Pure functions only (no page, no network), so they are tested in test/mining.test.mjs.
// The chain side (wallet connect, Mining Keys, Bee Engine sessions) lives in bee.js.

export const MINING = {
  appDappId: "0x0000000000000000000000000000000000000000000000000000000000000037",  // issued by Acki Nacki (GOSH) for TalonHive Hub
  endpoints: ["https://shellnet.ackinacki.org"],   // test network first, as GOSH asked
  dailyStepCap: 10000,    // steps per day that count toward mining; walking more is fine, it just doesn't add more
  sessionMs: 30000,       // one Bee Engine session; sessions run back to back while you walk
};

/** How many of n new steps may become mining taps, given today's steps before them. */
export function tapsAllowed(todayBefore, n, cap = MINING.dailyStepCap) {
  const before = Math.max(0, Math.floor(Number(todayBefore) || 0));
  return Math.max(0, Math.min(Math.floor(Number(n) || 0), cap - before));
}

/** Steps that count toward mining today (capped). */
export function countedSteps(todaySteps, cap = MINING.dailyStepCap) {
  const n = Math.max(0, Math.floor(Number(todaySteps) || 0));
  return Math.min(n, cap);
}

/** Today's step energy, 0..1. */
export function energy(todaySteps, cap = MINING.dailyStepCap) {
  return cap > 0 ? countedSteps(todaySteps, cap) / cap : 0;
}

// Setup stages, in order. Each must be done before the next.
export const STAGES = [
  { id: "app",    title: "TalonHive Hub approved by Acki Nacki", hint: "Waiting for our Bee Engine app id. Nothing for you to do." },
  { id: "wallet", title: "Connect your Acki Nacki Wallet",        hint: "Tap Connect wallet, then approve TalonHive Hub in the wallet. We never see your seed phrase." },
  { id: "keys",   title: "Allow mining",                          hint: "Approve Mining Keys in your wallet. They can only mine, and you can revoke them in the wallet at any time." },
  { id: "walk",   title: "Mine while you walk",                   hint: "Each verified step is sent to Bee Engine as mining activity." },
];

/**
 * Where the user is and whether mining can start.
 * s = { appDappId, walletConnected, keysAllowed, todaySteps, mining }
 */
export function miningState(s, cfg = MINING) {
  const steps = countedSteps(s.todaySteps, cfg.dailyStepCap);
  const done = {
    app: !!s.appDappId,
    wallet: !!s.appDappId && !!s.walletConnected,
    keys: !!s.appDappId && !!s.walletConnected && !!s.keysAllowed,
  };
  done.walk = done.keys && !!s.mining;
  const current = STAGES.find((st) => !done[st.id])?.id || null;
  const capReached = steps >= cfg.dailyStepCap;

  let reason = "";
  if (!done.app) reason = "Mining switches on once Acki Nacki issues our app id.";
  else if (!done.wallet) reason = "Connect your wallet to start.";
  else if (!done.keys) reason = "Allow mining in your wallet to start.";
  else if (capReached) reason = "Today's step energy is used up. Mining continues tomorrow.";

  const status = s.mining ? "mining" : !done.app ? "waiting" : current === "walk" ? "ready" : "setup";
  return {
    stages: STAGES.map((st) => ({ ...st, done: !!done[st.id], current: st.id === current })),
    steps,
    cap: cfg.dailyStepCap,
    energy: cfg.dailyStepCap > 0 ? steps / cfg.dailyStepCap : 0,
    capReached,
    canStart: !s.mining && done.keys && !capReached,
    status,   // waiting | setup | ready | mining
    reason,
  };
}
