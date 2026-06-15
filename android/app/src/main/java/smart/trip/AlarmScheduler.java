package smart.trip;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;

/** Schedules and cancels the exact wake-up alarm behind a Leave Alarm. */
final class AlarmScheduler {
    static final String ACTION_FIRE = "smart.trip.action.LEAVE_ALARM_FIRE";
    static final String EXTRA_ID = "leave_alarm_id";

    private AlarmScheduler() {}

    static void schedule(Context ctx, String id, long triggerAt, String title, String stop, String open) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) throw new IllegalStateException("AlarmManager unavailable");
        // setAndAllowWhileIdle: wakes the device (RTC_WAKEUP) and fires through
        // Doze with NO exact-alarm permission — so the app needs no
        // USE_EXACT_ALARM / SCHEDULE_EXACT_ALARM and no alarm-clock Play
        // declaration. The trade-off vs setAlarmClock is precision: under Doze the
        // OS batches allow-while-idle alarms, so it can fire a few minutes late —
        // acceptable for a lead-time "leave" reminder.
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, firePendingIntent(ctx, id));
        // Persist only once the alarm is actually set, so a failed schedule
        // leaves no orphan entry for boot-restore to resurrect.
        AlarmStore.put(ctx, id, triggerAt, title, stop, open);
    }

    static void cancel(Context ctx, String id) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(firePendingIntent(ctx, id));
        AlarmStore.remove(ctx, id);
    }

    /** Rebuildable broadcast intent — matching by component + action + request
     *  code (extras are ignored for equality) so cancel() finds the same one. */
    private static PendingIntent firePendingIntent(Context ctx, String id) {
        Intent i = new Intent(ctx, AlarmReceiver.class)
            .setAction(ACTION_FIRE)
            .putExtra(EXTRA_ID, id);
        return PendingIntent.getBroadcast(
            ctx, AlarmStore.requestCode(id), i,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
