---
title: Views and controls
summary: How the desktop host draws views, controls and the libraries it compiles in, on macOS.
---

# Views and controls

What the desktop host draws, and how each view, control and library behaves on macOS.

The host draws views, text, text fields, images, scroll views, modals (as a
sheet, an in-window cover, or an NSPopover when the modal has an `anchor`), takes clicks, hover
and the scroll wheel, loads the app from the dev server with reload and Fast Refresh, runs React
Native's layout animations, and has the default menu bar. React Native's iOS modules answer from
the core: Linking, Appearance, AccessibilityInfo, AppState, DeviceInfo, PlatformConstants,
I18nManager, Alert (NSAlert), Clipboard, Networking (streaming, progress, cookies, redirects),
WebSocket, Blob, FileReader, ImageLoader and `@react-native-async-storage` (2.x and 3.x,
file-backed). A view's `transform` is drawn on its layer, about
its `transform-origin`, as React Native iOS draws it, and the view is hit where it is drawn: a
click, a pointer event or a gesture lands on a moved, scaled or rotated view by its drawn shape, and
its `locationX`, `offsetX` and gesture `x` are in the view's own coordinates.

## Painting a view

A view's box is painted as React Native iOS paints it (`view-box.h`): one corner radius and one
solid border are the layer's own, drawn over the children only when the view clips or the border
is hidden, and any other box is drawn under the children, with each corner's radius and each
side's width and colour (the start and end sides by the layout direction), a dashed or dotted
border in one colour, and the background colour in the border box's shape. Linear and radial
gradients (`background-image`) are drawn with their size, position and repeat, and each box shadow,
outer or inset, is a blurred layer under the children. A view that clips its overflow also clips
its outer shadows.

An `<image>` fits its picture to its box by `resizeMode`: `cover`, `contain`, `center` or `stretch`,
and `repeat`, which tiles the picture at its own size from the box's top left corner, as React
Native iOS does.

## Modals

A `<modal>` with `pageSheet`, `formSheet` or no presentation style is an NSWindow sheet on its
window, stacked on a sheet already there. It takes its content root's CSS width and height, or
480 points wide and as tall as its content lays out, measured from the shadow tree in a second
commit, and stays between 320x200 and the window. `fullScreen`, `overFullScreen` and `transparent`
are a cover in the window below its title bar and toolbar, and a transparent one shows the window
through. Escape and Cmd-W ask a sheet or a cover to close (`requestClose`), the one in front
first, and Cmd-W stays on Close Window even when the app's own menu bar leaves it out. An alert
with no key window runs app-modally, so its answer always arrives.

## The mouse and scrolling

The mouse reaches an app as on the web: every move goes to React Native's pointer events, which
send `(mouseenter)`, `(mouseleave)`, `(mousemove)`, `(mouseover)` and `(mouseout)` to the views
that listen, and `(dblclick)`, `(contextmenu)` (a secondary click or Control-click) and `(wheel)`
reach the view under the pointer. The cursor is the nearest CSS `cursor` under the pointer, shown
as AppKit's cursor for it (the arrow for one AppKit has none of), and the I-beam over a text
input. Scroll views follow the "Show scroll bars" setting in System Settings, changing as it does:
overlay scrollers float over the content, and legacy ones (always shown) take their strip from it,
so the content is laid out that much narrower or shorter. `scrollbar-width: thin` draws small
scrollers, `none` hides them, and `scrollbar-gutter: stable` keeps a legacy vertical scroller and
its strip while the content fits. A scroll along an axis a scroll view cannot scroll along goes to
the one around it, so a vertical scroll over a horizontal pager moves the page, and an inverted list
scrolls the way the user's scroll direction setting says. A trackpad drag sends `(scrollBeginDrag)`
and `(scrollEndDrag)`, its momentum or a page settling `(momentumScrollBegin)` and
`(momentumScrollEnd)`, and `pagingEnabled` settles on a page as the gesture ends, or once a mouse's
wheel stops. A click focuses a focusable view, and a focus a key moved reports `focusVisible` and
draws AppKit's focus ring unless the view styles `outline`.

## Controls

The platform controls are AppKit's own, sized for Yoga at their `controlSize`: `<native-button>`
is an NSButton (Return presses a `default` one and Escape a `cancel` one), `<switch>` an NSSwitch,
`<activity-indicator>` an NSProgressIndicator, `<segmented-control>` an NSSegmentedControl and
`<date-time-picker>` an NSDatePicker and `<search-field>` an NSSearchField, drawn at its control
size's height in the middle of its element, with `@ng-native/expo`'s iOS contract: a text older
than what has been typed since is skipped, Return sends `(search)`, the clear button and Escape
empty the field and send `(cancel)` (keeping the keyboard), and `focus()` and `blur()` are its view
commands. Its type is its CSS's, and `tintColor` colours the cursor.

## Text inputs

A `<text-input>` is an NSTextField, or an NSSecureTextField for `secureTextEntry` (swapped in place
as the prop changes, keeping the text and the keyboard), and a multiline one an NSTextView. Its
props map onto AppKit's text checking:

