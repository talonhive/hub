// Mining panel logic: where the user is in the setup, and how much of today's walking counts toward mining.
// Pure functions only (no page, no network), so they are tested in test/mining.test.mjs.
// The Bee Engine SDK is NOT bundled yet: it is added once Acki Nacki issues our app id and confirms its licence.
// Until then MINING.appDappId is null and the panel says "waiting for app id" - nothing pretends to mine.

export const MINING = {
  appDappId: null,        // issued by Acki Nacki (GOSH) for TalonHive Hub
  dailyStepCap: 10000,    // steps per day that count toward mining; walking more is fine, it just doesn't add more
  minStepsToMine: 1000,   // a real walk first, so a few taps can't start a session
};

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
  { id: "app",    title: "TalonHive Hub approved by Acki Nacki", hint: "We've asked for our Bee Engine app id. Nothing for you to do." },
  { id: "wallet", title: "Connect your Acki Nacki Wallet",        hint: "Open the Acki Nacki Wallet and approve TalonHive Hub. We never see your seed phrase." },
  { id: "keys",   title: "Allow mining",                          hint: "Your wallet creates Mining Keys just for mining. You can revoke them in the wallet at any time." },
  { id: "walk",   title: "Walk",                                  hint: "Verified steps power your miner." },
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
  done.walk = done.keys && steps >= cfg.minStepsToMine;
  const current = STAGES.find((st) => !done[st.id])?.id || null;

  let reason = "";
  if (!done.app) reason = "Mining switches on once Acki Nacki issues our app id.";
  else if (!done.wallet) reason = "Connect your wallet to start.";
  else if (!done.keys) reason = "Allow mining in your wallet to start.";
  else if (!done.walk) reason = `Walk ${(cfg.minStepsToMine - steps).toLocaleString("en-US")} more steps to start.`;

  const status = s.mining ? "mining" : !done.app ? "waiting" : current === "walk" || !current ? "ready" : "setup";
  return {
    stages: STAGES.map((st) => ({ ...st, done: !!done[st.id], current: st.id === current })),
    steps,
    cap: cfg.dailyStepCap,
    energy: cfg.dailyStepCap > 0 ? steps / cfg.dailyStepCap : 0,
    capReached: steps >= cfg.dailyStepCap,
    canStart: !s.mining && done.walk,
    status,   // waiting | setup | ready | mining
    reason,
  };
}
