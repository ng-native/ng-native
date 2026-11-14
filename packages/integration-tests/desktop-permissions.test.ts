/**
 * Permissions on macOS come from the Expo keys an app sets for iOS (decision 9): the usage strings
 * in `ios.infoPlist` and each `expo-*` plugin's permission option. Nothing is declared twice.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { macosPermissions } from '@ng-native/device';

describe('macOS permissions from the Expo keys', () => {
  it('takes the usage strings set in ios.infoPlist', () => {
    const { usageStrings, sandboxEntitlements } = macosPermissions({
      ios: {
        infoPlist: {
          NSMicrophoneUsageDescription: 'To record voice notes.',
          NSCameraUsageDescription: 'To scan documents.',
          UIBackgroundModes: ['audio'],
          NSEmptyUsageDescription: '',
        },
      },
    });
    assert.deepEqual(usageStrings, {
      NSMicrophoneUsageDescription: 'To record voice notes.',
      NSCameraUsageDescription: 'To scan documents.',
    });
    assert.deepEqual(sandboxEntitlements, [
      'com.apple.security.device.audio-input',
      'com.apple.security.device.camera',
    ]);
  });

  it("takes each plugin's permission option, which wins over infoPlist", () => {
    const { usageStrings, sandboxEntitlements } = macosPermissions({
      ios: { infoPlist: { NSMicrophoneUsageDescription: 'From infoPlist.' } },
      plugins: [
        ['expo-audio', { microphonePermission: 'From expo-audio.' }],
        ['expo-location', { locationWhenInUsePermission: 'To show nearby places.' }],
        ['expo-calendar', { calendarPermission: 'To add events.' }],
        ['some-other-plugin', { microphonePermission: 'Not an Expo option.' }],
      ],
    });
    assert.equal(usageStrings['NSMicrophoneUsageDescription'], 'From expo-audio.');
    assert.equal(usageStrings['NSLocationWhenInUseUsageDescription'], 'To show nearby places.');
    assert.equal(usageStrings['NSCalendarsFullAccessUsageDescription'], 'To add events.');
    assert.equal(usageStrings['NSCalendarsUsageDescription'], 'To add events.');
    assert.deepEqual(sandboxEntitlements, [
      'com.apple.security.device.audio-input',
      'com.apple.security.personal-information.calendars',
      'com.apple.security.personal-information.location',
    ]);
  });

  it("writes a plugin's own default strings where it is listed with no option, as on iOS", () => {
    // macOS ends an app that asks for the camera with no usage string, so a bare plugin needs them.
    const { usageStrings, sandboxEntitlements } = macosPermissions({
      name: 'Notes',
      ios: { infoPlist: { NSMicrophoneUsageDescription: 'From infoPlist.' } },
      plugins: ['expo-camera', ['expo-calendar', { writeOnlyAccess: true }]],
    });
    assert.deepEqual(usageStrings, {
      NSCameraUsageDescription: 'Allow Notes to access your camera',
      NSMicrophoneUsageDescription: 'From infoPlist.',
      NSCalendarsUsageDescription: 'Allow Notes to access your calendars',
      NSCalendarsWriteOnlyAccessUsageDescription: 'Allow Notes to add events to your calendars',
      NSRemindersUsageDescription: 'Allow Notes to access your reminders',
      NSRemindersFullAccessUsageDescription: 'Allow Notes to access your reminders',
    });
    assert.deepEqual(sandboxEntitlements, [
      'com.apple.security.device.audio-input',
      'com.apple.security.device.camera',
      'com.apple.security.personal-information.calendars',
    ]);
  });

  it('puts the app name in place of $(PRODUCT_NAME), which no Xcode build fills in here', () => {
    const { usageStrings } = macosPermissions({
      name: 'Notes',
      ios: { infoPlist: { NSCameraUsageDescription: '$(PRODUCT_NAME) scans documents.' } },
    });
    assert.deepEqual(usageStrings, { NSCameraUsageDescription: 'Notes scans documents.' });
  });

  it('leaves out a permission a plugin option turns off with false', () => {
    const { usageStrings } = macosPermissions({
      ios: { infoPlist: { NSCameraUsageDescription: 'Camera.' } },
      plugins: [['expo-image-picker', { cameraPermission: false, photosPermission: 'Photos.' }]],
    });
    assert.equal(usageStrings['NSCameraUsageDescription'], undefined);
    assert.equal(usageStrings['NSPhotoLibraryUsageDescription'], 'Photos.');
  });

  it('declares nothing for an app that asks for nothing', () => {
    assert.deepEqual(macosPermissions({}), { usageStrings: {}, sandboxEntitlements: [] });
  });
});
