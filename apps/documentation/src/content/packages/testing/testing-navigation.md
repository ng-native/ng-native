---
title: Testing the router
summary: Pushing a screen on the native stack, route parameters as inputs, and native router features.
---

# Testing the router

Continues from [Writing a test](/packages/testing/writing-a-test). Routing works with the native
stack, the same providers the app uses, and `NativeStackOutlet` as the root. Pressing a
`nativeRouterLink` pushes the next screen:

```ts
import { Component, input } from '@angular/core';
import { withComponentInputBinding } from '@angular/router';
import { Pressable, Text } from '@ng-native/components';
import {
  NativeRouterLink,
  NativeStackOutlet,
  provideNativeRouter,
  withLinkParent,
} from '@ng-native/router';
import { render, screen, userEvent } from '@ng-native/testing';
import { expect, it } from 'vitest';

@Component({
  selector: 'app-home',
  imports: [NativeRouterLink, Pressable, Text],
  template: `
    <pressable accessibilityRole="button" nativeRouterLink="/about">
      <text>About us</text>
    </pressable>
  `,
})
class Home {}

@Component({ selector: 'app-about', imports: [Text], template: '<text>We make apps</text>' })
class About {}

@Component({
  selector: 'app-root',
  imports: [NativeStackOutlet],
  template: '<native-stack-outlet />',
})
class App {}

it('pushes a screen when a link is pressed', async () => {
  await render(App, {
    providers: [
      provideNativeRouter([
        { path: '', component: Home },
        { path: 'about', component: About },
      ]),
    ],
  });

  await userEvent.press(screen.getByRole('button', { name: 'About us' }));

  expect(await screen.findByText('We make apps')).toBeTruthy();
});
```

With eagerly declared routes the pushed screen is already there when the press resolves, but a
`loadComponent`, a guard or a resolver each put the screen a few tasks further away, and
`findByText` keeps working when a route gains one. A pushed screen stacks on top of the one before
it, as it does on a device, so the home screen is still in the tree afterwards: assert on what
arrived rather than on what left. The native stack's transition and its navigation bar are drawn
by the platform, and a test sees neither.

A page that takes a route parameter as an input needs `withComponentInputBinding()` in the test's
providers, the same as the app does, or the input is never set and a required one throws on first
render:

```ts
@Component({ selector: 'app-trip', imports: [Text], template: '<text>Trip {{ id() }}</text>' })
class Trip {
  readonly id = input.required<string>();
}

it("passes Angular's router features through, so a route parameter arrives as an input", async () => {
  await render(App, {
    providers: [
      provideNativeRouter(
        [
          { path: '', redirectTo: 'trip/lisbon', pathMatch: 'full' },
          { path: 'trip/:id', component: Trip },
        ],
        withComponentInputBinding(),
      ),
    ],
  });

  expect(await screen.findByText('Trip lisbon')).toBeTruthy();
});
```

`provideNativeRouter`'s native-specific features, such as `withLinkParent`, sit alongside Angular's
own router features in the same call, and both still route:

```ts
it('takes its native option as a feature beside Angular ones, and still routes', async () => {
  await render(App, {
    providers: [
      provideNativeRouter(
        [
          { path: '', component: Home },
          { path: 'about', component: About },
        ],
        withLinkParent((url) => (url.startsWith('/about/') ? '/about' : null)),
        withComponentInputBinding(),
      ),
    ],
  });

  await userEvent.press(screen.getByRole('button', { name: 'About us' }));

  expect(await screen.findByText('We make apps')).toBeTruthy();
});
```

## Following a deep link

`followLink(router, url, parentOf)` opens a link the way a deep link does, on top of the pages
`parentOf` puts beneath it. Pass the same function the app gives `withLinkParent`, then check the
parent is underneath as well as the page:

```ts
import { Router } from '@angular/router';
import { followLink, type LinkParent } from '@ng-native/router';

@Component({ selector: 'app-team', imports: [Text], template: '<text>Our team</text>' })
class Team {}

const linkParent: LinkParent = (url) => (url.startsWith('/about/') ? '/about' : null);

it('opens a link above the page it belongs under', async () => {
  const { componentRef } = await render(App, {
    providers: [
      provideNativeRouter(
        [
          { path: '', component: Home },
          { path: 'about', component: About },
          { path: 'about/team', component: Team },
        ],
        withLinkParent(linkParent),
      ),
    ],
  });

  await followLink(componentRef.injector.get(Router), '/about/team', linkParent);

  expect(await screen.findByText('Our team')).toBeTruthy();
  // The page it belongs under is on the stack beneath it, so Back has somewhere to go.
  expect(screen.getByText('We make apps')).toBeTruthy();
});
```

Give `provideNativeRouter` the same router features the app does - a test whose providers are
missing one the app declares will pass for routes that do not need it and fail, confusingly, only
on the ones that do.
