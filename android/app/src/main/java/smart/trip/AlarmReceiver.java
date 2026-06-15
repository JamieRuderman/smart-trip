package smart.trip;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Receives the AlarmManager wake-up broadcast (fires the alarm) and the
 * notification's Stop action (silences it). Declared in the manifest so it
 * resolves even when the app process is dead.
 */
public class AlarmReceiver extends BroadcastReceiver {
    static final String ACTION_STOP = "smart.trip.action.LEAVE_ALARM_STOP";

    @Override
    public void onReceive(Context ctx, Intent intent) {
        String id = intent.getStringExtra(AlarmScheduler.EXTRA_ID);

        if (ACTION_STOP.equals(intent.getAction())) {
            AlarmNotifier.cancel(ctx);
            // Stop a live alarm screen too, if one is showing.
            ctx.sendBroadcast(new Intent(LeaveAlarmActivity.ACTION_DISMISS).setPackage(ctx.getPackageName()));
            AlarmStore.remove(ctx, id);
            return;
        }

        AlarmStore.Entry entry = AlarmStore.get(ctx, id);
        if (entry == null) return; // already canceled
        AlarmNotifier.ring(ctx, entry);
        // setAlarmClock is one-shot; it's no longer pending once delivered.
        AlarmStore.remove(ctx, id);
    }
}
