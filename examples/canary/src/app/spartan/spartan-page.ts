import { Component } from '@angular/core';
import { ScrollView } from '@ng-native/components';
import { NativeHeader } from '@ng-native/router';
import { SpartanButtons } from './spartan-buttons.ts';

/**
 * Spartan UI on the engine through `@ng-native/web-compat`, one component at a time: each section
 * is a component that is finished, with a test beside it.
 */
@Component({
  selector: 'app-spartan-page',
  imports: [NativeHeader, ScrollView, SpartanButtons],
  template: `
    <native-header title="Spartan UI" />
    <scroll-view contentInsetAdjustmentBehavior="automatic">
      <div class="spartan bg-background text-foreground flex flex-col gap-6 p-4">
        <h2 class="text-lg font-semibold">Button</h2>
        <app-spartan-buttons />
      </div>
    </scroll-view>
  `,
})
export class SpartanPage {}
