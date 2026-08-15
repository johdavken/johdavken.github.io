package tools.resin.app;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    public static final String EXTRA_OPEN_TIMELINE = "open_timeline";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PumpOffAlarmPlugin.class);
        super.onCreate(savedInstanceState);
    }

    // singleTask launchMode means an already-running instance is reused via
    // onNewIntent rather than a fresh onCreate - without this, tapping
    // "Open Resin.Tools" on the alarm screen while the app was already
    // running would leave getIntent() pointing at the old (stale) launch
    // intent, and PumpOffAlarmPlugin.consumeLaunchIntent() would never see
    // the EXTRA_OPEN_TIMELINE flag from the new one.
    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
    }
}
