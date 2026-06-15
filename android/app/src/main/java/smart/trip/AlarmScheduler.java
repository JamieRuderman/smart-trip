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
        AlarmStore.put(ctx, id, triggerAt, title, stop, open);
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        // setAlarmClock: exact, wakes the device, fires through Doze, and is
        // exempt from the SCHEDULE_EXACT_ALARM permission. The show intent opens
        // the app when the user taps the status-bar alarm chip.
        Intent launch = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent show = PendingIntent.getActivity(
            ctx, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        am.setAlarmClock(new AlarmManager.AlarmClockInfo(triggerAt, show), firePendingIntent(ctx, id));
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
