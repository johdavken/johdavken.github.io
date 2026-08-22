package tools.resin.app;

import android.app.AlarmManager;
import android.app.NotificationManager;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.provider.Settings;
import androidx.activity.result.ActivityResult;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * JS-facing bridge for full-screen, alarm-clock-style pump-off alerts.
 * A deliberately small surface (schedule/cancel plus the two
 * Android-version-gated permission checks a full-screen alarm needs) -
 * everything else about *which* hoppers are due stays in app.js, same
 * as it already does for the existing @capacitor/local-notifications path.
 */
@CapacitorPlugin(name = "PumpOffAlarm")
public class PumpOffAlarmPlugin extends Plugin {

    @PluginMethod
    public void schedule(PluginCall call) {
        JSArray notifications = call.getArray("notifications");
        if (notifications == null) { call.reject("notifications is required"); return; }
        AlarmManager alarmManager = (AlarmManager) getContext().getSystemService(android.content.Context.ALARM_SERVICE);
        if (alarmManager == null) { call.reject("AlarmManager unavailable"); return; }
        try {
            for (int i = 0; i < notifications.length(); i++) {
                JSONObject entry = notifications.getJSONObject(i);
                // Requiring these here keeps a malformed entry out of the
                // persisted store, which a reboot would otherwise replay.
                entry.getInt("id");
                entry.getLong("at");
                // Records as well as arms, so a reboot can put it back - see
                // PumpOffBootReceiver.
                PumpOffAlarmScheduler.schedule(getContext(), entry);
            }
            call.resolve();
        } catch (JSONException e) {
            call.reject("Invalid notification entry", e);
        }
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        JSArray notifications = call.getArray("notifications");
        if (notifications == null) { call.reject("notifications is required"); return; }
        NotificationManager notificationManager = (NotificationManager) getContext().getSystemService(android.content.Context.NOTIFICATION_SERVICE);
        try {
            for (int i = 0; i < notifications.length(); i++) {
                int id = notifications.getJSONObject(i).getInt("id");
                // Drops the persisted record along with the alarm; leaving it
                // behind would have a reboot resurrect a cancelled alarm.
                PumpOffAlarmScheduler.cancel(getContext(), id);
                if (notificationManager != null) notificationManager.cancel(id);
            }
            call.resolve();
        } catch (JSONException e) {
            call.reject("Invalid notification entry", e);
        }
    }

    /** Android 13+ per-app notification permission - same gate the full-screen intent notification itself needs. */
    @PluginMethod
    public void checkNotificationPermission(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
        call.resolve(result);
    }

