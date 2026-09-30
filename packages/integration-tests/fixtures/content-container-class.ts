import { Component, signal } from '@angular/core';
import { KeyboardAvoidingView } from '../../components/src/keyboard-avoiding-view.ts';
import { ScrollView } from '../../components/src/scroll-view.ts';
import { Text } from '../../components/src/text.ts';

/**
 * Scroll views whose content containers take classes: one from the global sheet, one from this
 * component's own styles, and a list of them that changes at runtime.
 */
@Component({
  selector: 'x-content-container-class',
  imports: [KeyboardAvoidingView, ScrollView, Text],
  template: `
    <scroll-view testID="scroll" [contentContainerClass]="classes()">
      <text>Row</text>
    </scroll-view>
    <scroll-view
      testID="both"
      contentContainerClass="own"
      [contentContainerStyle]="{ paddingLeft: 1 }"
      horizontal
    >
      <text>Row</text>
    </scroll-view>
    <scroll-view testID="late" [contentContainerClass]="late()"><text>Row</text></scroll-view>
    <keyboard-avoiding-view
      testID="avoiding"
      [behavior]="behavior()"
      [contentContainerClass]="late()"
      [contentContainerStyle]="{ paddingTop: 1 }"
    >
      <text>Field</text>
    </keyboard-avoiding-view>
  `,
  styles: `
    .own {
      padding-left: 24px;
      column-gap: 8px;
    }
    view {
      opacity: 0.5;
    }
  `,
})
export class ContentContainerClass {
  readonly classes = signal('own global');
  readonly late = signal<string | undefined>(undefined);
  readonly behavior = signal<'position' | 'padding'>('position');
}
