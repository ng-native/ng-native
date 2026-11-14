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
        'expo-camera',
        ['some-other-plugin', { microphonePermission: 'Not an Expo option.' }],
      ],
    });
    assert.deepEqual(usageStrings, {
      NSMicrophoneUsageDescription: 'From expo-audio.',
      NSLocationWhenInUseUsageDescription: 'To show nearby places.',
      NSCalendarsFullAccessUsageDescription: 'To add events.',
    });
    assert.deepEqual(sandboxEntitlements, [
      'com.apple.security.device.audio-input',
      'com.apple.security.personal-information.calendars',
      'com.apple.security.personal-information.location',
    ]);
  });

  it('leaves out a permission a plugin option turns off with false', () => {
    const { usageStrings } = macosPermissions({
      ios: { infoPlist: { NSCameraUsageDescription: 'Camera.' } },
      plugins: [['expo-image-picker', { cameraPermission: false, photosPermission: 'Photos.' }]],
    });
    assert.deepEqual(usageStrings, { NSPhotoLibraryUsageDescription: 'Photos.' });
  });

  it('declares nothing for an app that asks for nothing', () => {
    assert.deepEqual(macosPermissions({}), { usageStrings: {}, sandboxEntitlements: [] });
  });
});
