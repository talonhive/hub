# TalonHive Hub

<img src="www/icons/icon-192.png" width="72" alt="TalonHive mark">

**Walk, play and read to mine NACKL** with Acki Nacki's [Bee Engine](https://dev.ackinacki.com/bee-engine/bee-engine-overview).
Part of **TalonHive**, alongside [TalonHive Swap](https://github.com/talonhive/talonhive).

> **Status: preview.** Walk sessions and on-device step counting work now (web preview:
> https://talonhive.github.io/hub/). Mining runs on the Acki Nacki test network (Shellnet) with our Bee Engine app id `0x…0037`.
> Shellnet / test network only. The Android APK is next.

## What it does

| Activity | Status | Honest activity signal |
|---|---|---|
| **Walk** | ✅ preview | Steps detected on the phone from the accelerometer |
| **Games** | planned | Real moves in small games |
| **Read** | planned | Real reading activity |

Every activity feeds one Bee Engine miner: users connect their Acki Nacki Wallet **once** and allow
mining with **Mining Keys** (revocable in the wallet). TalonHive never asks for seed phrases or keys.

## Privacy and fairness (Walk)

- **On-device only:** motion data never leaves the phone. **No GPS, no location.**
- **Fair counting** (`www/stepcore.js`, tested in `test/stepcore.test.mjs`):
  - counting starts only after a steady walking rhythm (6 steps, then back-credited), so bumps and taps never count;
  - hand shaking, vibration and machine-perfect rhythms are rejected (cadence limits, double-peak rate, a 3 s
    lockout after violent shakes, and sub-sample peak timing so the sensor's sampling grid can't disguise a machine).

## Layout

```
www/         the app (web build; also the content of the Android app)
  stepcore.js  step detector (pure logic, no browser APIs)
  app.js       walk sessions, screen wake lock, UI
test/        node tests for the step detector
tools/       pre-commit secret guard (bash tools/install-hooks.sh)
```

## Run

```bash
node test/stepcore.test.mjs                  # step detector tests
python -m http.server 8766 --directory www   # then open http://localhost:8766 (phone: use the web preview)
```

## Android app (APK)

Built on GitHub's servers by `.github/workflows/android.yml` (Capacitor 8.5.3, pinned): the Android project is
generated from `capacitor.config.json` + `www/` on every build, so this repo holds only our code.
Every push produces an unsigned **debug** test APK (Actions → latest "android" run → Artifacts) with its SHA-256.

**Step counting in the APK** uses Android's hardware step counter (`TYPE_STEP_COUNTER`) through a small native plugin
(`android-res/java/StepCounterPlugin.java`, permission *Physical activity*): it counts with the screen off, in a pocket,
and while the app is closed, fully offline. Field test: 100% in hand, a few steps over in a pocket. Phones without the
sensor (and the website) use the motion detector in `www/stepcore.js`.

Signed public releases come from version tags (`release.yml`).

## Distribution

**Download:** https://github.com/talonhive/hub/releases (latest: v0.1.0, test-network preview).
Releases are signed with the TalonHive key; its certificate SHA-256 is
`773de2fca6b4bd945332f7da947cf868fc1512f1c2374e5cead7ce133051fe20` and stays the same for every release.

The Android app is published as **signed APKs on GitHub Releases** (installable and auto-updatable with
Obtainium). It won't be on Google Play, whose policies don't allow on-device mining. **Only install TalonHive from
this repository's Releases page.**

## Licence

TalonHive Hub is licensed under the **GNU AGPL-3.0** (see LICENSE.md), because it bundles Acki Nacki's Bee Engine
SDK (AGPL-3.0, github.com/gosh-sh/bee-engine), vendored unmodified in `www/vendor/bee-sdk-6.0.0/`.
