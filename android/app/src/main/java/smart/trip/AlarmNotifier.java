package smart.trip;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/**
 * Builds, posts, and cancels the full-screen alarm notification. The
 * full-screen intent launches {@link LeaveAlarmActivity} over the lock screen
 * when the device is idle; on an in-use device it shows as a high-priority
 * heads-up with the alarm-stream sound. The channel uses USAGE_ALARM so it
 * plays on the alarm stream (audible in silent mode and, by default, DND).
 */
final class AlarmNotifier {
    static final String CHANNEL_ID = "leave_alarm";
    static final int NOTIF_ID = 0x1EA7;

    private AlarmNotifier() {}

    static void ring(Context ctx, AlarmStore.Entry entry) {
        ensureChannel(ctx);

        Intent full = new Intent(ctx, LeaveAlarmActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_HISTORY)
            .putExtra(AlarmScheduler.EXTRA_ID, entry.id)
            .putExtra(LeaveAlarmActivity.EXTRA_TITLE, entry.title)
            .putExtra(LeaveAlarmActivity.EXTRA_STOP, entry.stop)
            .putExtra(LeaveAlarmActivity.EXTRA_OPEN, entry.open);
        PendingIntent fullPi = PendingIntent.getActivity(
            ctx, AlarmStore.requestCode(entry.id), full,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent stop = new Intent(ctx, AlarmReceiver.class)
            .setAction(AlarmReceiver.ACTION_STOP)
            .putExtra(AlarmScheduler.EXTRA_ID, entry.id);
        PendingIntent stopPi = PendingIntent.getBroadcast(
            ctx, AlarmStore.requestCode(entry.id) ^ 0x55, stop,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        String stopLabel = entry.stop != null ? entry.stop : "Stop";
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle(entry.title)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setContentIntent(fullPi)
            .setFullScreenIntent(fullPi, true)
            .addAction(0, stopLabel, stopPi);

        if (entry.open != null && !entry.open.isEmpty()) {
            Intent openIntent = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            PendingIntent openPi = PendingIntent.getActivity(
                ctx, AlarmStore.requestCode(entry.id) ^ 0xAA, openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            b.addAction(0, entry.open, openPi);
        }

        try {
            NotificationManagerCompat.from(ctx).notify(NOTIF_ID, b.build());
        } catch (SecurityException ignored) {
            // POST_NOTIFICATIONS not granted — nothing actionable from here.
        }
    }

    static void cancel(Context ctx) {
        NotificationManagerCompat.from(ctx).cancel(NOTIF_ID);
    }

    private static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(
            CHANNEL_ID, "Trip departure alarms", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Rings when it's time to leave for your train.");
        Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        if (sound == null) sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        AudioAttributes attrs = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        ch.setSound(sound, attrs);
        ch.enableVibration(true);
        ch.setBypassDnd(true); // honored only with policy access; harmless otherwise
        nm.createNotificationChannel(ch);
    }
}
