import { Component, signal } from '@angular/core';
import type { CanActivateFn, Routes } from '@angular/router';
import { Sidebar } from '../../components/src/sidebar.ts';
import { SidebarSection } from '../../components/src/sidebar-section.ts';
import { SidebarItem } from '../../components/src/sidebar-item.ts';
import { SplitView } from '../../components/src/split-view.ts';
import { SidebarItemPath } from '../../router/src/sidebar-item-path.ts';

@Component({ selector: 'x-blank', template: '' })
class Blank {}

export const refuse = { now: false };
const guard: CanActivateFn = () => !refuse.now;

export const routes: Routes = [
  { path: '', component: Blank },
  { path: 'inbox', component: Blank },
  { path: 'mail/sent', component: Blank },
  { path: 'mail/sent/today', component: Blank },
  { path: 'mail', component: Blank },
  { path: 'locked', component: Blank, canActivate: [guard] },
  { path: 'elsewhere', component: Blank },
];

@Component({
  selector: 'x-sidebar-routes',
  imports: [Sidebar, SidebarItem, SplitView, SidebarItemPath],
  template: `
    <split-view>
      <sidebar>
        <sidebar-item testID="home" path="" label="Home" />
        <sidebar-item testID="inbox" path="inbox" label="Inbox" />
        <sidebar-item testID="mail" path="mail" label="Mail" />
        <sidebar-item testID="sent" path="mail/sent" label="Sent" />
        <sidebar-item testID="locked" path="locked" label="Locked" />
      </sidebar>
    </split-view>
  `,
})
export class Shell {}

/** Items an @for and an @if render, beside a static one in another section. */
@Component({
  selector: 'x-sidebar-routes-repeated',
  imports: [Sidebar, SidebarSection, SidebarItem, SplitView, SidebarItemPath],
  template: `
    <split-view>
      <sidebar>
        <sidebar-section>
          <sidebar-item testID="home" path="" label="Home" />
        </sidebar-section>
        <sidebar-section title="Mail">
          @for (item of items; track item.path) {
            <sidebar-item [testID]="item.path" [path]="item.path" [label]="item.label" />
          }
          @if (more()) {
            <sidebar-item testID="elsewhere" [path]="'elsewhere'" label="Elsewhere" />
          }
        </sidebar-section>
      </sidebar>
    </split-view>
  `,
})
export class RepeatedShell {
  protected readonly items = [
    { path: 'inbox', label: 'Inbox' },
    { path: 'mail', label: 'Mail' },
  ];
  readonly more = signal(true);
}
