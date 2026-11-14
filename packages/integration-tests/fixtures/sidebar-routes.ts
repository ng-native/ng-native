import { Component } from '@angular/core';
import type { CanActivateFn, Routes } from '@angular/router';
import { Sidebar } from '../../components/src/sidebar.ts';
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
