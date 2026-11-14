---
title: Sidebar and split view
summary: A sidebar beside the content, a source list on macOS and two columns or a stack elsewhere.
---

# Sidebar and split view

`<split-view>` holds a `<sidebar>` and the content beside it. On macOS the first one in a window
is its NSSplitViewController, with the full-height sidebar and the toolbar's sidebar button, and a
nested or second one is a plain NSSplitView. On iOS, Android and the web host it is drawn from
views: two columns, and below `Screen.compact`'s width a stack whose root is the sidebar.

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
  button, View > Show Sidebar and a drag that shuts it. Drawn, a collapsed sidebar is hidden.
- **`minWidth`** and **`maxWidth`** - the narrowest and widest a drag of the divider leaves it, in
  points. Drawn, they bound the sidebar's width, which starts at 240.
- **`autosave`** - macOS: the name the width and collapsed state are kept under across launches.

Sections and items become a native source list on macOS. Anything else in the sidebar, such as a
search field or a footer, is drawn and styled by CSS on every OS.

## Sections and items

`<sidebar-section>` takes an optional `title`, and `collapsible` to show and hide its items from
the title. The selection survives a section collapsing.

`<sidebar-item>` takes:

- **`label`** and **`badge`** - the row's text, and a count or a short word at its trailing edge.
- **`sfSymbol`**, **`drawable`** and **`icon`** - the picture, as on a
  [`<native-tab>`](/packages/router/tabs) and a
  [`<native-button>`](/packages/components/native-button). Drawn rows show no picture yet.
- **`[(selected)]`** and **`(select)`** - the selection, and the user choosing the item. A sidebar
  selects one item at a time, so choosing one deselects the others.

Content inside an item replaces its default row. Pressables in it take clicks, and while the row
is selected its host has `data-selected`, for CSS to restyle the row on the selection highlight.

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

Drawn below `Screen.compact`'s width, the split view is a stack: the sidebar fills the screen, and
choosing an item shows the content in its place. `showSidebar()` on the `SplitView`, or Android's
back button, returns to the sidebar. `stacked()` and `showing()` say which layout and pane are in
front, for a back button of the app's own.

## Tabs on macOS

A tab bar renders as the window's sidebar on macOS, with no change to the app: each
`<native-tab>` is a sidebar item, its `title` as the label, with its `sfSymbol` and `badge`, and
its page in the content pane. The tabs own the window's split view, so a `<split-view>` inside a
tab is a plain split view in the content.
