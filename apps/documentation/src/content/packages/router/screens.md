---
title: Screens and navigation
summary: Pushing, replacing, presenting and resetting a native stack through NativeNavigation.
---

# Screens and navigation

<!-- api: NativeStackOutlet -->

`<native-stack-outlet>` is a `RouterOutlet` that renders a real stack instead of swapping one view
for another: each activated route's component is created on its own screen, and screens below the
top stay mounted so their native state survives a push. `nativeRouterLink` covers a plain push;
for replacing, presenting or resetting, inject `NativeNavigation`, a small typed layer over
`Router.navigate()` that still leaves the router as the source of truth.

<!-- api: NativeRouterLink -->

<!-- api: NativeNavigation -->

```ts
import { Component, inject } from '@angular/core';
import { NativeNavigation } from '@ng-native/router';

@Component({ selector: 'app-editor', template: `...` })
export class Editor {
  private readonly nav = inject(NativeNavigation);

  protected push(): void {
    void this.nav.push('/detail');
  }

  protected presentSheet(): void {
    void this.nav.present('/filters', {
      as: 'formSheet',
      presentation: { sheetAllowedDetents: [0.5, 1], sheetGrabberVisible: true },
    });
  }

  protected finishOnboarding(): void {
    // Every screen below is destroyed - there is nothing left to go back to.
    void this.nav.reset('/');
  }

  protected back(): void {
    this.nav.back();
  }
}
```

Because `present()`, `push()` and `replace()` are all just `Router.navigate()` underneath, with the
extra intent riding on `NavigationExtras.state`, guards and resolvers still run and a deep link
still lands correctly - a presented screen going back restores the same presentation it was opened
with, because it rode in history state along with everything else.

A push or a presentation asked for while the app's first screen is still loading, such as a
lazily loaded root route waiting on its import when a notification is tapped at launch, waits for
that screen and goes above it, so Back returns to it. `reset()` goes at once, since it replaces the
stack anyway.

## Every url is its own screen

A push to the route already on top, with different parameters, is a new screen: `/user/1` then
`/user/2` stacks two `User` screens with a push animation, and back returns to `/user/1`, whether
the push came from `NativeNavigation`, `nativeRouterLink`, `Router.navigate()` or a deep link. That
is what a native stack does with a detail that links to another detail, a product to a similar
product or a thread to a reply. Angular's own route reuse strategy on the web keeps one component
for the route and feeds it the new parameters instead; the native stack keeps that behavior for
changes that do not change the path: a different query string or fragment updates the screen
already there.

A route whose parameter picks what one screen shows, rather than naming another screen to go to,
opts back into the web behavior with `reuseScreen`:

```ts
import type { Routes } from '@angular/router';
import { reuseScreen } from '@ng-native/router';
import { Photo } from './photo.ts';
import { User } from './user.ts';

export const routes: Routes = [
  { path: 'user/:id', component: User }, // /user/1 then /user/2: two screens
  reuseScreen({ path: 'photo/:index', component: Photo }), // one screen, its input updated
];
```

## Popping several screens

`popTo(commands)` pops straight back to the screen at that url, taking every screen above it off the
stack at once, as `popToViewController` does; the screen is the one already there, with its state.
`popToRoot()` pops the stack in front to its first screen, which inside a tab is the tab's own first
screen. Both are answered by the innermost stack in front, and resolve false, doing nothing, when
there is nothing to pop to: a push is the way to a screen that is not on the stack.

## Deep links into nested screens

`withLinkParent(parentOf)` says which page a deep link belongs under, and that page's own parent is
asked in turn, so a link to a screen five levels deep opens on all five and Back retraces them. A
link that arrives as the app launches waits for the router's first navigation to finish, so the
root screen is always there beneath it.

## A page that fails to render

The stack outlet renders a page once as it creates its screen, so a page that throws on that
first render, from a typo in its template or a constructor that fails, fails the navigation: the
promise from `push()` or `Router.navigate()` rejects, the router emits a `NavigationError`, and the
url stays where it was. Nothing of the page stays behind. Its component is destroyed, its screen
comes off the stack, the screen it was pushed from carries on as the one showing, and a replace or
a reset that failed leaves the screens it would have removed. When the page is the first screen of
a stack of its own, that stack goes too, and a tab's page that throws leaves the tab that was
showing in front. The error reaches the app's `ErrorHandler` as well as the navigation's promise.

## Refusing a dismissal

