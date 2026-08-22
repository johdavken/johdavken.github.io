package tools.resin.app;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The device's own record of the pump-off alarms it has handed to
 * AlarmManager.
 *
 * AlarmManager forgets everything across a reboot, and the details of what to
 * re-arm (which hopper, when, which sound) only exist in the WebView's JS
 * state - which is not running at boot and will not run until somebody opens
 * the app. Without a native copy, a phone that restarts overnight simply has
 * no pump-off alarms the next morning and says nothing about it.
 *
 * Deliberately a plain SharedPreferences JSON blob rather than a database:
 * this holds at most a handful of entries, is written only when the app is
 * already doing alarm work, and is read once at boot.
 */
final class PumpOffAlarmStore {
    private static final String PREFS = "pump_off_alarms";
    private static final String KEY_ENTRIES = "entries";

    static final String FIELD_ID = "id";
    static final String FIELD_TITLE = "title";
    static final String FIELD_BODY = "body";
    static final String FIELD_AT = "at";
    static final String FIELD_SOUND = "sound";
    static final String FIELD_VIBRATE = "vibrate";

    private PumpOffAlarmStore() {}

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Every alarm believed to be armed. Never null; a corrupt store reads as empty. */
    static List<JSONObject> all(Context context) {
        List<JSONObject> entries = new ArrayList<>();
        String raw = prefs(context).getString(KEY_ENTRIES, null);
        if (raw == null) return entries;
        try {
            JSONArray array = new JSONArray(raw);
            for (int i = 0; i < array.length(); i++) {
                JSONObject entry = array.optJSONObject(i);
                if (entry != null && entry.has(FIELD_ID) && entry.has(FIELD_AT)) entries.add(entry);
            }
        } catch (JSONException ignored) {
            // Unreadable record: treat as empty rather than throwing on a path
            // that also has real alarms to schedule.
        }
        return entries;
    }

    /** Records one alarm, replacing any existing entry with the same id. */
    static void put(Context context, JSONObject entry) {
        int id = entry.optInt(FIELD_ID, Integer.MIN_VALUE);
        if (id == Integer.MIN_VALUE) return;
        List<JSONObject> entries = all(context);
        entries.removeIf(existing -> existing.optInt(FIELD_ID, Integer.MIN_VALUE) == id);
        entries.add(entry);
        write(context, entries);
    }

    static void remove(Context context, int id) {
        List<JSONObject> entries = all(context);
        if (entries.removeIf(existing -> existing.optInt(FIELD_ID, Integer.MIN_VALUE) == id)) {
            write(context, entries);
        }
    }

    /**
     * Drops entries whose due time has passed. Called at boot: an alarm that
     * came due while the device was off has already been missed, and re-arming
     * it would fire it late for a changeover that is long over.
     */
    static void pruneDueBefore(Context context, long millis) {
        List<JSONObject> entries = all(context);
        if (entries.removeIf(entry -> entry.optLong(FIELD_AT, 0L) <= millis)) {
            write(context, entries);
        }
    }

    private static void write(Context context, List<JSONObject> entries) {
        JSONArray array = new JSONArray();
        for (JSONObject entry : entries) array.put(entry);
        prefs(context).edit().putString(KEY_ENTRIES, array.toString()).apply();
    }
}
