# TalonHive Hub

<img src="www/icons/icon-192.png" width="72" alt="TalonHive mark">

**Walk, play and read to mine NACKL** with Acki Nacki's [Bee Engine](https://dev.ackinacki.com/bee-engine/bee-engine-overview).
Part of **TalonHive**, alongside [TalonHive Swap](https://github.com/talonhive/talonhive).

> **Status: preview.** Walk sessions and on-device step counting work now (web preview:
> https://talonhive.github.io/hub/). Mining switches on once Acki Nacki issues our Bee Engine app id.
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

## Distribution

The Android app will be published as **signed APKs on GitHub Releases** (installable and auto-updatable with
Obtainium). It won't be on Google Play, whose policies don't allow on-device mining. **Only install TalonHive from
this repository's Releases page.**
