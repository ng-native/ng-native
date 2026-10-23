/**
 * Fixture for `defer-triggers.test.ts`. See `button-app.ts` for why a `@Component` lives out here.
 */
import { Component, signal } from '@angular/core';
import { Pressable, Text, TextInput, View } from '@ng-native/components';

@Component({
  selector: 'app-root',
  imports: [Pressable, Text, TextInput, View],
  template: `
    <pressable #trigger id="trigger"><text>open</text></pressable>
    @defer (on interaction(trigger)) {
      <text>interaction loaded</text>
    } @placeholder {
      <text>interaction waiting</text>
    }

    @defer (on hover) {
      <text>hover loaded</text>
    } @placeholder {
      <view id="hover-target"><text>hover waiting</text></view>
    }

    <view [style]="{ height: 3000 }"></view>
    @defer (on viewport) {
      <text>viewport loaded</text>
    } @placeholder {
      <view id="spot"><text>viewport waiting</text></view>
    }

    <text-input #field id="field" [multiline]="multiline()" />
    @defer (on interaction(field)) {
      <text>field loaded</text>
    } @placeholder {
      <text>field waiting</text>
    }

    <view [style]="{ height: 3000 }"></view>
    <text-input #seen id="seen" [multiline]="multiline()" />
    @defer (on viewport(seen)) {
      <text>seen loaded</text>
    } @placeholder {
      <text>seen waiting</text>
    }
  `,
})
export class DeferTriggersApp {
  /** Swaps each text-input's element for a `<textarea>`, with the triggers already on it. */
  readonly multiline = signal(false);
}
