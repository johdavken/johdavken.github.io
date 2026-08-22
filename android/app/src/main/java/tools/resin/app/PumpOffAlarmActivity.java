package tools.resin.app;

import android.app.NotificationManager;
import android.app.KeyguardManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.view.WindowManager;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;

/**
 * Full-screen, wakes-the-device pump-off alarm - the thing PumpOffAlarmReceiver's
 * full-screen-intent notification launches. Loops the device's alarm sound and
 * vibrates, the same interaction shape as the stock Clock app's alarm screen.
 *
 * Ringing is tied to this screen actually being on display. That is the whole
 * point of the onStart/onStop pairing below, and it is a correctness fix
 * rather than a lifecycle nicety: audio used to start in onCreate and stop
 * only in onDestroy, so pressing Home left the loop playing with the activity
 * alive but invisible. The launching notification had already been cancelled
 * in onCreate and this activity is excludeFromRecents, so there was then
 * nothing left to tap and nothing in Recents - the alarm could not be
 * silenced short of force-stopping the app or rebooting the device.
 *
 * Three things now make that unreachable:
 *
 *   - audio and vibration run only between onStart and onStop, so an
 *     invisible alarm screen is always a silent one;
 *   - the notification is kept (as an ongoing one carrying a Stop alarm
 *     action) instead of being cancelled, so there is always a visible way
 *     back to this screen and a one-tap way to end it;
 *   - RING_TIMEOUT_MS stops the alarm on its own, so it can never ring
 *     indefinitely even if nobody is holding the phone.
 */
public class PumpOffAlarmActivity extends AppCompatActivity {
    /** How long the alarm may ring unattended before silencing itself. */
    static final long RING_TIMEOUT_MS = 5 * 60 * 1000L;

    private MediaPlayer mediaPlayer;
    private Vibrator vibrator;
    private int notificationId = 1;
    private String soundUri;
    private boolean vibrateEnabled = true;
    private boolean dismissed = false;
    private final Handler timeoutHandler = new Handler(Looper.getMainLooper());
    private final Runnable ringTimeout = this::timeOutAlarm;

    /**
     * The notification's Stop alarm action reaches this screen through
     * PumpOffAlarmReceiver, which rebroadcasts locally. It cannot simply stop
     * the player itself - the player belongs to this activity.
     */
    private final BroadcastReceiver stopRequestReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (intent == null) return;
            int id = intent.getIntExtra(PumpOffAlarmReceiver.EXTRA_ID, -1);
            // A second hopper's alarm must not silence this one.
            if (id == notificationId || id == -1) dismissAlarm();
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            KeyguardManager keyguardManager = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            if (keyguardManager != null) keyguardManager.requestDismissKeyguard(this, null);
            // Not covered by setTurnScreenOn, which only wakes the screen. Without
            // this the display can time out, which now stops the alarm.
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        } else {
            getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                    | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                    | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
                    | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }

        setContentView(R.layout.activity_pump_off_alarm);
        readAlarmIntent(getIntent());

        findViewById(R.id.pumpOffAlarmDismissButton).setOnClickListener(v -> {
            dismissAlarm();
            finish();
        });
        findViewById(R.id.pumpOffAlarmOpenButton).setOnClickListener(v -> {
            dismissAlarm();
            finish();
            Intent openApp = new Intent(this, MainActivity.class);
            openApp.putExtra(MainActivity.EXTRA_OPEN_TIMELINE, true);
            openApp.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            startActivity(openApp);
        });

        IntentFilter filter = new IntentFilter(PumpOffAlarmReceiver.ACTION_STOP_BROADCAST);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(stopRequestReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(stopRequestReceiver, filter);
        }
    }

    /** singleInstance + SINGLE_TOP means a re-launch lands here, not in onCreate. */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        readAlarmIntent(intent);
        // Tapping the notification for a still-undismissed alarm brings the
        // screen back, so it should be ringing again.
        dismissed = false;
    }

    private void readAlarmIntent(Intent intent) {
        if (intent == null) return;
        notificationId = intent.getIntExtra(PumpOffAlarmReceiver.EXTRA_ID, notificationId);
        String title = intent.getStringExtra(PumpOffAlarmReceiver.EXTRA_TITLE);
        String body = intent.getStringExtra(PumpOffAlarmReceiver.EXTRA_BODY);
        ((TextView) findViewById(R.id.pumpOffAlarmTitle)).setText(title != null ? title : "Pump off due");
        ((TextView) findViewById(R.id.pumpOffAlarmBody)).setText(body != null ? body : "Hopper pump-off is due now.");
        soundUri = intent.getStringExtra(PumpOffAlarmReceiver.EXTRA_SOUND);
        vibrateEnabled = intent.getBooleanExtra(PumpOffAlarmReceiver.EXTRA_VIBRATE, true);
        // Replaces the launching notification in place with an ongoing one
        // that cannot be swiped away and carries Stop alarm.
        PumpOffAlarmReceiver.showRingingNotification(this, notificationId, title, body, soundUri, vibrateEnabled);
    }

    @Override
    protected void onStart() {
        super.onStart();
        if (!dismissed) startAlarm();
    }

    @Override
    protected void onStop() {
        // The alarm is never audible without this screen on display.
        stopAlarm();
        super.onStop();
    }

    @Override
    protected void onDestroy() {
        stopAlarm();
        try { unregisterReceiver(stopRequestReceiver); } catch (IllegalArgumentException ignored) {}
        super.onDestroy();
    }

    private void startAlarm() {
        if (mediaPlayer != null) return;
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
            mediaPlayer = null;
        }

        if (vibrateEnabled) startVibration();

        timeoutHandler.removeCallbacks(ringTimeout);
        timeoutHandler.postDelayed(ringTimeout, RING_TIMEOUT_MS);
    }

    private void startVibration() {
        long[] pattern = {0, 800, 400};
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager vibratorManager = (VibratorManager) getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            vibrator = vibratorManager != null ? vibratorManager.getDefaultVibrator() : null;
        } else {
            vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        }
        if (vibrator == null || !vibrator.hasVibrator()) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
        } else {
            vibrator.vibrate(pattern, 0);
        }
    }

    private void stopAlarm() {
        timeoutHandler.removeCallbacks(ringTimeout);
        if (mediaPlayer != null) {
            try { mediaPlayer.stop(); } catch (IllegalStateException ignored) {}
            mediaPlayer.release();
            mediaPlayer = null;
        }
        if (vibrator != null) {
            vibrator.cancel();
            vibrator = null;
        }
    }

    /**
     * Ended on purpose: stop ringing, and take the notification away with it so
     * the alarm cannot be walked back into.
     */
    private void dismissAlarm() {
        dismissed = true;
        stopAlarm();
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.cancel(notificationId);
    }

    /**
     * Rang unattended for RING_TIMEOUT_MS. Stop the noise but leave a plain,
     * dismissible notification behind - a pump-off that nobody acknowledged is
     * exactly the thing an operator needs to find out about afterwards.
     */
    private void timeOutAlarm() {
        stopAlarm();
        dismissed = true;
        PumpOffAlarmReceiver.showMissedNotification(this, notificationId,
            ((TextView) findViewById(R.id.pumpOffAlarmTitle)).getText().toString(),
            ((TextView) findViewById(R.id.pumpOffAlarmBody)).getText().toString());
        finish();
    }
}
