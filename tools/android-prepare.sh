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
cp android-res/java/MainActivity.java android-res/java/StepCounterPlugin.java "$src/"
m=android/app/src/main/AndroidManifest.xml
sed -i 's#<application#<uses-permission android:name="android.permission.ACTIVITY_RECOGNITION" />\n    <uses-feature android:name="android.hardware.sensor.stepcounter" android:required="false" />\n    <application#' "$m"
grep -q ACTIVITY_RECOGNITION "$m"
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
echo "android project ready"
