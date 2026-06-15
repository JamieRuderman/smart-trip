package smart.trip;

import android.Manifest;
import android.os.Build;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.UUID;

/**
 * Android side of the local {@code LeaveAlarm} Capacitor plugin — the
 * counterpart to ios/App/App/LeaveAlarm/. iOS uses AlarmKit; here we schedule
 * an exact {@link android.app.AlarmManager#setAlarmClock} that fires a
 * full-screen, alarm-audio alert ({@link LeaveAlarmActivity}) which rings
 * through silent mode / Do Not Disturb — the promise the notification path
 * can't make.
 *
 * <p>setAlarmClock requires the USE_EXACT_ALARM permission (declared in the
 * manifest, auto-granted at install for alarm apps); without it the call throws
 * SecurityException and we fall back to a notification. POST_NOTIFICATIONS also
 * matters, since the alert is delivered via a full-screen-intent notification.
 *
 * <p>JS binds to this via {@code registerPlugin("LeaveAlarm")} in
 * src/lib/native/leaveAlarm.ts; the method surface mirrors the Swift plugin.
 */
@CapacitorPlugin(
    name = "LeaveAlarm",
    permissions = @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = LeaveAlarmPlugin.NOTIFICATIONS)
)
public class LeaveAlarmPlugin extends Plugin {

    static final String NOTIFICATIONS = "notifications";

    @PluginMethod
    public void isAvailable(PluginCall call) {
        // setAlarmClock exists on every API this app supports (minSdk 23).
        JSObject ret = new JSObject();
        ret.put("value", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void checkAuthorization(PluginCall call) {
        resolveStatus(call);
    }

    @PluginMethod
    public void requestAuthorization(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && getPermissionState(NOTIFICATIONS) != PermissionState.GRANTED) {
            requestPermissionForAlias(NOTIFICATIONS, call, "authorizationCallback");
            return;
        }
        resolveStatus(call);
    }

    @PermissionCallback
    private void authorizationCallback(PluginCall call) {
        resolveStatus(call);
    }

    @PluginMethod
    public void schedule(PluginCall call) {
        // Epoch ms arrives as a JS number; past Int32 it lands as a Long, which
        // PluginCall.getDouble() (Double/Float/Integer only) drops to null — so
        // read it via optDouble, which coerces any Number. Double holds epoch ms
        // exactly (well under 2^53).
        double fireAtMs = call.getData().optDouble("fireAtMs", Double.NaN);
        if (Double.isNaN(fireAtMs) || Double.isInfinite(fireAtMs)) {
            call.reject("fireAtMs is required");
            return;
        }
        String title = call.getString("title");
        if (title == null || title.isEmpty()) {
            call.reject("title is required");
            return;
        }
        long triggerAt = (long) fireAtMs;
        if (triggerAt <= System.currentTimeMillis()) {
            call.reject("fireAtMs must be in the future");
            return;
        }
        String stop = call.getString("stopButtonTitle", "Stop");
        String open = call.getString("openButtonTitle"); // nullable — hides the second button
        String id = UUID.randomUUID().toString();
        try {
            AlarmScheduler.schedule(getContext(), id, triggerAt, title, stop, open);
        } catch (Exception e) {
            // e.g. SecurityException when exact-alarm permission is missing/revoked
            // — reject so JS degrades to the notification path instead of crashing.
            call.reject("Failed to schedule alarm: " + e.getMessage(), e);
            return;
        }
        JSObject ret = new JSObject();
        ret.put("id", id);
        call.resolve(ret);
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String id = call.getString("id");
        if (id == null || id.isEmpty()) {
            call.reject("id is required");
            return;
        }
        AlarmScheduler.cancel(getContext(), id);
        call.resolve();
    }

    private void resolveStatus(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("status", notificationsAllowed() ? "authorized" : "denied");
        call.resolve(ret);
    }

    private boolean notificationsAllowed() {
        return NotificationManagerCompat.from(getContext()).areNotificationsEnabled();
    }
}
