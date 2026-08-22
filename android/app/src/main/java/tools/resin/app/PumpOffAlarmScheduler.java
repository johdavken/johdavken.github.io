package tools.resin.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import org.json.JSONObject;

/**
 * The one place a pump-off alarm is handed to (or taken back from)
 * AlarmManager.
 *
 * Shared by PumpOffAlarmPlugin (the JS bridge) and PumpOffBootReceiver (which
 * re-arms after a restart) so the two cannot drift - a boot-time alarm has to
 * be built with the identical PendingIntent the plugin would have built, or
 * the app's later cancel() would not match it and the alarm would be
 * unstoppable.
 */
final class PumpOffAlarmScheduler {

    private PumpOffAlarmScheduler() {}

    /** Arms one alarm and records it, so a reboot can put it back. */
    static void schedule(Context context, JSONObject entry) {
        int id = entry.optInt(PumpOffAlarmStore.FIELD_ID, Integer.MIN_VALUE);
        if (id == Integer.MIN_VALUE) return;
        long at = entry.optLong(PumpOffAlarmStore.FIELD_AT, 0L);
        if (at <= 0L) return;

        arm(context, id, at,
            entry.optString(PumpOffAlarmStore.FIELD_TITLE, "Pump off due"),
            entry.optString(PumpOffAlarmStore.FIELD_BODY, "Hopper pump-off is due now."),
            entry.isNull(PumpOffAlarmStore.FIELD_SOUND) ? null : entry.optString(PumpOffAlarmStore.FIELD_SOUND, null),
            entry.optBoolean(PumpOffAlarmStore.FIELD_VIBRATE, true));

        PumpOffAlarmStore.put(context, entry);
    }

    /**
     * Re-arms without re-recording. Used at boot, where the entry came out of
     * the store in the first place.
     */
    static void rearm(Context context, JSONObject entry) {
        int id = entry.optInt(PumpOffAlarmStore.FIELD_ID, Integer.MIN_VALUE);
        if (id == Integer.MIN_VALUE) return;
        arm(context, id, entry.optLong(PumpOffAlarmStore.FIELD_AT, 0L),
            entry.optString(PumpOffAlarmStore.FIELD_TITLE, "Pump off due"),
            entry.optString(PumpOffAlarmStore.FIELD_BODY, "Hopper pump-off is due now."),
            entry.isNull(PumpOffAlarmStore.FIELD_SOUND) ? null : entry.optString(PumpOffAlarmStore.FIELD_SOUND, null),
            entry.optBoolean(PumpOffAlarmStore.FIELD_VIBRATE, true));
    }

    private static void arm(Context context, int id, long at, String title, String body, String sound, boolean vibrate) {
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) return;
        PendingIntent pendingIntent = alarmPendingIntent(context, id, title, body, sound, vibrate);
        boolean canScheduleExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S
            || alarmManager.canScheduleExactAlarms();
        if (canScheduleExact) {
            alarmManager.setAlarmClock(new AlarmManager.AlarmClockInfo(at, pendingIntent), pendingIntent);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pendingIntent);
        } else {
            alarmManager.set(AlarmManager.RTC_WAKEUP, at, pendingIntent);
        }
    }

    static void cancel(Context context, int id) {
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager != null) {
            alarmManager.cancel(alarmPendingIntent(context, id, null, null, null, true));
        }
        PumpOffAlarmStore.remove(context, id);
    }

    /**
     * PendingIntent equality ignores extras (Intent.filterEquals compares
     * action, data, type, class and categories only), so the null-extra form
     * used by cancel still matches the alarm that was armed with real ones.
     */
    static PendingIntent alarmPendingIntent(Context context, int id, String title, String body, String sound, boolean vibrate) {
        Intent intent = new Intent(context, PumpOffAlarmReceiver.class);
        intent.putExtra(PumpOffAlarmReceiver.EXTRA_ID, id);
        if (title != null) intent.putExtra(PumpOffAlarmReceiver.EXTRA_TITLE, title);
        if (body != null) intent.putExtra(PumpOffAlarmReceiver.EXTRA_BODY, body);
        if (sound != null) intent.putExtra(PumpOffAlarmReceiver.EXTRA_SOUND, sound);
        intent.putExtra(PumpOffAlarmReceiver.EXTRA_VIBRATE, vibrate);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(context, id, intent, flags);
    }
}
