package io.github.talonhive.hub;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.core.content.ContextCompat;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Build;
import android.view.WindowManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * TalonHive Hub: Android's hardware step counter (Sensor.TYPE_STEP_COUNTER).
 *
 * The phone's low-power sensor hub counts steps continuously - screen off, app paused or closed - and reports
 * the total since the last reboot. The app reads it while open and works out the steps since it last looked.
 * Nothing leaves the device; no location is used.
 */
@CapacitorPlugin(
    name = "StepCounter",
    permissions = {
        @Permission(alias = "activity", strings = { Manifest.permission.ACTIVITY_RECOGNITION }),
        @Permission(alias = "notifications", strings = { "android.permission.POST_NOTIFICATIONS" })
    }
)
public class StepCounterPlugin extends Plugin implements SensorEventListener {
    private SensorManager sensorManager;
    private Sensor counter;
    private boolean listening = false;
    private long lastTotal = -1;

    @Override
    public void load() {
        sensorManager = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
        counter = sensorManager != null ? sensorManager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER) : null;
    }

    private boolean permissionMissing() {
        // ACTIVITY_RECOGNITION is a runtime permission from Android 10 (API 29).
        return Build.VERSION.SDK_INT >= 29 && getPermissionState("activity") != PermissionState.GRANTED;
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject r = new JSObject();
        r.put("available", counter != null);
        r.put("permission", !permissionMissing());
        call.resolve(r);
    }

    @PluginMethod
    public void ensurePermission(PluginCall call) {
        if (!permissionMissing()) {
            JSObject r = new JSObject();
            r.put("granted", true);
            call.resolve(r);
            return;
        }
        requestPermissionForAlias("activity", call, "onPermission");
    }

    @PermissionCallback
    private void onPermission(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", !permissionMissing());
        call.resolve(r);
    }

    /** Start receiving totals ("steps" events). Resolves with the last known total (-1 if none yet). */
    @PluginMethod
    public void start(PluginCall call) {
        if (counter == null) { call.reject("This phone has no hardware step counter"); return; }
        if (permissionMissing()) { call.reject("Physical activity permission not granted"); return; }
        if (!listening) {
            sensorManager.registerListener(this, counter, SensorManager.SENSOR_DELAY_UI);
            listening = true;
        }
        JSObject r = new JSObject();
        r.put("total", lastTotal);
        call.resolve(r);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (listening && sensorManager != null) { sensorManager.unregisterListener(this); listening = false; }
        call.resolve();
    }

    /** Keep the screen on (only used for the motion-detector fallback; the hardware counter doesn't need it). */
    @PluginMethod
    public void keepAwake(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        });
        call.resolve();
    }

    // ---- mining with the screen off (MiningService) ----
    // While mining runs in the background, a native heartbeat fires a "tick" event every second: browsers slow a
    // hidden page's own timers (down to once a minute), but events delivered from here still run its code.
    private final Handler heartbeat = new Handler(Looper.getMainLooper());
    private final Runnable beat = new Runnable() {
        @Override public void run() {
            notifyListeners("tick", new JSObject());
            heartbeat.postDelayed(this, 1000);
        }
    };

    /** Start mining in the background: foreground service (notification + wake lock) and the heartbeat. */
    @PluginMethod
    public void startBackground(PluginCall call) {
        if (permissionMissing()) { call.reject("Physical activity permission not granted"); return; }
        try {
            ContextCompat.startForegroundService(getContext(), new Intent(getContext(), MiningService.class));
        } catch (Exception e) {
            call.reject("Couldn't start background mining: " + e.getMessage());
            return;
        }
        heartbeat.removeCallbacks(beat);
        heartbeat.post(beat);
        getActivity().runOnUiThread(() -> getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON));
        call.resolve();
    }

    @PluginMethod
    public void stopBackground(PluginCall call) {
        heartbeat.removeCallbacks(beat);
        getContext().stopService(new Intent(getContext(), MiningService.class));
        call.resolve();
    }

    /** Android 13+: ask to show the "mining" notification (the service runs either way). */
    @PluginMethod
    public void ensureNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) {
            JSObject r = new JSObject(); r.put("granted", true); call.resolve(r); return;
        }
        requestPermissionForAlias("notifications", call, "onNotifications");
    }

    @PermissionCallback
    private void onNotifications(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", getPermissionState("notifications") == PermissionState.GRANTED);
        call.resolve(r);
    }

    /** Whether battery optimisation is off for this app (some phones stop background apps otherwise). */
    @PluginMethod
    public void batteryStatus(PluginCall call) {
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        JSObject r = new JSObject();
        r.put("unrestricted", Build.VERSION.SDK_INT < 23 || (pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName())));
        call.resolve(r);
    }

    /** Opens Android's own "allow to run in the background" prompt for this app. */
    @PluginMethod
    public void requestUnrestrictedBattery(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        } catch (Exception e) {
            Intent i = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        }
        call.resolve();
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        lastTotal = (long) event.values[0];
        JSObject d = new JSObject();
        d.put("total", lastTotal);
        notifyListeners("steps", d);
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) { }

    @Override
    protected void handleOnDestroy() {
        heartbeat.removeCallbacks(beat);
        if (listening && sensorManager != null) sensorManager.unregisterListener(this);
        getContext().stopService(new Intent(getContext(), MiningService.class));
    }
}
