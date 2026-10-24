/**
 * A service that gates a feature on the OS, under Vitest, where `react-native` cannot be imported
 * to read `Platform.OS`. `OS` and `OS_VERSION` are what it injects instead, and what a spec
 * provides to check the gate both ways.
 */
import { Service, inject } from '@angular/core';
import { OS, OS_VERSION } from '@ng-native/device';
import { describe, expect, it } from 'vitest';
import { injectService } from './index.ts';

/** Apple Foundation Models need iOS 26. */
@Service()
class Assistant {
  readonly available = inject(OS) === 'ios' && (inject(OS_VERSION) ?? 0) >= 26;
}

describe('the OS in a test', () => {
  it('is the platform the test renders as, iOS, with no version', () => {
    expect(injectService(OS)).toBe('ios');
    expect(injectService(OS_VERSION)).toBeNull();
  });

  it('is what a test provides', () => {
    const ios = [
      { provide: OS, useValue: 'ios' },
      { provide: OS_VERSION, useValue: 26 },
    ];
    expect(injectService(Assistant, { providers: ios }).available).toBe(true);

    // API level 36 is above 26, so a version check alone would read as true on Android.
    const android = [
      { provide: OS, useValue: 'android' },
      { provide: OS_VERSION, useValue: 36 },
    ];
    expect(injectService(OS, { providers: android })).toBe('android');
    expect(injectService(Assistant, { providers: android }).available).toBe(false);
  });
});
