package io.github.talonhive.hub;

import android.os.Build;
import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(StepCounterPlugin.class);   // our hardware step counter (must be registered before super)
        super.onCreate(savedInstanceState);
        // Mining runs in the web view: keep its renderer at full priority even when the app isn't visible,
        // so Android doesn't freeze it while MiningService keeps mining going with the screen off.
        if (Build.VERSION.SDK_INT >= 26) {
            getBridge().getWebView().setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        }
    }

    // Going to the background pauses the web view's timers; undo that while mining runs in the background.
    @Override
    public void onPause() {
        super.onPause();
        keepWebViewRunning();
    }

    @Override
    public void onStop() {
        super.onStop();
        keepWebViewRunning();
    }

    private void keepWebViewRunning() {
        if (!MiningService.running || getBridge() == null) return;
        WebView w = getBridge().getWebView();
        w.onResume();
        w.resumeTimers();
    }
}
