import { Component, signal } from '@angular/core';
import { View } from '../../components/src/view.ts';

@Component({
  selector: 'x-accessibility-events',
  imports: [View],
  template: `
    <view
      testID="box"
      [accessibilityActions]="[{ name: 'activate' }, { name: 'archive', label: 'Archive' }]"
      (accessibilityAction)="log('action ' + $any($event).nativeEvent.actionName)"
      (accessibilityTap)="log('tap')"
      (magicTap)="log('magicTap')"
      (accessibilityEscape)="log('escape')"
    ></view>
    <view testID="plain"></view>
  `,
})
export class AccessibilityEvents {
  readonly heard = signal<string[]>([]);
  log(name: string): void {
    this.heard.update((all) => [...all, name]);
  }
}
