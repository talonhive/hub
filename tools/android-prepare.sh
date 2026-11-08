#!/usr/bin/env bash
# Shared by the "android" (debug test APK) and "release" (signed APK) workflows, so both are built identically.
# Runs on GitHub's build server: generates the Android project from capacitor.config.json + www/, adds our native
# step-counter plugin and permission, and installs the app icons.
set -euo pipefail

npm install --no-audit --no-fund
npx cap add android
npx cap sync android

# Native hardware step counter plugin + permission
src=android/app/src/main/java/io/github/talonhive/hub
test -d "$src" || { echo "unexpected project layout:"; find android/app/src/main/java; exit 1; }
rm -f "$src"/MainActivity.*
cp android-res/java/MainActivity.java android-res/java/StepCounterPlugin.java android-res/java/MiningService.java "$src/"
m=android/app/src/main/AndroidManifest.xml
sed -i 's#<application#<uses-permission android:name="android.permission.ACTIVITY_RECOGNITION" />\n    <uses-feature android:name="android.hardware.sensor.stepcounter" android:required="false" />\n    <application#' "$m"
grep -q ACTIVITY_RECOGNITION "$m"

# Mining with the screen off: a foreground service (type "health": hardware step counting) holding a wake lock,
# its notification, and Android's "allow background" prompt.
sed -i 's#<application#<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />\n    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_HEALTH" />\n    <uses-permission android:name="android.permission.WAKE_LOCK" />\n    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />\n    <uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />\n    <application#' "$m"
sed -i 's#</application>#    <service android:name=".MiningService" android:exported="false" android:foregroundServiceType="health" />\n    </application>#' "$m"
grep -q 'android:name=".MiningService"' "$m" && grep -q FOREGROUND_SERVICE_HEALTH "$m"
grep -q "registerPlugin(StepCounterPlugin.class)" "$src/MainActivity.java"

# App icons: the TalonHive mark, white on black
for d in mipmap-mdpi mipmap-hdpi mipmap-xhdpi mipmap-xxhdpi mipmap-xxxhdpi; do
  dir=android/app/src/main/res/$d; mkdir -p "$dir"
  cp android-res/icon-512.png "$dir/ic_launcher.png"
  cp android-res/icon-512.png "$dir/ic_launcher_round.png"
  cp android-res/icon-maskable-512.png "$dir/ic_launcher_foreground.png"
done
rm -f android/app/src/main/res/mipmap-anydpi-v26/ic_launcher*.xml

chmod +x android/gradlew
# The Gradle wrapper gives its own download 10 s by default; allow 2 minutes (a slow mirror failed a release).
w=android/gradle/wrapper/gradle-wrapper.properties
if grep -q '^networkTimeout=' "$w"; then sed -i 's/^networkTimeout=.*/networkTimeout=120000/' "$w"; else echo "networkTimeout=120000" >> "$w"; fi
grep -q '^networkTimeout=120000' "$w"
echo "android project ready"
