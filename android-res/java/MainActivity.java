package io.github.talonhive.hub;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(StepCounterPlugin.class);   // our hardware step counter (must be registered before super)
        super.onCreate(savedInstanceState);
    }
}
