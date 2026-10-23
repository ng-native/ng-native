---
title: Tabs
summary: NativeTabsOutlet renders a real tab bar, with each tab declared as content.
---

# Tabs

`<native-tabs-outlet>` renders a real `UITabBarController` on iOS and a bottom navigation bar on
Android. Tabs are declared as content, the same way a header is declared in a page's own template,
because a badge is a signal that changes, a title may be translated, and a tab might not exist
until a feature flag says so - none of which a static route config can express:

<!-- api: NativeTabsOutlet -->
<!-- api: NativeTab -->

```ts
@Component({
  selector: 'x-tabs',
  imports: [NativeHeader, NativeTab, NativeTabsOutlet],
  template: `
    <native-header [hidden]="true" />
    <native-tabs-outlet>
      <native-tab path="library" title="Library" sfSymbol="books.vertical.fill" />
      <native-tab path="inbox" title="Inbox" sfSymbol="tray" [badge]="unread()" />
    </native-tabs-outlet>
  `,
})
export class TabsPage {
  protected readonly unread = signal('3');
}
```

`path` names the child route the tab selects - the route config underneath needs one child route per
`<native-tab>`, matched by that same path. A child route with no component of its own counts as
part of the path: a `loadChildren` wrapper whose page sits at `''` beneath it, as Analog's file
routes make, or a group at `''` around the tab's route. A tab can be at `path=""` too, the bar's
own url, with its pages at urls beside those of routes outside the bar; a page belongs to it when
its routes lead there, through static and `:param` segments (a `**` route or a custom `matcher` is
not followed). `sfSymbol` (iOS) and `drawable` (Android) are shorthand for the fuller
`icon`/`selectedIcon` inputs, and a tab that names both draws each on its own platform. Each
platform reads only its own, so a tab with just one has no icon on the other, and in development
that platform logs a warning naming the tab's path. The fuller inputs also take a `require()`d
image drawn either as-authored or as a tinted template mask; `icon` and `selectedIcon` must be the
same kind of image, since native carries one icon type for both states.

