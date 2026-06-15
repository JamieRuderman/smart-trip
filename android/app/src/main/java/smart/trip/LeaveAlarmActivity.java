package smart.trip;

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
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

/**
 * Full-screen alarm shown when a Leave Alarm fires: rings on the alarm stream
 * (audible through silent / DND), shows the trip title, and offers Stop +
 * "View trip". Launched over the lock screen by the notifier's full-screen
 * intent. Auto-dismisses after a minute so it never rings forever.
 */
public class LeaveAlarmActivity extends AppCompatActivity {
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_STOP = "stop";
    static final String EXTRA_OPEN = "open";
    static final String ACTION_DISMISS = "smart.trip.action.LEAVE_ALARM_DISMISS";

    private static final long AUTO_DISMISS_MS = 60_000L;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private MediaPlayer player;
    private Vibrator vibrator;
    private BroadcastReceiver dismissReceiver;
    private String alarmId;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        showOverLockScreen();
        setContentView(R.layout.activity_leave_alarm);

        Intent intent = getIntent();
        alarmId = intent.getStringExtra(AlarmScheduler.EXTRA_ID);
        String title = orDefault(intent.getStringExtra(EXTRA_TITLE), "Time to leave");
        String stopLabel = orDefault(intent.getStringExtra(EXTRA_STOP), "Stop");
        String openLabel = intent.getStringExtra(EXTRA_OPEN);

        ((TextView) findViewById(R.id.leave_alarm_title)).setText(title);

        Button stopButton = findViewById(R.id.leave_alarm_stop);
        stopButton.setText(stopLabel);
        stopButton.setOnClickListener(v -> dismiss());

        Button openButton = findViewById(R.id.leave_alarm_open);
        if (openLabel != null && !openLabel.isEmpty()) {
            openButton.setText(openLabel);
            openButton.setOnClickListener(v -> {
                openApp();
                dismiss();
            });
        } else {
            openButton.setVisibility(View.GONE);
        }

        // The notification's Stop action broadcasts this so we silence too.
        dismissReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent received) {
                finish();
            }
        };
        ContextCompat.registerReceiver(
            this, dismissReceiver, new IntentFilter(ACTION_DISMISS), ContextCompat.RECEIVER_NOT_EXPORTED);

        startRinging();
        handler.postDelayed(this::dismiss, AUTO_DISMISS_MS);
    }

    private void showOverLockScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            if (km != null) km.requestDismissKeyguard(this, null);
        }
        getWindow().addFlags(
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);
    }

    private void startRinging() {
        try {
            Uri uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            if (uri == null) uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            if (uri != null) {
                player = new MediaPlayer();
                player.setDataSource(this, uri);
                player.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
                player.setLooping(true);
                player.prepare();
                player.start();
            }
        } catch (Exception ignored) {
            // No alarm tone available — vibration + the UI still alert.
        }
        startVibration();
    }

    private void startVibration() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                VibratorManager vm = (VibratorManager) getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
                vibrator = vm != null ? vm.getDefaultVibrator() : null;
            } else {
                vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            }
            if (vibrator == null || !vibrator.hasVibrator()) return;
            long[] pattern = { 0, 800, 800 };
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
            } else {
                vibrator.vibrate(pattern, 0);
            }
        } catch (Exception ignored) {
        }
    }

    private void openApp() {
        startActivity(new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP));
    }

    private void dismiss() {
        NotificationManagerCompat.from(this).cancel(AlarmNotifier.NOTIF_ID);
        if (alarmId != null) AlarmStore.remove(this, alarmId);
        finish();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (player != null) {
            try {
                player.stop();
            } catch (Exception ignored) {
            }
            player.release();
            player = null;
        }
        if (vibrator != null) {
            vibrator.cancel();
            vibrator = null;
        }
        if (dismissReceiver != null) {
            try {
                unregisterReceiver(dismissReceiver);
            } catch (Exception ignored) {
            }
            dismissReceiver = null;
        }
        super.onDestroy();
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        // Swallow Back — an alarm shouldn't be dismissible by accident.
    }

    private static String orDefault(String value, String fallback) {
        return value == null || value.isEmpty() ? fallback : value;
    }
}
