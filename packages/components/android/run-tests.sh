#!/bin/bash
# Runs the JVM unit tests of the Android sources (android/src/test) with Gradle, through the
# canary's Android project, which links this package as `:ng-native-components`. Prebuilds that
# project first when examples/canary/android is not there. Needs JDK 17 and the Android SDK:
# JAVA_HOME and ANDROID_HOME, or Homebrew's openjdk@17 and Android Studio's SDK on a Mac.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
canary="$(cd "$here/../../../examples/canary" && pwd)"
if [ -z "${JAVA_HOME:-}" ] && [ -d /opt/homebrew/opt/openjdk@17 ]; then
  export JAVA_HOME=/opt/homebrew/opt/openjdk@17
fi
if [ -z "${ANDROID_HOME:-}" ] && [ -d "$HOME/Library/Android/sdk" ]; then
  export ANDROID_HOME="$HOME/Library/Android/sdk"
fi

if [ ! -f "$canary/android/gradlew" ]; then
  (cd "$canary" && npx expo prebuild --platform android --no-install)
fi

cd "$canary/android"
./gradlew :ng-native-components:testDebugUnitTest "$@"
