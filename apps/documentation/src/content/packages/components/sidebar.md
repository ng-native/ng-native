---
title: Sidebar and split view
summary: A sidebar beside the content, native on macOS and iPad, two columns or a stack elsewhere.
---

# Sidebar and split view

`<split-view>` holds a `<sidebar>` and the content beside it. On macOS the first one in a window
is its NSSplitViewController, with the full-height sidebar and the toolbar's sidebar button, and a
nested or second one is a plain NSSplitView. On an iPad it is a UISplitViewController, in a
development build (not in Expo Go): the sidebar is its sidebar column, with the system's sidebar
button, and the content its other column. On iPhone, Android and the web host, and in Expo Go, it
is drawn from views: two columns, and below `Screen.compact`'s width a stack whose root is the
sidebar. On Android the columns wait for Material's expanded width, 840dp, as its list-detail
layout does.

```html
<split-view>
  <sidebar [(collapsed)]="hidden" minWidth="180" maxWidth="360" autosave="main">
    <text-input placeholder="Filter" />
    <sidebar-section title="Library" collapsible>
      <sidebar-item path="songs" label="Songs" sfSymbol="music.note" />
      <sidebar-item path="albums" label="Albums" sfSymbol="square.stack" [badge]="newAlbums()" />
    </sidebar-section>
  </sidebar>
  <native-stack-outlet />
</split-view>
```

Import `SplitView`, `Sidebar`, `SidebarSection` and `SidebarItem` from `@ng-native/components`,
and `SidebarItemPath` from `@ng-native/router` for items with a `path`.

## The sidebar

- **`[(collapsed)]`** - whether the sidebar is shut. On macOS it follows the title bar's sidebar
  button, View > Show Sidebar and a drag that shuts it. On an iPad it follows the sidebar button
  and the swipe that opens or shuts the sidebar, while a sidebar UIKit hides at a narrower width
  stays uncollapsed and shows again at a wider one. Drawn, a collapsed sidebar is hidden.
- **`minWidth`** and **`maxWidth`** - the narrowest and widest a drag of the divider leaves it, in
  points. Drawn, they bound the sidebar's width, which starts at 240.
- **`autosave`** - the name the sidebar is kept under across launches: its width and collapsed
  state on macOS, and its collapsed state on Linux, where the sidebar has no width to drag.

Sections and items become a native source list on macOS. Anything else in the sidebar, such as a
search field or a footer, is drawn and styled by CSS on every OS.

## The content pane

- **`contentStyle`** - `plain` (the default) or `inset`. On macOS and Linux an `inset` content
  pane is a card with rounded corners, inset 8 points from the edges of the space beside the
  sidebar and from the bottom of the toolbar or header bar, on the sidebar's backdrop, which
  runs under the toolbar or header bar. The pane is laid out at the card's size, so a page in it
  starts below the toolbar with no top inset of its own. iOS, Android and the web host ignore it.

```html
<split-view contentStyle="inset">
  <sidebar>...</sidebar>
  <native-stack-outlet />
</split-view>
```

The host places the content pane, so a margin, radius or background on what it holds (a
`<native-stack-outlet>`, say) styles the content inside the card, not the pane.

## Sections and items

`<sidebar-section>` takes an optional `title`, and `collapsible` to show and hide its items from
the title. The selection survives a section collapsing.

`<sidebar-item>` takes:

- **`label`** and **`badge`** - the row's text, and a count or a short word at its trailing edge.
- **`sfSymbol`**, **`drawable`** and **`icon`** - the picture, as on a
  [`<native-tab>`](/packages/router/tabs) and a
  [`<native-button>`](/packages/components/native-button). On macOS and Linux `icon` can also be
  an icon's SVG markup, such as an `@ng-icons` icon: `[icon]="{ svg: lucideBlocks }"`. Linux shows
  no SF Symbol, so there an SVG icon is the only picture a row has. Drawn rows show no picture yet.
