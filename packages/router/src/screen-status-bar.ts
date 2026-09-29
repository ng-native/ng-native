import { InjectionToken, type Provider } from '@angular/core';
import { StatusBar, type StatusBarSource, type StatusBarState } from '@ng-native/device';
import { nativePlatform } from '@ng-native/fabric';

const STYLES = { default: 'auto', light: 'light', dark: 'dark' } as const;

export const SCREEN_STATUS_BAR = new InjectionToken<boolean>('angular-native.screenStatusBar', {
  factory: () => nativePlatform() === 'ios',
});

export function screenStatusBarProps(state: StatusBarState): Record<string, unknown> {
  return {
    statusBarStyle: state.style && STYLES[state.style],
    statusBarHidden: state.hidden,
    statusBarAnimation: state.hidden === undefined ? undefined : state.animated ? 'fade' : 'none',
  };
}

const onScreens: StatusBarSource = {
  setStyle: () => {},
  setHidden: () => {},
  setBackgroundColor: () => {},
  setTranslucent: () => {},
  height: undefined,
};

export function provideScreenStatusBar(): Provider[] {
  return nativePlatform() === 'ios' ? [{ provide: StatusBar.SOURCE, useValue: onScreens }] : [];
}
