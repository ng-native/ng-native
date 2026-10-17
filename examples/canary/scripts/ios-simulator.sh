#!/usr/bin/env bash
# A simulator of its own for a CI run, sourced by smoke-ios.sh and visual-ios.sh: the newest iPhone
# on the newest iOS runtime installed, booted, and deleted when the script that sourced this exits.
# Sets `udid`, and defines `step` and `boot_phases` for the script to go on with.
#
#     source "$(dirname "$0")/ios-simulator.sh" <name>
#
# With `UDID` set, that simulator is used as it is, booted already by whoever made it. With
# `KEEP_SIMULATOR` set, the one made is left booted when the script exits. Run on its
# own with `--which`, it prints the runtime and the device type it would make one of, which is part
# of what a screenshot recorded on it is cached by.

# The newest runtime's first iPhone: every runtime ships a set of devices made for it.
read -r runtime type < <(xcrun simctl list devices available -j | jq -r '
  .devices | to_entries | map(select(.key | test("iOS"))) | sort_by(.key) | last
  | "\(.key) \(.value | map(select(.name | startswith("iPhone"))) | first | .deviceTypeIdentifier)"')
if [ -z "${runtime:-}" ] || [ -z "${type:-}" ] || [ "$type" = null ]; then
  echo "No iOS runtime with an iPhone simulator found (or jq is missing): see xcrun simctl list" >&2
  exit 1
fi
# Booting and the driver's start are minutes of a run with nothing to print, so each step says
# when it starts.
if [ "${1:-}" = --which ]; then
  echo "$runtime $type"
  exit 0
fi
step() { echo "[$(date +%T)] $*"; }
# What a boot is waiting on, each time that changes. bootstatus repeats itself every second, and a
# new simulator's first boot is minutes of one-time setup on a CI Mac: this says which part.
boot_phases() {
  local line waiting='' reason=''
  while read -r line; do
    case $line in
      Waiting\ on* | Finished)
        if [ "$line" != "$waiting" ]; then step "boot: $line"; fi
        waiting=$line
        ;;
      Reason:*)
        if [ "$line" != "$reason" ]; then step "boot: $line"; fi
        reason=$line
        ;;
    esac
  done
}
if [ -n "${UDID:-}" ]; then
  udid=$UDID
  return 0
fi
step "creating a $type on $runtime"
udid=$(xcrun simctl create "$1" "$type" "$runtime") || exit 1
# Kept where `KEEP_SIMULATOR` is set: CI boots one while the app builds, for the steps after.
[ -n "${KEEP_SIMULATOR:-}" ] || trap 'xcrun simctl shutdown "$udid" 2>/dev/null; xcrun simctl delete "$udid"' EXIT

step "booting it"
xcrun simctl boot "$udid" && xcrun simctl bootstatus "$udid" -b | boot_phases || exit 1
# A fresh simulator posts follow-up notifications of its own, "Ready for Apple Intelligence" among
# them, at any point after it boots. The banner covers the top of the screen, so
# a tap on a header button lands on the banner and opens Settings over the app. followupd posts
# them, so it is stopped here, and stays disabled when the retry below reboots the simulator.
xcrun simctl spawn "$udid" launchctl disable system/com.apple.followupd 2>/dev/null
xcrun simctl spawn "$udid" launchctl bootout system/com.apple.followupd 2>/dev/null
# The keyboard's suggestions are of whatever was typed on the simulator before, so a screenshot with
# the keyboard up differs between runs by them: predictions, and the corrections that come with
# them, are turned off.
for key in KeyboardPrediction KeyboardShowPredictionBar KeyboardAutocorrection KeyboardCheckSpelling; do
  xcrun simctl spawn "$udid" defaults write com.apple.Preferences "$key" -bool NO
done
