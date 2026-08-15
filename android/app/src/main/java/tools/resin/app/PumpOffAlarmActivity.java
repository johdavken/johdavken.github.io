package tools.resin.app;

import android.app.NotificationManager;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;

/**
 * Full-screen, wakes-the-device pump-off alarm - the thing PumpOffAlarmReceiver's
 * full-screen-intent notification launches. Loops the device's default alarm
 * sound and vibrates continuously until the operator dismisses it or opens
 * the app, the same interaction shape as the stock Clock app's alarm screen.
 */
public class PumpOffAlarmActivity extends AppCompatActivity {
    private MediaPlayer mediaPlayer;
    private Vibrator vibrator;
    private int notificationId = 1;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            KeyguardManager keyguardManager = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            if (keyguardManager != null) keyguardManager.requestDismissKeyguard(this, null);
        } else {
            getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                    | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                    | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
                    | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }

        setContentView(R.layout.activity_pump_off_alarm);

        Intent intent = getIntent();
        notificationId = intent.getIntExtra(PumpOffAlarmReceiver.EXTRA_ID, 1);
        String title = intent.getStringExtra(PumpOffAlarmReceiver.EXTRA_TITLE);
        String body = intent.getStringExtra(PumpOffAlarmReceiver.EXTRA_BODY);
        ((TextView) findViewById(R.id.pumpOffAlarmTitle)).setText(title != null ? title : "Pump off due");
        ((TextView) findViewById(R.id.pumpOffAlarmBody)).setText(body != null ? body : "Hopper pump-off is due now.");

        findViewById(R.id.pumpOffAlarmDismissButton).setOnClickListener(v -> stopAlarmAndFinish());
        findViewById(R.id.pumpOffAlarmOpenButton).setOnClickListener(v -> {
            stopAlarmAndFinish();
            Intent openApp = new Intent(this, MainActivity.class);
            openApp.putExtra(MainActivity.EXTRA_OPEN_TIMELINE, true);
            openApp.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            startActivity(openApp);
        });

        String sound = intent.getStringExtra(PumpOffAlarmReceiver.EXTRA_SOUND);
        boolean vibrate = intent.getBooleanExtra(PumpOffAlarmReceiver.EXTRA_VIBRATE, true);
        startAlarm(sound, vibrate);
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.cancel(notificationId);
    }

    private void startAlarm(String soundUri, boolean vibrate) {
        try {
            Uri alarmSound;
            if (soundUri != null) {
                alarmSound = Uri.parse(soundUri);
            } else {
                alarmSound = RingtoneManager.getActualDefaultRingtoneUri(this, RingtoneManager.TYPE_ALARM);
                if (alarmSound == null) alarmSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            }
            mediaPlayer = new MediaPlayer();
            mediaPlayer.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build());
            mediaPlayer.setDataSource(this, alarmSound);
            mediaPlayer.setLooping(true);
            mediaPlayer.prepare();
            mediaPlayer.start();
        } catch (Exception ignored) {
            // Device has no alarm sound configured, or playback failed - vibration below still runs.
        }

        if (!vibrate) return;
        long[] pattern = {0, 800, 400};
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager vibratorManager = (VibratorManager) getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            vibrator = vibratorManager != null ? vibratorManager.getDefaultVibrator() : null;
        } else {
            vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        }
        if (vibrator != null && vibrator.hasVibrator()) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
            } else {
                vibrator.vibrate(pattern, 0);
            }
        }
    }

    private void stopAlarm() {
        if (mediaPlayer != null) {
            try { mediaPlayer.stop(); } catch (IllegalStateException ignored) {}
            mediaPlayer.release();
            mediaPlayer = null;
        }
        if (vibrator != null) vibrator.cancel();
    }

    private void stopAlarmAndFinish() {
        stopAlarm();
        finish();
    }

    @Override
    protected void onDestroy() {
        stopAlarm();
        super.onDestroy();
    }
}