A page's host element is its screen, so a page can refuse to be swiped away while it holds
unsaved changes, and hear the attempt to ask about them. On Android the same holds for the Back
button: while `preventNativeDismiss` is true, Back leaves the screen in place and fires
`(nativeDismissCancelled)`. `NativeNavigation.back()` still goes back, which is how the page leaves
once the user has confirmed:

```ts
@Component({
  selector: 'app-editor',
  template: `...`,
  host: {
    '[preventNativeDismiss]': 'dirty()',
    '(nativeDismissCancelled)': 'confirmDiscard()',
  },
})
export class Editor {
  protected readonly dirty = signal(false);
  protected confirmDiscard(): void {
    // Ask, then nav.back() to leave.
  }
}
```

## Presented screens have no header

A presented screen (`present()`) is shown outside the stack's own navigation controller - the same
way `expo-router`'s and `react-navigation`'s modals work - so it has no native header and no
automatic safe-area insets. It owns its own way out and its own `<safe-area-view>`:

```ts
@Component({
  selector: 'x-sheet',
  imports: [SafeAreaProvider, SafeAreaView /* ... */],
  template: `
    <safe-area-provider [reportInsets]="false" class="fill">
      <safe-area-view class="fill" [edges]="['top', 'bottom']">
        <pressable (press)="nav.back()"><text>Close</text></pressable>
        <!-- ... -->
      </safe-area-view>
    </safe-area-provider>
  `,
  styles: `
    .fill {
      flex: 1;
    }
  `,
})
export class Sheet {
  protected readonly nav = inject(NativeNavigation);
}
```

## Pushing from a presented screen

A push from a presented screen is presented the same way, over it: from a modal, `push('/detail')`
opens the detail as a modal on top, and one back closes it again, leaving the modal showing. On
iOS a pushed screen can only slide in on a navigation controller, and a presented screen is
outside the stack's, so this is the one way the new screen can be seen at all. A presentation the
push names itself wins, so `push('/detail', { presentation: { stackPresentation:
'fullScreenModal' } })` covers everything, and `stackPresentation: 'push'` pushes onto the stack
under the modal, out of sight until the modal closes.

A presented screen that should push inside itself, with a header and a back button, is a stack
of its own: a route whose component is a `<native-stack-outlet>`, with the screens it pushes as
its children.

```ts
import type { Routes } from '@angular/router';
import { Compose, ComposeRecipients, ComposeStart } from './compose.ts';

export const routes: Routes = [
  {
    path: 'compose', // nav.present('/compose')
    component: Compose, // template: '<native-stack-outlet />'
    children: [
      { path: '', component: ComposeStart },
      { path: 'recipients', component: ComposeRecipients }, // nav.push('/compose/recipients')
    ],
  },
];
```

A push to one of those children stays inside the modal; a push to any other route leaves it and is
presented over it, as above.

## Presentation options

`ScreenPresentation` is the full set of options a screen can be given - stack animation, the
dismiss gesture, sheet detents, status bar and navigation bar overrides - all spelled exactly as
`react-native-screens` spells its own props, so its documentation reads across directly. Anything
that does not fit in a URL - `push` versus `replace` versus `reset`, and the full presentation a
screen was opened with - travels as router navigation state, which Angular's own history already
carries: going back to a screen restores the presentation it was originally given, with no extra
bookkeeping on your part.

## Whether a screen is in front

`SCREEN_IN_FRONT` from `@ng-native/device` is a signal that is true while the screen something is on
is the one showing, and false while another screen is pushed over it, presented from it, or while
its tab is not selected. The stack and tab outlets provide it for every screen they show, combined
with the screen they are themselves on; outside an outlet it is always true. A covered screen's
views are detached from change detection, so read it in a root effect (`effect(fn, { injector })`
with the environment injector) to act while covered. `<keyboard-dock>` uses it to let the keyboard go.

## Above every screen

A sheet or a modal is presented above the app's root view, so a toast positioned absolutely at the
root is covered by the first sheet the user opens. `<full-window-overlay>` draws its content above
every screen instead. On iOS it is react-native-screens' own full-window overlay, a window of its
own above the app's, which lets touches through wherever it has no content, so it can stay mounted
empty. On Android it is a view filling the window; put it last in the root component's template so
it draws on top.

```html
<safe-area-provider>
  <native-stack-outlet />
  <full-window-overlay>
    @if (toast(); as message) {
    <view class="toast"><text>{{ message }}</text></view>
    }
  </full-window-overlay>
</safe-area-provider>
```

It fills the window and follows it through a rotation. `[modal]="true"` keeps VoiceOver inside
it while it shows, for a cover that blocks the app.

<!-- api: FullWindowOverlay -->
