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

A guard that redirects, by returning a `UrlTree`, sends the navigation to its page with the same
intent: `reset('/home')` from a signed-out user whose `home` guard redirects to `/login` leaves the
sign-in page alone on the stack, `replace()` swaps the top screen for it, and `present()` presents
it the way it was asked for. That holds when the user is on `/login` already: the router skips a
navigation to the url it is showing, and the screens under the sign-in page still go, as they do for
a `reset()` to that url without a guard. It resolves `false` then, as the router does. A `reset()`
that lands on the screen on top by another url, such as `/login?next=home` or a route that
redirects to `login`, keeps that screen and takes the ones under it off too. A `replace()` that
lands there leaves the stack as it is, since the screen it would swap in is the one already on top.

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

A push to a url further down the stack is a new screen too: a customer that links to one of its
jobs, whose page links back to the customer, is three screens, and back from the second customer
returns to the job. That holds for `push()` and `nativeRouterLink`. A plain `Router.navigate()` to
that url goes back to the screen already there instead, as `popTo()` does.

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

Without `withLinkParent`, a link that launches the app opens its page alone: no Back, no tab bar,
and nothing beneath it to return to until the app is relaunched. A link that arrives while the app
is running is pushed over whatever is showing.

`withLinkParent(parentOf)` says which page a deep link belongs under, and that page's own parent is
asked in turn, so a link to a screen five levels deep opens on all five and Back retraces them.
Return null for a link that should open alone:

```ts
import { provideNativeRouter, withLinkParent } from '@ng-native/router';
import { routes } from './app/app.routes.ts';

const router = provideNativeRouter(
  routes,
  // A person opens above the people list, which opens above the tabs.
  withLinkParent((url) => (url.startsWith('/person/') ? '/people' : null)),
);
```

When `parentOf` names a parent for a link the app launches with, the app opens on the first page of
that chain and the link waits for that navigation to finish, so every page the chain names is
beneath it. When `parentOf` returns null, the link opens alone, as it does without
`withLinkParent`. [Testing the router](/packages/testing/testing-navigation)
shows how to follow a link in a test.

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

The same binding works on a page inside a
[presented screen that is a stack of its own](#pushing-from-a-presented-screen): the stack gives
the refusal of the screen on top of it to the presented screen, the one a swipe down dismisses, and
the page hears the attempt. Bind it on the page or on the component that holds the
`<native-stack-outlet>`, not on both: a refusal the holding component binds is its own, and it is
the one that hears `(nativeDismissCancelled)` for it.

A page that should not be shown at all, a record that no longer exists, can call `back()` as it
appears, from an `effect()` in its constructor: a back asked for while the navigation is still
putting the page up waits for it, then goes.

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

A page of a tab that is not in front is presented over the tab that is, rather than in its own:
see [Presenting a page of another tab](/packages/router/tabs#presenting-a-page-of-another-tab).

## Presentation options

`ScreenPresentation` is the full set of options a screen can be given - stack animation, the
dismiss gesture, sheet detents, status bar and navigation bar overrides - all spelled exactly as
`react-native-screens` spells its own props, so its documentation reads across directly. Anything
that does not fit in a URL - `push` versus `replace` versus `reset`, and the full presentation a
screen was opened with - travels as router navigation state, which Angular's own history already
carries: going back to a screen restores the presentation it was originally given, with no extra
bookkeeping on your part.

## A sideways drag on iOS 26

On iOS 26 the swipe back starts anywhere on a pushed screen, not only at its edge. It takes the
touch once a finger has moved a little way to the right, and whatever in the app was following that
finger stops: a slider's thumb, a card being dragged, a row swiped to reveal its actions. The view
gets `(responderTerminate)`, and a longer drag goes on to pop the screen. A drag to the left is not
affected, and neither is a `<scroll-view>` that scrolls sideways, which the swipe waits for.

This is `react-native-screens`' default from iOS 26, and a React Native app has it too. A screen
that holds something dragged sideways opts out where it is navigated to, and keeps the swipe from
its edge:

```ts
void this.nav.push('/mixer', { presentation: { fullScreenSwipeEnabled: false } });
```

A view that follows a finger sideways can say so itself with `touch-action`, as it would on the web.
A touch that starts on an element with `touch-action: pan-y` or `touch-action: none`, or on anything
inside one, holds the screen's swipe off until the finger lifts, and a touch anywhere else on the
screen swipes back as before:

```css
.slider {
  touch-action: pan-y;
}
```

This needs nothing where the screen is navigated to, and works however the screen was opened. The
screen is told as the finger comes down, so a flick that is already moving fast in its first few
milliseconds can still be taken by the swipe.

The same touch is kept from a `<scroll-view>` the element is in. With `pan-y`, a drag that sets off
down the page scrolls it as usual, and one that sets off across is the element's for as long as the
finger is down, however it wanders after. With `none`, every drag that starts on the element is its
own.

`gestureResponseDistance` narrows the swipe instead of turning it off. Its four values bound where
a touch may be for the swipe to start, in points from the screen's leading and top edges:
`{ end: 40 }` starts it only within 40 points of the leading edge, and `{ top: 300 }` only below
the first 300 points, which leaves a slider above that line alone. Earlier versions of iOS start
the swipe at the edge alone unless `fullScreenSwipeEnabled` is set.

## Whether a screen is in front

`SCREEN_IN_FRONT` from `@ng-native/device` is a signal that is true while the screen something is on
is the one showing, and false while another screen is pushed over it, presented from it, or while
its tab is not selected. The stack and tab outlets provide it for every screen they show, combined
with the screen they are themselves on; outside an outlet it is always true. A covered screen's
views are detached from change detection, so read it in a root effect (`effect(fn, { injector })`
with the environment injector) to act while covered. `<keyboard-dock>` uses it to let the keyboard
go.

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
