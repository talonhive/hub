// TalonHive Hub — on-device step detection from the accelerometer, with gait checks against cheating.
// Pure logic (no browser APIs), so it runs the same in the web app, the APK and the Node tests.
//
// How it works:
//   1. Remove gravity from the acceleration magnitude (slow low-pass) and smooth the rest.
//   2. A step is a peak above an adaptive threshold, at least MIN_INTERVAL after the previous one.
//   3. Steps only count once a walking rhythm is established (START_STEPS plausible steps in a row),
//      so single bumps, taps and putting the phone down never count.
//   4. Gait checks on the recent rhythm reject what humans don't do: cadence above MAX_CADENCE (hand
//      shaking), machine-perfect regularity (mechanical shakers), or violent peaks (shaking).
// Nothing here uses location; nothing leaves the device.

export const LIMITS = {
  MIN_INTERVAL_MS: 300,     // fastest plausible step (~200 steps/min, running)
  MAX_GAP_MS: 2000,         // longer pause = the walk rhythm restarts
  START_STEPS: 6,           // steady-rhythm steps needed before counting starts (then back-credited)
  MIN_CADENCE: 50,          // steps per minute
  MAX_CADENCE: 190,
  MIN_INTERVAL_CV: 0.012,   // below this the rhythm is machine-perfect (human gait varies ~2-5%)
  MAX_PEAK: 20,             // m/s^2 above gravity; a phone in a pocket legitimately jolts to ~15-20 on each step
  MIN_PEAK: 0.5,            // m/s^2: below this it is noise / phone at rest
  WINDOW: 10,               // intervals used for the gait checks
  SHAKE_LOCK_MS: 3000,      // after a violent shake, nothing counts for this long
  PACE_RATIO: 0.75,         // a bump sooner than this x the walker's usual step interval is the same step
  VIBRATION_WINDOW_MS: 2000, // vibration = this many strong bumps within this window...
  VIBRATION_PEAKS: 7,       // ...(>= 3.5 per second). Walking, even with equal heel + push-off bumps, stays <= ~3/s
  SECONDARY_RATIO: 0.8,     // a close peak weaker than this x the step's peak is gait (push-off), not vibration
  THRESHOLD_RATIO: 0.35,    // peaks must reach this x the typical step peak (adapts to hand vs pocket)
};

export function createStepDetector(limits = LIMITS) {
  const L = { ...LIMITS, ...limits };
  let gravity = null, smooth = 0, prev = 0, rising = false, peak = 0;
  let threshold = L.MIN_PEAK, lastStepT = null, lastStepPeak = 0, stepPeakAvg = 0;
  let streak = [];            // timestamps of the current candidate rhythm
  let lockUntil = -Infinity;  // shake lockout
  const strongPeaks = [];     // times of recent bumps at least SECONDARY_RATIO x the typical step peak
  let s0 = 0, t0 = 0, t1 = 0; // the sample before the previous one, for sub-sample peak timing
  const intervals = [];       // accepted intervals (ms), most recent last
  const stats = { steps: 0, rejected: 0, reason: "" };

  function gaitOk() {
    const w = intervals.slice(-L.WINDOW);
    if (w.length < 3) return { ok: true };
    const mean = w.reduce((a, b) => a + b, 0) / w.length;
    const cadence = 60000 / mean;
    const sd = Math.sqrt(w.reduce((a, b) => a + (b - mean) ** 2, 0) / w.length);
    const cv = sd / mean;
    if (cadence > L.MAX_CADENCE) return { ok: false, reason: "too fast for walking" };
    if (cadence < L.MIN_CADENCE) return { ok: false, reason: "too slow" };
    if (w.length >= 6 && cv < L.MIN_INTERVAL_CV) return { ok: false, reason: "machine-like rhythm" };
    return { ok: true };
  }

  function onPeak(t, amplitude) {
    if (amplitude > L.MAX_PEAK) { streak = []; lockUntil = t + L.SHAKE_LOCK_MS; stats.rejected++; stats.reason = "shaking"; return false; }
    const recent = intervals.slice(-L.WINDOW);
    const usual = recent.length >= 3 ? [...recent].sort((a, b) => a - b)[recent.length >> 1] : 0;   // median step interval
    const minGap = Math.max(L.MIN_INTERVAL_MS, usual * L.PACE_RATIO);
    const double = lastStepT !== null && t - lastStepT < minGap;
    // Vibration/shaking = many strong bumps per second, continuously. Walking produces at most ~3 per
    // second (heel strike + push-off, sometimes equally strong on some phones), so count the rate.
    if (!stepPeakAvg || amplitude >= L.SECONDARY_RATIO * stepPeakAvg) {
      strongPeaks.push(t);
      while (strongPeaks.length && t - strongPeaks[0] > L.VIBRATION_WINDOW_MS) strongPeaks.shift();
      if (strongPeaks.length >= L.VIBRATION_PEAKS) {
        strongPeaks.length = 0; streak = []; lockUntil = t + L.SHAKE_LOCK_MS; stats.rejected++; stats.reason = "vibration"; return false;
      }
    }
    if (double) return false;                                                         // double peak
    if (t < lockUntil) { streak = []; lastStepT = t; return false; }
    if (lastStepT !== null && t - lastStepT > L.MAX_GAP_MS) streak = [];              // rhythm broke
    if (lastStepT !== null && streak.length) intervals.push(t - lastStepT);
    if (intervals.length > 50) intervals.shift();
    lastStepT = t;
    lastStepPeak = amplitude;
    stepPeakAvg = stepPeakAvg ? stepPeakAvg * 0.8 + amplitude * 0.2 : amplitude;
    threshold = Math.max(L.MIN_PEAK, L.THRESHOLD_RATIO * stepPeakAvg);   // adapt to this walker and phone position
    streak.push(t);
    const g = gaitOk();
    if (!g.ok) { stats.rejected++; stats.reason = g.reason; streak = [t]; return false; }
    if (streak.length < L.START_STEPS) return false;
    const credited = streak.length === L.START_STEPS ? L.START_STEPS : 1;            // back-credit the start
    stats.steps += credited;
    stats.reason = "";
    return credited;
  }

  return {
    /** Feed one accelerometer sample (t in ms; ax, ay, az in m/s^2 including gravity).
     *  Returns the number of newly credited steps (0 most of the time). */
    feed(t, ax, ay, az) {
      const m = Math.sqrt(ax * ax + ay * ay + az * az);
      if (gravity === null) gravity = m;
      gravity = gravity * 0.98 + m * 0.02;           // ~1 s time constant at 50 Hz
      const d = m - gravity;
      smooth = smooth * 0.55 + d * 0.45;
      let credited = 0;
      if (smooth > prev) { rising = true; peak = Math.max(peak, smooth); }
      else if (rising && smooth < prev) {            // just passed a local maximum (at the previous sample)
        rising = false;
        // Parabola through the 3 samples around the maximum: exact peak time between samples, so the
        // sampling grid can't disguise a machine-perfect rhythm as natural variation.
        const den = s0 - 2 * prev + smooth;
        const off = den !== 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (s0 - smooth) / den)) : 0;
        const tPeak = t1 + off * (t - t1);
        if (peak >= threshold) credited = onPeak(tPeak, peak) || 0;
        peak = 0;
      }
      s0 = prev; t0 = t1; t1 = t;
      prev = smooth;
      return credited;
    },
    stats: () => ({ ...stats, cadence: cadence() }),
  };

  function cadence() {
    const w = intervals.slice(-L.WINDOW);
    if (!w.length) return 0;
    return Math.round(60000 / (w.reduce((a, b) => a + b, 0) / w.length));
  }
}
