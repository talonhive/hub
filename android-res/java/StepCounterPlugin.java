package io.github.talonhive.hub;

import android.Manifest;
import android.content.Context;
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
    permissions = { @Permission(alias = "activity", strings = { Manifest.permission.ACTIVITY_RECOGNITION }) }
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
        if (listening && sensorManager != null) sensorManager.unregisterListener(this);
    }
}
