package smart.trip;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

/**
 * Tiny SharedPreferences-backed record of scheduled Leave Alarms, keyed by id.
 * Needed so cancel() can target an alarm and so {@link BootReceiver} can
 * re-arm survivors after a reboot (AlarmManager forgets alarms across restarts).
 */
final class AlarmStore {
    private static final String PREFS = "leave_alarm_store";
    private static final String KEY = "alarms";

    private AlarmStore() {}

    static final class Entry {
        final String id;
        final long triggerAt;
        final String title;
        final String stop;
        final String open;

        Entry(String id, long triggerAt, String title, String stop, String open) {
            this.id = id;
            this.triggerAt = triggerAt;
            this.title = title;
            this.stop = stop;
            this.open = open;
        }
    }

    /** Stable, positive request code derived from the (UUID) id. */
    static int requestCode(String id) {
        return id.hashCode() & 0x7fffffff;
    }

    static void put(Context ctx, String id, long triggerAt, String title, String stop, String open) {
        JSONObject root = root(ctx);
        try {
            JSONObject o = new JSONObject();
            o.put("triggerAt", triggerAt);
            o.put("title", title);
            o.put("stop", stop == null ? "" : stop);
            o.put("open", open == null ? "" : open);
            root.put(id, o);
            prefs(ctx).edit().putString(KEY, root.toString()).apply();
        } catch (JSONException ignored) {
        }
    }

    static Entry get(Context ctx, String id) {
        if (id == null) return null;
        JSONObject o = root(ctx).optJSONObject(id);
        return o == null ? null : toEntry(id, o);
    }

    static void remove(Context ctx, String id) {
        if (id == null) return;
        JSONObject root = root(ctx);
        if (root.has(id)) {
            root.remove(id);
            prefs(ctx).edit().putString(KEY, root.toString()).apply();
        }
    }

    static List<Entry> all(Context ctx) {
        List<Entry> out = new ArrayList<>();
        JSONObject root = root(ctx);
        for (Iterator<String> it = root.keys(); it.hasNext(); ) {
            String id = it.next();
            JSONObject o = root.optJSONObject(id);
            if (o != null) out.add(toEntry(id, o));
        }
        return out;
    }

    private static Entry toEntry(String id, JSONObject o) {
        return new Entry(
            id,
            o.optLong("triggerAt"),
            o.optString("title"),
            emptyToNull(o.optString("stop")),
            emptyToNull(o.optString("open")));
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static JSONObject root(Context ctx) {
        try {
            return new JSONObject(prefs(ctx).getString(KEY, "{}"));
        } catch (JSONException e) {
            return new JSONObject();
        }
    }

    private static String emptyToNull(String s) {
        return s == null || s.isEmpty() ? null : s;
    }
}
