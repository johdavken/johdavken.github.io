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
    static final String EXTRA_ID = "id";
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_BODY = "body";
    static final String EXTRA_SOUND = "sound";
    static final String EXTRA_VIBRATE = "vibrate";

    @Override
    public void onReceive(Context context, Intent intent) {
        int id = intent.getIntExtra(EXTRA_ID, 1);
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
            .setAutoCancel(true)
            .setOngoing(false)
            .setFullScreenIntent(fullScreenPendingIntent, true)
            .setContentIntent(fullScreenPendingIntent);

        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null) manager.notify(id, builder.build());
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