| Prop                | On macOS                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| `autoCorrect`       | spelling correction and text replacement                                                                        |
| `spellCheck`        | misspellings underlined as you type; follows `autoCorrect`, and is on when both are unset                       |
| `smartQuotes`       | curly quotes and dashes as you type (macOS only); follows `autoCorrect`                                         |
| `smartInsertDelete` | spaces added and removed around pasted and deleted words                                                        |
| `autoCapitalize`    | `none` turns sentence capitalization off (macOS 26 and later); `words` and `characters` capitalize what goes in |
| `maxLength`         | an insertion is cut to fit, never through a character                                                           |
| `secureTextEntry`   | every substitution and check off                                                                                |

An unset switch follows the user's setting in System Settings. `placeholderTextColor`, the
`selection` prop and `autoFocus` work as on iOS, and the field sends `(focus)` as it takes the
keyboard, by a click, Tab or `focus()`. The text and placeholder align as on iOS: with no
`textAlign`, to the leading side of the layout (the right when `I18nManager.isRTL`), and a
`textAlign` that is set is not turned round in right to left, so `auto`, `start` and `left` stay on
the left and `end` and `right` on the right. That differs from `<text>`, where right to left puts
`auto` and `start` on the right, `end` on the left, and swaps `left` and `right`, as on iOS.
`writingDirection` sets the base writing direction.

## Libraries compiled in

When the app has them installed, the host compiles in the Fabric components of
`react-native-screens`, `react-native-safe-area-context`, `react-native-svg` and
`react-native-webview`, and the shared C++ of `react-native-worklets` and
`react-native-reanimated`:

- A native stack keeps every screen mounted, shows the top one and hides those below it, and sends
  `willAppear` and `appear` (which the router waits for) as a screen comes to the top. Push and pop
  swap at once.
- The header of the screen in front is the window's toolbar: its title is the window title, the
  back and forward chevrons lead, bar buttons and their menus sit at their side, and a header
  item's own content moves into a toolbar item. The chevrons follow the window's history, which
  `@ng-native/router` reports (`setHistory` on `NgNativeMenus`), and show beside a sidebar with no
  header too; a press and hold or a secondary click on one lists that way's entries by title, and
  a pick goes that many steps. An app with no router history gets a back chevron while the stack
  has a screen below. `hideBackButton` hides the pair, and the header's own left items replace it.
  The title is drawn by the system: `titleColor`, `titleFontFamily`, `titleFontSize` and
  `titleFontWeight` are not applied, since AppKit has no public way to restyle a window's title.
- A header's `<native-search-bar>` (`RNSSearchBar` in a `searchBar` header item) is an
  NSSearchToolbarItem at the toolbar's trailing end, which collapses to a button in a narrow
  window. It takes `placeholder` (also its label), `autoCapitalize`, `textColor` and `tintColor`
  (the caret), and sends what iOS sends: `changeText` as the text changes (the clear button
  included), `searchButtonPress` on Return, `cancelButtonPress` and an empty `changeText` on
  Escape, and `searchFocus` and `searchBlur`. The `focus`, `blur`, `setText`, `clearText` and
  `cancelSearch` commands work; `placement`, `hideWhenScrolling`, `obscureBackground`,
  `hideNavigationBar` and `cancelButtonText` are iOS's and do nothing. A toolbar rebuilt while
  the field is being typed in keeps it typing.
