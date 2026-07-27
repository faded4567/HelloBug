# HelloBug Flutter App

This directory contains the HelloBug mobile client. The app pairs with a daemon running on a computer, then uses the configured relay to view and control coding-agent sessions.

## Run Locally

From this directory:

```bash
flutter pub get
flutter test
flutter run
```

The relay server and daemon must already be running. Follow the repository [quick start](../README.md#本地快速开始) for the complete setup and pairing flow.

For local server addresses, use `ws://10.0.2.2:3000/v1/relay` from an Android emulator, `ws://127.0.0.1:3000/v1/relay` from an iOS Simulator, or the development host's LAN address from a physical device.

The Android push integration requires a local `android/app/google-services.json` when testing real FCM delivery. Do not commit that file unless it is explicitly intended to be public.
