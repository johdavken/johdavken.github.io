package tools.resin.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;

/**
 * Fired by AlarmManager at the pump-off due time. Posts a full-screen-intent
 * notification: on a locked/asleep device this launches PumpOffAlarmActivity
 * directly, same as an incoming call or a clock alarm. On devices/OS
 * versions that don't honor full-screen intents, it still falls back to a
 * normal heads-up notification.
 */
public class PumpOffAlarmReceiver extends BroadcastReceiver {
    static final String CHANNEL_ID = "pump-off-alarms";
    /** Sent by the notification's Stop alarm action. */
    static final String ACTION_STOP = "tools.resin.app.STOP_PUMP_OFF_ALARM";
    /** Rebroadcast of the above, which PumpOffAlarmActivity listens for. */
    static final String ACTION_STOP_BROADCAST = "tools.resin.app.STOP_PUMP_OFF_ALARM_BROADCAST";
    static final String EXTRA_ID = "id";
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_BODY = "body";
    static final String EXTRA_SOUND = "sound";
    static final String EXTRA_VIBRATE = "vibrate";

    @Override
    public void onReceive(Context context, Intent intent) {
        int id = intent.getIntExtra(EXTRA_ID, 1);

        // Stop alarm, from the ongoing notification. Take the notification
        // down first so the operator gets feedback even in the case where no
        // alarm screen is alive to hear the rebroadcast.
        if (ACTION_STOP.equals(intent.getAction())) {
            NotificationManager stopManager = context.getSystemService(NotificationManager.class);
            if (stopManager != null) stopManager.cancel(id);
            Intent stop = new Intent(ACTION_STOP_BROADCAST);
            stop.putExtra(EXTRA_ID, id);
            stop.setPackage(context.getPackageName());
            context.sendBroadcast(stop);
            return;
        }

        String title = intent.getStringExtra(EXTRA_TITLE);
        String body = intent.getStringExtra(EXTRA_BODY);
        String sound = intent.getStringExtra(EXTRA_SOUND);
        boolean vibrate = intent.getBooleanExtra(EXTRA_VIBRATE, true);
        if (title == null) title = "Pump off due";
        if (body == null) body = "Hopper pump-off is due now.";

        ensureChannel(context);

        Intent fullScreenIntent = new Intent(context, PumpOffAlarmActivity.class);
        fullScreenIntent.putExtra(EXTRA_ID, id);
        fullScreenIntent.putExtra(EXTRA_TITLE, title);
        fullScreenIntent.putExtra(EXTRA_BODY, body);
        if (sound != null) fullScreenIntent.putExtra(EXTRA_SOUND, sound);
        fullScreenIntent.putExtra(EXTRA_VIBRATE, vibrate);
        fullScreenIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent fullScreenPendingIntent = PendingIntent.getActivity(context, id, fullScreenIntent, flags);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(context.getApplicationInfo().icon)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setAutoCancel(false)
            .setOngoing(true)
            .addAction(0, "Stop alarm", stopPendingIntent(context, id))
            .setFullScreenIntent(fullScreenPendingIntent, true)
            .setContentIntent(fullScreenPendingIntent);

        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null) manager.notify(id, builder.build());
    }

    /**
     * The notification shown while the alarm screen is up. Ongoing, so it
     * cannot be swiped away by accident; tapping it returns to the alarm
     * screen and its action ends the alarm outright. This is the escape hatch
     * that used to be missing - the launching notification was cancelled the
     * moment the screen appeared, which left nothing on screen to act on.
     */
    static void showRingingNotification(Context context, int id, String title, String body,
                                        String sound, boolean vibrate) {
        ensureChannel(context);
        Intent screenIntent = new Intent(context, PumpOffAlarmActivity.class);
        screenIntent.putExtra(EXTRA_ID, id);
        if (title != null) screenIntent.putExtra(EXTRA_TITLE, title);
        if (body != null) screenIntent.putExtra(EXTRA_BODY, body);
        // Carried through so re-entering from the notification keeps the
        // operator's chosen alarm sound instead of silently reverting to the
        // device default.
        if (sound != null) screenIntent.putExtra(EXTRA_SOUND, sound);
        screenIntent.putExtra(EXTRA_VIBRATE, vibrate);
        screenIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(context.getApplicationInfo().icon)
            .setContentTitle(title != null ? title : "Pump off due")
            .setContentText(body != null ? body : "Hopper pump-off is due now.")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setAutoCancel(false)
            .setOngoing(true)
            .addAction(0, "Stop alarm", stopPendingIntent(context, id))
            .setContentIntent(activityPendingIntent(context, id, screenIntent));

        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null) manager.notify(id, builder.build());
    }

    /**
     * Replaces the ongoing notification once the alarm has timed out. Plain and
     * dismissible: the pump-off still happened and nobody acknowledged it, which
     * is worth finding later, but it is no longer demanding attention.
     */
    static void showMissedNotification(Context context, int id, String title, String body) {
        ensureChannel(context);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(context.getApplicationInfo().icon)
            .setContentTitle(title != null ? title : "Pump off due")
            .setContentText(body != null ? body : "Hopper pump-off is due now.")
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setAutoCancel(true)
            .setOngoing(false)
            .setSilent(true);

        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null) manager.notify(id, builder.build());
    }

    private static PendingIntent stopPendingIntent(Context context, int id) {
        Intent stop = new Intent(context, PumpOffAlarmReceiver.class);
        stop.setAction(ACTION_STOP);
        stop.putExtra(EXTRA_ID, id);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        // A request code distinct from the alarm's own, so the two PendingIntents
        // for one id cannot collide and overwrite each other.
        return PendingIntent.getBroadcast(context, ~id, stop, flags);
    }

    private static PendingIntent activityPendingIntent(Context context, int id, Intent intent) {
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(context, id, intent, flags);
    }

    static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID, "Pump-off Alarms", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Full-screen pump-off alarms from Resin Tools' Timeline");
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[]{0, 500, 200, 500, 200, 800});
        manager.createNotificationChannel(channel);
    }
}
