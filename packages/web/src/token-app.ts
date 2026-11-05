/**
 * Fixture for `token.test.ts` and `browser/token.test.ts`. See `button-app.ts` for why a `@Component` lives out here.
 */
import { Component, ElementRef, inject, signal } from '@angular/core';
import { Text, View } from '@ng-native/components';
import { injectToken } from '@ng-native/device';

/** A token read at its own host, which is not in the document yet when it is built. */
@Component({
  selector: 'app-scoped',
  imports: [Text],
  template: `<text>{{ accent() ?? 'none' }}</text>`,
})
export class ScopedToken {
  readonly accent = injectToken('--accent', { at: inject(ElementRef).nativeElement });
}

@Component({
  selector: 'app-root',
  imports: [Text, View, ScopedToken],
  template: `
    <text>{{ accent() ?? 'none' }}</text>
    <view class="local">
      @if (scoped()) {
        <app-scoped />
      }
    </view>
  `,
})
export class TokenApp {
  readonly accent = injectToken('--accent');
  readonly scoped = signal(false);
}
