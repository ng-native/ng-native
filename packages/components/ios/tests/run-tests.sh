#!/bin/bash
# Builds the unit tests of the iOS sources that run without React Native into an XCTest bundle
# and runs it with XCTest's own runner on a simulator: the one named by NGN_IOS_TEST_SIMULATOR
# (a UDID), or else the one booted simulator. Fails when there is none, or when any test fails.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
ios="$(dirname "$here")"
udid="${NGN_IOS_TEST_SIMULATOR:-}"
if [ -z "$udid" ]; then
  booted="$(xcrun simctl list devices booted -j | /usr/bin/python3 -c 'import json,sys; print("\n".join(d["udid"] for r in json.load(sys.stdin)["devices"].values() for d in r))')"
  if [ "$(printf '%s\n' "$booted" | grep -c .)" -ne 1 ]; then
    echo "run-tests.sh: boot one simulator, or name it with NGN_IOS_TEST_SIMULATOR" >&2
    exit 1
  fi
  udid="$booted"
fi

sdk="$(xcrun --sdk iphonesimulator --show-sdk-path)"
platform="$(xcrun --sdk iphonesimulator --show-sdk-platform-path)"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
bundle="$out/NgNativeComponentsTests.xctest"
mkdir -p "$bundle"
/usr/libexec/PlistBuddy -c 'Add :CFBundleIdentifier string dev.ngnative.components.tests' \
  -c 'Add :CFBundleExecutable string NgNativeComponentsTests' \
  -c 'Add :CFBundlePackageType string BNDL' "$bundle/Info.plist" >/dev/null

xcrun --sdk iphonesimulator clang++ -std=c++20 -fobjc-arc -fmodules -bundle \
  -target arm64-apple-ios16.4-simulator -isysroot "$sdk" \
  -I "$here/stubs" -F "$platform/Developer/Library/Frameworks" \
  -Xlinker -rpath -Xlinker "$platform/Developer/Library/Frameworks" \
  -framework XCTest -framework UIKit -framework CoreGraphics -framework QuartzCore -framework UniformTypeIdentifiers \
  "$here/NgNativeComponentsTests.mm" "$ios/NgNativeViewBinder.mm" "$ios/NgNativeMenuBuilding.mm" \
  "$ios/NgNativeResponderHooks.mm" "$ios/NgNativeUndoSteps.mm" "$ios/NgNativeDropItems.mm" \
  "$ios/NgNativeSplitViewDelegate.mm" \
  "$ios/NgNativeSceneKeys.mm" "$ios/NgNativePressMenu.mm" "$ios/NgNativeButtonMetrics.mm" \
  -o "$bundle/NgNativeComponentsTests"

xcrun simctl spawn "$udid" "$platform/Developer/Library/Xcode/Agents/xctest" "$bundle"
