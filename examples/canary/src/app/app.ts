import { Component, inject } from '@angular/core';
import { SafeAreaProvider } from '@ng-native/components';
import { StatusBar } from '@ng-native/device';
import { NativeStackOutlet } from '@ng-native/router';
import { ToastHost } from './overlays/toast-host.ts';

/**
 * The shell. Every feature lives on its own routed screen, so each can be exercised in
 * isolation and every visit pushes and pops the native stack.
 */
@Component({
  selector: 'app-root',
  imports: [NativeStackOutlet, SafeAreaProvider, ToastHost],
  // The provider measures its own frame, so it has to be the thing filling the window. Nothing
  // needs it to inset a view - `<safe-area-view>` does that natively - only to read the numbers.
  template: `
    <safe-area-provider>
      <native-stack-outlet />
      <x-toast-host />
    </safe-area-provider>
  `,
  host: { class: 'screen' },
})
export class App {
  constructor() {
    // Dark text on the light palette, light text on the dark one, following the scheme and the
    // theme switch. A page can still push its own.
    inject(StatusBar).set({ style: 'auto' });
  }
}