    /** Android 12+ exact-alarm access; without it pump-off alarms still fire, just not necessarily on the exact minute. */
    @PluginMethod
    public void checkExactAlarmPermission(PluginCall call) {
        JSObject result = new JSObject();
        boolean granted = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            AlarmManager alarmManager = (AlarmManager) getContext().getSystemService(android.content.Context.ALARM_SERVICE);
            granted = alarmManager != null && alarmManager.canScheduleExactAlarms();
        }
        result.put("granted", granted);
        call.resolve(result);
    }

    @PluginMethod
    public void requestExactAlarmPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            try {
                Intent intent = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                    Uri.parse("package:" + getContext().getPackageName()));
                intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            } catch (Exception ignored) {
                // Some OEM settings apps don't implement this screen - the operator
                // can still find the equivalent toggle manually under App info.
            }
        }
        call.resolve();
    }

    /** Android 14+ can revoke full-screen-intent access independently of the notification permission itself. */
    @PluginMethod
    public void checkFullScreenIntentPermission(PluginCall call) {
        JSObject result = new JSObject();
        boolean granted = true;
        if (Build.VERSION.SDK_INT >= 34) {
            NotificationManager notificationManager = (NotificationManager) getContext().getSystemService(android.content.Context.NOTIFICATION_SERVICE);
            granted = notificationManager != null && notificationManager.canUseFullScreenIntent();
        }
        result.put("granted", granted);
        call.resolve(result);
    }

    @PluginMethod
    public void requestFullScreenIntentPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 34) {
            try {
                Intent intent = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,
                    Uri.parse("package:" + getContext().getPackageName()));
                intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            } catch (Exception ignored) {
                // Some OEM settings apps don't implement this screen - the operator
                // can still find the equivalent toggle manually under App info.
            }
        }
        call.resolve();
    }

    /** Whether the app was just launched by tapping "Open Resin.Tools" on the alarm screen. */
    @PluginMethod
    public void consumeLaunchIntent(PluginCall call) {
        JSObject result = new JSObject();
        boolean openTimeline = getActivity() != null
            && getActivity().getIntent() != null
            && getActivity().getIntent().getBooleanExtra(MainActivity.EXTRA_OPEN_TIMELINE, false);
        result.put("openTimeline", openTimeline);
        if (openTimeline) getActivity().getIntent().removeExtra(MainActivity.EXTRA_OPEN_TIMELINE);
        call.resolve(result);
    }

    /**
     * Opens the system ringtone picker scoped to alarm sounds. The picker's own
     * "Default" entry resolves to RingtoneManager's default-alarm sentinel URI,
     * not null - stored and reused as-is, so it keeps following the device's
     * system default alarm sound if that's ever changed later, same as never
     * having picked a sound at all.
     */
    @PluginMethod
    public void pickAlarmSound(PluginCall call) {
        Intent intent = new Intent(RingtoneManager.ACTION_RINGTONE_PICKER);
        intent.putExtra(RingtoneManager.EXTRA_RINGTONE_TYPE, RingtoneManager.TYPE_ALARM);
        intent.putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_DEFAULT, true);
        intent.putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_SILENT, false);
        Uri defaultUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        intent.putExtra(RingtoneManager.EXTRA_RINGTONE_DEFAULT_URI, defaultUri);
        String current = call.getString("uri");
        intent.putExtra(RingtoneManager.EXTRA_RINGTONE_EXISTING_URI, current != null ? Uri.parse(current) : defaultUri);
        startActivityForResult(call, intent, "pickAlarmSoundResult");
    }

    @ActivityCallback
    private void pickAlarmSoundResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject data = new JSObject();
        Intent resultData = result.getData();
        Uri uri = resultData != null ? resultData.getParcelableExtra(RingtoneManager.EXTRA_RINGTONE_PICKED_URI) : null;
        if (uri == null) {
            data.put("cancelled", true);
            call.resolve(data);
            return;
        }
        data.put("cancelled", false);
        data.put("uri", uri.toString());
        data.put("name", ringtoneName(uri));
        call.resolve(data);
    }

    private String ringtoneName(Uri uri) {
        if (uri.equals(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM))) return "Default alarm sound";
        try {
            Ringtone ringtone = RingtoneManager.getRingtone(getContext(), uri);
            String title = ringtone != null ? ringtone.getTitle(getContext()) : null;
            return title != null ? title : "Custom sound";
        } catch (Exception e) {
            return "Custom sound";
        }
    }

    /** Plays ~3s of the given (or device default) alarm sound plus one vibration pulse, so the operator can hear their choice without waiting for a real alarm. */
    @PluginMethod
    public void previewAlarmSound(PluginCall call) {
        String soundUri = call.getString("uri");
        boolean vibrate = call.getBoolean("vibrate", true);

        try {
            Uri sound = soundUri != null ? Uri.parse(soundUri) : RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            MediaPlayer player = new MediaPlayer();
            player.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build());
            player.setDataSource(getContext(), sound);
            player.prepare();
            player.start();
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                try { player.stop(); } catch (IllegalStateException ignored) {}
                player.release();
            }, 3000);
        } catch (Exception ignored) {
            // No alarm sound configured on this device - vibration below still previews.
        }

        if (vibrate) {
            Vibrator vibrator;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                VibratorManager vibratorManager = (VibratorManager) getContext().getSystemService(android.content.Context.VIBRATOR_MANAGER_SERVICE);
                vibrator = vibratorManager != null ? vibratorManager.getDefaultVibrator() : null;
            } else {
                vibrator = (Vibrator) getContext().getSystemService(android.content.Context.VIBRATOR_SERVICE);
            }
            if (vibrator != null && vibrator.hasVibrator()) {
                long[] pattern = {0, 800, 400};
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1));
                } else {
                    vibrator.vibrate(pattern, -1);
                }
            }
        }

        call.resolve();
    }
}
