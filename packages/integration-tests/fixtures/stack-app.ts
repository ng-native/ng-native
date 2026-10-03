import { Component, DestroyRef, inject, input, signal } from '@angular/core';
import type { Routes } from '@angular/router';
import { Text } from '../../components/src/text.ts';
import { NativeStackOutlet } from '../../router/src/native-stack-outlet.ts';
import { reuseScreen } from '../../router/src/native-stack-reuse-strategy.ts';
import { NativeTab } from '../../router/src/native-tab.ts';
import { NativeTabsOutlet } from '../../router/src/native-tabs-outlet.ts';

/** Components alive now, by name, so a test can tell a new screen from an updated one. */
export const live: Record<string, number> = {};
/** Components ever created, by name. */
export const created: Record<string, number> = {};

function track(name: string): void {
  created[name] = (created[name] ?? 0) + 1;
  live[name] = (live[name] ?? 0) + 1;
  inject(DestroyRef).onDestroy(() => (live[name] = live[name]! - 1));
}

@Component({
  selector: 'x-shell',
  imports: [NativeStackOutlet],
  template: `<native-stack-outlet />`,
})
export class Shell {}

@Component({ selector: 'x-home', imports: [Text], template: `<text>home</text>` })
export class Home {}

/** A detail screen that links to another of its kind. */
@Component({ selector: 'x-user', imports: [Text], template: `<text>user {{ id() }}</text>` })
export class User {
  readonly id = input.required<string>();
  constructor() {
    track('User');
  }
}

/** The same shape, opted out of stacking: a param change updates the one screen in place. */
@Component({ selector: 'x-photo', imports: [Text], template: `<text>photo {{ index() }}</text>` })
export class Photo {
  readonly index = input.required<string>();
  constructor() {
    track('Photo');
  }
}

/** A page under a route with no component of its own, holding state a test can change. */
@Component({ selector: 'x-member', imports: [Text], template: `<text>member {{ note() }}</text>` })
export class Member {
  readonly note = signal('fresh');
  constructor() {
    track('Member');
    members.push(this);
  }
}

/** Every `Member` created, oldest first. */
export const members: Member[] = [];

/** A page in a group of routes with no component of its own. */
@Component({ selector: 'x-grouped', imports: [Text], template: `<text>grouped</text>` })
export class Grouped {
  constructor() {
    track('Grouped');
  }
}

/** A presented screen with no stack of its own. */
@Component({ selector: 'x-modal', imports: [Text], template: `<text>modal</text>` })
export class Modal {}

/** A presented screen that is a stack, so what it pushes goes inside it. */
@Component({
  selector: 'x-compose',
  imports: [NativeStackOutlet],
  template: `<native-stack-outlet />`,
})
export class Compose {}

@Component({ selector: 'x-compose-start', imports: [Text], template: `<text>start</text>` })
export class ComposeStart {}

@Component({ selector: 'x-compose-step', imports: [Text], template: `<text>step</text>` })
export class ComposeStep {}

/** A page whose first render throws, as a typo in a template does. */
@Component({ selector: 'x-broken', imports: [Text], template: `<text>{{ missing() }}</text>` })
export class Broken {
  protected readonly missing = undefined as unknown as () => string;
  constructor() {
    track('Broken');
  }
}

/** A stack whose own first screen is the one that throws. */
@Component({
  selector: 'x-broken-stack',
  imports: [NativeStackOutlet],
  template: `<native-stack-outlet />`,
})
export class BrokenStack {
  constructor() {
    track('BrokenStack');
  }
}

@Component({ selector: 'x-fine', imports: [Text], template: `<text>fine</text>` })
export class Fine {
  constructor() {
    track('Fine');
  }
}

/** A tab bar with one tab whose page throws. */
@Component({
  selector: 'x-bar',
  imports: [NativeTab, NativeTabsOutlet],
  template: `
    <native-tabs-outlet>
      <native-tab path="fine" title="Fine" />
      <native-tab path="broken" title="Broken" />
    </native-tabs-outlet>
  `,
})
export class Bar {}

@Component({ selector: 'x-schedule', imports: [Text], template: `<text>schedule</text>` })
export class Schedule {
  constructor() {
    track('Schedule');
  }
}

@Component({ selector: 'x-speakers', imports: [Text], template: `<text>speakers</text>` })
export class Speakers {
  constructor() {
    track('Speakers');
  }
}

/** A tab that is a stack of its own, so a switch away and back has screens to lose. */
@Component({
  selector: 'x-venues',
  imports: [NativeStackOutlet],
  template: `<native-stack-outlet />`,
})
export class Venues {
  constructor() {
    track('Venues');
  }
}

@Component({ selector: 'x-rooms', imports: [Text], template: `<text>rooms</text>` })
export class Rooms {}

@Component({ selector: 'x-room', imports: [Text], template: `<text>room {{ id() }}</text>` })
export class Room {
  readonly id = input.required<string>();
  constructor() {
    track('Room');
  }
}

/** A tab bar whose tabs are under routes with no component of their own, as Analog's are. */
@Component({
  selector: 'x-wrapped-bar',
  imports: [NativeTab, NativeTabsOutlet],
  template: `
    <native-tabs-outlet>
      <native-tab path="schedule" title="Schedule" />
      <native-tab path="speakers" title="Speakers" />
      <native-tab path="venues" title="Venues" />
    </native-tabs-outlet>
  `,
})
export class WrappedBar {}

export const routes: Routes = [
  { path: '', component: Home },
  {
    path: 'wrapped-tabs',
    component: WrappedBar,
    children: [
      { path: 'schedule', loadChildren: () => [{ path: '', component: Schedule }] },
      { path: '', children: [{ path: 'speakers', component: Speakers }] },
      {
        path: 'venues',
        loadChildren: () => [
          {
            path: '',
            component: Venues,
            children: [
              { path: '', component: Rooms },
              { path: ':id', component: Room },
            ],
          },
        ],
      },
    ],
  },
  {
    path: 'tabs',
    component: Bar,
    children: [
      { path: 'fine', component: Fine },
      { path: 'broken', component: Broken },
    ],
  },
  { path: 'user/:id', component: User },
  { path: 'member/:id', loadChildren: () => [{ path: '', component: Member }] },
  { path: '', children: [{ path: 'grouped', component: Grouped }] },
  reuseScreen({ path: 'photo/:index', component: Photo }),
  { path: 'modal', component: Modal },
  { path: 'broken', component: Broken },
  { path: 'broken-stack', component: BrokenStack, children: [{ path: '', component: Broken }] },
  {
    path: 'compose',
    component: Compose,
    children: [
      { path: '', component: ComposeStart },
      { path: 'step', component: ComposeStep },
    ],
  },
];