- **`[(selected)]`** and **`(select)`** - the selection, and the user choosing the item. A sidebar
  selects one item at a time, so choosing one deselects the others.

Content inside an item replaces its default row. Pressables in it take clicks, and while the row
is selected its host has `data-selected`, for CSS to restyle the row on the selection highlight.

On macOS the highlight is the accent colour while the window is key and the sidebar has the focus,
and grey otherwise. While it is the accent colour, the host also has `data-emphasized`, and the
item's read-only `emphasized` signal is true, so text that turns white on the accent colour can stay
dark on the grey. Neither is set on other platforms.

```css
sidebar-item[data-emphasized] text {
  color: white;
}
```

```html
<sidebar-item label="Storage" [(selected)]="storage">
  <view class="storage-row">
    <text>Storage {{ used() }}%</text>
    <view class="meter"><view class="used" [style.width.%]="used()"></view></view>
  </view>
</sidebar-item>
```

## Selecting by route

With `SidebarItemPath` imported, an item's `path` selects it by route and choosing it navigates
there. The path is relative to the page the sidebar is on, and matches as a `<native-tab>`'s does:
the item with the longest path that starts the url is selected, so `mail/sent` wins over `mail` on
`/mail/sent/today`. An item at `''` takes the page's own url, and any url no other item takes. A
navigation a guard refuses leaves the selection on the route that is showing.

## Compact widths

On an iPad, UIKit collapses the split view controller into a navigation stack at a compact width,
in Slide Over or a narrow window: the sidebar is its root, choosing an item pushes the content, and
the back button returns to the sidebar. Where an item was chosen before the width shrank, the
content stays in front. Both columns stay mounted through the change, so the router's page and its
selection are kept. `showSidebar()` pops back to the sidebar.

Drawn below `Screen.compact`'s width (840dp on Android), the split view is a stack: the sidebar
fills the screen, and choosing an item shows the content in its place. `showSidebar()` on the
`SplitView`, or Android's back button, returns to the sidebar. `stacked()` and `showing()` say
which layout and pane are in front, for a back button of the app's own.

## Tabs on macOS

A tab bar renders as the window's sidebar on macOS, with no change to the app: each
`<native-tab>` is a sidebar item, its `title` as the label, with its `sfSymbol` or SVG icon and
`badge`, and its page in the content pane. The tabs own the window's split view, so a
`<split-view>` inside a tab is a plain split view in the content.

## In the desktop host

`<split-view>` is `NgNativeSplitView`, holding the sidebar pane (`NgNativeSidebar`) and then the
content pane (`NgNativeSplitContent`). The first split view in a window is the window's
NSSplitViewController, with the full-height sidebar, the toolbar's sidebar button and tracking
separator, View > Show Sidebar and an autosaved width; one inside another split view, a modal or
the tabs is a plain NSSplitView in the content. Each pane is sized by AppKit, and the size goes
back into layout, at most once a display frame. The sidebar's collapsed state follows the app's
`collapsed`, and the title bar button, the View menu and a restored autosave report theirs with
`topSidebarCollapse`. The content pane's `contentStyle` prop is `inset` for a card: its container
sits in a backdrop of the sidebar's material, which runs under the toolbar, and the content's split
item draws no title bar separator. On Linux the content page takes the sidebar's colour, the header
bar over it draws none of its own, and the pane's slot is the card.

Neighbouring `<sidebar-section>`s (`NgNativeSidebarSection`) in one parent are one NSOutlineView
source list, laid out where Yoga put them, and each `<sidebar-item>` (`NgNativeSidebarItem`) is a
row of it with its label, badge and SF Symbol. A titled section's rows line up with its title and
with the rows of an untitled section. A click selects a row and sends `topSidebarSelect` to its
item, and a change to whether the row's selection is drawn emphasized sends `topSidebarEmphasis`
with `{ emphasized }`. An item with content is a custom row: its views sit in a cell of their own,
which they fill, and a click on a pressable in it reaches the pressable while other clicks select
the row.
