import { Component } from '@angular/core';
import { HlmTabsImports } from './helm/tabs';

/** Spartan UI's tabs: a list of triggers, one panel shown at a time, and a disabled trigger. */
@Component({
  selector: 'app-spartan-tabs',
  imports: [HlmTabsImports],
  host: { class: 'spartan flex flex-col gap-3' },
  template: `
    <hlm-tabs tab="account" testID="tabs">
      <hlm-tabs-list testID="list">
        <button hlmTabsTrigger="account" testID="account-tab">Account</button>
        <button hlmTabsTrigger="password" testID="password-tab">Password</button>
        <button hlmTabsTrigger="billing" testID="billing-tab" disabled>Billing</button>
      </hlm-tabs-list>
      <div hlmTabsContent="account" testID="account-panel"><p>Account settings.</p></div>
      <div hlmTabsContent="password" testID="password-panel"><p>Change your password.</p></div>
      <div hlmTabsContent="billing" testID="billing-panel"><p>Billing details.</p></div>
    </hlm-tabs>
  `,
})
export class SpartanTabs {}
