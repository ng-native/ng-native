import { Component } from '@angular/core';
import { ScrollView } from '@ng-native/components';
import { NativeHeader } from '@ng-native/router';
import { TuiRoot } from '@taiga-ui/core/components/root';
import { HelpSection } from './help-section.ts';
import { PlanPicker } from './plan-picker.ts';
import { ProfileForm } from './profile-form.ts';

/**
 * The one screen: an account's profile, plan and help, in Taiga's components. `tui-root` is
 * what Taiga's dialogs, dropdowns and alerts are presented in, so it holds the whole screen.
 */
@Component({
  selector: 'app-account-page',
  imports: [HelpSection, NativeHeader, PlanPicker, ProfileForm, ScrollView, TuiRoot],
  styles: `
    /*
     * Taiga sets its type with font shorthands of its tokens, which the engine cannot split on
     * a device, so the face and size its body text has are set here, for every text to inherit.
     */
    tui-root {
      flex: 1;
      font-family: 'Manrope';
      font-size: 16px;
      line-height: 24px;
      color: var(--tui-text-primary);
    }
    .content {
      padding: 16px;
      gap: 24px;
    }
    h2 {
      font-size: 20px;
      line-height: 24px;
      font-weight: 700;
      margin: 0 0 12px;
    }
  `,
  template: `
    <native-header title="Account" />
    <tui-root>
      <scroll-view contentContainerClass="content" keyboardShouldPersistTaps="handled">
        <section>
          <h2>Profile</h2>
          <app-profile-form />
        </section>
        <section>
          <h2>Subscription</h2>
          <app-plan-picker />
        </section>
        <section>
          <h2>Help</h2>
          <app-help-section />
        </section>
      </scroll-view>
    </tui-root>
  `,
})
export class AccountPage {}
