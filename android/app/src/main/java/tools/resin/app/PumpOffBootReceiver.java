package tools.resin.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import java.util.List;
import org.json.JSONObject;

/**
 * Puts pump-off alarms back after the device restarts.
 *
 * AlarmManager drops every alarm on reboot. Before this existed, a phone that
 * restarted overnight had no pump-off alarms the next morning and gave no sign
 * of it - the operator would simply never be told, which on a production floor
 * is worse than a false alarm. Nothing in the app could notice either, because
 * the WebView that schedules alarms does not run until somebody opens the app.
 *
 * Also handles the app being updated, which clears alarms the same way.
 */
public class PumpOffBootReceiver extends BroadcastReceiver {
    // Some OEM firmwares send this instead of the standard action on a
    // "quick boot"/fast-restart path.
    private static final String QUICKBOOT = "android.intent.action.QUICKBOOT_POWERON";
    private static final String QUICKBOOT_HTC = "com.htc.intent.action.QUICKBOOT_POWERON";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        String action = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
            && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
            && !QUICKBOOT.equals(action)
            && !QUICKBOOT_HTC.equals(action)) {
            return;
        }

        long now = System.currentTimeMillis();
        // An alarm that came due while the device was off has been missed
        // already; re-arming it would fire it late, for a changeover that is
        // over. Drop those instead of re-arming them.
        PumpOffAlarmStore.pruneDueBefore(context, now);

        List<JSONObject> entries = PumpOffAlarmStore.all(context);
        for (JSONObject entry : entries) {
            PumpOffAlarmScheduler.rearm(context, entry);
        }

        // The notification channel is created lazily when an alarm fires, but
        // an alarm re-armed here may be the first thing to need it after a
        // restart.
        PumpOffAlarmReceiver.ensureChannel(context);
    }
}
