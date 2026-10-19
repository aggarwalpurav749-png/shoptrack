#!/usr/bin/env bash
# Run after `npx cap add android`: permissions for GPS (also with the screen off) and the app name.
set -e
M=android/app/src/main/AndroidManifest.xml
add() { grep -q "$1" "$M" || sed -i "s#<application#$2\n    <application#" "$M"; }
add ACCESS_FINE_LOCATION '<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />'
add ACCESS_COARSE_LOCATION '<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />'
add ACCESS_BACKGROUND_LOCATION '<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />'
add FOREGROUND_SERVICE_LOCATION '<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />'
add 'permission.FOREGROUND_SERVICE"' '<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />'
add POST_NOTIFICATIONS '<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />'
echo "manifest patched"
