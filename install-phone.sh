#!/usr/bin/env bash
#
# Build the Android app and (re)install it on the connected phone, then relaunch it.
# Requires: a phone on adb (USB debugging on) + Android Studio's bundled JDK.
#
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
ADB="$(command -v adb || echo "$HOME/Library/Android/sdk/platform-tools/adb")"
RELAY_PORT=8799

if ! "$ADB" get-state >/dev/null 2>&1; then
  echo "✗ No phone on adb. Plug it in, enable USB debugging, accept the prompt, and retry." >&2
  exit 1
fi

cd "$ROOT/android"
echo "› Building the app (first build can take a minute)…"
./gradlew :app:assembleDebug || { echo "✗ Build failed." >&2; exit 1; }

echo "› Installing on $("$ADB" devices | sed -n '2p' | cut -f1)…"
"$ADB" install -r app/build/outputs/apk/debug/app-debug.apk

echo "› Restoring the phone↔hub tunnel (adb reverse tcp:$RELAY_PORT)…"
"$ADB" reverse tcp:$RELAY_PORT tcp:$RELAY_PORT >/dev/null 2>&1 || true

echo "› Launching the app…"
"$ADB" shell am start -n com.agenticandroid/.MainActivity >/dev/null 2>&1 || true

echo
echo "✓ Installed + launched."
echo "  If the chat shows 'connecting…', make sure the Mac stack is up:  ./start.sh"
