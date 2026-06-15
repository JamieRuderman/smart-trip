package smart.trip;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Re-arms persisted Leave Alarms after a reboot — AlarmManager drops all alarms
 * across a restart, so without this a reminder set the night before would never
 * fire. Past-due entries are pruned rather than fired late.
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        String action = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
                && !Intent.ACTION_LOCKED_BOOT_COMPLETED.equals(action)) {
            return;
        }
        long now = System.currentTimeMillis();
        for (AlarmStore.Entry e : AlarmStore.all(ctx)) {
            if (e.triggerAt > now) {
                AlarmScheduler.schedule(ctx, e.id, e.triggerAt, e.title, e.stop, e.open);
            } else {
                AlarmStore.remove(ctx, e.id);
            }
        }
    }
}
