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

`path` names the child route the tab selects - the route config underneath needs one child route
per `<native-tab>`, matched by that same path. `sfSymbol` (iOS) and `drawable` (Android) are
shorthand for the fuller `icon`/`selectedIcon` inputs, which also take a `require()`d image drawn
either as-authored or as a tinted template mask; `icon` and `selectedIcon` must be the same kind of
image, since native carries one icon type for both states.

Every tab is a route a user reaches in one tap, so a tab whose route is lazy pauses on its first
visit while its code loads. `withPreloading(PreloadAllModules)` in `provideNativeRouter` loads
those routes right after start-up; see [the router](/packages/router).

A bar item is not a view - `UITabBarItem` and Android's bottom-navigation item are model objects, a
title and an image and a badge string, with no way to put a view in their place. That is why
`<native-tab>` takes no content while `<native-header-item>` does, and why customization beyond the
basics lives in the `standardAppearance`/`scrollEdgeAppearance` inputs rather than in markup.

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
