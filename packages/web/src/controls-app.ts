/**
 * Fixture for `controls.test.ts`. See `button-app.ts`'s doc comment for why a real `@Component`
 * has to live in its own file rather than inside a `.test.ts` one.
 */
import { Component, signal } from '@angular/core';
import { ImageBackground, Pressable, Switch, Text, TextInput } from '@ng-native/components';

@Component({
  selector: 'app-root',
  imports: [ImageBackground, Pressable, Switch, Text, TextInput],
  template: `
    <text-input #field [(value)]="text" placeholder="Say something" />
    <switch #toggle [(checked)]="on" />
    <switch id="refusing" [(checked)]="kept" (checkedChange)="kept.set(false)" />
    <image-background
      [source]="{ uri: 'https://example.com/photo.png' }"
      [style.width.px]="120"
      [style.height.px]="80"
    />
    <text testID="terms" pressable [disabled]="off()">Terms</text>
    <text testID="wins" pressable [disabled]="off()" [aria-disabled]="!off()">Wins</text>
    <pressable testID="own" [disabled]="off()" [aria-disabled]="!off()" />
  `,
})
export class ControlsApp {
  readonly text = signal('');
  readonly on = signal(false);
  readonly kept = signal(false);
  readonly off = signal(true);
}
