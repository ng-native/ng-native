import { Component, signal } from '@angular/core';
import { Text } from '../../components/src/text.ts';
import { VisualEffect, type VisualEffectMaterial } from '../../components/src/visual-effect.ts';

@Component({
  selector: 'x-visual-effect',
  imports: [Text, VisualEffect],
  template: `
    <visual-effect
      testID="backdrop"
      [material]="material()"
      blendingMode="within-window"
      state="active"
      [emphasized]="emphasized()"
      [style]="{ flex: 1, borderRadius: 10, backgroundColor: '#f3f2f2' }"
    >
      <text testID="label">Inbox</text>
    </visual-effect>
    <visual-effect testID="plain" />
  `,
})
export class VisualEffectFixture {
  readonly material = signal<VisualEffectMaterial | undefined>('hud-window');
  readonly emphasized = signal(true);
}
