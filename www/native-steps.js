// Hardware step counter (Android APK only), through our StepCounter Capacitor plugin
// (android-res/java/StepCounterPlugin.java). The phone's sensor hub counts steps continuously - screen off,
// app paused or closed - and reports the total since the last reboot. On the website this returns null and
// the app uses its own motion-based detector (stepcore.js).

export function getNativeStepCounter() {
  const C = window.Capacitor;
  if (!C || !(typeof C.isNativePlatform === "function" && C.isNativePlatform())) return null;
  try {
    return typeof C.registerPlugin === "function" ? C.registerPlugin("StepCounter") : (C.Plugins && C.Plugins.StepCounter) || null;
  } catch {
    return null;
  }
}

/** Steps since the previously seen hardware total; handles reboots (the counter restarts from 0). */
export function stepsSince(previousTotal, total, maxPlausible = 60000) {
  if (previousTotal == null || previousTotal < 0) return 0;          // first reading: baseline only, no credit
  const delta = total >= previousTotal ? total - previousTotal : total;  // reboot -> counter restarted
  return delta > maxPlausible ? 0 : delta;                             // ignore impossible jumps
}
