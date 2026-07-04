#!/usr/bin/env bash
set -euo pipefail

LAT="${RIDER_TEST_LAT:-28.666662}"
LNG="${RIDER_TEST_LNG:-77.274517}"
APP_DIR="${RIDER_APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../app" && pwd)}"
API_BASE_URL="${API_BASE_URL:-http://10.0.2.2:3000}"
EMULATOR_NAME="${ANDROID_EMULATOR_NAME:-}"

if ! command -v adb >/dev/null 2>&1; then
  echo "adb not found. Install Android platform-tools or add adb to PATH."
  exit 1
fi

if ! command -v flutter >/dev/null 2>&1; then
  echo "flutter not found. Install Flutter or add flutter to PATH."
  exit 1
fi

if ! command -v emulator >/dev/null 2>&1; then
  echo "emulator command not found. Add Android emulator tools to PATH."
  echo "Example: export PATH=\"\$ANDROID_HOME/emulator:\$ANDROID_HOME/platform-tools:\$PATH\""
  exit 1
fi

if [ ! -d "$APP_DIR" ]; then
  echo "Flutter app directory not found: $APP_DIR"
  echo "Set RIDER_APP_DIR=/path/to/app if your app is elsewhere."
  exit 1
fi

running_device="$(adb devices | awk 'NR > 1 && $2 == "device" { print $1; exit }')"

if [ -z "$running_device" ]; then
  if [ -z "$EMULATOR_NAME" ]; then
    EMULATOR_NAME="$(emulator -list-avds | head -n 1)"
  fi

  if [ -z "$EMULATOR_NAME" ]; then
    echo "No Android emulator is running and no AVD was found."
    echo "Create an AVD in Android Studio, or set ANDROID_EMULATOR_NAME=<avd-name>."
    exit 1
  fi

  echo "Starting emulator: $EMULATOR_NAME"
  nohup emulator -avd "$EMULATOR_NAME" >/tmp/zipply-rider-emulator.log 2>&1 &
else
  echo "Using running Android device/emulator: $running_device"
fi

echo "Waiting for emulator/device..."
adb wait-for-device

echo "Waiting for Android boot completion..."
until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do
  sleep 2
done

echo "Unlocking screen..."
adb shell input keyevent 82 >/dev/null 2>&1 || true

echo "Setting rider GPS to lat=$LAT lng=$LNG"
# adb emu geo fix expects longitude first, then latitude.
adb emu geo fix "$LNG" "$LAT" >/dev/null

echo "Launching Flutter rider app from: $APP_DIR"
cd "$APP_DIR"
flutter pub get
flutter run --dart-define=API_BASE_URL="$API_BASE_URL"
