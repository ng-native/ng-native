import { Component, signal } from '@angular/core';
import type { Routes } from '@angular/router';
import { Text } from '../../components/src/text.ts';
import { NativeStackOutlet } from '../../router/src/native-stack-outlet.ts';

@Component({
  selector: 'x-shell',
  imports: [NativeStackOutlet],
  template: `<native-stack-outlet />`,
})
export class Shell {}

@Component({ selector: 'x-home', imports: [Text], template: `<text>home</text>` })
export class Home {}

@Component({ selector: 'x-list', imports: [Text], template: `<text>list</text>` })
export class List {}

/** A page that sets the bar on its own screen through a host binding. */
@Component({
  selector: 'x-video',
  imports: [Text],
  host: { '[statusBarStyle]': "'light'", '[statusBarHidden]': 'true' },
  template: `<text>video</text>`,
})
export class Video {}

/** A page whose own style is the one the app's claim resolves to when it opens. */
@Component({
  selector: 'x-reader',
  imports: [Text],
  host: { '[statusBarStyle]': "'dark'" },
  template: `<text>reader</text>`,
})
export class Reader {}

/** What the `x-own` page binds as its own style, set from the test. */
export const ownStyle = signal<string | undefined>('light');

/** A page whose own style can come and go. */
@Component({
  selector: 'x-own',
  imports: [Text],
  host: { '[statusBarStyle]': 'style()' },
  template: `<text>own</text>`,
})
export class Own {
  protected readonly style = ownStyle;
}

/** What the `x-own-status-bar` page binds as its own `statusBarStyle`, set from the test. */
export const ownStatusBarStyle = signal<string | undefined>(undefined);

/** What the `x-own-status-bar` page binds as its own `statusBarHidden`, set from the test. */
export const ownStatusBarHidden = signal<boolean | undefined>(undefined);

/** A page whose own status bar style and visibility can come and go. */
@Component({
  selector: 'x-own-status-bar',
  imports: [Text],
  host: { '[statusBarStyle]': 'style()', '[statusBarHidden]': 'hidden()' },
  template: `<text>own status bar</text>`,
})
export class OwnStatusBar {
  protected readonly style = ownStatusBarStyle;
  protected readonly hidden = ownStatusBarHidden;
}

/** What the `x-own-navigation-bar` page binds as its own `navigationBarHidden`, set from the test. */
export const ownNavigationBarHidden = signal<boolean | undefined>(undefined);

/** A page whose own navigation bar visibility can come and go. */
@Component({
  selector: 'x-own-navigation-bar',
  imports: [Text],
  host: { '[navigationBarHidden]': 'hidden()' },
  template: `<text>own navigation bar</text>`,
})
export class OwnNavigationBar {
  protected readonly hidden = ownNavigationBarHidden;
}

export const routes: Routes = [
  { path: '', component: Home },
  { path: 'photo', component: List },
  { path: 'list', component: List },
  { path: 'video', component: Video },
  { path: 'reader', component: Reader },
  { path: 'own', component: Own },
  { path: 'own-status-bar', component: OwnStatusBar },
  { path: 'own-navigation-bar', component: OwnNavigationBar },
];
