package smart.trip;

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Register the local LeaveAlarm plugin (Android AlarmManager.setAlarmClock
        // counterpart to the iOS AlarmKit plugin) before the bridge loads.
        registerPlugin(LeaveAlarmPlugin.class);
        super.onCreate(savedInstanceState);
        // Enable edge-to-edge display
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
    }
}