On Android, a tab can be added after start behind an `@if`, but not taken away again: its item
stays in the bottom navigation bar, still tappable, and opens a blank page, and adding the tab back
then shows its item twice. The router takes the tab out of the bar it commits, but React Native
drops that removal before it reaches react-native-screens' Android tab bar. The fix is an open
pull request,
[react-native-screens#4812](https://github.com/software-mansion/react-native-screens/pull/4812).
Until a release has it, keep a tab a user can lose declared on Android, and have its page say why
there is nothing there.

Neither platform's tab bar draws SVG, so an icon written as SVG markup, such as an `@ng-icons` icon,
is drawn once into an image by a renderer the app provides. `SvgImages` from `@ng-native/icons` is
one:

```ts
provideNativeRouter(routes, withSvgIcons(SvgImages));
```

```html
<native-tab path="saved" title="Saved" [icon]="{ svg: lucideHeart }" />
```

It is tinted like a symbol, 25 points square on iOS and 24 on Android unless the icon gives a
`size`, and the tab shows no icon until it has been drawn, a frame or two after the bar appears.
Without a renderer the tab has no icon, and in development it logs a warning naming the tab's path.

Every tab is a route a user reaches in one tap, so a tab whose route is lazy pauses on its first
visit while its code loads. `withPreloading(PreloadAllModules)` in `provideNativeRouter` loads
those routes right after start-up; see [the router](/packages/router).

A bar item is not a view - `UITabBarItem` and Android's bottom-navigation item are model objects, a
title and an image and a badge string, with no way to put a view in their place. That is why
`<native-tab>` takes no content while `<native-header-item>` does, and why customization beyond the
basics lives in the `standardAppearance`/`scrollEdgeAppearance` inputs rather than in markup.

## A search tab

iOS 26 sets a tab bar's search tab apart: a circular button at the trailing end of the bar, which
grows into the search field when tapped. `role="search"` makes a tab that tab, a `UISearchTab`:

```html
<native-tabs-outlet>
  <native-tab path="library" title="Library" sfSymbol="books.vertical.fill" />
  <native-tab
    path="search"
    title="Search"
    systemItem="search"
    drawable="ic_search"
    role="search"
    automaticallyActivatesSearch
  />
</native-tabs-outlet>
```

`systemItem` is iOS's alone, so a search tab names its `title` and an Android icon too, or it is a
blank item on Android.

`automaticallyActivatesSearch` focuses the search field as the tab is selected, and needs a
[`<native-search-bar>`](/packages/router/header#search) in the header of the stack inside the tab.
On iOS 27 not on the tab's first visit, though: the outlet builds a tab's screen when the router
activates it, after native has selected the tab, so that first time the field is shown but not
focused. Every later visit focuses it. iOS 26 focuses it on the first visit too.

Both need iOS 26.1 and react-native-screens 4.29 or later, beyond the 4.26 Expo SDK 57 installs;
older ones ignore them, and Android has no such tab. Native reads the role once, as the tab is
created, so bind a value that does not change, and a bar has one search tab at most.

Which build the app is decides whether the role is needed at all. Linked against the iOS 26 SDK,
as Expo Go and an app built with Xcode 26 are, UIKit keeps its older behavior and a plain
`systemItem="search"` already draws the detached button, on iOS 26 and on iOS 27. Built with the
iOS 27 SDK, only a `UISearchTab` is detached, and on iOS 27 only while
`automaticallyActivatesSearch` is on.

Expo Go's react-native-screens is older than 4.29, so there both inputs are ignored: the button is
`systemItem`'s, the field is not focused when the tab opens, and Cancel empties it but stays on the
tab rather than going back to the one before.

## Defaults for every tab bar

`withTabDefaults` is `withHeaderDefaults` for tab bars: the outlet's `tintColor`, `backgroundColor`
and `colorScheme`, and each tab's `standardAppearance` and `scrollEdgeAppearance`, said once
beside the routes. As with headers it takes an object or a function of the color scheme, and
anything an outlet or a tab binds itself wins.

```ts
import { provideNativeRouter, withTabDefaults } from '@ng-native/router';
import { routes } from './routes.ts';

export const providers = [
  provideNativeRouter(
    routes,
    withTabDefaults((scheme) => ({
      tintColor: '#3b6ef5',
      backgroundColor: scheme === 'dark' ? '#101014' : '#f4f4f7',
    })),
  ),
];
```

A tab that binds its own `standardAppearance` replaces the default one whole rather than merging
into it, the same as any other input.

Native holds the current selection, not your app - a tap is round-tripped through the router as a
real navigation, so the URL and the bar never disagree, and each tab keeps its own screen (and its
own stack, if it has one) mounted while another tab is in front. Returning to a tab returns to
wherever it was left, because the outlet remembers each tab's own url.

A sheet or modal presented in a tab's own stack is the exception. On iOS it covers the whole
window, the bar included, so it cannot stay up while its tab is behind another: when another tab
comes in front it is dismissed, and returning to its tab returns to the page beneath it. On Android
react-native-screens draws it inside the tab's stack (a modal as a push, a form sheet as a bottom
sheet), so the bar stays visible under it. It is dismissed there too, so a tab comes back on the
same page on both platforms.

## Hiding the bar on a pushed page

A detail or editor page pushed in a tab's stack can take the whole window, as UIKit's
`hidesBottomBarWhenPushed` and SwiftUI's `.toolbar(.hidden, for: .tabBar)` do. Give its header
`tabBarHidden`:

```html
<native-header title="Invoice" tabBarHidden />
```

The bar goes while that page is the one in front of the tab in front. It comes back when the page
is popped, when another page is pushed over it, when another tab is selected, and when the header
is removed or `tabBarHidden` turns false. A `[barHidden]` bound on the `<native-tabs-outlet>` wins
over every page, either way; left unbound, the pages decide. A header outside any tab ignores it.

react-native-screens hides the bar on the tab bar as a whole rather than per screen, so the bar
disappears and reappears without UIKit's slide. It disappears as a push starts. On a pop by the
header's back button on iOS, it comes back once the slide has finished; on a pop by Android's back
button, as the pop starts. On iOS 18 and later react-native-screens asks the tab bar controller to
hide the bar; below iOS 18 it hides the bar's view.

## Content above the tab bar

A tab's screen runs to the bottom of the window, and the bar is drawn over it: on iOS 26 it floats
over the content, on earlier iOS it is translucent and overlays it, and on Android the bottom
navigation bar sits on top of it. Anything pinned to the bottom of a tab - a panel of controls, a
mini player - has to be lifted clear of the bar, by an amount that differs between devices,
versions and platforms.

`<safe-area-view>` cannot do it. Its insets come from the app's `<safe-area-provider>`, which is at
the root, above the tab bar, so inside a tab its bottom inset is only the home indicator.
`<tab-safe-area-view>` asks the tab screen instead: on iOS that is the screen's own safe area,
which UIKit extends by the bar, and on Android the larger of the bar's height and the system bars.
It follows the bar as it changes size or is hidden.

<!-- api: TabSafeAreaView -->

The inset is applied as **margin**, so whatever is behind it shows through. When a panel's
background has to reach the bottom of the screen, so that the bar floats over the panel rather
than over whatever the panel sits on, give the background to a parent and put the
`<tab-safe-area-view>` inside it. The parent grows by the margin:

```html
<view class="absolute bottom-0 left-0 right-0 rounded-t-3xl bg-white px-5 pt-4">
  <tab-safe-area-view [edges]="['bottom']" class="pb-4">
    <!-- controls, which now end 16 points above the bar -->
  </tab-safe-area-view>
</view>
```

Content that should float with nothing behind it, such as a mini player, needs no parent:

```ts
@Component({
  selector: 'x-library-stack',
  imports: [MiniPlayer, NativeStackOutlet],
  template: `
    <native-stack-outlet />
    <x-mini-player class="absolute bottom-0 left-0 right-0" />
  `,
})
export class LibraryStack {}
```

with a `<tab-safe-area-view [edges]="['bottom']">` inside the mini player's own template. It has to
be inside a tab to know about the bar, so something every tab shows is placed in each tab - in a
tab's stack component, beside its `<native-stack-outlet>`, it stays put as pages are pushed.
Placed beside the `<native-tabs-outlet>` instead, it is outside every tab screen, and on iOS it
insets by nothing at all.

A scroll view that fills the tab can usually do without: on iOS, with
`contentInsetAdjustmentBehavior="automatic"`, it insets its own content by the safe area, the bar
included. Android has no equivalent, so there the last rows scroll under the bar unless the
content is padded.

## Pushing into another tab

`NativeNavigation.push('/items/1')` from another tab selects the Items tab and pushes the page
onto its stack, over whatever the tab was left on. A tab nobody has opened has no stack yet, so
the push goes to the tab first and then to the page: the tab's own first screen, `/items`, is under
it, and a back from the page lands there, as it does when the tab has been opened. If the tab's
first screen refuses the navigation, a guard that redirects among them, the push resolves to
`false` and the page is not shown.

`Router.navigateByUrl()` does not do this: it goes straight to the url it is given.

## Presenting a page of another tab

A detail page that lives in one tab is often shown as a sheet over another: an invoice opened from
the dashboard, a search result, a notification. `present()` shows a page of a tab that is not in
front over the tab that is, and leaves the page's own tab as it was:

```ts
// On the Home tab. The Invoices tab is not selected, and is not opened.
void this.nav.present('/invoices/7', { as: 'formSheet' });
```

The route is the one the tab already has, with its params, resolvers, data and lazy component, and
with the guards and providers of the routes it sits inside. Only their components are left out:
the page is shown on the app's own stack, over the tab bar, and not inside the Invoices tab's.
While it is up the url names it beside where the app is, `/home(presented:invoices/7)`, and a
back, or the swipe that dismisses a sheet, returns to `/home`.

Three things follow from the page being over the tabs rather than in one:

- It has no header and no stack of its own, as any [presented
  screen](/packages/router/screens#presented-screens-have-no-header)
  has none, so it needs its own way out.
- A `push()` from it, or a link inside it, leaves it: the push goes to its url's own tab, and the
  page is dismissed rather than left covering where the app went.
- It needs the app's root to be a `<native-stack-outlet>`, the usual shape, with the tab bar as the
  stack's first screen. Without one, and for a page of the tab in front or of no tab, `present()`
  shows the page where its url puts it. So it does for a page behind a `canMatch` guard, on its own
  route or one above it, which only the route's own place can run.

## Going back

Android's back button pops the stack in the tab in front, never one in a tab behind it. That is a
pop, not one entry back through history: after a trip to another tab and back, the entry behind
the top screen is that other tab, and going back to it would switch tab instead. A screen pushed
over the whole bar, on the app's own stack, is popped before anything inside the bar.

Once the stack in front is at its root, or the tab has no stack, back goes to the first tab, on
whatever screen it was left on. On the first tab the button leaves the app, which Android
backgrounds rather than closes. This is how a bottom navigation bar behaves on Android; the order
the tabs were visited in is not retraced, because after a few switches nobody could predict where
that lands.

`NativeNavigation.back()` does the same, except that it cannot leave the app: on the first tab's
root it does nothing.

A tab screen with no stack of its own has no header above it, so nothing clears the status bar for
it. iOS hides that, because a scroll view insets its own content by the safe area; Android does
not, and draws edge to edge, so the page's first line lands under the clock. Wrap such a page in
`<safe-area-view [edges]="['top']">` - on iOS the scroll view inside then no longer overlaps the
unsafe area and adds nothing of its own, so the inset is not doubled.
