import { Component } from '@angular/core';
import { ScrollView } from '@ng-native/components';
import { NativeHeader } from '@ng-native/router';
import { SpartanAccordions } from './spartan-accordions.ts';
import { SpartanBadges } from './spartan-badges.ts';
import { SpartanButtons } from './spartan-buttons.ts';
import { SpartanCards } from './spartan-cards.ts';
import { SpartanChecks } from './spartan-checks.ts';
import { SpartanDialogs } from './spartan-dialogs.ts';
import { SpartanInputs } from './spartan-inputs.ts';
import { SpartanTabs } from './spartan-tabs.ts';

/**
 * Spartan UI on the engine through `@ng-native/web-compat`, one component at a time: each section
 * is a component that is finished, with a test beside it.
 */
@Component({
  selector: 'app-spartan-page',
  imports: [
    NativeHeader,
    ScrollView,
    SpartanAccordions,
    SpartanBadges,
    SpartanButtons,
    SpartanCards,
    SpartanChecks,
    SpartanDialogs,
    SpartanInputs,
    SpartanTabs,
  ],
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
        <h2 class="text-lg font-semibold">Checkbox and switch</h2>
        <app-spartan-checks />
        <h2 class="text-lg font-semibold">Tabs</h2>
        <app-spartan-tabs />
        <h2 class="text-lg font-semibold">Accordion</h2>
        <app-spartan-accordions />
        <h2 class="text-lg font-semibold">Dialog</h2>
        <app-spartan-dialogs />
      </div>
    </scroll-view>
  `,
})
export class SpartanPage {}