- The window's content runs under the title bar and toolbar, and each safe-area view gets the part
  of the window's safe area it overlaps: `RNCSafeAreaProvider`'s `insetsChange` (with the window
  controls' width as `titlebarLeading`), `RNCSafeAreaView` and `RNSSafeAreaView`.
- A screen whose `stackPresentation` is not `push` is presented over its stack, as a `<modal>`
  is: `modal`, `formSheet` and `pageSheet` as a sheet on the window, `fullScreenModal`,
  `transparentModal` and the contained ones as a cover in the window, and one with an `anchor`
  (which `present()` writes) as an NSPopover at that view. The screen under it stays showing and
  keeps the toolbar. A sheet has no toolbar, so it draws the screen's header itself: the title as
  a heading at the top, and the bar buttons as a row at the bottom right, the left ones first,
  the first of those on Escape, and the last of the row the default button on Return. A popover
  draws no header and takes the title as its accessibility label. Escape, Cmd-W and a click
  outside a popover send `dismissed`.
- The tabs (`RNSTabsHostIOS`) are the window's sidebar: its source list holds the tabs and the
  content pane shows the selected screen. The tabs outlet commits the props it commits on iOS,
  and the host keeps iOS's selection handshake: the app's `navStateRequest`, stale and repeated
  requests refused, `preventNativeSelection`, and `tabSelected` with its provenance (`user` for a
  click, `programmatic-js` for a request). The first tab shows until the app asks for one, and
  the tabs not selected stay mounted, neither drawn nor hit.
- An svg (`RNSVGSvgView`, which `@ng-native/icons` commits) draws its elements with Core Graphics:
  groups, paths, rects, circles, ellipses and lines, linear and radial gradients, clip paths,
  luminance masks, `use` and `symbol`, images, and text in spans, with presentation inherited
  through `propList` and `currentColor` from the svg's `color`. Markers sit at a path's or line's
  vertices with `orient` (`auto`, `auto-start-reverse` or an angle), `markerUnits`, `refX` and
  `refY`, their viewBox and their box clipping them. A pattern fills or strokes with its tile,
  drawn once and repeated, in either units, with its viewBox, content units and
  `patternTransform`. A filter draws its element offscreen and runs its steps over the pixels:
  `feGaussianBlur`, `feOffset`, `feColorMatrix` (all four types), `feFlood`, `feComposite` (every
  operator) and `feMerge`, with named results, `SourceGraphic` and `SourceAlpha`, the region and
  each step's subregion in either units, so a drop shadow drawn from them works. Text takes
  `text-anchor` per chunk, as Chrome does, where a span's own `x` starts a chunk, and so does its
  own `y` except on a `textPath`, where `y` places nothing. A `textPath` sets its text along the
  shape it names, each glyph (a grapheme cluster, drawn as its run shaped it, kerning and joined
  forms kept) at the point its middle reaches and turned with it, from `startOffset`, with
  `side="right"` reversing the path; a glyph whose middle is off the path is not drawn. A span's or
  a `textPath`'s `opacity` applies once to all the text it holds. A `foreignObject` draws the views
  in it, as react-native-svg does on iOS: at its `x` and `y`, cut to its `width` and `height`, in
  its place among the shapes, and under the transforms, opacity, clip paths, masks and filters
  around it, and draws again when a commit changes one of them. It draws them from their layers,
  so they take no clicks, and what a layer does not draw into its own contents, such as a video or
  a visual-effect (glass) view, does not show; an image that loads after the commit shows at the
  svg's next draw. `feBlend` and the other filter steps draw nothing, a `textPath`'s `method` and
  `spacing` are not read, and text has no letter spacing.
- A web view (`RNCWebView`, which `<web-view>` and `@ng-native/web-compat`'s `<iframe>` commit) is
  a WKWebView loading `newSource` (a url with its method, body and headers, a `file:` url, or
  `html` at its `baseUrl`), with the library's iOS events, scripts and commands: the injected
  scripts before and after the content, `window.ReactNativeWebView.postMessage` sent as `message`,
  `postMessage` dispatched in the page as a `MessageEvent`, `injectJavaScript`, back, forward,
  reload, stop and `loadUrl`. As on iOS each navigation waits for
  `RNCWebViewModule.shouldStartLoadWithLockIdentifier`. The view also takes `originWhitelist`: a
  page navigation to an origin outside it is not made, and the url opens in its own app only when
  the user clicked a link or submitted a form to it and Linking would open it (not `file:`,
  `javascript:`, `data:`, `vbscript:` or `blob:`); any other is cancelled, so a page's script
  cannot open an app or a share on its own. `about:` and `data:` pages always pass. `incognito` is
  read when the view is made, and `clearHistory` and `clearFormData` do nothing, as WebKit has no
  way to.
- Worklets run on the UI thread, and Reanimated's shared values, animations and worklet styles move
  views at the display's rate, with no frames requested while nothing animates.

## Expo's views

`<expo-glass>` (`ViewManagerAdapter_ExpoGlassEffect_GlassView`) is drawn by the host: Liquid Glass,
NSGlassEffectView, from macOS 26 (found by name, so any SDK builds it), and an NSVisualEffectView
before it, behind the view's children in its own corners, with `glassEffectStyle` (`regular`,
`clear`, `none`), `tintColor` and `colorScheme`. `<expo-glass-container>` is a plain view.

`<expo-image>` (`ViewManagerAdapter_ExpoImage`) is drawn by the host, with no module of its own:
the source nearest the view's size in pixels, placed by `contentFit` and `contentPosition`, with
its `tintColor` and `blurRadius`, faded in over `transition`'s duration (every effect is a
cross-dissolve). The placeholder shows until the image arrives, a `blurhash:` or `thumbhash:` one
decoded in the core. A `recyclingKey` changed from one key to another clears the image shown at
once, so a reused view never shows the last item's image while its own loads. Remote images are
kept by `cachePolicy` in memory (64 MB) and on disk in the app's caches, by their `cacheKey` or url;
`file:` and `data:` sources are read each time. It sends
`loadStart`, `load` (with `cacheType` and the source's size and media type), `error` and
`display`. Animated images show their first frame, and `expo-image`'s module (prefetch, clearing
the caches) is not there.

## Views with no macOS counterpart

Views with no macOS counterpart are absent from the host's view registry (`absent-views.h`), which
JavaScript reads as `__nativeComponentRegistry__hasComponent`, each with its reason: one committed
anyway is a plain view whose children still show. They are `<refresh-control>`'s
`PullToRefreshView` and `AndroidSwipeRefreshLayout` (a Mac has no pull to refresh),
`<input-accessory-view>` and react-native-keyboard-controller's views, though the library is
compiled in (a Mac has no software keyboard), and the community `slider`, `picker` and
`masked-view`, whose libraries have no macOS view (`@expo/ui`'s `ui-slider` and `ui-picker` are
SwiftUI's on macOS).
