import { Component } from '@angular/core';
import { ScrollView } from '@ng-native/components';
import { NativeHeader } from '@ng-native/router';
import { SpartanAccordions } from './spartan-accordions.ts';
import { SpartanBadges } from './spartan-badges.ts';
import { SpartanButtons } from './spartan-buttons.ts';
import { SpartanCalendars } from './spartan-calendars.ts';
import { SpartanCards } from './spartan-cards.ts';
import { SpartanChecks } from './spartan-checks.ts';
import { SpartanCommands } from './spartan-commands.ts';
import { SpartanControls } from './spartan-controls.ts';
import { SpartanDialogs } from './spartan-dialogs.ts';
import { SpartanFeedback } from './spartan-feedback.ts';
import { SpartanGroups } from './spartan-groups.ts';
import { SpartanInputs } from './spartan-inputs.ts';
import { SpartanLayouts } from './spartan-layouts.ts';
import { SpartanMenus } from './spartan-menus.ts';
import { SpartanNavigation } from './spartan-navigation.ts';
import { SpartanOverlays } from './spartan-overlays.ts';
import { SpartanTables } from './spartan-tables.ts';
import { SpartanToggleGroups } from './spartan-toggle-groups.ts';
import { SpartanSheets } from './spartan-sheets.ts';
import { SpartanSliders } from './spartan-sliders.ts';
import { SpartanPickers } from './spartan-pickers.ts';
import { SpartanPrompts } from './spartan-prompts.ts';
import { SpartanSelects } from './spartan-selects.ts';
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
    SpartanCalendars,
    SpartanCards,
    SpartanCommands,
    SpartanGroups,
    SpartanChecks,
    SpartanControls,
    SpartanDialogs,
    SpartanFeedback,
    SpartanInputs,
    SpartanLayouts,
    SpartanMenus,
    SpartanPickers,
    SpartanNavigation,
    SpartanOverlays,
    SpartanPrompts,
    SpartanSelects,
    SpartanSheets,
    SpartanSliders,
    SpartanTables,
    SpartanToggleGroups,
    SpartanTabs,
  ],
  template: `
    <native-header title="Spartan UI" />
    <scroll-view contentInsetAdjustmentBehavior="automatic" automaticallyAdjustKeyboardInsets>
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
        <h2 class="text-lg font-semibold">Alert, progress, separator, skeleton</h2>
        <app-spartan-feedback />
        <h2 class="text-lg font-semibold">Popover and tooltip</h2>
        <app-spartan-overlays />
        <h2 class="text-lg font-semibold">Select</h2>
        <app-spartan-selects />
        <h2 class="text-lg font-semibold">Dropdown menu</h2>
        <app-spartan-menus />
        <h2 class="text-lg font-semibold">Slider</h2>
        <app-spartan-sliders />
        <h2 class="text-lg font-semibold">Toggle group and collapsible</h2>
        <app-spartan-toggle-groups />
        <h2 class="text-lg font-semibold">Sheet</h2>
        <app-spartan-sheets />
        <h2 class="text-lg font-semibold">Alert dialog, hover card, one-time code</h2>
        <app-spartan-prompts />
        <h2 class="text-lg font-semibold">Breadcrumb and pagination</h2>
        <app-spartan-navigation />
        <h2 class="text-lg font-semibold">Table and keys</h2>
        <app-spartan-tables />
        <h2 class="text-lg font-semibold">Command</h2>
        <app-spartan-commands />
        <h2 class="text-lg font-semibold">Calendar</h2>
        <app-spartan-calendars />
        <h2 class="text-lg font-semibold">Button group, input group, context menu</h2>
        <app-spartan-groups />
        <h2 class="text-lg font-semibold">Combobox, date picker, native select, menubar</h2>
        <app-spartan-pickers />
        <h2 class="text-lg font-semibold">Field, item, empty, aspect ratio</h2>
        <app-spartan-layouts />
        <h2 class="text-lg font-semibold">Toggle, radio group, textarea, avatar</h2>
        <app-spartan-controls />
      </div>
    </scroll-view>
  `,
})
export class SpartanPage {}
