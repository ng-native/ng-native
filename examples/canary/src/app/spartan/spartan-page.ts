import { Component } from '@angular/core';
import { ScrollView } from '@ng-native/components';
import { NativeHeader } from '@ng-native/router';
import { SpartanBadges } from './spartan-badges.ts';
import { SpartanButtons } from './spartan-buttons.ts';
import { SpartanCards } from './spartan-cards.ts';
import { SpartanInputs } from './spartan-inputs.ts';

/**
 * Spartan UI on the engine through `@ng-native/web-compat`, one component at a time: each section
 * is a component that is finished, with a test beside it.
 */
@Component({
  selector: 'app-spartan-page',
  imports: [NativeHeader, ScrollView, SpartanBadges, SpartanButtons, SpartanCards, SpartanInputs],
  template: `
    <native-header title="Spartan UI" />
    <scroll-view contentInsetAdjustmentBehavior="automatic">
      <div class="spartan bg-background text-foreground flex flex-col gap-6 p-4">
        <h2 class="text-lg font-semibold">Button</h2>
        <app-spartan-buttons />
        <h2 class="text-lg font-semibold">Badge</h2>
        <app-spartan-badges />
        <h2 class="text-lg font-semibold">Card</h2>
        <app-spartan-cards />
        <h2 class="text-lg font-semibold">Input</h2>
        <app-spartan-inputs />
      </div>
    </scroll-view>
  `,
})
export class SpartanPage {}
