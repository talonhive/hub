// Mining panel logic: where the user is in the setup, and how much of today's walking counts toward mining.
// Pure functions only (no page, no network), so they are tested in test/mining.test.mjs.
// The chain side (wallet connect, Mining Keys, Bee Engine sessions) lives in bee.js.

export const MINING = {
  appDappId: "0x0000000000000000000000000000000000000000000000000000000000000037",  // issued by Acki Nacki (GOSH) for TalonHive Hub
  endpoints: ["https://shellnet.ackinacki.org"],   // default network (overridden by the private mainnet mode)
  dailyStepCap: 10000,    // steps per day that can be mined; walking more is fine, it just doesn't add more
  maxStepsPerMin: 200,    // fastest real walking/running cadence; faster bursts (e.g. a batch of steps from the
  burstSteps: 30,         //   hardware counter after the app was closed) are not mined. burst = short catch-up allowance
  sessionMs: 30000,       // one Bee Engine session; sessions run back to back while you walk
};

// Networks. The public Hub uses Shellnet; opening it with ?net=mainnet switches THIS device to mainnet
// (real NACKL) for private testing, and ?net=shellnet switches back. Same app id on both (GOSH).
export const NETWORKS = {
  shellnet: { name: "shellnet", endpoints: ["https://shellnet.ackinacki.org"], real: false },
  mainnet:  { name: "mainnet",  endpoints: ["https://mainnet.ackinacki.org"],  real: true },
};
/** Network to use, from the page's query string and the saved choice. Returns { net, save } (save: value to store). */
export function pickNetwork(search, saved) {
  const q = /(?:^|[?&])net=([a-z]+)/.exec(String(search || ""));
  const asked = q && NETWORKS[q[1]] ? q[1] : null;
  if (asked) return { net: NETWORKS[asked], save: asked };
  return { net: NETWORKS[saved] || NETWORKS.shellnet, save: null };
}

/**
 * Daily cap + speed limit for mining taps. state = { day, mined, tokens, at } (saved per device) or null.
 * Returns how many of n new steps may be mined now, and the refreshed state; after sending the taps,
 * record the number actually accepted with useTaps(state, k).
 */
export function limitTaps(state, n, nowMs, day, cfg = MINING) {
  const s = state && state.day === day ? { ...state } : { day, mined: 0, tokens: cfg.burstSteps, at: nowMs };
  const elapsed = Math.max(0, nowMs - s.at);              // a clock moved backwards refills nothing
  s.tokens = Math.min(cfg.burstSteps, s.tokens + elapsed * cfg.maxStepsPerMin / 60000);
  s.at = Math.max(s.at, nowMs);
  const want = Math.max(0, Math.floor(Number(n) || 0));
  const allowed = Math.max(0, Math.min(want, cfg.dailyStepCap - s.mined, Math.floor(s.tokens)));
  return { allowed, state: s };
}
export function useTaps(state, k) {
  const used = Math.max(0, Math.floor(Number(k) || 0));
  return { ...state, mined: state.mined + used, tokens: Math.max(0, state.tokens - used) };
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
 * s = { appDappId, walletConnected, keysAllowed, minedToday, mining }
 */
export function miningState(s, cfg = MINING) {
  const steps = countedSteps(s.minedToday, cfg.dailyStepCap);
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
  else if (capReached) reason = "You've mined today's 10,000 steps. Mining continues tomorrow.";

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
