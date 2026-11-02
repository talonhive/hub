package io.github.talonhive.hub;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

/**
 * TalonHive Hub: keeps mining running with the screen off.
 *
 * Android pauses an app's web view and lets the CPU sleep when the screen turns off, which stops the Bee Engine
 * miner (it runs in the web view). While mining is on, this foreground service keeps the app's process alive and
 * the CPU awake (partial wake lock), and shows a notification so the user always knows it is running.
 * Type "health": it counts steps with the hardware step counter (ACTIVITY_RECOGNITION).
 */
public class MiningService extends Service {
    static final String CHANNEL = "mining";
    static final int NOTIFICATION_ID = 7;
    /** True while the service runs; MainActivity keeps the web view's timers running while it is set. */
    static volatile boolean running = false;

    private PowerManager.WakeLock wakeLock;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification n = buildNotification();
        // The "health" type exists from Android 14 (API 34); older versions take no type here.
        int type = Build.VERSION.SDK_INT >= 34 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH : 0;
        ServiceCompat.startForeground(this, NOTIFICATION_ID, n, type);
        if (wakeLock == null) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "TalonHive:mining");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire();
        }
        running = true;
        return START_NOT_STICKY;   // mining needs the app; never restart this service on its own
    }

    private Notification buildNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Mining", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Shown while TalonHive Hub mines with the screen off");
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(getApplicationInfo().icon)
            .setContentTitle("TalonHive Hub is mining")
            .setContentText("Keep walking. Open the app to stop.")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(tap)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }

    @Override
    public void onDestroy() {
        running = false;
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
