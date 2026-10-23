## 0.17.1 (2026-10-20)

### 🩹 Fixes

- The packages run on Expo SDK 58 (React Native 0.88, gesture-handler 3, Reanimated 4.7) as well as SDK 57, and the template stays on SDK 57. ([#1039](https://github.com/ng-native/ng-native/pull/1039))

  - `@ng-native/expo` and `@ng-native/web-compat` accept the SDK 58 versions of the Expo modules they peer on, and `@ng-native/components` gesture-handler 3, so npm installs them beside an SDK 58 app.
  - The `@ng-native/metro` config plugin no longer stops `expo prebuild` on SDK 58, whose template has a scene delegate of its own: it keeps Expo's, and installs the iOS 27 status bar fix from the app delegate instead. On SDK 57 it writes what it did before.
  - `FileSystem.write` has written by the time it returns on SDK 58, where `File.write` answers a promise, by calling `writeSync`.
  - `StatusBar`'s `backgroundColor` and `translucent` do nothing and warn once on React Native 0.88, which removed both setters, where they threw a `TypeError` on Android.
  - Gestures attach with gesture-handler 3, which installs its bindings itself.
  - The Metro preset resolves React Native's `NativeAnimatedHelper`, which sticky headers move through, by its file, so an app bundles on React Native 0.88 without a warning about that package's exports.

- `ByRole` in `@ng-native/testing` takes `disabled`, `selected`, `checked`, `busy` and `expanded`, as React Native Testing Library's does, so `findByRole('button', { name, disabled: false })` waits for the button to be enabled. ([#1024](https://github.com/ng-native/ng-native/pull/1024))

  A state is read from the node's `accessibilityState`, which the components and the `aria-*` attributes write. When nothing sets a state, its value is false for `disabled`, `selected` and `busy`, and unset for `checked` and `expanded`; `checked` counts only on a `checkbox`, `radio` or `switch`. A `<text-input>` with `editable` false is disabled.

- An Angular CLI workspace's native project gets a `typecheck` target, `ng run native:typecheck`, which runs `ngc` on its code and templates, and `ng generate component` writes into the project's `src/app`. ([#1038](https://github.com/ng-native/ng-native/pull/1038), [#1033](https://github.com/ng-native/ng-native/issues/1033))

  `ng add @ng-native/schematics` and `ng generate @ng-native/schematics:application` write the target, run by the new `@ng-native/schematics:typecheck` builder: it loads the project's `metro.config.js`, so a Tailwind sheet `src/main.ts` imports exists, then runs `ngc -p tsconfig.json --noEmit`. The `native-typecheck-target` migration, which `ng update @ng-native/schematics` runs, adds it to each existing native project in `angular.json` that has no `typecheck` target. An `angular.json` with comments or trailing commas is left as it is, with a note saying what to add. A component generated from the project's own directory, the workspace root or outside the project now goes in `src/app/<name>`, beside `app.ts`, rather than at the project's root. Run from a directory inside `src`, it still goes there.

- `nx typecheck` passes on a library `@ng-native/nx:library` generates in Nx's TypeScript preset, whose `tsconfig.base.json` turns on `declarationMap`, where it failed with TS5069. ([#1034](https://github.com/ng-native/ng-native/pull/1034), [#1031](https://github.com/ng-native/ng-native/issues/1031))

  The generated `tsconfig.typecheck.json` now sets `"declarationMap": false` beside `"composite": false`. The `library-typecheck-declaration-map` migration, which `nx migrate` runs, adds the same line to the `tsconfig.typecheck.json` of a library generated before, or notes a config with comments, which it leaves as it is. See [Updating an app](https://ng-native.com/guide/updating).

- The Metro transformer wraps the Babel transformer of the app's own `expo`, where in a pnpm workspace it could wrap a newer SDK's `@expo/metro-config` that pnpm had installed beside `@ng-native/metro`. ([#1035](https://github.com/ng-native/ng-native/pull/1035), [#1030](https://github.com/ng-native/ng-native/issues/1030))

  pnpm resolves `@ng-native/metro`'s optional `@expo/metro-config` peer to the newest release, so an SDK 57 app in an Nx workspace was transformed by SDK 58's transformer. The copy beside `@ng-native/metro` is now used only when `expo` cannot be found from Metro's working directory, and an `expo` that cannot be read is reported rather than passed over.

### ❤️ Thank You

- Ashley Hunter
- Emanuel Hosu @Emanuel-Hosu

## 0.17.0 (2026-10-20)

### 🚀 Features

- An engine node's fields with names a DOM element also uses are renamed: `children` is now `childList`, `text` is `nodeText`, `kind` is `nodeKind`, `host` is `engine` and `sheet` is `templateSheet`, on `EngineNode`, `HostNode`, `StyleTarget` and `ViewNameNode` from `@ng-native/fabric` and `BrowserNode` from `@ng-native/web`, so read the new name where you read the old one, or let the `engine-node-fields` migration do it (`nx migrate @ng-native/nx@latest`, `ng update @ng-native/schematics` or `npx @ng-native/migrate@latest`, as [Updating an app](https://ng-native.com/guide/updating) describes). ([#946](https://github.com/ng-native/ng-native/pull/946))

  A node read as an element by code written for the web no longer has a field of the engine's hiding the DOM member of the same name. The migration rewrites a read only where the code shows it is read from one of those types, and prints a note with the file and line for each it cannot place in a file that imports one of them, for each read of a `nativeElement`, and for each read from a node cast to another type. A node's `props` keep their names: `props['text']`, a text input's value, is read as it was, and the migration leaves it alone.

- `display: block`, `flow-root` and `inline-block` are laid out as block containers, and an element that relied on them being read as `flex` needs `flex` instead. ([#957](https://github.com/ng-native/ng-native/pull/957))

  Adjoining vertical margins collapse between a block's children, between a block and its first or last child, and through an empty block; the flex properties on a block and on the boxes in its flow are ignored, as a browser ignores them; and a block whose children are all `inline-block` lays them out in lines that wrap. Before, each was read as `flex`, so margins added and `flex-direction: row` on a `block` made a row. `mount()` also takes `layoutConformance: 'strict'`, which lays the app out without Yoga's legacy quirks: a percentage inset or size of a `position: absolute` box is of its container's padding box, as CSS has it.

  An inline-block or inline-flex box among blocks, alone or with others, is on a line as tall as the font's line height, as in a browser: the box sits on the baseline, the room under it is kept below the line as a margin of the box, and a line it wraps onto starts under that room. A `box-sizing: content-box` block holding only inline-level boxes is as tall as its lines: one line tall when they fit on one line. A percentage height of a box on a line is of the block it is in. A box beside text sits on the baseline of that text, and a box `vertical-align` sets to the top, the middle or the bottom of its line has no room under the baseline added under it. A line taller than its block with a height of its own reaches down out of it from the top. A clipped flex box or span on a line keeps the baseline of its text, and only an inline-block that clips sits on the baseline by its bottom edge.


### 🩹 Fixes

- `margin: auto` on a `position: absolute` or `fixed` box between two insets takes the room left over, as in a browser, when the box has a size of its own on that axis. ([#959](https://github.com/ng-native/ng-native/pull/959))

  With no size there, the box fills the room between the insets and its automatic margins are 0, unless a min or max size clamps it, and then they share what is left.

  `inset: 0; margin: auto` centres a box of a set size, where it stayed at the top left.

- A `position: absolute` or `fixed` box with both insets on an axis, an `auto` margin on it and no size of its own there takes the room the insets leave, clamped by its min and max sizes, where it shrank to its content or to nothing. ([#995](https://github.com/ng-native/ng-native/pull/995))
- `@ng-native/fabric` exports `isNamedColor`, `parseColor`, `tokenFromValue` and `boundDeclaration`, the engine's own readers of a colour, a token and a bound declaration, for a package that reads CSS values outside a sheet. ([#982](https://github.com/ng-native/ng-native/pull/982))
- `pod install` no longer fails with "Unable to find a specification for `ExpoUI`" for an app that does not depend on `@expo/ui` in a workspace where another package or the root has it: `@ng-native/expo` builds its `@expo/ui` modifiers only where the app's own `package.json` lists `@expo/ui`. ([#1023](https://github.com/ng-native/ng-native/pull/1023))
- `@ng-native/expo` takes `expo-local-llm` 0.8.1, whose Android side uses ML Kit's published Prompt API, so an Android build with the module in it resolves again. ([#933](https://github.com/ng-native/ng-native/pull/933), [#824](https://github.com/ng-native/ng-native/issues/824))

  `LanguageModel` treats the module as available on Android as well as iOS: a build without its native half there reports `notInstalled`, as on iOS.

  On Android the module needs `minSdkVersion` 26; the language model page says how to raise it with `expo-build-properties`, or how to keep the module out of the Android build instead. `generateObject()` rejects on Android, where `expo-local-llm` 0.7 and later refuse a schema, and `maxTokens` is no longer capped at 256 there.

- `Engine.conditions` is what the engine was last given by `updateConditions`, the window size, colour scheme, motion preference and text size, for a package that answers a media query from a script. ([#987](https://github.com/ng-native/ng-native/pull/987))
- `Engine.conditions` answers the conditions an engine was made with, as an app's engine is, where it was undefined until the first `updateConditions`. ([#991](https://github.com/ng-native/ng-native/pull/991))
- `DeepLinks` from `@ng-native/device` has `follow(path)`, which hands a path of the app's own to its listeners as a link that arrived from outside is handed, so the router navigates to it. ([#1004](https://github.com/ng-native/ng-native/pull/1004))

  In an app with no listener, such as one without `provideNativeRouter()`, the path goes nowhere.

  `NATIVE_HISTORY` from `@ng-native/device` is the `PlatformLocation` that `provideNativeRouter()` provides; a fallback `PlatformLocation`, such as web-compat's, yields to it when both are present.

- `configure({ asyncUtilTimeout })` and `resetToDefaults()` from `@ng-native/testing` set how long `waitFor`, every `findBy*` query and `waitForElementToBeRemoved` keep trying when a call passes no `timeout`, as in React Native Testing Library. ([#1025](https://github.com/ng-native/ng-native/pull/1025))

  The default is still 1000 milliseconds, and a `timeout` a call passes still wins.

- The engine does less work per element as it commits and restyles: a style set is no longer copied to look for a transition, a node's own style is read without a copy where no rule on it is `!important`, and a node keeps the shape it is made with. ([#997](https://github.com/ng-native/ng-native/pull/997))
- A commit hands native each cloned view its children in one call, and matches the sheets of components rendered for the first time against the tree in one walk. ([#972](https://github.com/ng-native/ng-native/pull/972))

  The children go as an array, where a commit made one call per child, and the sheets are matched at the next commit rather than one walk per sheet. What is rendered does not change. `createFakeFabric` from `@ng-native/testing` takes a clone's children as React Native does, as the second argument of `cloneNodeWithNewChildren` and of `cloneNodeWithNewChildrenAndProps`; a test that wraps those methods passes the children on.

- A `calc()` that adds a token to a percentage, `calc(100% - var(--handle))`, sizes, places and spaces a box, where it was dropped. ([#992](https://github.com/ng-native/ng-native/pull/992))

  The sum is settled where the box is, in every app's CSS, and follows the token changing.

- `calc()` of a percentage and a length is supported for a box's size, insets, margins, padding and `translate`, where it was dropped with a warning. ([#957](https://github.com/ng-native/ng-native/pull/957))

  `width: calc(100% - 2rem)` and Tailwind's `max-w-[calc(100%-2rem)]` work. The engine reads the box the percentage is of back from native and commits the box at what the sum comes to.

  A sum of a share of a height and a length, in a height, a least height or a basis down a column, is of the height a column gives the box it is in once that box is as tall as its content, as in a browser, where it was set aside. A sum that moves or sizes a box in such a box makes it taller first.

- The Metro transformer can be told which libraries, and which of the app's own directories, are written for a browser, which `withWebCompat()` from `@ng-native/web-compat/metro` does. ([#964](https://github.com/ng-native/ng-native/pull/964))

  Their flex containers are laid out as rows, a rule in such a directory that does not parse is dropped rather than failing the build, and the app is told which elements their selectors name. Without it, apps see no change.

- A `StatusBar` or `NavigationBar` claim with a property set to `undefined` leaves whatever the claim underneath said for that property, as a claim that leaves the property out does. ([#941](https://github.com/ng-native/ng-native/pull/941))

  Before, `bar.push({ style: maybeStyle, hidden: true })` with `maybeStyle` undefined put the bar back to the platform's own style while the claim lasted, and `navigationBar.push({ hidden: undefined })` showed a bar the claim underneath hid. `state()` no longer holds a property set to `undefined`, and `forScreens()`, which the router hands each screen on Android, carries the value underneath.

- `min-width: auto` and `min-height: auto` keep a flex item that shrinks at the size of its content, as a browser does. ([#957](https://github.com/ng-native/ng-native/pull/957))

  An icon in a crowded row keeps its width, and a box in a column that is too short keeps its height. The engine applies it down a column, and along a row when no text in the item can wrap. Yoga reads them as no minimum, so they are not passed to it. An item that relied on shrinking below its content sets `min-height: 0` in a column, or `min-width: 0` in a row.

- `provideNativeKeyboard()` from `@ng-native/expo/keyboard` follows the keyboard on Android as it moves, from a native module of the package's own. ([#935](https://github.com/ng-native/ng-native/pull/935), [#832](https://github.com/ng-native/ng-native/issues/832))

  A `<keyboard-dock>` and the content its `[keyboardLift]` moves are moved on the native side at every frame, by how far the keyboard covers the dock on screen, so a dock that is not at the bottom of the window, or is in a form sheet react-native-screens raises with the keyboard, rises only as far as it must, and one in a `<modal>` follows the modal's keyboard. A `<keyboard-avoiding-view>` follows the keyboard frame by frame from the new `Keyboard.position`, where it jumped to its resting place before, since Android animates no layout alongside the keyboard by default; `Keyboard.metrics` carries the motion's duration there, with `'easeOut'`. The module applies no inset, so the app keeps its edge-to-edge layout, in landscape too. Off Android, and in a build without the module, it provides nothing.

  `Keyboard.followsMotion` and `Keyboard.position` from `@ng-native/device` are new, as are `KeyboardSource.subscribeMotion` and the `KEYBOARD_MOTION` token.

- On Android, a horizontal `<scroll-view>` or `<virtual-list>` commits as React Native's `AndroidHorizontalScrollView`, with its content in an `AndroidHorizontalScrollContentView`, and is made again when `horizontal` changes, so one turned horizontal after it mounted scrolls sideways. ([#939](https://github.com/ng-native/ng-native/pull/939))

  Android chooses between its vertical and horizontal scroll view once, when the view is created, and the vertical one ignores `horizontal`. A scroll view whose `horizontal` changed was cloned, so it kept the axis it was created with. It is now created again, as React Native remounts it, which starts its scroll position and the native state of everything in it over. The same holds for an element of an app's own registered as `ScrollView`, and for a scroll view inside a `<refresh-control>`'s swipe layout. `viewNameOf` answers `AndroidHorizontalScrollView` for such an element on Android. iOS is unchanged: one scroll view, which takes `horizontal` as a prop.

- A `position: absolute` box with no vertical inset in a block sits under the bottom margin of the box before it, as in a browser, and a percentage `margin-top` or `margin-bottom` on an absolute box is a share of its container's width. ([#959](https://github.com/ng-native/ng-native/pull/959))
- `@ng-native/web-compat` gives a library the CSSOM. ([#983](https://github.com/ng-native/ng-native/pull/983))

  `document.styleSheets`, a `<style>`'s `sheet`, `CSSStyleSheet` with `insertRule`, `deleteRule`, `replace` and `replaceSync`, a sheet a script makes and adopts with `document.adoptedStyleSheets`, and the CSSOM's rule classes are there. A `<style>` a library puts in the page while the app runs is read and applied as it comes in, as its text changes and as it leaves, with what holds it too: the layout properties, colours, custom properties and transitions it declares, `@media` by the window's width (one `min-width` or `max-width`; any other query is passed over with a warning) and `@supports`. `element.style` is a `CSSStyleDeclaration`, with `cssText`, `setProperty`, `getPropertyValue`, `removeProperty`, shorthands written as their longhands and the `style` attribute as its text, and a style a library binds is set as what a native view reads. `getComputedStyle` answers what the element, a rule or the element's name gives it, a `hidden` element is drawn as `display: none`, and `CSS.escape` and `CSS.supports` are there.

- `@ng-native/web-compat` is a new, experimental, opt-in package for rendering a component library written for the browser, and this first release is partial. ([#976](https://github.com/ng-native/ng-native/pull/976))

  `provideWebCompat()` gives the engine's nodes the core DOM members such a library calls (`nodeName`, attributes, `classList`, the nodes around one, `appendChild`, `insertBefore`, `removeChild`, `textContent`, `addEventListener` and `dispatchEvent`), provides a `document` that creates engine nodes and whose `body` draws over the screen for overlays, defines the basic `window` globals, and delivers a `click` listener from a press. `withWebCompat()` from `@ng-native/web-compat/metro` names the libraries and directories written for a browser to the build. Nothing changes in an app that does not add the provider, and everything it adds is taken away when the app is destroyed. Selectors, `element.style`, geometry, observers, forms and the rest of the DOM come in later releases.

- `@ng-native/web-compat` draws a library's `<canvas>`, whose 2D context draws with react-native-svg's native views, the ones an `<svg>` is drawn by. ([#1002](https://github.com/ng-native/ng-native/pull/1002))

  It draws paths, rectangles, arcs and rounded corners, strokes with their caps, joins and dashes, text, gradients, patterns, clips, transforms and `globalAlpha`. A canvas drawn again each frame moves the shapes it has rather than making new ones. The shapes drawn, not the text, can be read back with `getImageData`, drawn onto another canvas with `drawImage`, and written as a PNG by `toDataURL` and `toBlob`, and pixels can be put with `putImageData`. On React Native, `toBlob` hands its callback null, and `toDataURL` has the PNG. `isPointInPath`, `isPointInStroke`, `measureText` and `globalCompositeOperation` are there too, and so are `ImageData`, `CanvasRenderingContext2D`, `CanvasGradient` and `CanvasPattern` where the runtime has none. A canvas's `width` and `height` set the grid it draws on. Drawing an `<img>` on a canvas draws nothing. There is no bitmap: a clear of part of a canvas, and the ways of laying a drawing over what is there other than `source-over` (and `copy` where nothing clips it), change only the pixels read back.

- A canvas stroke drawn under a transform that stretches one way more than another, or skews, is shown as wide along each way as a browser draws it, where it was one width all round. ([#1015](https://github.com/ng-native/ng-native/pull/1015))

  A text stroked under a transform is as wide as the line, where the transform scaled it twice, and a gradient or pattern a text is painted with runs from where the canvas has it, where it ran from the text's place.

  A shape drawn again without the transform it had is drawn with none on iOS, where it kept the old one.

- With `@ng-native/web-compat`, what a template or a script writes inside a `<canvas>` is fallback content that stays in the document and is never drawn, whatever its styles say and its text included, as in a browser. Taken out of the canvas, it is drawn where it is put. ([#1013](https://github.com/ng-native/ng-native/pull/1013))

  `registerHoist` in `@ng-native/fabric` answers a function that takes the registration away again.

- A Vitest run with `ngNative()` from `@ng-native/testing/vitest` no longer leaves a directory in the system temp directory. ([#975](https://github.com/ng-native/ng-native/pull/975))

  Vitest copies each module it runs there and, when the config has no `projects`, never removed it; the plugin now removes it as Vitest closes.

- A `virtual-list` with `estimatedItemHeight` measures an item handed a recycled row view at the same place and size as the view's last item, so its separator is drawn and the separators below it line up with their rows after `items` changes. ([#1000](https://github.com/ng-native/ng-native/pull/1000), [#990](https://github.com/ng-native/ng-native/issues/990))

  React Native reports a layout only when a view's frame differs from the last one it reported, so such an item was never measured: it had no separator, and every separator below it was offset by the difference between the estimate and its real size.

- A `matrix()` transform bound to a view after a native transition or animation of its transform is drawn where the matrix puts it, set on native as the move, turn, skew and scale it is. ([#971](https://github.com/ng-native/ng-native/pull/971))

  It stayed where the animation left the view, since no commit changes a transform native has set.

- `NativeTabsOutlet` stays on the tab a cold-start deep link opens, where native's late answer to the outlet's request for the first tab could send the app back to it, on Android and less often on iOS. ([#1010](https://github.com/ng-native/ng-native/pull/1010), [#1005](https://github.com/ng-native/ng-native/issues/1005))

  The outlet no longer navigates on a `tabSelected` that native reports for a request the outlet made itself (`actionOrigin: 'programmatic-js'`). Taps, and selections native makes on its own, still navigate.

- On iOS, `SvgImages.render()` no longer asks react-native-svg for a view that is not mounted yet, which showed a red box in development (`Invalid svg returned from registry, expecting RNSVGSvgView, got: (null)`) and left a release build's tab icon missing after three seconds. ([#999](https://github.com/ng-native/ng-native/pull/999), [#986](https://github.com/ng-native/ng-native/issues/986))

  Fabric mounts a commit on the main thread after the JavaScript task that made it, and `render()` asked for the view from inside that task. iOS finds no view then, and react-native-svg logs an error and never calls back rather than retrying. `render()` now asks a frame after the commit, once the view is mounted. Android already waited for the view, and is asked a frame later too. Fixes #986.

- A renderer extension can answer `named(name, namespace)` for what an element written inside an `<svg>` stands for, groundwork for drawing a library's inline `<svg>` natively with react-native-svg. ([#970](https://github.com/ng-native/ng-native/pull/970))

  The shapes it creates are drawn as a browser draws them, painted by the library's stylesheet: paint handed down from a group, `currentColor`, no box on a shape, and a text's size and weight sent in its font on Android. `registerViewName` takes `spacedText` for a span that keeps its spaces, and `Engine.setTouchTarget` lets a package say which shape a touch is on. `@ng-native/web-compat` builds on these; `@ng-native/icons` icons and every other view render as before.

- With `@ng-native/web-compat`, an `<svg>` and its shapes are matched by attribute selectors on the attributes they are given, as `svg[width="16"]` and `path[fill="none"]` are in a browser, and a style a script sets on a shape is no attribute of it, to `getAttribute()`, a selector or a copy. ([#1014](https://github.com/ng-native/ng-native/pull/1014))
- An `inline-block` or `inline-flex` box in a `display: block` container is as wide as its content where that content includes a row with a percentage width or `flex-1` cells: a calendar written as `inline-flex` around a `w-full` header is as wide as its days, where it filled its container. ([#957](https://github.com/ng-native/ng-native/pull/957))
- Less of a long child list is styled again as it changes, where a stylesheet asks about places in one. ([#953](https://github.com/ng-native/ng-native/pull/953))

  - Rows added or removed one at a time mark each row before or after the change once a commit, not once for each change: a chart appending or removing thousands of points no longer takes quadratic time.
  - A rule that reads an element's place from under it (`text:nth-child(odd) .label`) restyles under elements of its own name only.
  - A class change is weighed against `[class^=...]` and `[class$=...]` by the whole attribute before and after, rather than restyling everything under the element for any class.
  - A style bound to a token again as it was (`fill="var(--ink)"` written again) changes nothing.
  - A sibling test nested in the element's own compound (`.a ~ .x:is(.peer ~ *)`) no longer restyles everything under any element whose place changes: a chart shown again after a label beside its series came and went restyled every point.

- `extendNodes()` lets a package replace `tagName`, a getter the engine only reads out for Angular, as it may replace `classList`; every field the engine writes on a node is still refused. ([#974](https://github.com/ng-native/ng-native/pull/974))
- `extendRenderer()` in `@ng-native/platform` and `extendNodes()` in `@ng-native/fabric` let a package outside core take over listeners, attributes, properties and bound styles, and give engine nodes members of its own. ([#963](https://github.com/ng-native/ng-native/pull/963))

  They also tell the package as elements are created, inserted and removed. `registerViewName()` now returns a function that restores what the element name was before, and `registeredViewName()` is exported. They are what an opt-in web-compatibility package is built on.

- Content projected into an `@if` or another control-flow block of a component keeps its event listeners, and an element that hoists keeps hoisting, when the block closes and opens again. ([#938](https://github.com/ng-native/ng-native/pull/938))

  When such a block closes, Angular destroys the nodes an `<ng-content>` at its top projects, though they belong to the component that declared them, and when it opens it puts the same nodes back without listening to them again. The engine dropped their listeners there, so a projected `(layout)` handler or a `<pressable>`'s hover stopped firing, and it stopped hoisting an element such as `<native-header>` or `<native-toolbar>` into its screen. Listeners now go when the view or directive that added them tears them down.

- `position: fixed` and `position: sticky` are supported, where both were dropped with a warning. ([#959](https://github.com/ng-native/ng-native/pull/959))

  A fixed box is positioned against the page it is on, the screen or modal it is inside or else the whole app, wherever in the page it is written. Inside a scroll view or a box that clips it is committed under the page instead, so it neither scrolls nor is clipped, while it is still styled and bubbles events as its parent's child. A sticky box sticks `top` from its scroll view's top edge (or `left`, in a horizontal one) at any depth inside it, and stops at the end of its parent. A sticky box with a `transform` of its own is drawn with both, as in a browser. In a grid, a fixed box is placed against its page and a sticky item stays in its area. A `position: absolute` child of a grid is placed against the lines its `grid-column` and `grid-row` name, or at the grid's padding edge with no inset, moved by its `justify-self` and `align-self`.

- A percentage gap down a flex container as tall as its content is no gap, as in a browser, where it was a share of the room on offer. ([#957](https://github.com/ng-native/ng-native/pull/957))
- A `height`, `min-height` or column `flex-basis` that is a percentage of a box as tall as its content is that share of the content's height, as a browser lays out a flex item: `height: 50%` beside a 40px box is 20px, where it was no height at all, and `min-height: 50%` there is 20px, where it was half the screen. ([#957](https://github.com/ng-native/ng-native/pull/957))
- A percentage `flex-basis` on an item of an `inline-flex` row that is itself an item of a flex container is a share of the row again, and a column that wraps around a percentage height keeps content that just fits on one line instead of breaking it onto a second. ([#996](https://github.com/ng-native/ng-native/pull/996))
- The engine can commit an element whose CSS says `overflow: auto` or `overflow: scroll` as a scroll view around one content view. ([#969](https://github.com/ng-native/ng-native/pull/969))

  What overflows it scrolls as it does in a browser. The box, its size, border and background, is the scroll view's; its padding, gap and flex layout are the content view's. It applies only to an element a package marks with the new `scrollsOverflow` export from `@ng-native/fabric`, which nothing on its own calls yet, so an app's views are committed as they were and `overflow` stays layout alone for them.

- `order` is supported on the children of a flex container, where it was dropped with a warning. ([#957](https://github.com/ng-native/ng-native/pull/957))

  The engine commits them in that order. `inline-flex` is kept as a box that sits in a line, as `inline-block` is: in a `display: block` container it is as wide as its content rather than stretched, a block holding only such boxes lays them out in lines, and a run of them among blocks shares a line. In a flex container it is laid out as before.

- A renderer extension's `named(name, namespace, engine)` is given the engine the element is created in, as its other hooks are, and only an element it answers for, with another name or its own, is a library's drawing. ([#989](https://github.com/ng-native/ng-native/pull/989))

  An extension can now answer for the apps that asked for it and leave another app in the process alone.

- An app's stylesheet compiles `:is()`, `:where()` and `:not()` of any selector, and `:has()` of any relative selector, where each was dropped with a warning. ([#950](https://github.com/ng-native/ng-native/pull/950))

  `:is(.a + .b)` and `:not(.list > *)` are among the first, `:has(+ .next)`, `:has(~ .panel .mark)` and `:has(.row > .badge)` among the second. A `:has()` on a box before the styled element, `.card:has(.action) + .title`, is matched too, and so are Tailwind's `group-has-*` and `peer-has-*` variants. Each is as specific as in a browser, and a list that mixes such a selector with a compound keeps both.

- The Metro preset has Expo build a lazy route's chunk URL from the dev server in a development build on iOS and Android, as Expo does where there is no global `location`. ([#1004](https://github.com/ng-native/ng-native/pull/1004))

  Expo's native chunk URL is built from `location.origin` where there is one, and `@ng-native/web-compat` gives the page an `exp://` address React Native cannot fetch from. A release build is left as Expo builds it.

- The Tailwind `browser` option names the classes that components written for a browser sit under, and a flex container with no direction under one is a row. ([#967](https://github.com/ng-native/ng-native/pull/967))

  With the option set, the whole sheet also reads `::before` and `::after` as boxes of their own, `visibility`, a clip to nothing, `overflow-x` and `overflow-y`, and `:checked`, `:indeterminate` and `:enabled` as a browser does.

- A package that keeps an element's attributes apart from its props can hand each one to `engine.keepAttribute()`, so that attribute selectors, `:has()` included, match it and restyle as it changes. ([#1014](https://github.com/ng-native/ng-native/pull/1014))
- A shorthand set in an element's inline style or bound on it (`padding`, `margin`, `inset`, `gap`, `border-width`, `border-color` or `border-radius`, or an axis form such as `padding-inline` or `paddingHorizontal`) now wins over a stylesheet's longhand on each side or corner it covers, as it does in a browser. ([#944](https://github.com/ng-native/ng-native/pull/944))

  Before, `[style.padding.px]="10"` on an element whose class set `padding-top: 4px` kept a top padding of 4, since Yoga and React Native read the more specific side first; the same held for a logical side such as `margin-inline-start`. The covered longhand is now committed with the shorthand's value, so a transition on it eases to that value, and it takes the stylesheet's value again once the shorthand is removed. A longhand the stylesheet marks `!important`, and a longhand the element sets itself beside the shorthand, still win over it.

- A numeric `flex` set in an element's inline style or bound on it now wins over a stylesheet's `flex-grow`, `flex-shrink` or `flex-basis`, so `[style.flex]="1"` grows under a class such as Tailwind's `grow-0`. ([#954](https://github.com/ng-native/ng-native/pull/954))

  Yoga reads each of those longhands over `flex`, so before, the class's value was kept. Each covered longhand now takes the value Yoga gives `flex` alone: for `flex: 1`, a grow of 1, a shrink of 0 and a basis of 0, which is React Native's `flex: 1` and not CSS's (CSS shrinks it as well). A longhand the element sets itself, or that the stylesheet marks `!important`, still wins, and a `flex` that is not a finite number covers nothing.

- A line of inline-blocks in a `display: block` box sized by `aspect-ratio` sits at the top of the box, as in a browser, where it sat on the bottom of the box and moved up or down with its height. ([#994](https://github.com/ng-native/ng-native/pull/994))
- A component named `Map`, `WeakMap`, `Object`, `Reflect` or `JSON` renders and hot-reloads in a development build. ([#937](https://github.com/ng-native/ng-native/pull/937))

  The code Metro adds to a component's file for hot reloading called those globals by name, and a class of the same name in the file is what it found, so the app failed as the file loaded, with `NG0203` for a component named `Map`.

- A component's host is matched again when a class its own `:has()` names comes or goes, and a `:has()` rule is asked only of a box with the classes and element it names. ([#952](https://github.com/ng-native/ng-native/pull/952))

  `:where(.group)` and `tr` are among the elements it names, and `:has(> )` is asked only of the box right above the change. An element keeps no record of the rules it matched once no sheet in play asks for one.

- `display: grid` is laid out, following CSS Grid Level 1, and Tailwind's grid utilities compile where they were dropped with a warning. ([#958](https://github.com/ng-native/ng-native/pull/958))

  Track lists take lengths, percentages, `fr`, `auto`, `min-content`, `max-content`, `minmax()`, `fit-content()` and `repeat()`. Items are placed by line number, by `span`, and by the names of lines and of `grid-template-areas`, in the order `order` gives. Gaps, alignment (baselines included) and `aspect-ratio` on a grid or an item are supported. A percentage `margin-top` or `margin-bottom` is a share of the item's area width. A grid keeps its own width, honours `min-width`, `max-width`, `min-height` and `max-height` on its tracks, and shrinks and stretches in a flex container as a box does. `inline-grid` sits in a line as `inline-block` does. A grid item's size or margin that is a `calc()` of a percentage and a length is of its area. Yoga has no grid, so the engine reads sizes back from native and places the items itself, in the commit that changed the grid. `subgrid` and the `grid` and `grid-template` shorthands are still dropped with a warning.

- The engine draws `::before` and `::after` boxes for a library or directory the build names as written for a browser. ([#966](https://github.com/ng-native/ng-native/pull/966))

  Each is a view first or last in the element a rule gives a `content`, styled by the rules for it, with the words a string `content` writes as its text. Any other CSS in an app still drops pseudo-elements with a warning.

- Smaller layout fixes come with block containers: `justify-self`, `vertical-align` lengths, `max-content`, the default width of text fields and relative offsets in wrapping rows. ([#957](https://github.com/ng-native/ng-native/pull/957))

  `justify-self` places a block of a set width along its line in a block, where it was dropped with a warning, and a block with no width keeps no `auto` margins. `vertical-align` takes a length for a box on a line, how far over the baseline it sits. `max-content` is read as `fit-content` on a width or a height, and as a cap at the content on `max-width` and `max-height`, where it was dropped. A text field with no width is as wide as its `size` in characters, and a text area as its `cols`. A relatively positioned box in a wrapping row moves by its offset on every line.

- `StatusBar`, `NavigationBar`, `KeepAwake`, `DeviceOrientation`, `Brightness` and `ScreenCapture` keep one stack of claims for every app the runtime mounts, and an app's claims leave it when the app is destroyed, so an app destroyed after another app has claimed leaves what that app claimed. ([#1020](https://github.com/ng-native/ng-native/pull/1020))

  On Android, each of them also gives an activity that comes to the front, a recreated one included, what is claimed again, so after a font size or display size change the screen still stays awake and out of screen capture where an app holds it. `ScreenCapture.prevent()` holds its key until `allow()` or until the app is destroyed. `@ng-native/device` exports `WindowClaims`, `TopClaim`, `sharedBySource` and `onWindowFront`, which these services are built on.

- With `@ng-native/web-compat`, a `touchmove` listener that is not passive and calls `preventDefault()` stops the page scrolling under the finger until the touch ends or is canceled, as a slider or a carousel asks a browser to. ([#1016](https://github.com/ng-native/ng-native/pull/1016))

  A passive listener on the window, the document or the body that calls `preventDefault()` does not prevent the event's default, as in a browser.

  A drag kept from the page, by a `touchmove` listener or by `touch-action`, holds every scroll view it is in, so a slider in a carousel in a scrolling page moves neither.

- `@ng-native/web-compat` draws a library's SVG with react-native-svg's native views, the ones `@ng-native/icons` draws with. ([#1001](https://github.com/ng-native/ng-native/pull/1001))

  An `<svg>` a template writes, markup builds or a script makes with `createElementNS` is drawn: shapes, groups, texts and their spans, a text along a path, gradients and their stops, clips, masks, markers, patterns, a drop shadow and HTML in a `foreignObject`. Its elements have SVG's names and namespace, `className` with `baseVal`, `getBBox`, `getComputedTextLength`, `ownerSVGElement` and `createSVGRect`. A style a script sets on a shape is its paint or its font, a paint that names a token is that token's colour, and a `light-dark()` paint is the side for the app's colour scheme. A `<template>` an icon's markup is bound to holds an empty box. `@ng-native/icons` is a peer dependency of the package. react-native-svg's JavaScript is never imported: without its native views a drawing shows nothing, as an icon does. An app that does not ask for the package draws its `<svg>` as it did, and icons drawn by `@ng-native/icons` commit what they did in either.

- `@ng-native/web-compat` finds elements by a selector: `querySelector` and `querySelectorAll` on an element, a fragment, the document and a document a script made, and `matches`, `webkitMatchesSelector` and `closest`. ([#981](https://github.com/ng-native/ng-native/pull/981))

  A selector is read as Selectors Level 4 has it, combinators, attribute operators and their case flags, `:is()`, `:where()`, `:not()`, `:has()`, `:nth-child(an+b of S)` and the rest, and one that cannot be read throws a `SyntaxError` as a browser throws. The pseudo-classes of where an element is, of its attributes, of its language and direction, and of the focus and a press match; one of a state nothing here reads, `:hover` or `:checked`, matches nothing.

- A `<style>` or constructed stylesheet made while the app runs draws `border`, its sides and parts, `outline`, `outline-offset` and each corner of `border-radius`, where it drew no border at all. ([#1019](https://github.com/ng-native/ng-native/pull/1019))

  A token in a border or outline, `border: 1px solid var(--c)`, is filled in where the rule applies, and `CSS.supports` answers true for one.

  A token and a plain declaration in one rule are applied in the order they are written, so `padding: var(--p); padding-top: 2px` pads the top by 2.

  A box whose display is `table` counts its border in its `clientWidth` and `clientHeight`, as Chrome does where its borders are not collapsed. A `<table>` scrolls nothing whatever its overflow says, and an `IntersectionObserver` sees a table clip what is in it, inside its border, only where its overflow is `hidden` or `clip`, as Chrome does.

- `@ng-native/web-compat` gives the page an address, read by `document.URL`, `baseURI` and `window.location`, and draws an `<iframe>` as a native web view. ([#1004](https://github.com/ng-native/ng-native/pull/1004))

  The address is the app's own URL with the route it is on: the one Expo opens the app with, `exp://` in Expo Go or the app config's `scheme` in a build, or the one `provideWebCompat({ url })` is given. A `<base href>` in the head changes what it resolves against. A relative link, an image's `src`, a form's `action` and the other URLs an element's attributes say resolve against it, an `<a>` and an `<area>` have the parts of their URL (`protocol`, `host`, `pathname`, `search`, `hash` and the rest), and `:target` matches the element the address's fragment names. `location.assign()` to a page of the app goes there through the router, as does a path outside Expo Go's `/--` on its own host, and opens any other URL with `Linking`. Angular's `Location` has a platform to stand on in an app with no router, and is the native router's in an app with one, in whichever order the two are provided.

  An `<iframe>` is a native web view from `react-native-webview`, an optional peer dependency, which runs and draws the page in it as a browser does. `src` and `srcdoc` say what it shows, it is 300 by 150 points unless its `width`, `height` or a stylesheet say otherwise, and `load` fires as its page finishes loading. `contentDocument` is `null`, as for a frame of another origin, and the app and the page talk with `postMessage` both ways. A `sandbox` without `allow-same-origin` gives the page the origin `null` in the messages the app sends and hears, and shows `srcdoc` with no base. The web view cannot give a page no origin, so a `src` page in such a sandbox still loads at its own origin, with its storage and cookies, and development says so. Where `react-native-webview` is not installed, and in Node, the frame is an emulated document of the app's own, which a script reads and writes, and `provideWebCompat({ frames: 'emulated' })` asks for that document in any app. `window.frames` and `window.postMessage` are there.

- `@ng-native/web-compat` reads and writes markup (`innerHTML`, `outerHTML`, `DOMParser`, `XMLSerializer`) and gives elements their names, namespaces, attributes and reflected properties. ([#979](https://github.com/ng-native/ng-native/pull/979))

  It also reads and writes `insertAdjacentHTML`, `setHTML` and its kin, and a `<template>`'s `content`, parsed by parse5 as a browser parses HTML, and an XML type as XML. Elements have their names and namespaces (`createElementNS`, `namespaceURI`, `prefix`, `localName`, `lookupNamespaceURI` and the rest, `getElementsByTagNameNS`), attribute names in a browser's case, `getAttributeNames`, attributes as `Attr` nodes, `dataset`, `innerText`, and the properties HTML reflects attributes as (`hidden`, `title`, `dir`, `tabIndex`, `type`, ARIA's and the rest), and `instanceof HTMLInputElement` and the other element interfaces answer. `document.implementation` makes HTML and XML documents that are never drawn, with doctypes, CDATA sections and processing instructions. A `<button>` and an `<a>` have their roles, a table's and a form's elements are views, and an element with an id is a global by it.

- `@ng-native/web-compat` finds an element in a `document.head` a script puts in the page once, so a global named by its id is the element and a query of the document counts it once. ([#1006](https://github.com/ng-native/ng-native/pull/1006))
- `@ng-native/web-compat` gives a library geometry and the observers. ([#984](https://github.com/ng-native/ng-native/pull/984))

  `getBoundingClientRect` and `getClientRects` answer `DOMRect`s, and `offsetParent` and the `offset`, `client` and `scroll` sizes and positions are read from where native last laid an element out, with what is pending committed first. An element whose style says `overflow: auto` or `scroll` scrolls what overflows it, with `scrollTop` and `scrollLeft`, `scroll`, `scrollTo`, `scrollBy` and `scrollIntoView`. `window.screen`, `visualViewport`, `matchMedia`, `ResizeObserver` and `IntersectionObserver` are there, and an app that observes nothing pays nothing for them. A `<style>` read while the app runs takes `@media` by the window's height, which way up it is and the colour scheme and motion the user asked for, as well as its width, and `getComputedStyle` answers a `width` or `height` an element has none of its own of as it is drawn.

- `@ng-native/web-compat` gives a library the DOM's forms. ([#988](https://github.com/ng-native/ng-native/pull/988))

  An `<input>` and a `<textarea>` are the platform's text field, as wide as a browser's, with `value` read as it is typed and `defaultValue` as written, `input` as it is typed and `change` once the edit ends, each key as a `keydown` and `keyup` with its `key` and `keyCode`, and return in a field of one line as Enter, which submits its form. Its `type`, `inputmode`, `autocomplete` and `maxlength` are the keyboard and entry native has for them, and `readOnly`, `disabled` or a disabled `<fieldset>` around it make it one that cannot be typed into. A `<select>` shows its chosen `<option>`, has `value`, `selectedIndex`, `options` and `add()`, and opens a list of its options when it or its label is pressed. `checked` is the state a click, a script or a binding sets, and a radio checked unchecks the rest of its group. A control has `validity`, `willValidate`, `validationMessage`, `checkValidity()`, `reportValidity()` and `setCustomValidity()`, and `:valid`, `:invalid`, `:in-range`, `:out-of-range`, `:placeholder-shown`, `:checked`, `:indeterminate` and `:default` match. A field has `selectionStart`, `selectionEnd`, `setSelectionRange()` and `select()`, a `<textarea>` says how tall its text is as `scrollHeight`, and a file input's `click()` opens the system's file picker, where `@ng-native/expo` and `expo-document-picker` are installed. A form has `elements`, `requestSubmit()` and `reset()`, is submitted only once its controls pass their constraints, and `document.forms` lists them. A plain app's `<text-input>` is unchanged.

- `@ng-native/web-compat` takes the focus off an element a script moves to another parent, or off the one in it that has it, as a browser does, and `moveBefore` keeps it. ([#1007](https://github.com/ng-native/ng-native/pull/1007))
- An app using `@ng-native/web-compat` can open a file picker of its own for a file input by providing `FILE_PICKER`, now exported with its `FilePicker` type. ([#1013](https://github.com/ng-native/ng-native/pull/1013))
- `@ng-native/web-compat` gives a library the DOM's events. ([#985](https://github.com/ng-native/ng-native/pull/985))

  `MouseEvent`, `PointerEvent`, `KeyboardEvent`, `FocusEvent`, `TouchEvent`, `Touch` and the other kinds are there with the members their init dictionaries give, `document.createEvent` makes each with its `init*Event`, `window.event` is the event a listener is being told, and an element has its handler properties, `onclick` to `onload`. A press reaches a listener as a `PointerEvent`, a touch is the mouse going down and up as a phone's browser tells it, and a finger held still is a `contextmenu`. A click does what it does in a browser, from a press, a script or `element.click()`: a checkbox or a radio is checked and says `input` and `change`, a button submits or resets its form, and a label clicks or focuses its control. `focus()` and `blur()` take effect at once, on a button, a link or what has a `tabindex` as on a text field, with `document.activeElement`, `:focus`, and `focusin` and `focusout` heard on the document. A button and a link take a press with no listener, and are `:active` while held, `data-hover` while a pointer is over them, and announced as disabled while they are.

- A web library's HTML elements start with a browser's default box sizing and display in an app that uses `@ng-native/web-compat`. ([#1017](https://github.com/ng-native/ng-native/pull/1017))

  A library's HTML elements are now sized `content-box` and its blocks are blocks, as in a browser: padding and border add to an element's width and height, and a `div`, a `p`, a `section`, a list and the other block elements lay out as `display: block`, while a `button`, a `select` and a `table` stay `border-box`. This changes layout for apps using web-compat; an author style or a stylesheet still wins over each default, and an app that does not call `provideWebCompat()` lays out as before.

- `@ng-native/web-compat` gives nodes the rest of the DOM tree a browser library walks and changes. ([#978](https://github.com/ng-native/ng-native/pull/978))

  That is live `childNodes` and `children`, `append`, `prepend`, `replaceChildren`, `replaceChild`, `before`, `after`, `replaceWith`, `insertAdjacentElement`, `moveBefore`, `cloneNode`, `getRootNode`, `compareDocumentPosition`, `isEqualNode`, `normalize`, the words of a text or a comment (`data`, `splitText` and the rest), and live `getElementsByTagName`, `getElementsByClassName` and `getElementsByName`, each checked as a browser checks an insertion first. `document.createDocumentFragment`, `createTreeWalker` and `createNodeIterator` are there, the document holds its doctype and its element as a browser's does, and `MutationObserver`, `NodeList`, `HTMLCollection`, `Text`, `Comment` and `DocumentFragment` are globals while an app that asked for the package is up.

- With `@ng-native/web-compat`, `window.devicePixelRatio` answers the screen's pixel ratio, so a canvas or a chart sized by it is drawn sharp, and the engine's conditions carry it as `pixelRatio`, read again when the window is resized. ([#1016](https://github.com/ng-native/ng-native/pull/1016))

### ❤️ Thank You

- Ashley Hunter
- Emanuel Hosu @Emanuel-Hosu
- erKam @erkamyaman
- Gabriel Silva @GabeSilvaDev
- Wassim Aarab @WassimAarab08

## 0.16.0 (2026-10-17)

### 🩹 Fixes

- On Android, `ui-date-picker`'s `range` now limits the dates that can be picked, and its `accessibilityLabel` is what TalkBack reads, with `@expo/ui` 57.0.21 or later. ([#928](https://github.com/ng-native/ng-native/pull/928), [#924](https://github.com/ng-native/ng-native/issues/924))

  Compose's date picker reads the range as `selectableDates`, in milliseconds, and the label as the `semantics` modifier's `contentDescription`, so a picker's committed `modifiers` on Android now include it. The typed components also stop sending Compose the SwiftUI props it never reads: an image's and a menu's props and added modifiers, a button's `label`, `systemImage` and `role` (the label is still drawn as text inside it), a toggle's `label`, a date picker's `title`, a host's `ignoreSafeArea` and a slot's `extraProps`.

- `UiContextMenu` and `UiViewHost` are exported from the main `@ng-native/expo` entry, beside the other typed `@expo/ui` components. ([#919](https://github.com/ng-native/ng-native/pull/919), [#911](https://github.com/ng-native/ng-native/issues/911))

  They were exported only from `@ng-native/expo/expo-ui-components`, so `import { UiContextMenu, UiViewHost } from '@ng-native/expo'` failed. That entry still exports them too.

- `ui-view-host`'s `matchContents` sizes it to the element it holds again with `@expo/ui` 57.0.23 and later, on iOS and Android, which a `ui-context-menu` trigger and a `ui-bottom-sheet` with `fitToContents` rely on. ([#923](https://github.com/ng-native/ng-native/pull/923), [#910](https://github.com/ng-native/ng-native/issues/910))

  From 57.0.23 the native view reads `matchContentsHorizontal` and `matchContentsVertical` in place of `matchContents`, so the host filled what SwiftUI or Compose offered it instead: a sheet with `fitToContents` opened taller than its content. `ui-view-host` now sends both forms, so it sizes to its element on either side of the change.

- When a component's template does not compile, the error for its `templateUrl` or `styleUrl` file now names the component and says its template did not compile, instead of a Babel `Unexpected token` at the top of the stylesheet or template file. ([#918](https://github.com/ng-native/ng-native/pull/918), [#917](https://github.com/ng-native/ng-native/issues/917))

  The Metro transformer retries a file whose Angular stage failed through Babel, so a TypeScript mistake is reported at its line and column. A stylesheet or a template file is not JavaScript, so Babel always failed on it, and its syntax error replaced the component's. Only a JavaScript or TypeScript file is retried now. A dev server may report the resource file's failure before the component's own, so this was the error a developer could see first.

- A `<markdown>` image is drawn at its own size once it loads, as a browser draws it, and is narrowed to the document's width, keeping its shape, only when it is wider, instead of being scaled to the document's width. ([#922](https://github.com/ng-native/ng-native/pull/922), [#906](https://github.com/ng-native/ng-native/issues/906))

  The size comes from the image's load event on iOS and Android, so a small picture such as an icon keeps its size. An image is still drawn at the document's width with a 200-point height until it loads. A class of the app's own given for `img` in `classes` sets the width instead. On the web host the load event carries no size, so an image there keeps the document's width.

- A `ui-host` with `matchContents` in a `native-header-item` of type `title` or `center` now sizes to its content on iOS, instead of measuring 0 by 0 and hiding the header's title. ([#927](https://github.com/ng-native/ng-native/pull/927), [#909](https://github.com/ng-native/ng-native/issues/909))

  react-native-screens makes a title item the bar's title view at its Yoga size, and UIKit lays out no title view of 0 by 0, while a host sized to its SwiftUI content has no size until it is laid out. On iOS a title item now has a least size of one point each way, under any size the app gives it, so its content is laid out and measured.

- On iOS, a `<ui-picker>` with no `label` is drawn, where it drew nothing. ([#930](https://github.com/ng-native/ng-native/pull/930), [#908](https://github.com/ng-native/ng-native/issues/908))

  SwiftUI's picker view in `@expo/ui` draws nothing without a label, so `UiPicker` now sends an empty one when `label` is not set. A segmented picker never shows its label anyway.

- On iOS, `ui-image`'s `size` and `color`, `ui-gauge`'s `type` and its three labels, `ui-label`'s `color`, and the `accessibilityLabel` of `ui-date-picker` and `ui-menu` now take effect in the app, where SwiftUI ignored them before. ([#926](https://github.com/ng-native/ng-native/pull/926))

  SwiftUI's views read none of these as props, so each is now sent as `@expo/ui`'s own components send it. A `ui-image`'s `size` is a `font` modifier of that size (a `font` modifier in `modifiers` wins over it) and its `color` a `foregroundStyle` modifier. A `ui-gauge`'s `type` is a `gaugeStyle` modifier, and each label is a `ui-text` in the slot SwiftUI reads it from. A `ui-label`'s `color` draws its symbol as the label's icon in that colour. An `accessibilityLabel` is the `accessibilityLabel` modifier. Each is added after the `modifiers` given, so a committed `modifiers` list now includes them.

  `ui-button` no longer sends `target` to native, which no `@expo/ui` button reads: a widget or Live Activity layout still compiles it as before. `ui-view-host` sends `modifiers` on Android only, as SwiftUI's view host has none.

### ❤️ Thank You

- Ashley Hunter

## 0.15.0 (2026-10-16)

### 🩹 Fixes

- A colour bound as a style and made of tokens, `color-mix(in srgb, var(--brand), white 20%)` or a relative colour such as `color(from var(--brand) srgb r g b)`, is worked out from the tokens where it is used, where it reached native as text and painted nothing. ([#866](https://github.com/ng-native/ng-native/pull/866))

  The channels of a relative colour set on an element can use `min()`, `max()` and `clamp()`, and a relative colour in `color()`'s `srgb` is worked out there too.

- `ui-bottom-sheet` takes a `backgroundColor` input, and a `background-color` on the element from CSS, as the colour of the sheet: SwiftUI's `presentationBackground` on iOS and the container colour of Compose's sheet on Android. ([#875](https://github.com/ng-native/ng-native/pull/875), [#852](https://github.com/ng-native/ng-native/issues/852))

  On iOS 26 a sheet below its full height is drawn as glass, and there was no way to make it opaque. The colour can come from a class, a stylesheet, a Tailwind utility or `[style]`, follows a `var()` and a theme change, and is dropped when it is removed. The input wins over CSS. `Engine` gains `takePaint`, which hands a node's resolved background colour to a listener instead of painting it.

- A `<ui-slot name="header">` or `<ui-slot name="footer">` in a `ui-section` is now the section's header or footer on iOS, where it was drawn as one of its rows. ([#912](https://github.com/ng-native/ng-native/pull/912), [#899](https://github.com/ng-native/ng-native/issues/899))

  `@expo/ui`'s `SectionView` reads them as slots of its own beside its `content`, and `ui-section` put everything it held inside `content`. A header slot lets a section's heading be any view, with its own font, where `title` is plain text. A `title` still wins when both are set: `@expo/ui`'s `SectionView` draws a non-empty `title` and drops the header slot, and an empty `title=""` counts as unset.

- `<text-input>` takes `rows` as an input, so a multiline field sized by `rows` no longer logs "has no prop 'rows'" in development, and `rows` is no longer sent to the native field on iOS or Android. ([#901](https://github.com/ng-native/ng-native/pull/901), [#895](https://github.com/ng-native/ng-native/issues/895))

  `rows` can be bound as well as written as an attribute: `[rows]="lines()"`. The engine reads it for the field's height as before, and neither platform's native field has a prop of that name.

- `(scroll)` and `(keyPress)` on a `<text-input>`, and `(contentSizeChange)` on a multiline one, fire on Android, where the native field was never asked to send them. ([#903](https://github.com/ng-native/ng-native/pull/903), [#858](https://github.com/ng-native/ng-native/issues/858))

  Android's text field sends each only when the `onContentSizeChange`, `onScroll` or `onKeyPress` prop is set, as React Native's `TextInput` sets it when a handler is passed. A field that listens for one of them now commits that prop on Android. iOS is unchanged: its field reports content size when the field itself changes size, as React Native's does, and the input docs now say so.

- An SVG shape whose `fill` or `stroke` contains a colour React Native cannot read, such as a custom property set to a typo, is drawn with no paint of its own instead of stopping the app. ([#864](https://github.com/ng-native/ng-native/pull/864))
- On Android, an `<ng-icon>` that loses a `pointer-events` it had, such as one inherited from a `<virtual-list>` row that was parked and then reused, no longer stops the app with a NullPointerException in react-native-svg. ([#891](https://github.com/ng-native/ng-native/pull/891), [#884](https://github.com/ng-native/ng-native/issues/884))

  A `pointerEvents` that goes away is now committed as `auto` rather than `null`, on every view and on both platforms. React Native's own views already read a `null` as `auto`, so they behave as before; react-native-svg's Android root view called `toUpperCase` on the `null`.

- On Android, a native stack screen now keeps a `statusBarStyle` or `statusBarHidden` that its page's host binding sets to the same value the app's `StatusBar` claim carries onto it, when that claim changes or is dropped. Such a value was taken off with the claim, so the bar followed the new claim, or went back to light text and shown. The router tells a screen's own status bar props from the claim's by whether its presentation or a host binding wrote them, as it already did for `navigationBarHidden`. ([#916](https://github.com/ng-native/ng-native/pull/916), [#913](https://github.com/ng-native/ng-native/issues/913))
- A CSS transition of a size or a place (`width`, `height`, the insets, the margins, `flex-basis`), and a `@keyframes` animation of a size, now animate on Android where layout animations are off, which is React Native's default there and always so in Expo Go, instead of jumping to where they end. ([#902](https://github.com/ng-native/ng-native/pull/902), [#883](https://github.com/ng-native/ng-native/issues/883), [#859](https://github.com/ng-native/ng-native/issues/859))

  `getFabricUIManager()` reads React Native's `enableLayoutAnimationsOnAndroid` or `enableLayoutAnimationsOnIOS` feature flag for the platform given to `registerPlatformComponents()`, and where it is off, leaves out `configureNextLayoutAnimation`, so the engine eases them from JavaScript, a commit on every frame, as it does on any host with no layout animation. Eased that way, it stalls while JavaScript is busy. An Android app that turns layout animations on, with the `@ng-native/metro` plugin's `android.layoutAnimations` option, still has them played by native.

- `<search-field>` draws its text in the `font-family`, `font-size`, `font-weight` and `font-style` its CSS resolves to, on iOS and Android, so a field matches the text around it, including in an app with its own `@font-face` faces. ([#893](https://github.com/ng-native/ng-native/pull/893), [#890](https://github.com/ng-native/ng-native/issues/890))

  The font comes from a class on the field, its own style, or what it inherits. A face the app declares is matched by weight and style, as a `<text>`'s is, and the system font or a family no `@font-face` declares is drawn at that weight, and slanted for `italic`, as a `<text>` is. The size scales with the system text size setting. A field whose CSS sets none of them keeps the system font at its own size, as before; one inside a page that sets a font now takes it. On iOS a field in the system font larger than about 21px is taller than its 56-point default height, and needs a height to match.

- A CSS transition of a size or a place that is started again before it ends, twice in a row, such as a progress bar stepping its `width`, is now committed where it ends from that third start on where it is eased from JavaScript, as it already was where native plays it as a layout animation. On a host with no layout animation, which includes Android unless the app turns them on, such a bar no longer keeps JavaScript committing on every frame for as long as it moves. Each step is drawn at once, which departs from CSS, where every step would ease. Once the size is left alone for as long as its transition lasts, the next change eases again. ([#904](https://github.com/ng-native/ng-native/pull/904))
- A prop that no rule asks of an element before another (`[data-on] ~ .x`, `#lead + .x`) no longer restyles every element after the one it changed on, and neither does a style bound to a token (`[style.color]="'var(--ink)'"`), where a stylesheet has sibling rules. ([#888](https://github.com/ng-native/ng-native/pull/888))

  A long list whose rows set props as they change, such as a chart's points under a finger, styles the changed row alone. A global sheet that asks about a prop that way starts restyling the rows after it as it is added, and stops once it is removed or replaced.

- When a `<native-stack-outlet>` or `<native-tabs-outlet>` is destroyed, it clears its route's context only while that context is still its own, as Angular's `RouterOutlet` does. A sheet presented over the tab bar, with a stack of its own and swiped away, cleared the tab bar's place in the page under it as that page came back, so the next tab chosen opened inside the first tab's stack, or left the screen blank, while the bar showed the new tab selected. ([#892](https://github.com/ng-native/ng-native/pull/892), [#886](https://github.com/ng-native/ng-native/issues/886))
- An ICU plural or select, or an element inside an `i18n` message, renders on iOS and Android in a development build, where it threw `ASSERTION ERROR: The provided value must be an instance of a DOM Node` and drew nothing. ([#885](https://github.com/ng-native/ng-native/pull/885), [#882](https://github.com/ng-native/ng-native/issues/882))

  Angular's development checks test each node with `instanceof Node`. The Metro preset's polyfill defines a `Node` that recognises the engine's nodes, but React Native's `InitializeCore` runs after the polyfills and replaces the global with its own `Node`, which does not. `mount()` now makes whichever `Node` is on the global then answer `true` for engine nodes, and answer as before for every other value, as it already does for `Element`.

- A class added to a view before a frame has drawn it no longer starts a transition, as in a browser: Spartan's sheet, committed once before its directive's `effect` adds `bg-popover`, appeared with a 200ms fade from transparent, and now appears at once. A change made once the view has been drawn eases as before. ([#876](https://github.com/ng-native/ng-native/pull/876))
- `@ng-native/device` adds `NavigationBar`, a stack of claims on Android's navigation bar like `StatusBar`'s, with `set()`, `push()` and a `state` signal: `style` picks light or dark buttons for three-button navigation on Android 8 and later, or `'auto'` to follow `ColorScheme`, an in-app `ColorScheme.set()` included, and `hidden` hides the bar until a swipe shows it for a moment. ([#907](https://github.com/ng-native/ng-native/pull/907), [#831](https://github.com/ng-native/ng-native/issues/831))

  It drives `expo-navigation-bar`'s native module, reached by name: Expo Go has it, and a development build needs `npx expo install expo-navigation-bar`. Without the module, and on iOS, the web and in Node, claims are kept in `state` and change nothing. A fixed style is sent again on a scheme change, which resets the buttons on Android. On Android with the module, the native stack outlet from `@ng-native/router` puts a `hidden` claim on every screen without a `navigationBarHidden` of its own, as it does the status bar claim, since `react-native-screens` sets the bar's visibility from the screen in front each time one appears.

  `@ng-native/fabric`'s `EngineNode` gains an optional `writes` set: a node that has one records which props have been written to it, which is how the outlet keeps a page's own `navigationBarHidden` that equals the carried claim.

- A `<markdown>` table scrolls sideways when it is wider than the page, with each column as wide as its widest cell (up to 280pt), instead of squeezing every column into the page's width. ([#865](https://github.com/ng-native/ng-native/pull/865), [#850](https://github.com/ng-native/ng-native/issues/850))

  A table is now a horizontal `scroll-view`, and each cell is a `view` that holds its text, so a custom `th` or `td` class styles the text inside a cell rather than the cell. A narrow table is drawn at its content's width.

- `<markdown>` takes a `streaming` input for a source that arrives a chunk at a time, keeping the blocks before the last one and holding back what has not closed yet: a code span, emphasis, a link, an image, a table row or a code fence's opening line. A fenced block's code streams in once its opening line ends. ([#867](https://github.com/ng-native/ng-native/pull/867), [#851](https://github.com/ng-native/ng-native/issues/851))

  While `streaming` is set, only the last block is lexed again on a change, so the cost of a chunk does not grow with the length of the document, except for a chunk that defines or changes a link reference, which lexes the whole source again since it can change an earlier block. Clearing `streaming` draws the whole source as written. Streaming or not, a block that did not change keeps its native views, where before every block was drawn again on any change to the source. A paragraph or heading no longer carries the whitespace at its end, which it never drew.

- `<markdown>` draws an image written into the document as a base64 `data:` url of a raster picture, PNG, JPEG, GIF or WebP, as a web editor writes a pasted screenshot. It drew its alt text. Any other `data:` url, an SVG or HTML among them, is still drawn as its alt text, as is every scheme but `http` and `https`. ([#905](https://github.com/ng-native/ng-native/pull/905))
- A dev bundle for iOS or Android no longer fails, and an edit hot-swaps instead of reloading the app, when a component whose `styleUrl` or `templateUrl` is shared has an aliased `@if (x; as y)` or a `@switch` in its template. ([#900](https://github.com/ng-native/ng-native/pull/900), [#894](https://github.com/ng-native/ng-native/issues/894))

  `compileForHmrSync` reports a warning about these blocks beside an update that is complete, and the Metro transform took any report for a template that did not compile. A stylesheet or template module then threw, which failed the dev bundle with a syntax error on that file, and an edit to an inline template with these blocks reloaded the app instead of swapping. Only an error from the compiler stops a hot update now; a template that does not compile still fails the build, naming the component.

- A `:has()` whose argument is a list with an ancestor test in it, such as `.card:has(.x:is(.p *, .y))` or Tailwind's `has-*` with a custom variant written as `:where([data-theme=midnight], [data-theme=midnight] *)`, matches either alternative, as a browser does, instead of needing both. A `:has()` inside another `:has()` is dropped with a warning, as a browser drops it as invalid. ([#863](https://github.com/ng-native/ng-native/pull/863))
- A change under many `:has()` rules walks each box's subtree once for all the rules that box asks, and not again under a box above it already walked, where it walked it once for each rule, so an app with many such rules, as Tailwind's `has-[...]` variants and component libraries write them, opens a screen much faster. ([#877](https://github.com/ng-native/ng-native/pull/877))
- A change beneath a box, such as a child added or a class changed on one, checks the box's `:has()` rules again without matching everything else under the box again. ([#881](https://github.com/ng-native/ng-native/pull/881))

  The elements a rule asking `:has()` of the box is for are still matched again on their own. Opening a dialog under the root, with a class on the root changing in the same commit, no longer matches every element of the screen again.

- `deepLinkSource()` is exported from `@ng-native/device`. It was written and used by `DeepLinks`, and its type `DeepLinkSource` was exported, but the function was not, so an app that needs the whole address of a link, which `DeepLinks.subscribe` strips to a path, had to listen to React Native's `Linking` itself. ([#869](https://github.com/ng-native/ng-native/pull/869))
- `registerExpoViews('expo-video')` registers `SurfaceVideoView` on Android, which is what `expo-video` names its view there, and `registerExpoViews('expo-blur')` registers the `ExpoBlur` module's `ExpoBlurView`. Before, Android stopped with "Can't find ViewManager 'ViewManagerAdapter_ExpoVideo_VideoView'" the first time a video showed, and there is no `ExpoBlurView` module to find. `registerExpoView`'s `viewName` takes `{ ios, android }` for a view named differently on each platform. ([#878](https://github.com/ng-native/ng-native/pull/878))

  `videoPlayer()` gives the player's shared-object `id`, which is what `<expo-video [player]>` takes: bound to `player.native`, the view had no player and drew nothing, while the video kept playing with nothing on screen. Bind `[player]="player.id"`.

- A font or an image a DOM component's stylesheet names in a relative `url()` now loads in development, where a font fell back to another and an image did not draw. ([#898](https://github.com/ng-native/ng-native/pull/898), [#897](https://github.com/ng-native/ng-native/issues/897))

  The dev server serves a page from `/_expo/@dom/`, so a `url()` left relative was asked for there and failed. Each one that names a file Metro takes as an asset is now pointed at the file on Metro's dev server, `/assets?unstable_path=...`, which serves a file outside the project too, such as a package in a pnpm store at the workspace root. A `url()` to any other file, or to one that is not there, is left as written, with Expo's warning that it is not supported.

- A class changing restyles only what a test of the class attribute, such as `[class^="p-"]`, or a `:has()` naming it can reach, where any class change under such a test restyled the element and everything under it. ([#880](https://github.com/ng-native/ng-native/pull/880))

  A test of the class attribute now reaches what a class written in its place would: the element, or the elements a rule is for under it. A class or class test named only inside `:has()` asks the boxes above the element again and matches nothing under it again. A `:has()` such as `.p-floatlabel:has([class^='p-'][class$='-fluid'])` no longer has a class added to the root restyle the whole screen. One named only in `:has(> )` asks just the box right above the element.

  A `:has()` rule in a component's own styles, such as `:host:has(.on)`, now follows a change beneath the host, where it kept what it matched before.

- `Camera` records video: `record(options)` resolves with `{ uri }` once the recording stops, and `stopRecording()` stops it. Like `takePicture()`, they call the functions `expo-camera` defines on the view, with the view's tag, so no React ref is needed. The view needs `mode="video"`. ([#879](https://github.com/ng-native/ng-native/pull/879))

### ❤️ Thank You

- Ashley Hunter
- Emanuel Hosu @Emanuel-Hosu
- Shahar Kazaz @shaharkazaz
- Wassim Aarab @WassimAarab08

## 0.14.0 (2026-10-15)

### 🚀 Features

- A push to a page of the tab bar from a screen over the bar, pushed on the app's own stack or presented, goes back to the bar: to that tab where it was left, with the page pushed onto it. It built a second tab bar over the screen, which took the first bar's pages, so a tab in it could show a page no longer told it was in front, and going back could leave a blank tab. A page of the tab in front presented over such a screen goes to the presented outlet, as a page of another tab does. A second tab bar is no longer built this way; an app that wants a screen over the bar opens a route outside it. ([#801](https://github.com/ng-native/ng-native/pull/801))
- A `<native-tab>` icon can be SVG markup, `[icon]="{ svg: lucideHeart }"`, drawn once into a tinted template image by the renderer `withSvgIcons(SvgImages)` provides, with `SvgImages` from `@ng-native/icons`. Neither platform's tab bar draws SVG, so `SvgImages` draws the markup as an `ng-icon` beside the tab bar for a frame, asks react-native-svg for it as a PNG at the screen's scale, and removes it. The icon is 25 points square on iOS and 24 on Android unless it gives a `size`, and the tab has no icon until it has been drawn. `SvgImages.render(svg, size, at)` is public for any other place that takes an image rather than a view. `native-toolbar-item` still takes only `systemImageName`. ([#818](https://github.com/ng-native/ng-native/pull/818), [#814](https://github.com/ng-native/ng-native/issues/814))
- A `line-height` with no unit written in a `style`, `style="line-height: 1.5"`, `[style.line-height]="'1.5'"` or `[style.line-height]="1.5"`, is now a multiple of the font size, as it is in a stylesheet, where it was 1.5 points. Text inside it multiplies its own font size by the number, as in a stylesheet. A style that meant points this way, `style="line-height: 20"` or `[style.line-height]="20"`, needs its unit: `line-height: 20px`. A number in a style object, `{ lineHeight: 24 }`, is still points. A negative `line-height` in a style is dropped with a warning, as a browser drops it. ([#803](https://github.com/ng-native/ng-native/pull/803))

  A `padding`, `margin`, `inset` or `gap` with a value for each side, `style="padding: 4px 8px"`, sets each side, where native dropped the text and the element had none. One with more values than it takes, `padding: 1px 2px 3px 4px 5px`, is dropped with a warning. `!important` in a `style` attribute is read as it is in a bound style, where the value was dropped.

- An engine node's element tag is now `tag` rather than `name`, on `EngineNode`, `StyleTarget`, `ViewNameNode` and `NamedHostNode` from `@ng-native/fabric` and `BrowserNode` from `@ng-native/web`, so read `node.tag` where you read `node.name`, or let the `engine-node-tag` migration do it (`nx migrate @ng-native/nx@latest`, `ng update @ng-native/schematics` or `npx @ng-native/migrate@latest`, as [Updating an app](https://ng-native.com/guide/updating) describes). ([#809](https://github.com/ng-native/ng-native/pull/809))

  `name` is the DOM's attribute, and a web library that set `input.name = 'email'` on a node renamed the element. The migration rewrites a `.name` only where the code shows it is read from one of those types, and prints a note with the file and line for each `nativeElement.name`, which an `ElementRef` without a type hides from the compiler, for each `name` read from a node cast to another type, such as `node as { name?: string }`, which still compiles after the rename, and for each other `.name` it cannot place in a file that imports one of them.

- `<ui-picker>` works on Android. Compose has no `Picker`, so the same element draws its options with Compose's controls: `pickerStyle="segmented"` as a row of segmented buttons, and any other style as an exposed dropdown menu under the chosen option. It committed as nothing there, and logged an error for its options. The Compose pieces are exported as components too: `UiSingleChoiceSegmentedButtonRow`, `UiSegmentedButton`, `UiExposedDropdownMenuBox`, `UiExposedDropdownMenu` and `UiDropdownMenuItem`. ([#807](https://github.com/ng-native/ng-native/pull/807))
- `<native-tab>` takes `role="search"` and `automaticallyActivatesSearch`, which make a tab the tab bar's search tab on iOS 26.1 and later: a `UISearchTab`, drawn as a circular button at the trailing end of the bar. An app built with the iOS 27 SDK needs both for that button on iOS 27, where `systemItem="search"` alone, or the role without `automaticallyActivatesSearch`, draws an ordinary item. Both need react-native-screens 4.29 or later; with an older one they do nothing. ([#823](https://github.com/ng-native/ng-native/pull/823))
- `<search-field>` from `@ng-native/expo/search-field` is the system search field outside a navigation bar, such as in a bottom sheet: UIKit's `UISearchBar` on iOS and AndroidX's `SearchView` on Android, with `<native-search-bar>`'s `placeholder`, `(search)`, `(cancel)`, `(searchFocus)`, `(searchBlur)` and `focus()`, `blur()` and `clear()`. Its text is a two-way `value`, and with `disabled` and `touch` it is a Signal Forms control: `[formField]` binds it as it binds a `<text-input>`. It is native code of `@ng-native/expo`, so a development build has to be rebuilt to pick it up, and Expo Go draws nothing for it. `@ng-native/expo` now depends on `androidx.appcompat` on Android, which React Native already brings. ([#821](https://github.com/ng-native/ng-native/pull/821), [#813](https://github.com/ng-native/ng-native/issues/813))

### 🩹 Fixes

- `StatusBar`'s `backgroundColor` and `translucent`, and the `statusBarColor`, `statusBarTranslucent`, `navigationBarColor` and `navigationBarTranslucent` screen presentation options, are deprecated: they do nothing under Android edge-to-edge, which is always on with Expo SDK 57. They still compile. On iOS `StatusBar` no longer sends `backgroundColor` or `translucent`, so React Native's "only available on Android" warning is gone, and on Android it warns once in development when one is set. `<modal>` no longer warns that `navigationBarTranslucent` needs `statusBarTranslucent`, since React Native turns both on under edge-to-edge. ([#835](https://github.com/ng-native/ng-native/pull/835))
- A border given its width or style after its colour is drawn in that colour on Android. A box made without a border and given one later, as a class or state changes, was drawn with a black border. ([#819](https://github.com/ng-native/ng-native/pull/819))
- A node that leaves the tree focused or pressed is not styled that way when it comes back, and leaves nothing pressed behind it. A field removed with the keyboard up came back matching `:focus`, and a card whose pressed button was removed mid-press stayed `:active` until the next press. A child with `inherit` follows a parent's bound `[style.x]` when it changes too, where it kept the first value. ([#802](https://github.com/ng-native/ng-native/pull/802))
- A focused field that a rule hides, `.field:focus { display: none }` or a box it is in, is shown again once hiding it has taken its focus away. It stayed hidden and unfocused, because the blur came in the middle of the commit that hid it. ([#802](https://github.com/ng-native/ng-native/pull/802))
- A commit asks nothing about transitions and animations until a stylesheet, an inline style or a prop the app gives declares one. Restyling and mounting are faster in an app that animates nothing, and unchanged in one that does. ([#836](https://github.com/ng-native/ng-native/pull/836))
- `DeepLinks` reads `/--/` as Expo Go's launch prefix only in a url's path. One in a query or a fragment cut the link there, so `https://example.com/search?q=/--/x` reached the router as `/x` and `myapp://notes?q=a/--/b` as `/b`. ([#804](https://github.com/ng-native/ng-native/pull/804))
- `<ui-date-picker [displayedComponents]>` works on Android. Compose takes one word for what the picker shows, `date`, `hourAndMinute` or `dateAndTime`, where SwiftUI takes a list, and the list was passed to both, so Android refused the prop with an error. ([#807](https://github.com/ng-native/ng-native/pull/807))
- A shorthand the build drops is dropped whole. `padding: 8px calc(50% - 10px)` warned that `padding` was dropped and still set the top padding, and an `inset` with a viewport unit before the value it could not take left an object where a number belongs. ([#805](https://github.com/ng-native/ng-native/pull/805))
- A commit steps over each unchanged child of a view that changed before asking anything else of it. A frame of a fade among the rows of a screen takes about half the time it did, and a commit that changes one row of a long list about a tenth less. ([#839](https://github.com/ng-native/ng-native/pull/839))
- A class list is split at the spaces HTML names (a space, a tab, a line feed, a form feed or a carriage return), and so is the list `~=` reads. A no-break space or a vertical tab split it into two classes, where a browser keeps either as part of one class's name. ([#845](https://github.com/ng-native/ng-native/pull/845))
- A bound style in `em`, `rem` or a viewport unit (`vw`, `vh`, `vmin`, `vmax`) is now measured as the same value in a stylesheet is. `[style.width]="'2em'"` is measured against the font size in scope and follows it when it changes, `'2rem'` is 32 points, and `'50vw'` follows the viewport. A bound `line-height` in `em` gives a line height in points, as a stylesheet's does. Each used to reach native as text, which native drops. So `<ng-icon size="2em" />` is now twice the font size around it, where it was drawn at `1em`. ([#786](https://github.com/ng-native/ng-native/pull/786), [#784](https://github.com/ng-native/ng-native/issues/784))
- A view with an `aspect-ratio` that stretches across its flex line is as wide as its column, or as tall as its row, as in a browser, where the ratio was taken over the stretch. In a column, a height given leaves the ratio nothing to work out; in a row, the height the ratio gives a width in points is the view's least height. An image keeps its picture's proportions. ([#842](https://github.com/ng-native/ng-native/pull/842))
- `aria-checked` written as an attribute reaches native as a boolean. `<view aria-checked="false">` was announced as checked, because the text `false` was passed on as it was. ([#803](https://github.com/ng-native/ng-native/pull/803))
- Text in a CSS system colour shows on Android. `CanvasText`, `FieldText`, `ButtonText` and `GrayText` (and the deprecated names for them) drew nothing there: they now take Android's `colorForeground`. `GrayText` is the text colour on Android, which has no grey of its own that follows light and dark. ([#820](https://github.com/ng-native/ng-native/pull/820))
- On Android, the app's `StatusBar` claim stays on after a push or a pop. A screen with its own `statusBarStyle` or `statusBarHidden` no longer leaves white icons, or a shown bar, on every screen after it: the stack outlet now puts the claim's style and visibility on each screen that has none of its own, and `StatusBar` has a new `forScreens` signal for it. ([#834](https://github.com/ng-native/ng-native/pull/834))
- A push into another tab now resolves `false` and shows nothing when a guard on the way redirects elsewhere: on the first screen of a tab nobody has opened, or on the page a tab covered by another screen was left on. Before, it resolved `true` and showed the page anyway. ([#825](https://github.com/ng-native/ng-native/pull/825))
- A `nativeRouterLink` inside a page presented over another tab now leaves that page, as `push()` from it does: the link goes to its url's own tab and the page is dismissed. An absolute link from the page no longer lands on the page's own url. ([#793](https://github.com/ng-native/ng-native/pull/793))
- A `nativeRouterLink` to a page of a tab nobody has opened now puts the tab's first screen under the page, as `push()` does, so Back lands on it. The same goes for a link or a `push()` with a relative url, such as `../library/7`. A query written into the link's url, such as `/library/7?from=home`, is now read as a query instead of being encoded into the path. ([#827](https://github.com/ng-native/ng-native/pull/827))
- A root guard's redirect at launch, such as one that sends the app to sign in, now lands before anything that arrives while it is still running: a screen pushed or presented, a deep link (with or without `withLinkParent`), or a page restored after a reload in development. Before, each of these cancelled the redirect and opened alone, past the guard. ([#789](https://github.com/ng-native/ng-native/pull/789))
- A transition of a size or a place that is started again before it ends, and again after that, is committed where it ends instead of as another native layout animation, so a progress bar that steps every few frames no longer keeps native laying the screen out on every frame. ([#799](https://github.com/ng-native/ng-native/pull/799))
- A page of another tab shown with `present()` puts the tab under it behind, so `SCREEN_IN_FRONT` is `false` for that tab's page while the sheet is up and `true` again once it is gone. Before, it stayed `true`, so a `<keyboard-dock>` on that page kept the keyboard under the sheet. ([#791](https://github.com/ng-native/ng-native/pull/791))
- `present()` of another tab's page, asked for while the app's first screen is still loading, shows the page over the first tab, as the same call made a moment later does. ([#792](https://github.com/ng-native/ng-native/pull/792))

  Asked at launch, with a lazily loaded tab bar not up yet, the page opened inside its own tab instead: the tab was selected and the page became the first screen of its stack. `present()` now waits for the first screen, as `push()` already did.

- `@oxc-angular/vite` is updated to 0.0.41, which fixes the compiler bugs the Metro transform guarded against, so those guards are removed: ([#798](https://github.com/ng-native/ng-native/pull/798))

  - A template arrow function that reads its own parameter, such as `open.update((was) => !was)`, compiles correctly and no longer fails the build.
  - A component's `host` and `styles` can use a spread, a concatenation, a constant or a `function` declaration in the same file. A value imported from another file now fails the build with the compiler's own error, which names the import.
  - An unclosed control-flow block such as `@if (on() {` is reported by the compiler; Angular's parser still places the error in the template.
  - A hot update no longer patches the compiler's update module, which now writes the template's fields itself.

  A capitalized element name such as `<View>` still fails the build, with a new message: `element <View> is capitalized`.

- `nx g @ng-native/nx:tailwind` keeps a leading `@charset` first when it adds Tailwind to an existing stylesheet, adds it to one that only mentions Tailwind in a comment, and writes a Tailwind 3 config that loads for a library in a directory named `require`, `module` or `exports`. ([#806](https://github.com/ng-native/ng-native/pull/806))
- `nx g @ng-native/nx:tailwind` run again for a second library keeps the first after a formatter has given the config double quotes, and writes a Tailwind 3 config that parses for a library in a directory named for a reserved word, such as `ui/switch`. ([#806](https://github.com/ng-native/ng-native/pull/806))
- `nx g @ng-native/nx:tailwind` puts Tailwind into a `src/styles.css` the app already has. It pointed Metro at the file and left it as it was, so every Tailwind class drew unstyled on a build that passed. ([#806](https://github.com/ng-native/ng-native/pull/806))
- An app that injects `Notifications` starts in Expo Go on Android, where it stopped on a red screen. ([#788](https://github.com/ng-native/ng-native/pull/788))

  `expo-notifications` cannot be imported there: it subscribes to push tokens as it loads, and that throws in Expo Go on Android, which has had no push since Expo SDK 53. The service now runs with no module behind it there, as it does on the web: nothing is scheduled or received, the permission is never granted, and a warning in the console says so. Expo Go on iOS and a development build are as before.

- A module missing from the build, in Expo Go say, is reported when the service is used, not when it is injected, so every page that uses it says what to install. A service threw as it was made, which left Angular's record of it marked as being made, and every page after the first failed with NG0200, "Circular dependency": `<expo-map>`, `<expo-camera>`, `Haptics` and the rest. The service is made inert, with `available` false and `available()` resolving to false where it has one, and a call on it, or a read of a value only the module knows, throws the `MissingModuleError`. A player, a database, `assets()` and the splash screen still throw when they are called. `AppInfo`'s `version`, `build`, `id`, `name` and `device` are read when asked. ([#807](https://github.com/ng-native/ng-native/pull/807))
- A `templateUrl` or `styleUrl` is read from the project when Metro is started from another directory, as `npx expo export apps/mobile` starts it. It was read from the directory the command ran in, and the build failed with a file not found. ([#805](https://github.com/ng-native/ng-native/pull/805))
- A dev server started again shows a template or stylesheet edited while it was stopped. A component with both a `templateUrl` and a `styleUrl` kept the old one until its other file was saved or the cache was cleared, because the cached module of the one put back what it was compiled with. ([#805](https://github.com/ng-native/ng-native/pull/805))
- A component whose template is only a comment builds, where it failed with "compiled to nothing". ([#805](https://github.com/ng-native/ng-native/pull/805))
- A media query list with a type a device is not, `@media screen and (min-width: 500px), print`, keeps its other queries. The whole rule was dropped with a warning, where only the `print` query never matches. ([#805](https://github.com/ng-native/ng-native/pull/805))

  The same holds with `only`: `@media only print, (min-width: 500px)` keeps the width query.

- A `min-height` or `min-width` over a `max-height` or `max-width` wins, as in a browser, and so do a box's padding and border over a `max-height` or `max-width` under them. React Native held the box, and the box around it, to the maximum. ([#840](https://github.com/ng-native/ng-native/pull/840))
- A number input with a default keeps it when bound to `undefined`. `<pressable [delayLongPress]="delay()">` with no delay waits the usual 500 ms, where the long press fired at once, and a `<virtual-list>` with `[rowGap]` or `[overscan]` unset lays out, where its height was `NaN`. The same goes for `delayPressIn`, `delayPressOut`, `minPressDuration`, `activeOpacity`, `keyboardVerticalOffset`, `endReachedThreshold` and `itemVisiblePercentThreshold`. ([#803](https://github.com/ng-native/ng-native/pull/803))
- An `@ng-icons` import shown as a code sample inside a template literal is left as text. It was rewritten as the build rewrites a real import, which broke the string and failed the build. ([#805](https://github.com/ng-native/ng-native/pull/805))
- A `<native-header-item type="title">` no longer crashes a screen on Android. It is committed as `center`: react-native-screens lists `title`, and iOS draws both as the title view, but Android's header throws `Unknown type title` while mounting the item, so a page with a custom title worked on iOS and crashed on Android as it opened. ([#800](https://github.com/ng-native/ng-native/pull/800))
- A `<native-header-item>` written inside a component of the header now shows in the bar. It reached the header inside the component's view, which iOS dropped with an error and Android crashed on. ([#830](https://github.com/ng-native/ng-native/pull/830))
- A `@font-face` url with a query or a fragment, `url('./Inter.ttf?v=2')`, bundles the file it names, and a remote or `data:` url is dropped with a warning that names the face. Each was passed to the bundler as it was written, which failed to resolve it. ([#805](https://github.com/ng-native/ng-native/pull/805))

  A face that lists a remote url before a file in the app, `src: url(https://x.com/a.ttf), url(./a.ttf)`, bundles the file in the app instead of refusing the face.

- Five cases where the engine kept showing an old state now follow the change. An element put back in the tree after a class changed above it, `.dark .title`, is styled by the class as it is now. A change inside a `display: none` element reaches the next commit, so a panel hidden by `:has()` shows again once the `:has()` no longer holds. An endless `@keyframes` animation stops while its element, or one it is in, is `display: none`, with an `animationcancel` as a browser sends, where it kept a frame loop running, and plays again when shown. A scroll-driven animation drives its view again after the view or its scroll view was hidden and shown, where it froze on its first frame. A custom property bound with a `calc()`, `min()` or `max()` of lengths, a `rem`, an `em` or viewport length, a unitless line height or two to four lengths in `px` is read as the same text in a stylesheet, where it set nothing. ([#802](https://github.com/ng-native/ng-native/pull/802))
- The lines of a wrapping flex container that says nothing of `align-content` stretch across it, as in a browser. They started at `flex-start`, as tall (or as wide) as what was in them, so an item that stretches across its line, a box with no width in a column that wraps, came out with no size at all. ([#841](https://github.com/ng-native/ng-native/pull/841))
- `ngNativeWeb()` registered twice, as the Storybook recipe does in the app's `vite.config.ts` and again in `viteFinal`, applies once. With `@oxc-angular/vite` 0.0.41 the second copy compiled each component again and failed the build with "Unsupported call to the input function". ([#853](https://github.com/ng-native/ng-native/pull/853))
- Text written straight into a view is truncated as the view says, as a browser truncates a block's own text. `<view class="truncate">` or `line-clamp-2` around its own words, or a `numberOfLines` bound on it, left the words untruncated, because the paragraph they are drawn in never took the view's `numberOfLines` or `ellipsizeMode`. ([#843](https://github.com/ng-native/ng-native/pull/843))
- A class change that brings in a `transition` together with the value it eases animates from the old value, as in a browser, which takes the transition from the style after the change. Such a change, out of `transition: none` or out of no transition at all, jumped to the new value before. ([#846](https://github.com/ng-native/ng-native/pull/846))
- A `<native-toolbar>` written ahead of a page's scroll view no longer stops the large title from collapsing as the page scrolls. The toolbar now commits after the page's content, as the header does. ([#826](https://github.com/ng-native/ng-native/pull/826))
- `@ng-native/testing`'s Node hook runs on Node 22 and early Node 24 releases, where every test file that compiled a component failed with `ERR_METHOD_NOT_IMPLEMENTED: The resolveSync() method is not implemented`. ([#795](https://github.com/ng-native/ng-native/pull/795))

  The compiler the hook runs is CommonJS, and it `require`s two ES modules, `@oxc-angular/vite` and `@angular/compiler`. Those versions of Node cannot `require` an ES module that imports anything on the thread that runs `module.register`'s hooks, so `node --import @ng-native/testing/register --test`, and a suite that registers `@ng-native/testing/loader` itself, failed there. The hook now imports both before it is registered. Recent Node 24 releases and the Vitest plugin are unchanged.

- A `<native-header>` in a tab's page that has no stack of its own no longer configures the stack screen that holds the whole tab bar. On Android it showed its bar above the tab bar, on every tab, even when the tabs page hid its own. ([#828](https://github.com/ng-native/ng-native/pull/828))
- A SwiftUI `font` modifier on an `@expo/ui` view can name one of the app's `@font-face` faces by the name it is registered under, such as `Nunito Sans-700`, and draws that face on iOS instead of the system font. ([#855](https://github.com/ng-native/ng-native/pull/855), [#849](https://github.com/ng-native/ng-native/issues/849))

  The build reads each face's PostScript name from its `.ttf`, `.otf`, `.ttc` or `.woff` file, and adds it to the face in the compiled sheet as `postScriptName`. A face file in a format the name cannot be read from, such as `.woff2`, is reported in the build. A font loaded by hand with `inject(Fonts).load(map)` is still named by its PostScript name in a modifier, and in development a modifier that names it by the name it was loaded under logs a warning. `registerViewName` and `registerExpoView` take a `fontNames` option, through which a view rewrites the font names its own props carry.

- An icon or drawing whose shape has an `opacity` or `clip-rule` attribute no longer stops the app on Android: a shape's `propList` now names only the fill and stroke paint react-native-svg inherits, which Android reads each name of by reflection. ([#817](https://github.com/ng-native/ng-native/pull/817))
- A text element that is a flex column of text elements, `<label class="flex flex-col"><span>Name</span><span>Hint</span></label>`, stacks them one under the other, as in a browser. They ran on as one line of a paragraph. ([#844](https://github.com/ng-native/ng-native/pull/844))
- Presses in a `ui-bottom-sheet`'s content keep working on iOS when a `ui-toolbar-item` is added to or removed from an open sheet that is not sized to its content. ([#862](https://github.com/ng-native/ng-native/pull/862), [#848](https://github.com/ng-native/ng-native/issues/848))

  The sheet's content now stays in place as items come and go: where the build has SwiftUI's toolbar, a sheet not sized to its content keeps its navigation stack with no item in it, which draws no bar, and the toolbar sits beside the content rather than around it. A sheet sized to its content is still made again as its first item arrives or its last goes, and is not covered by this fix.

- A `ui-bottom-sheet` with `ui-toolbar-item`s starts its content right under its bar on iOS, without the empty band of about 50pt SwiftUI left there for a large title. `@ng-native/expo` now registers a SwiftUI modifier of its own with `@expo/ui`, so a dev build has to be rebuilt to pick it up. Expo Go cannot load native code of its own, so a sheet there keeps the band. ([#815](https://github.com/ng-native/ng-native/pull/815), [#810](https://github.com/ng-native/ng-native/issues/810))
- A change to a view's opacity or transform after a native animation of it has ended is now drawn. Once a CSS transition, a `@keyframes` animation or a scroll-driven animation played on native had set either on a view, React Native drew no later commit of it: a keyframes fade that does not fill stayed at its last frame, and a later change of class or bound style left the view where the animation had put it. Each later change is now set on native as well as committed, except a transform written as a matrix, which native cannot set and which stays where the animation left it. ([#838](https://github.com/ng-native/ng-native/pull/838))
- A `font` modifier on a `ui-picker` with the segmented style draws its segments in that font on iOS, which SwiftUI's segmented picker otherwise ignores. `ui-picker` sends each `font` of a segmented picker again as a modifier `@ng-native/expo` registers with `@expo/ui`, which sets the title font on the picker's own `UISegmentedControl`, so a development build has to be rebuilt to pick it up. Expo Go cannot load it, and its segments stay in the system font. ([#816](https://github.com/ng-native/ng-native/pull/816), [#812](https://github.com/ng-native/ng-native/issues/812))

### ❤️ Thank You

- Ashley Hunter
- Emanuel Hosu @Emanuel-Hosu
- erKam
- Wassim Aarab @WassimAarab08

## 0.13.0 (2026-10-12)

### 🩹 Fixes

- A page presented from another tab now refuses Android's Back button while it sets `preventNativeDismiss`, and hears `nativeDismissCancelled`, as it already did when presented in the tab in front. ([#783](https://github.com/ng-native/ng-native/pull/783))
- `NgIcon` from `@ng-native/icons` does more of what `@ng-icons/core` does on the web: ([#785](https://github.com/ng-native/ng-native/pull/785))

  - It draws `<mask>`, `<clipPath>` and `<use>`. A lets-icons duotone line icon was a solid square, a flag-icons flag lost the stars or emblem it draws with `<use>`, and a flag whose artwork is clipped drew past its edge.
  - `provideNgIconsConfig({ size, color, strokeWidth })` sets the default of each. An icon's own input still wins.
  - `provideNgIconLoader` is asked for a name no `provideIcons` has. The loader can return a string, a promise or an observable, and `withCaching()` asks it once per name.
  - `color="var(--accent)"` resolves against the tokens in scope, where it was sent to native as the text `var(--accent)`.
  - A static `aria-label` labels the icon for a screen reader, as `accessibilityLabel` does.
  - With no `size`, an icon takes `--ng-icon__size` when something around it sets it, as `<ng-icon-stack size>` does.
  - `stroke-dasharray="none"` draws a solid line, and an opacity written as a percentage, `opacity="50%"`, is read as a fraction.

### ❤️ Thank You

- erKam @erkamyaman

## 0.12.0 (2026-10-12)

### 🩹 Fixes

- A DOM component's page has a `localStorage` and a `sessionStorage` on Android, where reading either threw, so web code that reads one as it starts failed the page before anything rendered. ([#779](https://github.com/ng-native/ng-native/pull/779), [#778](https://github.com/ng-native/ng-native/issues/778))

  Expo's Android web view leaves DOM storage off and answers `null` for both. The page now gets one of each kept in memory, with storage's methods (`getItem`, `setItem`, `removeItem`, `clear`, `key`, `length`), before any of its own code runs. What is stored lasts as long as the page: it is not kept between launches, as the web view's own is on iOS.

- A font or an image a DOM component's stylesheet names in a relative `url()` ships with the page in a release build, where it was left out and the page fell back to another font. ([#781](https://github.com/ng-native/ng-native/pull/781), [#777](https://github.com/ng-native/ng-native/issues/777))

  `expo export:embed` wrote the stylesheet as it was and none of the files it referred to. Each such file is now written into the page's folder in `www.bundle`, and the `url()` points at it. `withAngularNative` adds `woff` and `woff2` to Metro's `assetExts`, as only a file Metro takes as an asset is exported; a `url()` to any other file keeps Expo's warning.

- `registerViewName` takes a `looseText` option naming the element that draws text written straight into a view, for a native view such as an SVG text whose words are drawn by a span and not by a paragraph. ([#780](https://github.com/ng-native/ng-native/pull/780))

### ❤️ Thank You

- Ashley Hunter

## 0.11.0 (2026-10-12)

### 🩹 Fixes

- A Live Activity layout takes a `bannerSmall` slot, which is drawn where the activity is small: the Smart Stack of a paired Apple Watch from iOS 18 with watchOS 11, and CarPlay from iOS 26. It was a build error before. ([#766](https://github.com/ng-native/ng-native/pull/766))
- A Tailwind 3 theme colour written as `hsl()` gets the channels a browser prints where one falls on a half: `hsl(300 100% 25%)` is `rgb(128, 0, 128)`, where it was `rgb(128, 0, 127)`. ([#764](https://github.com/ng-native/ng-native/pull/764))
- A template plural on the web host picks its case by the rules of the app's `LOCALE_ID`, as on iOS and Android, where it was counted by the rules of `en-US` whatever the locale: with `LOCALE_ID` `fr`, a count of 0 renders the `one` case. ([#772](https://github.com/ng-native/ng-native/pull/772))
- A template ICU plural or select now renders on the web host in a development build, where it threw `ASSERTION ERROR: The provided value must be an instance of a DOM Node`. ([#773](https://github.com/ng-native/ng-native/pull/773))

  Angular's development checks on the i18n path test each node with `instanceof Node`, and the web host hands Angular its own node objects rather than DOM nodes. The web host now makes the page's `Node` answer `true` for those objects, in development and release builds, as the `Node` global already does on iOS and Android, and answers as before for every other value. A component compiled just in time in a development build no longer logs `NG0303: Can't bind to ...` for its own bindings on the web host.

- A tab bar kept as one screen with `reuseScreen` under a route with a parameter, such as `org/:org`, opens a tab in the account in front. ([#774](https://github.com/ng-native/ng-native/pull/774))

  Each tab remembers the url it was last on, and a tap on it, or Android's back to the first tab, went back to that url. Once the app moved from `/org/1/home` to `/org/2/home`, the same bar stayed on screen and a tap on Search still went to `/org/1/search/x`. A tab now goes back to its remembered url only while that url is still inside the bar, and to its own first page otherwise.

- Tapping back to the tab in front while a tap on another tab is still loading (a guard or lazy code) now stays on the tab in front, instead of the other tab opening when it finishes loading. ([#761](https://github.com/ng-native/ng-native/pull/761))
- `DeepLinks` has an `openSettings()`, which opens the app's own page in the system settings: where to send a person once a permission's `blocked()` is true. ([#776](https://github.com/ng-native/ng-native/pull/776), [#775](https://github.com/ng-native/ng-native/issues/775))

  Android has no url for that page, so `open()` could not reach it. `DeepLinkSource` gains an optional `openSettings`; a source without one, as a test's stand-in written before now, opens nothing.

- `liveActivity()` takes a `staleDate` option, which answers when what the activity shows is out of date: iOS then draws the layout with `environment().isStale` true. A Live Activity's layout reads what it is drawn in from an `environment` input, as a home-screen widget's does. ([#767](https://github.com/ng-native/ng-native/pull/767))
- `pushToStartToken()` from `@ng-native/expo/live-activity` is the token a server starts a Live Activity with over APNs while the app is closed: a signal, null until iOS issues one. It needs iOS 17.2 and `enablePushNotifications` in the `expo-widgets` plugin's config. ([#765](https://github.com/ng-native/ng-native/pull/765))
- `widget()` takes a `timeline` option: the entries a home-screen widget shows later, each from its date, with the app closed. Taps are collected from every entry of a timeline, where only the last entry's were before. ([#768](https://github.com/ng-native/ng-native/pull/768))

### ❤️ Thank You

- Ashley Hunter
- erKam @erkamyaman

## 0.10.0 (2026-10-10)

### 🩹 Fixes

- On Android, a screen that is closed keeps its content while it animates away: a `formSheet` dismissed with `NativeNavigation.back()` or the system back button was emptied at once and slid away blank. ([#724](https://github.com/ng-native/ng-native/pull/724), [#720](https://github.com/ng-native/ng-native/issues/720))

  react-native-screens starts a removed screen's transition before its views are unmounted, from a listener its native module installs as it is made, and React Native makes a module only when JavaScript asks for it. Nothing asked, since none of react-native-screens' JavaScript is imported. `provideNativeRouter` now asks for it.

- `ongoingNotification()` from `@ng-native/expo/ongoing-notification` keeps an Android ongoing notification in step with a signal, with a timer Android counts itself, a progress bar and action buttons whose taps reach `onTaps` even when made while the app was not running; it asks Android to show it as a Live Update. It needs the app rebuilt (`npx expo run:android`, or a new EAS build). An Android app built with `@ng-native/expo` now declares the `POST_NOTIFICATIONS` and `POST_PROMOTED_NOTIFICATIONS` permissions, whether or not it shows one. ([#762](https://github.com/ng-native/ng-native/pull/762))
- Renderer2.removeChild takes a node out of the parent it has, whatever parent it is handed, as Angular's DOM renderer does. ([#723](https://github.com/ng-native/ng-native/pull/723))
- A library's stylesheet with a rule that does not parse nested inside one that does, such as `@keyframes` in a style rule, keeps the rules nested beside it, where they were dropped with it. ([#756](https://github.com/ng-native/ng-native/pull/756))
- A box with a `z-index` above 0 is drawn over what follows the views it is in, as in a browser: each plain view it is in is committed at its `z-index`, up to a view with a `z-index` of its own. ([#726](https://github.com/ng-native/ng-native/pull/726))
- `NativeNavigation.popTo()` pops to an earlier screen whose url is the one already showing, where a stack holds the same url twice: its promise never settled and nothing was popped. ([#732](https://github.com/ng-native/ng-native/pull/732))
- A video player's `state()` starts with the player's own `muted` and `volume`, and keeps them when its source changes. It read unmuted at full volume until an event said otherwise, and again after every new source. ([#740](https://github.com/ng-native/ng-native/pull/740))
- `:first-of-type`, `:last-of-type`, `:only-of-type`, `:nth-of-type()` and `:nth-last-of-type()` are matched, counting the siblings with the element's own name, where a rule with one was dropped. ([#751](https://github.com/ng-native/ng-native/pull/751))
- `::ng-deep` is read where something is written before it: `:host ::ng-deep .inner` and `.panel ::ng-deep .inner` style `.inner` anywhere under that component, in the views of the components it holds as well. With nothing before it the rule is still dropped. ([#754](https://github.com/ng-native/ng-native/pull/754))
- A tap on a Live Activity's button that starts the app reaches `onTaps`, where it was lost before the app's JavaScript had loaded. `@ng-native/expo` holds it in a native module of its own on iOS, so rebuild the app (`npx expo run:ios`, or a new EAS build) to get it; an app not rebuilt behaves as before. ([#760](https://github.com/ng-native/ng-native/pull/760))
- A Live Activity layout takes `ui-button`, on iOS 17 and later, and `liveActivity()` hands each tap's `target` to a new `onTaps` option, as `widget()` does. A `(buttonPress)` in a Live Activity is a build error, where the button itself was before. ([#759](https://github.com/ng-native/ng-native/pull/759))
- Text with a `line-height` is never laid out shorter than one line: in a box too short for it, it is drawn at its full line height and overflows, where its letters were cut off. ([#755](https://github.com/ng-native/ng-native/pull/755))
- A deep link the app was launched with is followed over the first page to show, or not at all: when that page failed to load, the link was followed after whichever navigation next succeeded, however much later. ([#733](https://github.com/ng-native/ng-native/pull/733))
- An element after one that changed is matched again on its own, and what is under it is styled again only where a rule reads that far, in a sheet with a sibling combinator. ([#713](https://github.com/ng-native/ng-native/pull/713))
- A rule can ask :has() of a box the styled node is in, .card:has(.action) .title, where it used to be dropped with a warning. ([#725](https://github.com/ng-native/ng-native/pull/725))
- An @font-face that names several files is registered from its TrueType or OpenType file, and from the last src it writes, rather than from the first file named. ([#719](https://github.com/ng-native/ng-native/pull/719))
- `dark:` applies to the view that has the `dark` class as well as to everything inside it, with both Tailwind presets. A root view an app puts `dark` on itself kept its light `dark:bg-zinc-950` and only its children turned dark. The variant is now Tailwind's own class-based form, `&:where(.dark, .dark *)`, at the same specificity as on the web: a `dark:` utility still wins over the plain one it follows, and a rule an app writes after the utilities can now override it, as in a browser. ([#707](https://github.com/ng-native/ng-native/pull/707))
- On iOS, `Dialogs.choose()` resolves `null` when the choice with `style: 'cancel'` is picked or the sheet is dismissed, as it does on Android. It resolved that choice's index, so a caller checking for `null` took a dismissal for a choice. ([#729](https://github.com/ng-native/ng-native/pull/729))
- A border with a width and no color is drawn in the element's text color, its own or inherited, where it was black: give it a `border-color` to keep it black. ([#752](https://github.com/ng-native/ng-native/pull/752))
- Text written straight into a view, rather than in a `<text>`, takes a custom font that finishes loading after the first render. It stayed in the fallback face. ([#735](https://github.com/ng-native/ng-native/pull/735))
- The `background` shorthand takes gradients, with a position, size, repeat and color beside them, and what it leaves out is back at its initial value: `background: red` now takes away a gradient an earlier rule gave, as in a browser. ([#728](https://github.com/ng-native/ng-native/pull/728))
- A `[attr.class]` or `[attr.style]` binding that becomes null takes its classes or styles away, and a style attribute set again drops the declarations it no longer has. They stayed applied. ([#734](https://github.com/ng-native/ng-native/pull/734))
- An app below Metro's config root starts its transform cache afresh when its own `@angular/core`, `react-native-worklets` or `react-native-reanimated` is upgraded, installed or removed. ([#702](https://github.com/ng-native/ng-native/pull/702))

  `withAngularNative(config, { projectRoot })` read those versions for Metro's cache key from the config root, whose walk up never looks in the app's own `node_modules`. The app's copies are the ones its files resolve, so a change to them left every cached transform in place until a `--clear`. The key reads them from the app now, as it already did for `@ng-icons` sets, and keeps the config root's worklets packages beside them, since `babel-preset-expo` looks there first.

- Text that is one word, with no space or hyphen to break at, is one line cut at the edge of its box, where it was wrapped between its letters. Text of several words is as it was. ([#753](https://github.com/ng-native/ng-native/pull/753))
- A `<scroll-view>` with `pagingEnabled` settles on a whole page in a browser, one page per swipe, as on a device, where it scrolled freely and stopped anywhere before. Each child of the content view is a page, so a carousel of page-sized children pages as it does on a device. ([#704](https://github.com/ng-native/ng-native/pull/704))
- A `<text>` with `numberOfLines` is cut to that many lines in a browser, ending in an ellipsis as on a device, where it wrapped onto every line before. `ellipsizeMode="clip"` cuts it without the ellipsis, and `head` and `middle` end it at the tail, which is all CSS can say. ([#703](https://github.com/ng-native/ng-native/pull/703))
- A `<text-input>` in a browser hands `(keyPress)` and `(selectionChange)` React Native's payloads: `{ nativeEvent: { key } }` with `Backspace`, `Enter` or the character typed, and `{ nativeEvent: { selection: { start, end } } }` whenever the caret moves or a range is selected. ([#701](https://github.com/ng-native/ng-native/pull/701))

  `(keyPress)` was bound to the DOM's `keypress` event and handed it raw, so reading `$event.nativeEvent.key` threw on every character and `Backspace` sent nothing at all. `(selectionChange)` never fired.

- `Updates` keeps a downloaded update waiting when a later `check()` fails or finds nothing new: `ready()` stays `true`, `check()` resolves `true` and `apply()` restarts into it, with the failure reported on `error()` only. `error()` is cleared by the next check that succeeds. ([#705](https://github.com/ng-native/ng-native/pull/705))
- `ui-text` takes `date`, `dateStyle`, `timerInterval` and `countsDown`, and `ui-progress` takes `timerInterval` and `countsDown`, so a Live Activity, a home-screen widget or an iOS screen shows elapsed and remaining time that moves with no update from the app. ([#757](https://github.com/ng-native/ng-native/pull/757))
- `ui-image` takes `assetName`, an image or a custom symbol in the asset catalog, in an app and in a Live Activity or widget layout. ([#758](https://github.com/ng-native/ng-native/pull/758))
- A token of two to four lengths may have a `var()` for any of them, `--content-padding: 0 var(--modal-padding) var(--modal-padding)`, and gives `padding`, `margin`, `border-width` and `border-radius` a value a side as one of written lengths does. ([#746](https://github.com/ng-native/ng-native/pull/746))
- Text is centred in a box taller than its line at a system text size smaller than the default, where it sat at the top of the box. ([#763](https://github.com/ng-native/ng-native/pull/763))
- A test that imports a DOM component's `'use dom'` file gets a reference to its page, as native code does in a Metro bundle, under `ngNative()` and under `@ng-native/testing/register`. ([#711](https://github.com/ng-native/ng-native/pull/711), [#710](https://github.com/ng-native/ng-native/issues/710))

  The file was evaluated in Node instead, so `mountInWebView` failed as it was imported with "window is not defined", which Vitest reports as an unhandled rejection that fails a run whose tests all pass, and the page's web-only imports were loaded into the test run.

- `userEvent.press`, `longPress`, `type` and `clear`, and `fireEvent.press`, do nothing on a node a finger could not reach, as React Native Testing Library decides it: one that is `pointerEvents` `none` or `box-none` itself, or one under a view that is `none` or `box-only`. `pointer-events: none` in CSS counts too. A test that the button is blocked while an overlay is up passed before, because the press went through. ([#706](https://github.com/ng-native/ng-native/pull/706))

  A query `RegExp` with the `g` or `y` flag finds every match. It tested each node from where its last match ended, so `getAllByText(/item/gi)` over four items found two, and a second `getByText` with the same `RegExp` could miss.

- A `<native-tab>` an `@if` takes away and brings back shows its page again, where it was left, in place of an empty tab. ([#718](https://github.com/ng-native/ng-native/pull/718))
- A `<native-tab>` added after the tab bar starts, as an `@if` behind a feature flag adds one, can now be opened by a tap or a navigation. ([#717](https://github.com/ng-native/ng-native/pull/717))
- Dropping a `StatusBar.push()` claim puts back what only that claim had changed: a bar it hid is shown again, and its style and translucency go back to the platform's own. They stayed as the claim left them when no claim underneath named them. ([#727](https://github.com/ng-native/ng-native/pull/727))
- Styling an element passes over a rule that names an ancestor the element has not got, without walking up the tree to look for it. ([#712](https://github.com/ng-native/ng-native/pull/712))
- A custom property of two to four lengths gives padding, margin, border-width and border-radius a value for each side or corner, where it used to leave them unset. ([#722](https://github.com/ng-native/ng-native/pull/722))
- A screen with a scroll-driven animation (`animation-timeline: scroll()`) is released when it is closed: the engine kept its scroll view, and through it the whole screen, for as long as the app ran. ([#730](https://github.com/ng-native/ng-native/pull/730))
- A deep link that arrives while the app is running is pushed over the screen showing, as the Screens page says, when the app has no `withLinkParent`. A link to a url already further down the stack went back to that screen instead and closed the ones above it; now Back from the link returns to the screen it was opened over. ([#715](https://github.com/ng-native/ng-native/pull/715))

  Two different links that arrive back to back leave only the last one above the screen that was showing, since the second push supersedes the first.

- A default style given to a styled element, and a class a rule asks a box to have or not to have, restyle only what they reach rather than everything under the element. ([#714](https://github.com/ng-native/ng-native/pull/714))
- A reset or a replace to a page that navigates elsewhere as it is created, a sign-in check in its `ngOnInit`, takes out the screens it supersedes. ([#721](https://github.com/ng-native/ng-native/pull/721))

  The page's own navigation cancelled the reset or the replace before the stack had marked what it supersedes, and the stack waited for that navigation to end, which it never did. Signing out to a page that sent a signed-out user to sign in left every screen of the session under the sign-in page.

- `NativeNavigation.reset()` to a screen still kept further down the stack now leaves that screen alone on the stack. The screens below it are destroyed too, so back has nowhere to go, as the docs say. ([#716](https://github.com/ng-native/ng-native/pull/716))

### ❤️ Thank You

- Ashley Hunter
- erKam @erkamyaman
- Gabriel Silva @GabeSilvaDev

## 0.9.0 (2026-10-09)

### 🚀 Features

- ICU plurals and selects render, `i18n-` attributes keep their text, and a method shorthand in decorator metadata compiles, on `@oxc-angular/vite` 0.0.40. ([#687](https://github.com/ng-native/ng-native/pull/687))

  `{count(), plural, =0 {...} one {...} other {...}}` and `{value, select, ...}` in a template threw on first render and now work on iOS and Android, in the source language and translated; the web host does not support them yet. `i18n-accessibilityLabel` and the other `i18n-` attributes compiled with empty source text and now carry it. `providers: [{ useValue: { attach() {} } }]` failed the build and now compiles.

  **Translation files need one edit.** The placeholders for an element or a control-flow block inside a message are now named as Angular's own compiler names them, with underscores between the words: `{$STARTTAGTEXT}` is `{$START_TAG_TEXT}`, `{$CLOSETAGSCROLLVIEW}` is `{$CLOSE_TAG_SCROLL_VIEW}` and `{$STARTBLOCKIF}` is `{$START_BLOCK_IF}`. `{$INTERPOLATION}` and `{$INTERPOLATION_1}` are unchanged. A translation still using the old names is not applied and the message shows its source text. Extract again with `localize-extract` and copy the new names into each translation file.

  A case of a plural or select holds text and interpolations: Angular leaves out an element inside one, such as `<text>`, with its content. A plural picks its case by the rules of `LOCALE_ID`.

  `@ng-native/metro` no longer exports `assertNoBrokenMethodShorthand`.


### 🩹 Fixes

- Two components that each define `@keyframes` of the same name each play their own: an element's animation uses the keyframes of its own component's stylesheet where it has some by that name, as Angular scopes them in a browser, where the last stylesheet loaded used to win for both. ([#694](https://github.com/ng-native/ng-native/pull/694))
- A selector that reads the `class` attribute, `[class*='size-']`, matches the element's classes, so an icon a library styles with `svg:not([class*='size-'])` keeps the size a class gives it. ([#685](https://github.com/ng-native/ng-native/pull/685))

  `*=`, `^=`, `$=`, `~=` and a bare `[class]` looked for a `class` prop, which no element has, so they never matched and their `:not()` always did. They now read the class list in the order it was set, one space between each, as the attribute would spell it.

  A compound under a scope in `:is()`, `.x:is(.p .x)`, is as specific as the whole argument, `.p .x.x`, as in a browser. The scope was left out, so a rule lightningcss writes for one nested under a selector list lost to a less specific rule after it.

  Two `:host-context()` in one compound, `:host-context(.dark):host-context(.compact)`, need both, as Angular's emulated encapsulation does. The second replaced the first.

- An element moved from one box to another, or under a box whose class changed, is styled by what is over it now, where neither box has a rule or a value to hand down. ([#693](https://github.com/ng-native/ng-native/pull/693))

  Boxes with nothing to style share one cache once they are resolved a second time, after the window is resized or the colour scheme changes, in an app with no global stylesheet and no safe-area tokens. An element moved between two of them kept the style it had, though a rule of its component asks about a class only one of them has, `.dark .label`. A class added to one of them was missed in the same way when a rule reads it through `:not()`, where another such box was resolved first in the commit. Both are styled again now.

- A `@keyframes` animation of two frames that sets only sizes and places, a panel sliding open from `height: 0`, is committed once at its last frame and moved there by native's layout animation, where it was a commit on every frame; and of several transitions or animations of a size that start in one commit and take different times, native plays the longest and the rest are eased from JavaScript, where none of them was native's. ([#697](https://github.com/ng-native/ng-native/pull/697))
- A `@keyframes` value can be a `var()`, an `em` or a viewport unit: it is settled against the element that plays the frame, as in a browser, where it was a build error (or a dropped declaration) before, so `to { height: var(--panel-height) }` opens each panel to the height set on it. ([#696](https://github.com/ng-native/ng-native/pull/696))
- A font a `styleUrl` sheet in another directory declares is bundled from beside that sheet, and an `@ng-icons` import wrapped over several lines keeps the line numbers of the file below it. ([#695](https://github.com/ng-native/ng-native/pull/695))

  `url('./Inter.ttf')` in `../shared/fonts.css` was required from the component's directory, where there is no such file, so Metro could not resolve it. It is now resolved against the sheet it is written in, as CSS does, in the component's module and in the hot update an edited template or sheet carries. An `@ng-icons` import that Prettier wrapped was inlined as one line, so an error or a source map line after it was off by the lines it lost.

- `tw-animate-css` plays: an `animation` shorthand whose parts are each a token is read by what each falls back to, with its duration and delay following their tokens, and Tailwind's build leaves an animation's times and a keyframe's slots for the device, so `animate-in fade-in-0 zoom-in-95 duration-200` fades and zooms in over 200ms where the animation was dropped with a build warning. ([#700](https://github.com/ng-native/ng-native/pull/700))
- A `transform` with a token in it takes `translate3d()` and `scale3d()`, across and down since a view has no depth, and an angle token can fall back to a bare `0`: `rotate(var(--r, 0))` is no longer dropped where `--r` is not set. ([#698](https://github.com/ng-native/ng-native/pull/698))
- A view whose `bornIn` was cleared, which is how a caller says it has been seen as it is, keeps its transitions: the check that drops the transitions of a view nobody has seen yet took a cleared `bornIn` for an unseen one and dropped them on every commit. ([#684](https://github.com/ng-native/ng-native/pull/684))
- A custom property set on a box, or a class such as `dark` added to one, restyles what is under it without finding each element's rules again. ([#691](https://github.com/ng-native/ng-native/pull/691))

  Finding the rules that match an element is most of what styling it costs, and both changes found them again for every element under the box, as a first render does. An element now keeps the rules it matched, and is styled from them when the change above it cannot have altered them: a custom property, which no selector reads, and a class that rules name only for the element that has it or for particular elements beneath, which alone are matched again. A theme token changed on a screen of 1,800 elements took 24 ms and takes 15; a `dark` class on its root took 41 ms and takes 27 where the classes are composed ones. Nothing an app sees changes but the time.

- A press that is let go is committed as no longer pressed before its handler runs, so what the handler changes is committed by the render pass after it and not a frame early with the press: an overlay a press opens is no longer drawn before it has been placed. ([#692](https://github.com/ng-native/ng-native/pull/692))
- On iOS the text of a single-line text field with a `line-height` and a percentage height, `height: 100%` in a box drawn around it, is centred, where it sat low in the field: the line height is left out and kept as the least the field is tall, as it already was for a field with no height. ([#699](https://github.com/ng-native/ng-native/pull/699))
- A view that takes a touch and fades to `opacity: 0` by a transition still hears a press on iOS: native ends the fade at the opacity the view is committed with, where it ended at none and iOS passed the view over. ([#690](https://github.com/ng-native/ng-native/pull/690))

### ❤️ Thank You

- Ashley Hunter
- Gabriel Silva @GabeSilvaDev

## 0.8.0 (2026-10-08)

### 🩹 Fixes

- An attribute selector with an empty value matches what it does in a browser. ([#667](https://github.com/ng-native/ng-native/pull/667))

  `[data-x^=""]`, `[data-x$=""]` and `[data-x*=""]` matched every element with a `data-x`, and `[data-x~=""]` matched one whose `data-x` was empty or began or ended with a space. All four match nothing, as Selectors 4 says. `[data-x=""]` and `[data-x|=""]` are unchanged.

- `background: var(--x)` draws a gradient that a custom property set on an element holds, with the colour under it. ([#664](https://github.com/ng-native/ng-native/pull/664))

  A library that works a gradient out as the app runs sets it as a custom property: a colour slider's track, or a colour area's two fades over a colour. It was read as a colour and came to nothing. `linear-gradient()` with a side or an angle and colour stops at percentages is read, in layers, over a last colour. A gradient in a stylesheet's own custom property is still refused where it is written, and native has no conic gradient. Only the shorthand reads one: `background-color: var(--x)` is a colour or nothing. The gradient is ranked in the cascade as a `background-image` is, so one a later rule declares, or an important one, stands over it.

- A prop no selector names no longer has its element, and everything in it, matched against the stylesheets again. ([#673](https://github.com/ng-native/ng-native/pull/673))

  Any prop can be what a selector asks about, so one changing restyled the element and its subtree: a progress bar's `aria-valuenow` on every tick, a field's text on every key. Only the attributes a loaded stylesheet's selectors mention, and the id, do so now.

- A transition or a `@keyframes` animation now eases a padding, a margin or a `border-radius` that no rule sets from or to 0, as a browser does. `view { transition: padding 200ms }` with `.open { padding: 20px }` eases the padding in and back out, where it jumped. ([#670](https://github.com/ng-native/ng-native/pull/670))
- A text field focused while a view around it fades in keeps its focus: a plain view with a `transition` is now a native view for as long as it has one. ([#665](https://github.com/ng-native/ng-native/pull/665), [#663](https://github.com/ng-native/ng-native/issues/663))

  React Native gives a view a native view of its own for an opacity under 1 and takes it away at 1, moving everything inside it to the view above, and that move made a focused field lose its focus as the fade ended. From 0.7.0 this showed for `transition-[opacity]` with `opacity-0` taken off, which now eases where it jumped; a fade between two written opacities did it before then too. A view with a transition commits `collapsable: false`, unless `collapsable` is written on the element.

- A rule that names its element by an attribute alone, or as anything inside an element with a class, is no longer tried against every element. ([#674](https://github.com/ng-native/ng-native/pull/674))

  `[data-open] { }` and `.item:focus * { }` say nothing of the element's own name or class, so each was offered to every element of the screen, and the second walked to the root each time to find no `.item`. They are filed under the attribute and under the class, and offered to the elements that have the one or sit inside the other.

- `NativeNavigation.reset()` to a url that lands on the screen already on top, such as the same page with another query, a route config that redirects to it, or a guard that redirects there with a query, takes the screens under it off the stack. It left them, so Back still went to the old stack. ([#669](https://github.com/ng-native/ng-native/pull/669))
- A release build from a warm Metro cache ships a `templateUrl` or `styleUrl` file edited since the last build. ([#681](https://github.com/ng-native/ng-native/pull/681))

  Metro caches a transform against the file's own content, and a component's template and sheet are compiled into its own module, so two `npx expo export` runs with only the `.html` or `.css` edited between them shipped the old template or styles until `--clear`. The transform worker now records the templates and stylesheets a component's transform read, and the cache stores `withAngularNative` wraps treat that transform as a miss once one of them has changed or been deleted. Set your own `cacheStores` before calling `withAngularNative`, so they are wrapped too.

- `Permission.ensure()` checks a refused permission again before answering, so one the person turns on in Settings works on the next call, without a dialog. ([#682](https://github.com/ng-native/ng-native/pull/682))

  It used to ask the platform only once, so after a refusal for good it answered no, and `blocked()` stayed true, until the app restarted, which neither platform does when a permission is turned on. This reached `Location`, `Notifications`, `ImagePicker`, `MediaLibrary`, `ScreenCapture` and `Tracking`. A `Permission` built in an injection context also checks a no again when the app comes back to the front, so a screen that shows `blocked()` changes by itself. A granted answer is still kept, and the dialog still shows only when the platform will show one.

- A `@media` inside another `@media` applies where both hold, and `:not()` around a list with an ancestor test in it excludes each alternative, so Tailwind's stacked `md:max-lg:` and `not-dark:` variants work. ([#675](https://github.com/ng-native/ng-native/pull/675))

  The inner `@media` was refused as an at-rule a style rule cannot hold, so `md:max-lg:` and `md:motion-reduce:` were dropped at every width. `.x:not(:where(.dark, .dark *))` excluded only an element that was dark and inside something dark, so `not-dark:` with Tailwind's class-based dark mode still applied in dark mode. It now excludes an element that is dark or inside something dark, as Selectors 4 says.

- A CSS transition of `opacity`, a transform, a `background-color` or a border color is played by native, with no frame of it in JavaScript. ([#672](https://github.com/ng-native/ng-native/pull/672))

  A press that fades, slides or tints something was a commit on every frame for as long as it took, on press and again on release. It is now a commit to start and a commit to end, as a `@keyframes` animation of opacity and transforms already was. A transition of a size, a text color or a shadow, and one with a delay, is eased from JavaScript as before.

- A CSS transition of a size or a place (`width`, `height`, margins, insets, `flex-basis`) is one commit, which native animates, where nothing else in that commit moves a box. ([#676](https://github.com/ng-native/ng-native/pull/676))

  It was a commit on every frame from JavaScript. Native's layout animation has four curves (linear, ease-in, ease-out, ease-in-out), so a transition with a `cubic-bezier()` of its own is played by the nearest of them when native lays it out. Where another box is resized in the same commit, text changes length or an element comes or goes, the transition is eased from JavaScript by its own curve, as before.

- `:is(<scope> <compound> > *)` and `:is(<scope> <compound> *)` are read: a parent or ancestor test of a compound that is itself under another. ([#659](https://github.com/ng-native/ng-native/pull/659))

  Tailwind's `*:` and `group-*` variants written inside a scope, `.theme { .card { @apply *:data-[slot=title]:font-medium } }`, compile to that shape, and the whole rule was dropped with a warning. A longer selector inside `:is()` is still refused.

- `:is(<scope> <compound>)` is read: the element itself, where it is somewhere under the scope. ([#662](https://github.com/ng-native/ng-native/pull/662))

  A class written inside a scope and then named by a Tailwind variant, `in-data-[slot=dialog]:` or `rtl:` on a class under `.theme { ... }`, compiles to that shape, and the rule was dropped with a warning. Two compounds in front, or a child combinator, are still refused.

- A `@keyframes` animation leaves a property a rule declares `!important` where the rule puts it, as a browser does. ([#666](https://github.com/ng-native/ng-native/pull/666))

  `view { opacity: 0.3 !important; animation: fade 1s }` faded the view from 0 to 1 over its own important opacity. An important declaration is above an animation in the cascade, so the view stays at 0.3, and the animation still moves every property that is not important. That holds where native plays the animation, which is no longer handed an important opacity or transform, and for one played by a scroll. A transition still eases an important property.

- An icon's `size` is read with the unit a web app writes it with: `size="18px"` or `size="1.5rem"`. ([#668](https://github.com/ng-native/ng-native/pull/668))

  `@ng-icons/core` documents the size as a CSS length. Read as a number alone, `18px` was not one, and the icon was drawn with no size at all. One that cannot be read is now left the size of the text around it.

- Upgrading or removing an `@ng-icons` set rebuilds the files that import it, without a `--clear`. ([#683](https://github.com/ng-native/ng-native/pull/683))

  Metro reads the icons out of the set while it builds the app's own file, and the set's version was not in Metro's cache key. After an upgrade that redrew an icon, a release build, or a dev server after a restart, kept the old icon until the cache was cleared by hand. The installed sets and their versions are in the key now, found in the app's `node_modules` folders and in pnpm's store.

### ❤️ Thank You

- Ashley Hunter
- erKam
- Gabriel Silva @GabeSilvaDev

## 0.7.0 (2026-10-07)

### 🩹 Fixes

- A press no longer restyles the whole screen under a stylesheet that uses Tailwind's `group-active:` or `peer-active:`. ([#653](https://github.com/ng-native/ng-native/pull/653))

  Tailwind writes those as `:is(.group):active .label`, where the element asked about is named inside `:is()`. The engine read a compound with no class of its own as one any element could be, so every element from the pressed one up to the root was restyled with all under it, on touch down and again on release. It now reads the classes inside `:is()` too, and restyles the group alone.

- A press on an element named as one alternative of `:is()` restyles what a rule styles inside it again. ([#655](https://github.com/ng-native/ng-native/pull/655))

  `:is(.group, .card):active .label` lost its pressed style on a `.group` after the last release: only the last alternative was read as the element pressed. Every alternative is.

- `<virtual-list>` and `<section-list>` now fire `endReached` when the rows are shorter than the viewport, and again when a page is appended while the list rests at the end, without waiting for a drag. ([#647](https://github.com/ng-native/ng-native/pull/647))

  `viewableItemsChanged` now reports again when the items change: rows that arrive after the first layout, a filter that leaves fewer rows, or new rows in place of as many old ones.

- A unitless `line-height` in an app's global stylesheet is now a multiple of the element's own font size, whichever rule that size comes from, as CSS has it. ([#638](https://github.com/ng-native/ng-native/pull/638))

  The Tailwind build multiplied the number by the `font-size` written in the same rule and kept the result, so `.icons { font-size: 24px; line-height: 1 }` on an element another rule made `16px` kept a 24-point line: an icon font drawn smaller sat low in its box. Tailwind's own text sizes come to the same points as before. An element that relied on the larger line now has the one CSS gives it.

- A transition of an `opacity` or a `background-color` that no rule sets now runs, from or to the property's initial value (1, and `transparent`), as in a browser. It jumped instead. ([#641](https://github.com/ng-native/ng-native/pull/641))

  `.closed { opacity: 0 }` with `transition: opacity 200ms` on the element fades out and back in without the element also writing `opacity: 1`, and a background colour a class adds eases in from `transparent`. A `@keyframes` list that leaves out its first or last frame for a background colour nothing sets now starts or ends at `transparent` too, where it stepped.

- `transition: all` now eases an `opacity` or a `background-color` that no rule sets from or to its initial value, as a transition that names the property does. `view { transition: all 200ms }` with `.closed { opacity: 0 }` fades out and back, where it jumped. ([#649](https://github.com/ng-native/ng-native/pull/649))
- A `steps()`, `step-start` or `step-end` easing in an `animation` or `transition` now drops only that declaration, with a warning naming it, and the rest of the rule is kept. It used to drop the whole rule, so a spinner lost its size and a fading dot its opacity. In a rule that names no animation or no transition properties, where each longhand cascades on its own, only the `animation-timing-function` or `transition-timing-function` is dropped, and so is only the `transition-duration` or `transition-delay` list with no `transition-property` beside it. A step `animation-timing-function` inside a keyframe still drops the whole `@keyframes`, so the animation does not play rather than play eased. ([#640](https://github.com/ng-native/ng-native/pull/640))
- `@ng-native/router` gains a screen's bottom toolbar on iOS: `<native-toolbar>` with `<native-toolbar-item>`s, each a button with an SF Symbol or a title and a `(press)` output, a fixed or fluid spacer, or the place the integrated search field goes, so buttons can sit either side of it. ([#658](https://github.com/ng-native/ng-native/pull/658), [#657](https://github.com/ng-native/ng-native/issues/657))

  react-native-screens has no toolbar, so the two elements commit as Expo Router's native toolbar views: an app that uses them installs `expo-router` for its native half, with `npx expo install expo-router`. None of its JavaScript is imported, and Expo Go has it built in. The toolbar needs iOS 18, and the search field's place in it iOS 26. Android draws nothing for either element.

- A transition turned back part way now takes as long to return as it had been going, as in a browser. It took its full duration, so a press fade released half way through came back at half speed. ([#643](https://github.com/ng-native/ng-native/pull/643))
- A colour transition or `@keyframes` animation now mixes the two colours in premultiplied alpha, as a browser does. Halfway from `transparent` to red is red at half opacity, where it was a dark red, and a colour at part opacity pulls the mix less than an opaque one does. ([#642](https://github.com/ng-native/ng-native/pull/642))
- `max-content` is read as a size: `width` and `height` as `fit-content`, and `max-width` and `max-height` as a cap that keeps a box that would fill its container to its content. ([#654](https://github.com/ng-native/ng-native/pull/654))

  Tailwind's `w-max`, `h-max`, `max-w-max` and `max-h-max` were dropped with a warning. A box is as big as its content along its container's main axis already, so `max-content` is the same as `fit-content` here. A `max-width: max-content` beside a width in points leaves the width as written, since the content is not measured. `min-content`, and `max-content` as a minimum, are still refused.

- A `nativeRouterLink` to a url that is already on the stack pushes a new screen over it, as `NativeNavigation.push()` does, and Back returns to the page the link was on, where the press popped back to the earlier screen and destroyed everything above it. A link whose `[extras]` set `replaceUrl: true` replaces the screen as the `replace` attribute does, rather than leaving the replaced screen mounted under one its history entry no longer leads back to. ([#645](https://github.com/ng-native/ng-native/pull/645))
- `NativeNavigation.reset()`, `replace()` and `present()` to a page whose guard redirects, by returning a `UrlTree`, do to the page it redirects to what they were asked to do. A reset to a page whose guard sends a signed-out user to `/login` left the old stack under the sign-in page, a replace pushed it over the screen it was meant to replace, and a presentation pushed it instead of presenting it. A reset to the url already showing, or one a guard redirects there, takes the screens under it off the stack too, where the router skipped it and left them. ([#646](https://github.com/ng-native/ng-native/pull/646))
- A unitless `line-height` is inherited as the number, as on the web. Under `.card { font-size: 10px; line-height: 2 }`, a text with `font-size: 20px` now has lines 40 points tall, where it took the card's 20. The same goes for a number in the `font` shorthand, `font: 10px/2 serif`, and for one held in a custom property. A percentage or an `em` is still worked out where it is written, and those points are what a descendant inherits. ([#639](https://github.com/ng-native/ng-native/pull/639))
- A single-line text field whose `min-height` is `auto` now has its text centred by its line height on iOS, as a field with no `min-height` has. ([#644](https://github.com/ng-native/ng-native/pull/644))

  The centring was skipped for any `min-height` that was not a number, `auto` included, which left the text 3 to 5 points low in the field. `auto` is no minimum of the field's own.

- On iOS a single-line text field in a row with `align-items: baseline` now sits on the same baseline as the text beside it. ([#650](https://github.com/ng-native/ng-native/pull/650))

  The field's text is centred in its line by leaving `lineHeight` out, which left the field saying its baseline was the font's own: higher than a paragraph's in a line as tall, so the row lifted the text beside the field by the difference, about 2.5 points for 16-point text in a 24-point line. Half the room the line has over the font is now kept as padding over and under the field's text. The field is as tall as before; its `paddingTop` and `paddingBottom` are larger by that half where it is in such a row.

- A `ui-bottom-sheet` shows the system's close button on iOS: a `<ui-toolbar-item>` written inside it goes in a toolbar across the top of the sheet, and `<ui-button role="close">` in one is the button iOS 26 draws itself. ([#656](https://github.com/ng-native/ng-native/pull/656), [#652](https://github.com/ng-native/ng-native/issues/652))

  `@ng-native/expo` gains `UiNavigationStack`, `UiToolbar` and `UiToolbarItem` for SwiftUI's `NavigationStack`, `toolbar` and `ToolbarItem`, registered as `ui-navigation-stack`, `ui-toolbar` and `ui-toolbar-item`, and `UiButton`'s `role` takes `close`. They are iOS only and need `@expo/ui` 57.0.20 or later in the native build. Android's sheet has no toolbar and draws no item, and an iOS build without the views, as Expo Go can be, warns and shows the sheet without one.

- A debug build no longer stops with "Attempt to mutate a sealed object" when a row with `align-items: baseline` is laid out again and one of its boxes holds text. ([#637](https://github.com/ng-native/ng-native/pull/637))

  The text a baseline row takes a baseline from, where it is inside one of the row's boxes, is now measured again in every commit that commits the row again. Release builds were not affected: the assertion is compiled into debug builds only.

- Fix four things in the Markdown and Analog support: ([#648](https://github.com/ng-native/ng-native/pull/648))

  - `<markdown>` no longer breaks a paragraph where its source wrapped a line. A line break in a paragraph is a space, as CommonMark reads it; two spaces or a backslash at the end of a line still break the text there.
  - `<markdown>` decodes every named HTML entity, such as `&rarr;`, `&eacute;`, `&euro;` and `&hearts;`, not only a short list of common ones.
  - `injectContent()` and `contentFileResource()` from `@ng-native/analog` find a file whose slug has a space or an accent in it by the encoded slug `injectContentFiles()` lists it with, so a link to `post.slug` opens the post, as in Analog.
  - `fileRoutes` tries a dotted static page such as `users.new.page.ts` before a `users` folder whose `[id].page.ts` would take `new`, as Analog does.

- Fix four things in the Markdown and Analog support: ([#648](https://github.com/ng-native/ng-native/pull/648))

  - `<markdown>` no longer breaks a paragraph where its source wrapped a line. A line break in a paragraph is a space, as CommonMark reads it; two spaces or a backslash at the end of a line still break the text there.
  - `<markdown>` decodes every named HTML entity, such as `&rarr;`, `&eacute;`, `&euro;` and `&hearts;`, not only a short list of common ones.
  - `injectContent()` and `contentFileResource()` from `@ng-native/analog` find a file whose slug has a space or an accent in it by the encoded slug `injectContentFiles()` lists it with, so a link to `post.slug` opens the post, as in Analog.
  - `fileRoutes` tries a dotted static page such as `users.new.page.ts` before a `users` folder whose `[id].page.ts` would take `new`, as Analog does.

- Fix four things in the Markdown and Analog support: ([#648](https://github.com/ng-native/ng-native/pull/648))

  - `<markdown>` no longer breaks a paragraph where its source wrapped a line. A line break in a paragraph is a space, as CommonMark reads it; two spaces or a backslash at the end of a line still break the text there.
  - `<markdown>` decodes every named HTML entity, such as `&rarr;`, `&eacute;`, `&euro;` and `&hearts;`, not only a short list of common ones.
  - `injectContent()` and `contentFileResource()` from `@ng-native/analog` find a file whose slug has a space or an accent in it by the encoded slug `injectContentFiles()` lists it with, so a link to `post.slug` opens the post, as in Analog.
  - `fileRoutes` tries a dotted static page such as `users.new.page.ts` before a `users` folder whose `[id].page.ts` would take `new`, as Analog does.

### ❤️ Thank You

- Ashley Hunter
- erKam @erkamyaman

## 0.6.0 (2026-10-07)

### 🚀 Features

- An element that is `display: none` has no native view, nor has anything inside it; before, its views stayed mounted and were not displayed. ([#604](https://github.com/ng-native/ng-native/pull/604), [#587](https://github.com/ng-native/ng-native/issues/587))

  What a view holds of its own, such as a scroll offset, is no longer kept across a spell of `display: none`: the views are made again when the element is displayed. To keep a view while it is out of sight, take it out of the flow and give it no opacity (`position: absolute; opacity: 0; pointer-events: none`), which is how `<virtual-list>` now keeps its recycled rows. A debug build no longer stops on React Native's layout assertion for a hidden view. In `@ng-native/testing`, a `display: none` element is not found by any query, `includeHiddenElements` or not, and a view with no opacity that takes no touch counts as hidden.

- `@ng-native/analog`, a new package, routes an app with Analog's file-based pages: the pages in `src/app/pages`, found by Metro's `require.context` and routed by `createRoutes` from `@analogjs/router` itself, on a native stack. ([#509](https://github.com/ng-native/ng-native/pull/509))

  `pageRoutes(pages)` takes the `require.context` of the pages, or an `import.meta.glob` of them in a Vitest test, and returns the routes for `provideNativeRouter`, with `[id]` parameters, `(group)` folders, layouts and each page's `routeMeta` as Analog has them. `withAnalog(config)` from `@ng-native/analog/metro` turns on `require.context` and resolves `@analogjs/router`'s import of `@analogjs/content`, which only a Markdown page needs, to an empty module, so the bundle leaves it out whether or not the package manager installed it. `examples/analog` is a showroom of each of these features.

- `@ng-native/analog` reads Analog's content files and routes its Markdown pages on native. `provideContentFiles(require.context('../content', true, /\.md$/))` feeds `injectContent`, `injectContentFiles`, `contentFilesResource` and `contentFileResource`, named and shaped as `@analogjs/content` has them, with each file's `tokens` for `<markdown>`. A `.md` file in `src/app/pages` is a page, titled by its front matter, drawn by the component given as `pageRoutes(pages, { markdownPage })`, which reads its file with `injectMarkdownPage()`: `@ng-native/router`'s, under the same route data key, so one component draws a `.md` page under `fileRoutes` and `pageRoutes` alike. `rxjs` and `@ng-native/router` are new peer dependencies. ([#509](https://github.com/ng-native/ng-native/pull/509))
- `fileRoutes(pages)` in `@ng-native/router` routes an app by its files, with no Analog: each file in `src/app/pages`, found by Metro's `require.context` or, in a Vitest test, an `import.meta.glob`, is the page at the URL its path names, with Analog's file names (`index.page.ts`, `[id].page.ts`, `[...slug].page.ts` with the rest of the URL as `slug`, `(group)` folders, `blog.[slug].page.ts`, and `products.page.ts` as the layout of `products/`), each page's default export and `routeMeta`, and `.md` pages drawn by the component given as `fileRoutes(pages, { markdownPage })`, which reads its file with `injectMarkdownPage()`. `MARKDOWN_PAGE` and `markdownPageFile` are exported for a package that routes `.md` pages itself, as `@ng-native/analog`'s `pageRoutes` does. Pages from a lazy context load on their first navigation, static paths are tried before parameters and catch-alls, a `canMatch` that refuses a page passes it over to the next route, and two files at one URL or a malformed name throw at startup, naming the files. `examples/markdown` is routed this way. ([#509](https://github.com/ng-native/ng-native/pull/509))
- A `.md` file is a module in any app bundled with `withAngularNative`: `import post from './post.md'` is `{ attributes, content, tokens }`, its front matter parsed with `front-matter` and its Markdown lexed by `marked` as the app is bundled, each token without its `raw` source text, so `<markdown [tokens]="post.tokens">` parses nothing on the device. `marked` is a new optional peer dependency of `@ng-native/metro`, needed only when the app has a `.md` file; a new version of it rebuilds every cached one. `"types": ["@ng-native/metro/markdown"]` types the import, and `MarkdownFile` from `@ng-native/metro/markdown-file` names its attributes. The `ngNative()` Vitest plugin and the `@ng-native/testing/register` hook import a `.md` file the same way, and the plugin leaves one to a Vite plugin ahead of it that already made the file a module. ([#509](https://github.com/ng-native/ng-native/pull/509))
- `<markdown>`, from the new `@ng-native/components/markdown` entry point, draws a Markdown document as native text and views: headings, paragraphs with nested emphasis, code spans and links, quotes, ordered, unordered and task lists, code blocks in a horizontal scroll view, rules, tables and images. It parses with `marked`, a new optional peer dependency the main entry point never imports. `source` takes the Markdown and `tokens` takes tokens lexed already; `classes` replaces an element's default `md-*` class; `(linkPress)` reports a pressed link, and an absolute one is opened with `DeepLinks.open` unless the handler calls `preventDefault()`. Raw HTML is drawn as text, links are followed only to `http`, `https`, `mailto`, `tel` and relative targets, and images load only over `http` and `https`. ([#509](https://github.com/ng-native/ng-native/pull/509))
- Every component library's own CSS is compiled into native sheets with nothing to configure, in the Metro preset and in the Vitest plugin; before, a library drew unstyled unless its package was listed in `libraryStyles`. A list in `libraryStyles` still names the only packages compiled, so a config that has one builds as it did. An app with no list now gets each library's styles, and one build warning for each library file that drops something native cannot express; set `libraryStyles: false` to compile none but the `@ng-native/*` packages', as before. ([#592](https://github.com/ng-native/ng-native/pull/592))

### 🩹 Fixes

- A component whose CSS is not scoped (`ViewEncapsulation.None`) styles again only the views its rules could match the first time it renders, where every view in the app was styled again. On a screen of several hundred views that is the difference between a menu opening at once and after a visible pause. ([#572](https://github.com/ng-native/ng-native/pull/572))
- A component whose CSS is not scoped and names a cascade layer, as the CDK's overlay styles do, no longer has every view in the app styled again when it first renders, nor does one whose views join the tree in the same commit as its sheet. The first menu, select or dialog to open on a screen waited several hundred milliseconds for that. ([#575](https://github.com/ng-native/ng-native/pull/575))
- `LayoutAnimation.animate()` animates its own change while a CSS transition or animation driven from JavaScript is playing, where the change landed in one step and a frame of the other animation took the configured animation. ([#624](https://github.com/ng-native/ng-native/pull/624))

  `animate()` now runs change detection and commits the change before it returns, and configures the animation as that commit is handed to the platform. A change that commits nothing configures nothing, so a later unrelated commit is no longer animated in its place, and the promise resolves at once. A change made after `animate()` returns, rather than inside the function passed to it, lands in a later commit and is not animated.

- The `@ng-native/metro` config plugin takes an `android.layoutAnimations` option that makes `LayoutAnimation.animate()` animate on Android, where every layout change otherwise lands in one step. ([#622](https://github.com/ng-native/ng-native/pull/622), [#569](https://github.com/ng-native/ng-native/issues/569))

  React Native 0.86 ships its `enableLayoutAnimationsOnAndroid` feature flag off, and with it off Fabric never hands a commit to the driver that plays a layout animation. With `["@ng-native/metro", { "android": { "layoutAnimations": true } }]` in `app.json`, the plugin turns the flag on in the `MainApplication.kt` that `expo prebuild` writes. The option is off by default, and without it the Android project is as `expo prebuild` wrote it. Expo Go on Android is built with the flag off and does not animate; iOS is unchanged.

- A row whose place in a list changed keeps its style, and everything under it is left alone, where it still matches the rules it did. ([#625](https://github.com/ng-native/ng-native/pull/625), [#588](https://github.com/ng-native/ng-native/issues/588))

  A row added or removed under a stylesheet that counts its children (`:nth-child()`) or asks about earlier ones (`~`, which is every Tailwind `peer-*` variant) had every row its place could reach styled again, and everything under each. Those rows are now matched again, and one that matches the rules it did keeps its style and its subtree. A 300-row list of nine views a row gaining a row at its start goes from about 15ms to 0.8ms under `.row ~ .row` and from 19ms to 4ms under `.row:nth-child(3)`, in Node with V8's optimising tiers off. A list whose every row matches differently after the change, as stripes from `:nth-child(odd)` do, costs what it did. So does one under a rule that reads a row's place from inside the row, such as `.row:nth-child(odd) .label` or `.a + .b .c`: the rows such a rule could mean are styled again with everything under them, as before.

- `inherit` is taken for a property that has a value a child can simply have: `border-radius` and its corners, `width`, `height` and their limits, the font properties, `letter-spacing`, `text-align`, `text-transform`, `background-color` and `opacity`. The element has its parent's value, and none where the parent has none. It was refused as a CSS-wide keyword, so `border-radius: inherit` on a layer over a button left the layer square, and Tailwind's `bg-inherit` did nothing. For any other property it is still refused with a warning. ([#561](https://github.com/ng-native/ng-native/pull/561))
- A declaration a stylesheet marks `!important` now stands over the same property in an element's inline style, as it does in a browser. ([#633](https://github.com/ng-native/ng-native/pull/633))

  Before, an inline style won over every rule, so `.measuring { height: auto !important }` did nothing on an element with a `[style.height]` binding. An element that relied on its inline style beating an `!important` rule now takes the rule's value: drop the `!important`, or mark the inline value's rule the same way.

- Hot reload keeps the app's state and its route for far more edits, where only a template or a style edit did. An edited method, getter or lifecycle hook is patched onto the live component, service or directive, and an edited function onto every module that calls it; a template or a `computed` that called one shows the result at once. An edit that still needs a full reload, to a field, a constructor, a constant or a route file, comes back on the page it left with its back stack, where it returned to the first route. In Expo Go on Android such an edit now reloads the app, where it was dropped and the app went on running the code from before it. A file two lazy routes share no longer reloads the app for an edit that could be applied. ([#600](https://github.com/ng-native/ng-native/pull/600))
- A field that already has the focus does not hear a second `focus` event for it. ([#603](https://github.com/ng-native/ng-native/pull/603))

  A `topFocus` for the node the engine already holds as focused is dropped before any listener runs, so a focus dispatched from JavaScript and native's answer to it are one event. A focus after a blur, or on another field, is heard as before.

- A `flex-basis` that changes after a view is first laid out is followed, and a percentage `flex-basis` follows the box it is a share of. ([#613](https://github.com/ng-native/ng-native/pull/613))

  React Native works a `flexBasis` out once for a view and never again when its props change, so a bar bound from `flex-basis: 100%` to `60%` stayed at full width. A `flex-basis` that is a length or a percentage is now committed as the size it is along its container's main axis, a `width` in a row and a `height` in a column, which React Native reads on every layout and takes as the basis. A basis of `0` (`flex: 1`) and `auto` are committed as before. A view reading its committed props sees `width` or `height` where it saw `flexBasis`.

- A token that falls back to a value with several parts is read for two more properties: `border-radius: var(--r, 50% 50% 50% 0)` gives each corner its own radius, and `transform: var(--t, translateX(-50%) rotate(-45deg))` takes the list. The first gave every corner the token and no fallback, without a warning; the second was dropped with one. ([#591](https://github.com/ng-native/ng-native/pull/591))
- `UiBottomSheet` in `@ng-native/expo/expo-ui-components` opens the system's sheet from any component, with no route: `<ui-bottom-sheet [(open)]="open" fitToContents>` is SwiftUI's sheet on iOS and Material's on Android, and what is written inside it is the app's own components. ([#621](https://github.com/ng-native/ng-native/pull/621), [#576](https://github.com/ng-native/ng-native/issues/576))

  It type-checks in a strict template, where `<ui-bottom-sheet>` on its own is an unknown element. `open` presents and dismisses the sheet and is written back when the user dismisses it, `dismissed` is emitted once the sheet has finished closing, `fitToContents` makes it as tall as its content rather than resting at half height, `detents` sets the heights it rests at on iOS (`'medium'`, `'large'`, `{ fraction }` or `{ height }`, as SwiftUI's `presentationDetents`; Android takes no notice of it), and `showDragIndicator` hides the grabber. The component mounts the sheet as each platform needs and wraps the content in the `ui-host` and `ui-view-host` a sheet's content takes, at the window's width.

  `registerExpoUiViews` now also registers the sheet's native view as `ui-bottom-sheet-view`, the name the component's template uses. `<ui-bottom-sheet>` in a template that does not import `UiBottomSheet` is the native view, as before.

  `UiGroup` types SwiftUI's `Group` (`<ui-group>`, iOS only), which carries modifiers for the views inside it.

- One of HTML's text elements with nothing in it is a view, where it was a paragraph with no text. ([#610](https://github.com/ng-native/ng-native/pull/610), [#584](https://github.com/ng-native/ng-native/issues/584))

  `<span class="dot"></span>` styled as an 8 by 8 box was committed as an empty paragraph, which is not sized or painted as the box it is styled as. An empty `span`, `p`, `label` or other text element is now a view, as it is where it holds an element, and becomes a paragraph when it is given text. `<text>` is a paragraph whatever it holds.

- `:empty` matches an element whose only child is a text node with no characters, which is what `<span>{{ label }}</span>` holds while `label` is empty, and the element is restyled when the text gets its first character or loses its last. Any text node, an empty one included, used to stop the match. ([#571](https://github.com/ng-native/ng-native/pull/571))
- An animation whose keyframes hold nothing no longer commits a frame for as long as it runs. ([#618](https://github.com/ng-native/ng-native/pull/618))

  A `@keyframes` whose only declarations are refused at build time, as one with a `var()` in it is, left an animation with nothing to paint that was still restyled and committed on every frame, forever where it is `infinite`. It now commits nothing while it plays, its `animationstart` and `animationend` are sent as before, and one that never ends leaves the frame loop nothing to run for.

- A `color-mix()` whose share is a token, `color-mix(in srgb, var(--ink) calc(var(--share) * 100%), transparent)`, mixes by the token's value where the rule applies, on its own and as the fallback of another token. It was dropped with a warning, so the colour was never set. ([#565](https://github.com/ng-native/ng-native/pull/565))
- A class set on an element restyles only what the stylesheet rules that name the class are written for, where it restyled the element and everything under it. ([#596](https://github.com/ng-native/ng-native/pull/596))

  A class in no rule restyles nothing, and one named only as what a rule's element is inside, as `.busy .row` names `busy`, restyles the elements under it those rules are for. A component library that marks an overlay while it animates no longer restyles the whole overlay each time: opening Angular Material's datepicker restyled its 300 views twice over for two such classes. What is drawn is unchanged.

- A text element that is a flex container and holds one text element places it, as it places a run of text. ([#608](https://github.com/ng-native/ng-native/pull/608), [#585](https://github.com/ng-native/ng-native/issues/585))

  `<span class="content"><span class="label">First</span></span>` with `display: flex; align-items: center; height: 48px` on the outer span was committed as one paragraph, so the label sat at the top. The outer span is now a view around the inner one's paragraph, which the alignment centres, and is one paragraph again once it stops aligning.

- A border side styled `none` has no width whatever width another rule gives it, as CSS computes it: `border-right: none` under a later `border-width: 1px` drew the side. Each side's style is kept through the cascade, so a rule that styles the side again draws it again, and `border-top-style`, `border-right-style`, `border-bottom-style` and `border-left-style` are supported where they were dropped with a warning. ([#560](https://github.com/ng-native/ng-native/pull/560))
- A row with `align-items: baseline` keeps its height, and places what is in it, where an item's first box has `display: none`. Yoga read the item's baseline from the hidden box, which has no layout, so the row came to no height and nothing in it was drawn. ([#568](https://github.com/ng-native/ng-native/pull/568))
- `@media (prefers-reduced-motion)` with no value is read as `(prefers-reduced-motion: reduce)`. ([#615](https://github.com/ng-native/ng-native/pull/615), [#586](https://github.com/ng-native/ng-native/issues/586))

  The rule was dropped with a warning that named `prefers-reduced-motion` as a feature a device cannot answer, in a list of the ones it can. A media feature with no value is true for any value but its "none", which for the motion asked for is `reduce`. `prefers-color-scheme` and `orientation` with no value are still refused, and the warning now says it is the missing value that is not read.

- `background: inherit` is now the parent's background colour, where it was dropped with a warning. ([#636](https://github.com/ng-native/ng-native/pull/636))

  `background-color: inherit` already was; the shorthand is taken the same way, for the colour, which is the part of a background a view has a value of to hand on. A box that relied on `background: inherit` doing nothing now takes its parent's colour.

- `aspect-ratio` is now left out for a box that has both a width and a height, as CSS has it: the ratio only works out a size that is `auto`. ([#634](https://github.com/ng-native/ng-native/pull/634))

  Before, the ratio was committed with both sizes and Yoga took it over one of them: a box `24px` by `10px` with `aspect-ratio: 1 / 2` was 5 by 10 in a column and 24 by 48 in a row. A box that relied on the ratio beating a size it was given now takes the size: drop the size the ratio should work out, or set it to `auto`.

- An `animation` shorthand whose duration is a `calc()` on a token is read. ([#607](https://github.com/ng-native/ng-native/pull/607), [#582](https://github.com/ng-native/ng-native/issues/582))

  `animation: spin calc(2000ms * var(--speed, 1)) linear infinite` was dropped with "'animation' mixes var() with other values". The shorthand is now read with that time left out, and the time as `animation-duration` reads one, so the animation plays over the time the token scales it to.

- An element whose exit animation ends is no longer seen back at rest for a frame before its `animationend` listener removes it. ([#628](https://github.com/ng-native/ng-native/pull/628))

  An animation with no `forwards` fill ended by committing the element's resting style, and its `animationend` was delivered after that commit, so an overlay that fades out and is removed on `animationend` flashed fully opaque for one frame. An ended animation that something listens to now keeps its last frame for that commit, and the element goes back to rest once the listener has run and left it in the tree. With no listener it is back at rest at once, as before.

- A transform is eased into a longer or shorter list of functions that starts the same way. ([#606](https://github.com/ng-native/ng-native/pull/606))

  `transform: translateY(4px)` to `translateY(8px) scale(0.5)` jumped to its end state, because lists of different lengths were not interpolated. The shorter list is now padded with the longer one's functions at rest, as CSS has it, so the functions gained ease in from their identity and the ones lost ease out toward it. Lists that start with different functions still step.

- `touch-action` is read. On iOS 26 and later, a touch that starts on an element with `touch-action: pan-y` or `none`, or on anything inside one, holds the screen's swipe back off until the finger lifts, so a slider or anything else dragged sideways keeps its drag without the screen being opened with `fullScreenSwipeEnabled: false`. Tailwind's `touch-none`, `touch-auto` and `touch-manipulation` are read with it; the `touch-pan-*` utilities, which Tailwind composes from tokens, are still dropped, with a warning that says to write the value. A drag that sets off across such an element is also kept from a scroll view it is in, so a slider in a page that scrolls keeps its drag when the finger drifts up or down. ([#590](https://github.com/ng-native/ng-native/pull/590))
- A stylesheet with a rule that gives every element the same custom properties, as Tailwind's base rule does, no longer has each element's custom properties copied. ([#632](https://github.com/ng-native/ng-native/pull/632))

  Tailwind writes `--tw-translate-x: 0`, `--tw-blur: initial` and about forty more on `*`, so every element defined custom properties and each one copied the whole map in scope, a few hundred entries with a theme loaded, though almost none changed what its parent had. An element whose own definitions leave every custom property as its parent has it is now handed the parent's map. Mounting a page of about 1,100 views went from about 193ms to about 151ms in Node. What a `var()` reads does not change.

- `rows` on a multiline `<text-input>` sizes it: that many lines of its line height, with its padding and border. ([#609](https://github.com/ng-native/ng-native/pull/609), [#580](https://github.com/ng-native/ng-native/issues/580))

  A multiline field with `rows="3"` and nothing typed was one line tall, because native sizes a field by its text. A multiline field with `rows`, a `line-height` and no height of its own is now given that height, as a browser sizes a `<textarea>`. A height written for the field still wins.

- `ngNative()` from `@ng-native/testing/vitest` takes `libraryStyles`, the list of npm packages the Metro preset takes by the same name, and compiles those packages' component stylesheets in a test. Without it a library's components drew with no styles under Vitest, whatever the app's Metro config named. ([#563](https://github.com/ng-native/ng-native/pull/563))
- `light-dark()` in a stylesheet built with the Tailwind preset is the two colour schemes it names. It was lowered to a pair of `var()`s the compiler drops, so a custom property written with it, as every colour of an Angular Material theme is, had no value, and a declaration written with it was dropped with a warning. ([#559](https://github.com/ng-native/ng-native/pull/559))
- A screen of a component library's components is styled faster on its first render. ([#630](https://github.com/ng-native/ng-native/pull/630))

  A library adds a stylesheet for each of its components as the component first renders, and each one had every stylesheet filed again, for every pair of component sheets on the screen. Each sheet's rules are now filed once and a later sheet is added to what is there. A rule that names no class, id or element of its own but says whose child it is, `.row > *`, or is a bare `:is(.a, .b)`, is offered only to the elements it could match, where it was tried against every element. Mounting a page of about 1,100 views from Angular Material went from about 305ms to about 208ms in Node. What an element is styled with does not change.

- `margin: var(--gap, 0 24px)` and `padding: var(--gap, 1px 2px 3px 4px)` use the fallback, each side taking its own part of it, where the token is not set. A fallback with more than one value was discarded with no warning, leaving the box with no margin or padding at all. ([#562](https://github.com/ng-native/ng-native/pull/562))
- A list gaining or losing a row no longer has every row styled again where the stylesheets only ask which element is first and which is last. ([#616](https://github.com/ng-native/ng-native/pull/616))

  With a `:first-child`, `:last-child`, `:only-child` or `:not(:last-child)` rule in any stylesheet, which Tailwind's `space-y-*` and `divide-y` are, a change to a child list restyled the parent and every child, and everything under them. Now only the two elements at each end are styled again, and the parent only when it stops or starts being empty. A 300-row list gaining a row goes from about 3.4ms to 0.15ms in Node. A stylesheet that counts (`:nth-child(odd)`) or asks about a neighbour (`+`, `~`) still has every child styled again.

- A list gaining or losing a row under a stylesheet that counts its children has only the rows the change can reach styled again. ([#620](https://github.com/ng-native/ng-native/pull/620))

  With an `:nth-child()` rule in any stylesheet, or one that asks about the element before (`+`, `~`), a change to a child list restyled every child and everything under them. A row's place from the start hangs only on the rows before it, so now only the rows from the change on are styled again, with the two at each end: a row added at the end of a striped list restyles none of the rows before it. An `:nth-last-child()` rule is the other way about, and reaches the rows before the change. A 300-row list of nine views a row, striped with `:nth-child(odd)`, gaining a row at its end goes from about 19ms to 0.45ms in Node with V8's optimising tiers off, and one in the middle from 19ms to 9.4ms. A row added at the start still restyles every row, as do stylesheets that between them count from both ends.

- A side of a `padding`, `margin`, `inset` or `gap` shorthand that is a `calc()` of more than one step around a `var()` is worked out. ([#602](https://github.com/ng-native/ng-native/pull/602))

  `padding: calc((var(--height, 72px) - 24px) / 2) 24px` was refused with a warning and the whole declaration dropped, where the same `calc()` in `padding-top` was worked out. A shorthand side now takes the sum the longhand takes, and follows the token being set and unset.

- `opacity` in a `::placeholder` rule fades the placeholder's colour, so `opacity: 0` hides a placeholder and `opacity: 1` shows it again. It was dropped with a warning, which left a placeholder a stylesheet hides drawn over whatever was meant to show in its place. ([#567](https://github.com/ng-native/ng-native/pull/567))
- A translate is eased between a percentage and a length, in a transition and between keyframes. ([#619](https://github.com/ng-native/ng-native/pull/619), [#606](https://github.com/ng-native/ng-native/issues/606), [#583](https://github.com/ng-native/ng-native/issues/583))

  `transform: translateY(-50%)` to `translateY(-34px) scale(0.75)`, as Material's floating label moves, stepped to its end, because a share of the box and a length are not on one scale. So did `translateY(100%)` to `translateY(0)`, a zero with no unit being a length. The frames between are now two translates along the axis, `translateY(-25%) translateY(-17px)` halfway, which add up to the `calc(-25% - 17px)` a browser eases through whatever size the box is; where one of the two is nothing, the frame is the other alone. A transition turned round part way carries on from the frame it had reached. The `translate` property is eased the same way. Keyframes that go from one to the other are played from JavaScript, as any keyframes with a percentage translate are.

- `height: 100%` under a parent stretched across a row that is as tall as its content is no height, where it was the height of the screen. ([#611](https://github.com/ng-native/ng-native/pull/611), [#579](https://github.com/ng-native/ng-native/issues/579))

  A box stretched across a row counted as having a height a percentage could be taken of, whether or not the row had one. Under a row sized by its content, Yoga then took the percentage of the space on offer: the screen, or everything a scroll view holds. The percentage is now kept only where the row has a height of its own, and the box is otherwise as tall as what it holds, as in a browser.

- A percentage height on an absolutely positioned box is kept where the box that holds it has no height written. ([#612](https://github.com/ng-native/ng-native/pull/612), [#578](https://github.com/ng-native/ng-native/issues/578))

  `position: absolute; height: 100%` under a parent sized by its content had its height removed, as a percentage height in the flow is, so the box had no height. A box out of the flow takes the percentage of the box that holds it, which is laid out first, so the percentage is now left for Yoga to resolve.

- A view that is pressed and has `opacity: 0` takes the press on iOS, as it does on Android and in a browser. iOS sends no touch to a view whose alpha is under a hundredth, so a see-through layer laid over the page to hear a press, such as the backdrop behind a menu, heard nothing and the press went to what was under it. ([#574](https://github.com/ng-native/ng-native/pull/574))
- `outline: none`, and any other outline of no width, is no longer sent to the native view, which fixes text vanishing from a focused text field on Android. ([#635](https://github.com/ng-native/ng-native/pull/635))

  On Android a text field given an outline prop after it is first drawn has its background set again, and the padding Android gives a text field comes back over the padding the field was laid out with. A field as tall as its line then clips all of its text. A stylesheet that takes the focus ring off with `:focus { outline: none }` was such an update: the field's text disappeared when it was focused, and stayed gone.

- An app that installs the `@ng-native/*` packages from npm gets their components' own styles, such as `<markdown>`'s default `md-*` classes and `<touchable-opacity>`'s press fade, with no `libraryStyles` entry. The transformer compiles every `@ng-native/*` package's component CSS into native sheets, as it does in a workspace; before, those components drew unstyled unless the package was listed. ([#509](https://github.com/ng-native/ng-native/pull/509))
- A list gaining or losing a row under a stylesheet that asks about the element just before (`+`) has only the rows next to the change styled again. ([#623](https://github.com/ng-native/ng-native/pull/623))

  With a `.row + .row` rule in any stylesheet, which is how a list is often given its gaps and separators, a row added or removed restyled every row after it and everything under them. A `+` reads the one element before, so now a change restyles as many rows after it as a rule steps along: one for `.a + .b`, two for `.a + .b + .c`. A 300-row list of nine views a row under `.row + .row` gaining a row at its start goes from about 15.8ms to 0.46ms in Node with V8's optimising tiers off, and one in the middle from 8.1ms to 0.56ms. A stylesheet that asks about any earlier element (`~`) or counts from the start (`:nth-child()`) still restyles every row after the change.

- A `detectChanges()` called from a lifecycle hook no longer commits the screen on its own. ([#631](https://github.com/ng-native/ng-native/pull/631))

  Angular tells the renderer when each change-detection pass ends, and the renderer committed every time, including a pass a component begins on itself from `ngAfterViewInit` while the application's pass is still running. A library that does this in each of its components committed the whole screen once for every one of them as the screen was first built. A pass begun inside another is now part of it, and the screen is committed once, when the outermost pass ends. A `detectChanges()` with no pass around it commits as before.

- A `@keyframes` animation whose transform gains or loses a function between frames is played by native. ([#617](https://github.com/ng-native/ng-native/pull/617))

  An animation from `transform: rotate(180deg) translateX(-10px)` to the element's own `rotate(180deg)` was played from JavaScript, a commit a frame for as long as it ran, because the two lists are of different lengths. A list that is the start of a longer one is now the longer one with the rest at their identity, as CSS eases it, so native plays the animation and JavaScript does nothing while it runs. Lists that start with different functions are still played from JavaScript.

- A `@keyframes` animation that moves an element by a percentage of its own size, `translateX(200%)`, is played by native. ([#629](https://github.com/ng-native/ng-native/pull/629))

  Native interpolates points, so an animation with a percentage translate in a frame was played from JavaScript, a restyle and a commit on every frame for as long as it ran. The percentage is now worked out from the size the view is laid out at, after its first commit, and the animation is handed to native from there. An indeterminate progress bar that slid this way cost about a sixth of the JavaScript thread while it was on screen, and now costs none. A view that changes size while its animation runs keeps moving by the points of the size it started at until the animation starts again.

- A `@keyframes` animation of opacity or transforms no longer leaves its view at its first frame when the view is made in a long task. ([#595](https://github.com/ng-native/ng-native/pull/595))

  Native plays such an animation, and one shorter than the task that made its view finished before
  the view was mounted: the view then stayed transparent or scaled, as an overlay's panel did the
  first time it opened. Native now writes the animation's last frame as it ends.

- A property named in `transition` with a time of 0ms is eased when one change gives it both a new value and a time, as `.grown { transform: scale(1); transition-duration: 100ms }` does. It went straight to the new value, because nothing remembered where the property was while its time was zero. ([#566](https://github.com/ng-native/ng-native/pull/566))
- A tab whose route has no component of its own, a `loadChildren` wrapper or a group of routes as Analog's file routes make, now opens, where `<native-tabs-outlet>` threw `no <native-tab> has path=""`, and switching away from it and back keeps it as it was, its own stack included. ([#509](https://github.com/ng-native/ng-native/pull/509))

  A tab at `path=""` now works beside routes outside the bar: `present()` of one of its pages from another tab shows the page over that tab, a push into it uses the stack it already has, and returning to it returns where it was left. A push into any tab that has been opened no longer builds a second stack in the tab's screen.

  A sheet or modal presented in a tab's own stack is now dismissed when another tab comes in front, where it stayed on screen over that tab, and returning to its tab returns to the page beneath it.

- A `<virtual-list>` or `<section-list>` with `listHeader` or `listFooter` content no longer stops the app on Android with "ScrollView can host only one direct child". The header, the rows and the footer are held by one content view, as `<scroll-view>`'s children are, so the native scroll view has a single child on both platforms. ([#589](https://github.com/ng-native/ng-native/pull/589), [#558](https://github.com/ng-native/ng-native/issues/558))
- A `var()` whose fallback is a `calc()` of a viewport or font unit and a length, `max-width: var(--max, calc(100vw - 32px))`, takes that fallback where nothing sets the token. The fallback was lost with no warning, so the declaration set nothing and still hid what an earlier rule had set. ([#570](https://github.com/ng-native/ng-native/pull/570))
- A `transition` shorthand whose time is a token, `transition: opacity linear var(--duration, 0ms)`, is eased over the time the token is set to, and a time set on an element (`style.setProperty('--duration', '150ms')`, or a bound `[style.--duration]`) is read as one. The shorthand was dropped with a warning and the time was read as a word, so what a library opens with such a transition was there at once. ([#577](https://github.com/ng-native/ng-native/pull/577))
- A `transform` that is a token of its own rule is read where the token's value is transform functions with a `var()` or a `calc()` inside them. ([#605](https://github.com/ng-native/ng-native/pull/605), [#581](https://github.com/ng-native/ng-native/issues/581))

  `--move: translateY(calc(6px + var(--h) / 2)) scale(var(--s)); transform: var(--move)` was refused with a warning, because no one form of a token holds a transform with a sum and tokens inside it, and the element had no transform. The compiler now reads the token's value in place of the `var()` in the same rule, so the transform follows `--h` and `--s` as it would written out. A token another rule reads stays a token.

- `scale3d()`, `translate3d()` and `translateZ(0)` are read as the flat transform they are on a view, in a stylesheet and on an element, where each was dropped with a warning. A move along z that is not zero is still refused, and says a native view is flat. ([#564](https://github.com/ng-native/ng-native/pull/564))

### ❤️ Thank You

- Ashley Hunter
- erKam @erkamyaman

## 0.5.0 (2026-10-05)

### 🚀 Features

- An `<ng-icon>` with no `size` is `1em`, as big as the text around it, where it was 24 points. That is what `@ng-icons/core` does on the web, and it is how a component library sizes its icons: with a `font-size` on the icon or above it, or a width and height from a stylesheet. An icon with a `size` is unchanged. To keep an unsized icon at 24, give it `size="24"`. ([#532](https://github.com/ng-native/ng-native/pull/532))

### 🩹 Fixes

- `:has()` is supported on the node a rule styles, for a descendant (`.card:has(.action)`) or a child (`.card:has(> img)`), and Tailwind's `has-[...]` and `has-data-[...]` variants with it. The rule was dropped with a warning before. On an ancestor of the styled node (`group-has-*`), or with a longer or sibling selector inside, it still is. ([#513](https://github.com/ng-native/ng-native/pull/513), [#512](https://github.com/ng-native/ng-native/issues/512))
- Tailwind's `*:` variant styles the children of the element it is on, as `**:` already does for everything beneath it: `*:rounded-full`, `*:data-[slot=icon]:size-4`. It compiles to `:is(<compound> > *)`, which is now read as a test of the node's parent, where the rule was dropped with a warning. ([#521](https://github.com/ng-native/ng-native/pull/521), [#520](https://github.com/ng-native/ng-native/issues/520))
- `width: fit-content` and `height: fit-content`, and Tailwind's `w-fit` and `h-fit`, keep a box at the size of its content, where the declaration was dropped with a warning and the box stretched across its container. ([#511](https://github.com/ng-native/ng-native/pull/511), [#510](https://github.com/ng-native/ng-native/issues/510))
- One of HTML's text elements that is a flex container aligning its text, as `<span class="flex items-center justify-center">AH</span>` centres an avatar's initials, places the text as a browser does. It is drawn as a view around a paragraph of the text, where it was a paragraph whose text sat at its top left whatever the alignment. A `<text>` is unchanged, and so is an element that holds more than one run of text. The paragraph the engine makes for text written straight into a view is laid out again when the system text size changes or a face it names is declared later, as any other text is. ([#529](https://github.com/ng-native/ng-native/pull/529))
- `npm run web` in an app created from `@ng-native/template` now explains that the app targets iOS and Android and links to the web guide, instead of failing with npm's `Missing script: "web"`. `create-expo-app` suggests the command as it finishes, whatever the template defines. ([#554](https://github.com/ng-native/ng-native/pull/554))
- A Tailwind rule that applies a comma-separated arbitrary value and a pseudo-element variant together, such as `@apply transition-[color,box-shadow] file:font-medium`, now builds, where it failed the whole build with `SyntaxError: Unexpected token CurlyBracketBlock`. ([#501](https://github.com/ng-native/ng-native/pull/501), [#500](https://github.com/ng-native/ng-native/issues/500))

  The pseudo-element part is refused with the usual warning and the rest of the rule is kept.

- A rule in a cascade layer keeps the layer's place in the Tailwind sheet: a component class in `@layer components`, written after the utilities, no longer beats a utility beside it, so `rounded-full` on an element with a `.card` that applies `rounded-md` wins, as it does in a browser. ([#519](https://github.com/ng-native/ng-native/pull/519), [#518](https://github.com/ng-native/ng-native/issues/518))
- Binding `[trackColor]` on `<switch>` no longer throws `ColorValue: the value must be a number or Object.` on Android: `trackColorForTrue` and `trackColorForFalse` are colours whose names end in the state they paint, so they were reaching native as raw strings where Android's `ColorPropConverter` takes only a number or a platform-colour map. ([#524](https://github.com/ng-native/ng-native/pull/524), [#523](https://github.com/ng-native/ng-native/issues/523))
- A static attribute that is an input of the host's own component is no longer committed to the host view as a prop: `<app-field accessibilityLabel="Email" />` gives the label to the input, and a screen reader and `getByLabelText` find the one field rather than the field and its container. The attribute stays on the node, so a selector such as `:host([variant='primary'])` still matches, and a host binding that writes the same name is committed as before. ([#546](https://github.com/ng-native/ng-native/pull/546), [#540](https://github.com/ng-native/ng-native/issues/540))
- `<screen-safe-area-view>` in `@ng-native/router` insets a page by what covers the screen it is on, so a page that is not one scroll view starts below a Liquid Glass header and keeps the glass bar. It works on any page of a stack and on a tab, for any edge. `<tab-safe-area-view>` is the same view and keeps working; on Android both now leave the top edge alone under a header that is shown and not translucent, where it added a gap the height of the status bar. ([#550](https://github.com/ng-native/ng-native/pull/550), [#539](https://github.com/ng-native/ng-native/issues/539))
- `Renderer2.listen('window', ...)`, and the same on `'document'` and `'body'`, attaches to nothing, where it threw `Cannot create property 'listeners' on string 'window'`. ([#505](https://github.com/ng-native/ng-native/pull/505), [#504](https://github.com/ng-native/ng-native/issues/504))
- A press no longer styles the whole screen again. `:active` is true of the pressed element and every ancestor up to the root, and each was restyled with everything under it, at touch down and again at release. Now each is only matched again, and keeps its style unless it matches other rules, so a press costs the pressed element and not the screen. An element a rule asks about from another one (`.card:active .title`, Tailwind's `group-active:`) is still restyled with what is under it. ([#556](https://github.com/ng-native/ng-native/pull/556))
- The Tailwind presets' `disabled:`, `focus:`, `focus-visible:`, `hover:` and `hovered:` variants no longer match a `data-disabled`, `data-focus` or `data-hover` attribute whose value is `"false"`. An attribute binding to a boolean writes that string when it is off, which styled the element as disabled, focused or hovered. ([#517](https://github.com/ng-native/ng-native/pull/517), [#516](https://github.com/ng-native/ng-native/issues/516))
- `getByPlaceholderText` and its `query`, `find` and `All` forms find a `<native-search-bar>` by its placeholder again, as they did before 0.4.0 limited the query to text fields. A wrapper component's host carrying a `placeholder` attribute is still not matched. ([#545](https://github.com/ng-native/ng-native/pull/545), [#535](https://github.com/ng-native/ng-native/issues/535))
- A `::placeholder` rule, and Tailwind's `placeholder:` variant, now reach an element named `input` or `textarea` as well as `<text-input>`, for an app or a package that registers one as a text field. ([#515](https://github.com/ng-native/ng-native/pull/515), [#514](https://github.com/ng-native/ng-native/issues/514))
- A percentage height under a parent with no height of its own is no height, as CSS reads it: the box is as tall as what it holds. It was a percentage of the space on offer, the height of the screen or of everything a scroll view holds, so a `height: 100%` box inside a content-sized one filled the screen. A parent has a height when it is written, when the parent grows in a column that has one, when it is stretched across a row, or when it is placed absolutely; under any of those the percentage is kept. To keep a box the height of the screen, give its parent a height or `flex: 1`. ([#528](https://github.com/ng-native/ng-native/pull/528))
- A `@keyframes` animation that sets only `opacity` and transforms is played by native, with nothing running in JavaScript while it plays: a spinner or a pulsing skeleton no longer commits on every frame for as long as its screen is open. Animations of anything else, delayed ones, and every animation without the native animated module play from JavaScript as before. ([#555](https://github.com/ng-native/ng-native/pull/555))
- Text written straight inside a `<div>` or another HTML layout element no longer logs "`<text>` is used in a template that does not import Text". The paragraph is one the engine adds for the text, not a `<text>` the template wrote. ([#508](https://github.com/ng-native/ng-native/pull/508), [#507](https://github.com/ng-native/ng-native/issues/507))
- A logical property and the physical one for the same corner or edge are settled as CSS settles them, the later declaration winning: `rounded-md` with `rounded-e-none` squares the end corners, where both had reached the view and it kept the rounded ones. The same holds for a margin, a padding, a border's width and colour, and an inset, for an inline style over a rule, and for `!important`. Which physical side a logical one is follows the element's `direction`, or the app's: `currentConditions()` in `@ng-native/device` now carries `direction`, from `I18nManager.isRTL`. ([#530](https://github.com/ng-native/ng-native/pull/530), [#525](https://github.com/ng-native/ng-native/issues/525))
- `<ng-icon [svg]>` draws `<defs>`, `<linearGradient>`, `<radialGradient>`, `<text>` and `<tspan>`, so a shape can have a gradient fill or stroke with `fill="url(#id)"` and a wordmark can be gradient text. A stop written as `currentColor` takes the icon's `color` input. A tag that is still not drawn is named in a development warning, where it was left out in silence. ([#549](https://github.com/ng-native/ng-native/pull/549), [#542](https://github.com/ng-native/ng-native/issues/542))
- A component with a `model()` or an `output()` keeps them through a hot template or style swap. After an external stylesheet was edited, every later cold start applied the swap before the component first rendered and turned its outputs round, so a custom form control under `[formField]` was rejected with NG01914 until Metro was restarted with `--clear`. ([#547](https://github.com/ng-native/ng-native/pull/547), [#544](https://github.com/ng-native/ng-native/issues/544))
- The build no longer fails with "host cannot be read at build time" on a component that has no `host`, when it follows another component in the same file and neither class is exported, as the components in a test file are. ([#502](https://github.com/ng-native/ng-native/pull/502))

  The check read the decorator of the component before it. A class that is not exported now has its own `host` and `styles` checked, where the first one in a file was passed over.

- A gradient through a transparent or partly transparent stop paints the fade a browser does, where iOS drew a grey or muddy band through it: `linear-gradient(transparent, white)`, `linear-gradient(red, transparent, blue)`, `linear-gradient(rgb(0 0 0 / 0.1), white)`, and the same with a token or a `color-mix()` as the stop. A stop at no opacity is committed in the colour of the stop it fades to or from, one between two different colours as two stops at one position, and stops are written in between two of different colour and opacity, so the `colorStops` committed for such a gradient differ from the ones written. A token bound on an element as `hsl()` or `hwb()` is also read as a colour by a `color-mix()`, a relative colour and a transition. ([#543](https://github.com/ng-native/ng-native/pull/543), [#534](https://github.com/ng-native/ng-native/issues/534))
- `<gradient-text>` in `@ng-native/components` draws a gradient, or any background, through its letters: text that wraps and scales like any other, filled by the `background-image` its class gives it. A rule with `background-clip: text` now applies to `<gradient-text>` alone, so on a `<text>` it no longer leaves transparent letters on a block of color, and the build no longer reports the declaration as not mapped. It needs `@react-native-masked-view/masked-view`, which Expo Go includes. ([#551](https://github.com/ng-native/ng-native/pull/551), [#538](https://github.com/ng-native/ng-native/issues/538))
- Tailwind's `ltr:` and `rtl:` variants apply. `:dir(ltr)` and `:dir(rtl)` are answered from the direction the app is laid out in, and an alternative the engine cannot match inside `:is()` or `:where()` is left out with a warning while the rest of the list still matches, as CSS reads those lists. Each used to drop the whole rule: `ltr:` never applied, and `open:` lost its `[open]` form to the `:popover-open` beside it. ([#533](https://github.com/ng-native/ng-native/pull/533))
- Content projected into an `@if` no longer aborts the app when the `@if` closes and opens again. Angular destroys the projected element with the view that showed it and puts the same element back later; the engine made the element's view again but handed it the views of what it holds, and native aborts when a view is given a second parent. Deleting past the start of a one-time code field built this way crashed on a device. ([#557](https://github.com/ng-native/ng-native/pull/557))
- A CSS system colour is the platform's own colour for the same thing: `Canvas` and `CanvasText` are the system background and label colours, `GrayText` the secondary label, `LinkText` the link colour, `AccentColor` the tint and `ButtonFace` the secondary background, each following light and dark. A deprecated one (`Window`, `WindowText`, `Menu`, `ThreeDFace`) is the current colour CSS says it now is. One with no such colour (`Highlight`, `SelectedItem`), or one inside a shadow or a gradient, is dropped with a warning. Each was passed to the view as its keyword, which no view reads as a colour. ([#527](https://github.com/ng-native/ng-native/pull/527), [#526](https://github.com/ng-native/ng-native/issues/526))

### ❤️ Thank You

- Ashley Hunter
- Ola Boluwatife @boluwatifee4

## 0.4.0 (2026-10-03)

### 🚀 Features

- `injectService()` calls in one test share an app, so a service and a service it injects are the same instances a later call returns, where each call made an app of its own and the two never saw each other. ([#419](https://github.com/ng-native/ng-native/pull/419), [#397](https://github.com/ng-native/ng-native/issues/397))

  A call with `providers` starts a new app, which the calls after it use. The app ends with its test, whether or not `cleanup()` ran. A test that relied on two bare calls returning separate instances now gets one: pass `providers: []` to the second call for an app of its own. Calls outside a test, or in tests that run at once, still make an app each.

- `@ng-native/expo/widget` keeps a home screen widget in step with a signal, and hands the app the taps on its buttons: `widget(widget, props, { onTaps })`. A widget layout's `<ui-button target="...">` now compiles: a tap runs in the widget extension while the app may be suspended, so it records its target in the widget's props as `taps`, and `widget` collects them when the app next runs, before anything is written over them. Its `error` holds why the last sync failed. `(buttonPress)` is an object of the props to change at once, so the widget shows the tap before the app has seen it. `UiButton` gains a `target` input. The padel example has a score widget with a button for each side. ([#340](https://github.com/ng-native/ng-native/pull/340))
- `@ng-native/web/vite` exports `ngNativeWebLink()`: `ngNativeWeb()` without the compiler, for an app whose own Angular plugin compiles its components, such as Analog. It keeps the browser resolution and `@oxc-angular/vite`'s linker, which links the `@ng-native/*` packages from `dist/`. ([#375](https://github.com/ng-native/ng-native/pull/375))

### 🩹 Fixes

- An `(animationcancel)` listener now fires when a running animation stops before it ends, because the element no longer asks for it, asks for another by name, or its `@keyframes` went in a hot swap, as a browser fires it. ([#361](https://github.com/ng-native/ng-native/pull/361), [#329](https://github.com/ng-native/ng-native/issues/329))
- `animate.enter` on a `transition` fades an element in once from its enter style, where it drew the element at rest, eased to the enter style and eased back, in twice the duration. ([#454](https://github.com/ng-native/ng-native/pull/454), [#410](https://github.com/ng-native/ng-native/issues/410))

  A class added to an element in the turn that created it is now its starting style, as in a browser, and is committed in that turn rather than a frame later. An `animate.enter` on `@keyframes` starts a frame sooner for the same reason.

- A component of an app's own with a `ui-` selector, such as `ui-button`, is now a plain view drawing its own template after `registerExpoUiViews()`, where its host was committed as the `@expo/ui` view of that name and its template drew nothing. ([#484](https://github.com/ng-native/ng-native/pull/484), [#428](https://github.com/ng-native/ng-native/issues/428))

  An element with no component on it is still the native view, and so are the typed components `@ng-native/expo/ui` exports. A view registered with `registerViewName` or `registerExpoView` can ask for the same with the `yieldsToComponents` option, and a component that wraps such a view keeps it by calling `keepNativeView` on its host from its constructor.

- In a Node test, `Crypto`, `FileSystem`, `database()` and the audio and video players say that Node has no native module to load and what a test does instead, where they said the package was not installed when it was. ([#467](https://github.com/ng-native/ng-native/pull/467), [#395](https://github.com/ng-native/ng-native/issues/395))
- A sibling rule after `:empty`, such as `.box:empty + .spacer`, is matched again when the element gains its first child or loses its last, where the sibling kept the style it had at first. ([#453](https://github.com/ng-native/ng-native/pull/453), [#411](https://github.com/ng-native/ng-native/issues/411))
- `<dom-component>` acts only on messages from the page it loaded, or from its dev server in development, and the Metro preset's dev server looks for a lazy chunk from outside the project only in the server root and the watch folders, rather than in every directory up to the root of the disk. ([#374](https://github.com/ng-native/ng-native/pull/374))

  A page the web view is taken to by a link cannot fire the app's outputs or be sent its changed inputs. The inputs given before the page loads are still handed to whatever page the web view shows, so they should hold nothing secret. A message that is not JSON is dropped instead of throwing, and an output named after an object member such as `constructor` does nothing.

  The dev server also refuses a chunk name that decodes to a `..` segment, a root or a backslash.

- A `display: var()` whose fallback native has no layout for, such as `var(--d, grid)`, now warns at build time and keeps reading the token, and a fallback of two keywords such as `var(--d, inline flex)` is kept where it was dropped. ([#352](https://github.com/ng-native/ng-native/pull/352), [#334](https://github.com/ng-native/ng-native/issues/334))
- `DateTimePicker` from `@ng-native/expo` is a typed component over the `<date-time-picker>` element, so a strict template can bind the picker's `date`, `mode`, `displayIOS`, `minimumDate` and `maximumDate` and read `$event.nativeEvent.timestamp` from `(change)`. ([#491](https://github.com/ng-native/ng-native/pull/491), [#430](https://github.com/ng-native/ng-native/issues/430))

  `date`, `minimumDate` and `maximumDate` take a `Date` or milliseconds. The Native views page now says what the element takes and sends, and that it is iOS only: on Android the library has no view, and the element commits as nothing.

- `database()` takes an `onOpen` option, run on every open, before the migrations and outside any transaction, which is where `PRAGMA foreign_keys = ON` has to be said for a schema's foreign keys to be enforced. ([#463](https://github.com/ng-native/ng-native/pull/463), [#396](https://github.com/ng-native/ng-native/issues/396))

  A migration is the wrong place for it: SQLite ignores the statement inside a transaction, and forgets it when the connection closes. Foreign keys stay off unless `onOpen` turns them on, as with `expo-sqlite` itself.

- A service built on `database()` can be tested in Node: `openDatabasesWith()` from `@ng-native/expo/database` points every `database()` at a stand-in, and `memoryDatabase()` from `@ng-native/testing` is one that runs the migrations and the SQL for real, in memory. ([#472](https://github.com/ng-native/ng-native/pull/472), [#394](https://github.com/ng-native/ng-native/issues/394))
- A token worked out on the device, such as a `calc()` of tokens bound on an element, and a transform bound as a string now treat only CSS whitespace as whitespace, so a no-break space leaves the value invalid as it does in Chrome, and an inline transform CSS cannot read leaves the transform a rule sets rather than replacing it. ([#351](https://github.com/ng-native/ng-native/pull/351), [#336](https://github.com/ng-native/ng-native/issues/336))

  A bound transform with anything but functions and their numeric arguments in it, such as `rotate(90deg) junk`, is now dropped in favour of the rule's transform, or none, where it was applied in part.

  A bound transform's function names are now read in any case, as CSS reads them, so `ROTATE(90deg)` turns the view, and a function native has no transform for, such as `spin(90deg)`, leaves the rule's transform.

- A push from a page under a route with no component of its own, a `loadChildren` wrapper or a group of routes, keeps that page on the stack beneath the new screen, where it destroyed it and the push acted as a replace. Back from there returns to the page as it was, where a group at path `''` came back as a page at `''` beside it. ([#489](https://github.com/ng-native/ng-native/pull/489))
- `ColorScheme.set('light')` and `set('dark')` now take effect at once for `ColorScheme.current()` and `.dark` styles, including inside a full-screen `<modal>` on iOS, where they waited for the modal to close. ([#368](https://github.com/ng-native/ng-native/pull/368), [#347](https://github.com/ng-native/ng-native/issues/347))

  On iOS React Native reports an appearance change only from its root view, which a full-screen modal takes out of the window. `set(null)` and a system switch while one is open still arrive when it closes. A subscriber hears each scheme once, though the platform repeats it.

- `@layer` in a component's or a library's stylesheet orders its rules as a browser does, where the block was refused and every rule in it lost. ([#385](https://github.com/ng-native/ng-native/pull/385), [#380](https://github.com/ng-native/ng-native/issues/380))

  A rule in a layer loses to every rule outside one whatever their specificity, a layer loses to each one named after it, and `!important` turns that order round. `@layer a, b;`, nested layers and layers with no name are read. Layers have one order across every stylesheet, so a library's layer and the app's layer of the same name are one layer. A library compiled with `libraryStyles` keeps what it ships in a layer, such as the Angular CDK's overlay stacking and backdrop.

- A `transition` on `transform` eases a transform bound as a style, `[style.transform]="'translateX(100px)'"`, as it eases one a rule sets, where the bound one started again from where it was at every frame and did not arrive on time. ([#459](https://github.com/ng-native/ng-native/pull/459), [#401](https://github.com/ng-native/ng-native/issues/401))
- A bound style declaration whose value is a `var()`, `[style.background-color]="'var(--surface)'"`, reads the token in scope and follows it, where the text `var(--surface)` was sent to native. ([#460](https://github.com/ng-native/ng-native/pull/460), [#402](https://github.com/ng-native/ng-native/issues/402))

  The whole value has to be the `var()`, with its fallback if it has one. It is settled as the same declaration in a stylesheet is: inherited where the property is, and reported in development when the token is unset with nothing to fall back to.

- A `border`, a per-side border or an `outline` shorthand now takes a `color-mix()` of a token as its color, as in `border: 1px solid color-mix(in srgb, var(--tint) 35%, transparent)`, where it was dropped whole with a message about arithmetic. ([#427](https://github.com/ng-native/ng-native/pull/427), [#423](https://github.com/ng-native/ng-native/issues/423))

  The color is worked out on device, as `border-color` has it, and follows the token. With the token unset the whole shorthand is invalid and no border is drawn, as in a browser.

  A `color-mix()` of a token with `currentColor` as its other side now mixes the text color, in a shorthand and in `border-color`, `background-color` and the other color properties, where the declaration was dropped with no message.

- A boolean view prop written as an attribute, such as `focusable="false"` on a component's own element, is committed as a boolean, where Android stopped with `java.lang.String cannot be cast to java.lang.Boolean`. ([#382](https://github.com/ng-native/ng-native/pull/382), [#378](https://github.com/ng-native/ng-native/issues/378))

  It applies to the props every native view reads as a boolean (`focusable`, `accessible`, `collapsable` and the rest of React Native's view and accessibility booleans) on an element no component takes the prop as an input for. `"false"` is false and anything else, the bare attribute included, is true. A stylesheet still reads the attribute as its text, so `[focusable="false"]` matches as it does in a browser.

- `NativeNavigation.back()` called while the navigation that shows the page is still in flight, as from an `effect()` in the page's constructor, goes back once that navigation ends, where the call was ignored and the page stayed on screen. ([#480](https://github.com/ng-native/ng-native/pull/480), [#439](https://github.com/ng-native/ng-native/issues/439))
- `role` takes the ARIA roles (`row`, `cell`, `listitem`, `heading`, `dialog` and the rest) and commits one `accessibilityRole` has no word for as native's own `role` prop, and `role` and the `aria-*` attributes are read on any element that draws a view, the host of an app's own component included. ([#450](https://github.com/ng-native/ng-native/pull/450), [#413](https://github.com/ng-native/ng-native/issues/413), [#412](https://github.com/ng-native/ng-native/issues/412))

  `<view role="row">` type-checks, where it failed with `TS2322`, and no longer sends `accessibilityRole: "row"`, a value native does not know. `Role` is exported from `@ng-native/components`. `getByRole` and its siblings match `role` as well as `accessibilityRole`. On a component's host, `aria-label` was dropped and is now the label; the state and value attributes become `accessibilityState` and `accessibilityValue`, and `aria-hidden`, `aria-live`, `aria-modal` and `aria-labelledby` the props React Native maps them to.

- A `<native-stack-outlet>` or `<native-tabs-outlet>` created after the first navigation has finished, one held behind an `@if` until a session or a database is ready, shows the route the router is on, where it rendered nothing with no error. ([#479](https://github.com/ng-native/ng-native/pull/479), [#438](https://github.com/ng-native/ng-native/issues/438))
- The types of `@ng-native/components/reanimated` and `/gestures` no longer import `react-native-reanimated` or `react-native-gesture-handler`, so a browser app that installs neither now type-checks with `skipLibCheck: false`, and `sharedValue()` keeps its type there where it was `any`. ([#348](https://github.com/ng-native/ng-native/pull/348), [#338](https://github.com/ng-native/ng-native/issues/338))

  `sharedValue()` now returns a `MutableValue<T>`, which has the shape of Reanimated's public `SharedValue` and is still accepted wherever Reanimated takes one. In `@ng-native/testing`, a shared value now also has `modify()`, `addListener()` and `removeListener()`, as Reanimated's does.

- `render()` and `rerender()` reject when `inputs` names an input the component does not have, with a message that names it, the component and the inputs it has, where Angular only logged `NG0303` and the component rendered with its defaults. ([#466](https://github.com/ng-native/ng-native/pull/466), [#389](https://github.com/ng-native/ng-native/issues/389))
- `render()` with a template string no longer logs `NG0303` for each native prop a component in it binds on its own host, the ones `PressBehavior` binds included. ([#443](https://github.com/ng-native/ng-native/pull/443), [#415](https://github.com/ng-native/ng-native/issues/415))

  The template is compiled with `NO_ERRORS_SCHEMA`, as an app's templates have no such check at run time. A property a test's template misspells on a component is therefore not reported there either.

- `render()` with a template string no longer logs `NG0912`, Angular's component ID collision warning, when a test file renders more than one. ([#365](https://github.com/ng-native/ng-native/pull/365), [#356](https://github.com/ng-native/ng-native/issues/356))
- `inject(Screen).window()` in a test is the size the render's `conditions` give, and follows `engine.updateConditions()`, where it was zero by zero whatever `conditions` said. ([#455](https://github.com/ng-native/ng-native/pull/455), [#407](https://github.com/ng-native/ng-native/issues/407))
- `render()`'s `on` hears an output a host directive forwards, and refuses a name the component has no output by with a message that names it, where both threw `TypeError: Cannot read properties of undefined (reading 'subscribe')`. ([#461](https://github.com/ng-native/ng-native/pull/461), [#392](https://github.com/ng-native/ng-native/issues/392))

  An output is named as a template binds it, so one with an alias is listened to by its alias, not by the name of the field. `mount()` takes `bindings`, which is how `on` is passed.

- A custom property set to a string in a stylesheet, such as `--d: "none"`, is now read as text rather than as the word in it, so `display: var(--d)` no longer hides the element and `color: var(--c)` with `--c: "red"` is no colour, as in Chrome; a quoted font family still names its family. ([#350](https://github.com/ng-native/ng-native/pull/350), [#335](https://github.com/ng-native/ng-native/issues/335))
- A push to a url that is already on the stack pushes a new screen over it, and Back returns to where the push came from, where the push popped to the earlier screen and destroyed everything above it. ([#481](https://github.com/ng-native/ng-native/pull/481), [#440](https://github.com/ng-native/ng-native/issues/440))

  `NativeNavigation.popTo(url)` is the way to go back to a screen further down. A back, by gesture, button or `back()`, still returns to the screen that was kept.

- `NativeNavigation.push()` to a page of a tab that has not been opened now puts the tab's own first screen under the page, where the page was the only screen of the tab's stack, a back from it went to the tab it came from, and tapping the tab afterwards pushed its list over the page. ([#490](https://github.com/ng-native/ng-native/pull/490), [#444](https://github.com/ng-native/ng-native/issues/444))

  The push navigates to the tab's url first and then to the page, so the same push leaves the same stack whether or not the tab was ever tapped. `nativeRouterLink` does the same. `present()` and the router's own `navigate` are unchanged.

- `PressBehavior` has `disableWhile(signal)`, for a component that composes it to refuse presses from its own state, a button that is loading: either that or the `disabled` input disables the control, for the press, for `[data-disabled]` in a stylesheet and for what is announced. ([#471](https://github.com/ng-native/ng-native/pull/471), [#391](https://github.com/ng-native/ng-native/issues/391))

  `[data-disabled]` now follows whether presses are refused, so on a `<touchable-opacity>` it is also set by `aria-disabled` and `accessibilityState.disabled`, which already refused its presses.

- `preventNativeDismiss` on a page inside a presented screen that is a stack of its own now guards the sheet: the stack gives the refusal of its top screen to the presented screen, and `(nativeDismissCancelled)` reaches the page, for a swipe down on iOS and for Android's Back. ([#436](https://github.com/ng-native/ng-native/pull/436), [#421](https://github.com/ng-native/ng-native/issues/421))

  Before, the binding landed on the first screen of the inner stack, and the sheet swiped away with no warning.

- `NativeNavigation.present()` now shows a page of a tab that is not in front over the tab that is, where it selected the page's own tab and added the page to that tab's stack, as its only screen when the tab had not been opened. ([#498](https://github.com/ng-native/ng-native/pull/498), [#445](https://github.com/ng-native/ng-native/issues/445))

  The page is shown on the app's root stack, over the tab bar, through a root outlet named `presented`: while it is up `router.url` reads `/home(presented:invoices/7)`, and a back or the dismissing swipe returns to `/home`. Its route keeps its params, resolvers, data and the guards and providers of the routes it sits inside. A `push()` from the page leaves it for the pushed url's own place. A page of the tab in front, or of no tab, is presented where its url puts it, as before, and so is every page in an app whose root is not a `<native-stack-outlet>`.

- `pointer-events` is inherited, and a descendant that sets `pointer-events: auto` inside a `pointer-events: none` element takes touches again, as on the web, where it took none. ([#383](https://github.com/ng-native/ng-native/pull/383), [#379](https://github.com/ng-native/ng-native/issues/379))

  An element that computes to `none` is committed as React Native's `box-none` while something inside it takes touches again, and as `none` otherwise. The `pointerEvents` prop keeps React Native's meaning, where `none` is the whole subtree.

- `getByPlaceholderText` and its siblings match text fields only, so a wrapper component with a `placeholder` input of its own no longer makes the query for its one field throw for finding two. ([#458](https://github.com/ng-native/ng-native/pull/458), [#403](https://github.com/ng-native/ng-native/issues/403))
- A per-side border in a style other than solid, such as `border-top: 1px dashed red`, is drawn solid with its width and color and the build says that, where it said the declaration was dropped, and dropped it whole when its color or width was a token. ([#442](https://github.com/ng-native/ng-native/pull/442), [#416](https://github.com/ng-native/ng-native/issues/416))
- `nx typecheck` on an app generated in a workspace of package-manager links now checks its templates when pnpm has given a workspace library its own copy of `@ng-native/components`, where `ngc` stopped at `NG3004: Unable to import symbol` and reported none of the app's template errors. ([#486](https://github.com/ng-native/ng-native/pull/486), [#432](https://github.com/ng-native/ng-native/issues/432))

  The app generator writes `tsconfig.typecheck.json`, which maps every `@ng-native` package to the app's own copy, and points the `typecheck` target at it. An existing app takes the same file by hand: the Nx page has it.

- A library from `nx g @ng-native/nx:library` in the TypeScript preset lets its source import with `.ts`, as its test and the documentation do, where `nx typecheck` failed with `TS5097`. ([#422](https://github.com/ng-native/ng-native/pull/422), [#398](https://github.com/ng-native/ng-native/issues/398))

  `tsconfig.lib.json` gets `allowImportingTsExtensions`, and `src/index.ts` exports `./lib/<name>.ts`. A workspace whose base config no longer sets `emitDeclarationOnly` keeps the `.js` form, since TypeScript takes the option only where no JavaScript is emitted. A library already generated is not changed: add the option to its `tsconfig.lib.json` by hand.

- `nx typecheck` on a library from `nx g @ng-native/nx:library` in the TypeScript preset checks its templates: the generator writes a `tsconfig.typecheck.json`, a `typecheck` target that runs `ngc` on it, and `@angular/compiler-cli` in the library's dev dependencies, where the inferred `tsc` target read no template and a misspelled input passed. ([#477](https://github.com/ng-native/ng-native/pull/477), [#406](https://github.com/ng-native/ng-native/issues/406))

  A library already generated can add the three by hand: the config extends `./tsconfig.lib.json` with `noEmit: true`, `composite: false` and `emitDeclarationOnly: false`, and the Angular options a generated app's `tsconfig.json` has.

- `Location` has `geocode(address)`, the places an address could be as `{ latitude, longitude }`, and `reverseGeocode(coordinates)`, the addresses at a point, through `Location.SOURCE` so a test fakes them, and empty without the permission or off a device. ([#476](https://github.com/ng-native/ng-native/pull/476), [#424](https://github.com/ng-native/ng-native/issues/424))
- An element that names `@keyframes` from a component sheet first met later in the same commit, such as a sibling's, now plays them from the first render, and the development warning that they are missing no longer fires for keyframes that arrive within the commit. ([#360](https://github.com/ng-native/ng-native/pull/360), [#330](https://github.com/ng-native/ng-native/issues/330))
- Text laid out while `loadFonts()` is still loading its face, as when the app mounts without awaiting it, now takes the face's size once it registers, where on Android it kept the fallback font's width and wrapped and clipped. ([#371](https://github.com/ng-native/ng-native/pull/371), [#345](https://github.com/ng-native/ng-native/issues/345))

  React Native caches a text's measurement by its family name, so the engine now lays such text out without the name until the face registers, and then with it, measured fresh.

- The build warning for `currentColor` on a property other than `color` in a `@keyframes` frame now says `currentColor` is the cause, where it blamed `var()`, `em` and viewport units. ([#353](https://github.com/ng-native/ng-native/pull/353), [#333](https://github.com/ng-native/ng-native/issues/333))
- `withHeaderDefaults({ liquidGlass: true })`, or `[liquidGlass]="true"` on one `<native-header>`, gives a header with no background of its own iOS 26's Liquid Glass navigation bar: clear and unlined, with the content scrolling under it and blurring out. ([#495](https://github.com/ng-native/ng-native/pull/495), [#451](https://github.com/ng-native/ng-native/issues/451))

  The default is unchanged: a header nobody configured is still the opaque neutral bar. The glass bar is over the page, so the page's scroll view takes `contentInsetAdjustmentBehavior="automatic"`. `OS_VERSION` from `@ng-native/device` is the major version of the operating system, which a test can provide.

- A `font-family` in a style set on an element, such as `style="font-family: 'Inter-Bold'"`, `[style.font-family]` or a custom property bound on the element and read with `var()`, now commits the first family of the stack without its quotes, as a stylesheet rule does, so the text draws in that face rather than the system font. ([#343](https://github.com/ng-native/ng-native/pull/343), [#342](https://github.com/ng-native/ng-native/issues/342))

  A family that needs quotes, such as `'Inter Display'`, can now be named in an inline style, and a stack such as `'Inter Display', sans-serif` commits `Inter Display` where it committed the whole text.

- A property CSS inherits, such as a colour or font size set with `[style.color]` or `[style.fontSize]`, now reaches the text inside the element, and `color: inherit` and `currentColor` read it there and on the element itself, as they would one set by a rule. ([#359](https://github.com/ng-native/ng-native/pull/359), [#331](https://github.com/ng-native/ng-native/issues/331))

  An `!important` rule still beats it, as in a browser. A `[style]` change restyles nothing below it, as before, when neither the old nor the new style sets an inherited property.

- `!important` on a custom property is honoured: an important `--x` beats a more specific or later plain one, and in a cascade layer it takes part in the reversal layers give important declarations, where the cascade ranked it as a plain declaration. ([#469](https://github.com/ng-native/ng-native/pull/469), [#384](https://github.com/ng-native/ng-native/issues/384))
- `<ng-icon>` treats an icon name, SVG tag or attribute that only exists on `Object.prototype` (such as `constructor` or `toString`) as unknown. Before, it threw during render and took the host component down with it. ([#369](https://github.com/ng-native/ng-native/pull/369))
- An icon's own markup takes a colour from a custom property: a `fill` or a `stroke` whose value is a `var()`, as an attribute or in `style`, is painted from the token in scope and follows it, where a `style` one left the path unpainted and an attribute sent the text `var(--brand)` to native as the colour. ([#470](https://github.com/ng-native/ng-native/pull/470), [#414](https://github.com/ng-native/ng-native/issues/414))

  An unset token with no fallback is reported in development.

- HTML's text and layout elements can be written in a template with no import: `span`, `p`, `h1` to `h6`, `label`, `strong`, `em` and the rest draw as text, and `div`, `section`, `ul`, `li` and the rest as views, where each was an unknown element drawn as an empty view. ([#393](https://github.com/ng-native/ng-native/pull/393), [#381](https://github.com/ng-native/ng-native/issues/381))

  A text element is text when it holds only text and other text elements, which then flow inline, and a view when it holds anything else. Text written straight into a view is now drawn, as a paragraph of its own, where it drew nothing: a template that left stray text inside a `<view>` shows it. `strong`, `em`, `u`, `s`, `small`, `code` and `mark` have the styles Tailwind's preflight leaves them, a heading and a paragraph have none, and `h1` to `h6` are announced as headings. `@ng-native/web`'s reset gives the same elements the same look.

- In development, a hot swap that drops, renames or removes an `@font-face` rule now stops text being matched to that face, where it stayed matched until the app reloaded. ([#362](https://github.com/ng-native/ng-native/pull/362), [#328](https://github.com/ng-native/ng-native/issues/328))

  The face stays registered with the platform, which has no way to unregister one. A face that declares a weight or style is registered under a name of its own, which nothing names any more; one that declares neither is registered under the family's own name, so text naming that family draws it until the app reloads.

- A component's `host` with a spread in it, or a `host` that is a constant or a call, fails the build with a message naming the component and the entry, where the compiler dropped those bindings without a word and the listeners and attributes were missing at run time. ([#465](https://github.com/ng-native/ng-native/pull/465), [#388](https://github.com/ng-native/ng-native/issues/388))
- `inject(Fonts)` now reports the faces `loadFonts()` registered, so `families()` and `has()` update once they load, where they kept the result of their first read for the life of the app. ([#346](https://github.com/ng-native/ng-native/pull/346), [#341](https://github.com/ng-native/ng-native/issues/341))
- `FileSystem` has `file(uri)`, the file at a uri, so a document the picker answers with can be read: `files.file(picked.uri).text()`. A `FileSystem.SOURCE` stand-in opens one with `fileAt(uri)`. ([#475](https://github.com/ng-native/ng-native/pull/475), [#425](https://github.com/ng-native/ng-native/issues/425))
- `fabric.render({ props: true })` prints the props of a node that has text, a text field's placeholder and keyboard among them, after the text, where it printed the text alone. ([#457](https://github.com/ng-native/ng-native/pull/457), [#404](https://github.com/ng-native/ng-native/issues/404))
- Under test, a `[workletStyle]` whose worklet returns a style such as `opacity` or `height` no longer logs "has no prop" for each key: the stand-in writes what the worklet returns as styles, where it wrote them as props. ([#483](https://github.com/ng-native/ng-native/pull/483), [#429](https://github.com/ng-native/ng-native/issues/429))
- A browser build through `ngNativeWeb()` now resolves `react-native-reanimated`, `react-native-worklets` and `react-native-gesture-handler` to inert stand-ins, so a component that imports `Gesture`, `withTiming` or `scheduleOnRN` builds for the web as well as for a device. ([#363](https://github.com/ng-native/ng-native/pull/363), [#327](https://github.com/ng-native/ng-native/issues/327))

  The stand-ins are `@ng-native/components/stand-ins/reanimated`, `/worklets` and `/gesture-handler`, and `@ng-native/testing` now uses the same ones, so it lists `@ng-native/components` as a peer dependency. On the web an animation lands where it ends and calls its callback with `true` at once, a gesture recognises nothing, and work scheduled for either runtime runs at once.

- An island now renders in an Angular app that hydrates server-rendered markup with `provideClientHydration()`, as an Analog app does by default, rather than staying empty with `TypeError: hasAttribute is not a function`. The element an island is mounted into is marked `ngSkipHydration`, so the island renders from scratch while the page around it hydrates as before. ([#375](https://github.com/ng-native/ng-native/pull/375))
- A component whose stylesheet declares `@font-face` now loads in a test, under Vitest and `node --test`: the `require` the compiler writes for the font file gets the `{ testUri }` stand-in an image's does, where the test file failed with `require is not a function` before any test ran. ([#437](https://github.com/ng-native/ng-native/pull/437), [#420](https://github.com/ng-native/ng-native/issues/420))
- A variable font declared with a weight range, `font-weight: 100 900`, keeps the range and the text keeps its `font-weight`, where the range was read as its lowest weight, the face registered as `Inter-100`, and the weight taken off the text so everything drew at the lightest. ([#468](https://github.com/ng-native/ng-native/pull/468), [#387](https://github.com/ng-native/ng-native/issues/387))

  The face is registered under the family and both ends of the range, `Inter-100to900`. Two files that split a family by range are matched by the range each covers.

- `UiViewHost` from `@ng-native/expo/expo-ui-components`, and the `<ui-view-host>` element `registerExpoUiViews()` now registers, hosts views of the app's own inside SwiftUI or Compose content, so a row drawn with the app's own components can be the trigger of a `UiContextMenu`: a long press lifts the row and opens the system menu, and the row still takes its own presses. ([#499](https://github.com/ng-native/ng-native/pull/499), [#426](https://github.com/ng-native/ng-native/issues/426))
- `UiContextMenu` from `@ng-native/expo/expo-ui-components` is a typed component for the `<ui-context-menu>` element `registerExpoUiViews()` already registers, so a strict template can use SwiftUI's long-press context menu: a `trigger`, `items` and optional `preview` slot. iOS only. ([#496](https://github.com/ng-native/ng-native/pull/496))
- A typed `UiChart` in `@ng-native/expo/expo-ui-components` draws a Swift Charts chart with its data and styles type-checked, in an app and in a widget or Live Activity layout, where `<ui-chart>` was an untyped element that strict templates rejected. ([#373](https://github.com/ng-native/ng-native/pull/373), [#339](https://github.com/ng-native/ng-native/issues/339))

  It is iOS only, as Compose has no chart. Each chart type takes a style of its own, and `referenceLines` draws lines across the chart.

- The development warning for an element used without importing its component says what is lost, the component's inputs and behavior, where it said the element renders as a plain view, which a `<text>` does not. ([#473](https://github.com/ng-native/ng-native/pull/473), [#418](https://github.com/ng-native/ng-native/issues/418), [#409](https://github.com/ng-native/ng-native/issues/409))
- A no-break space at the start or end of a text is drawn, as in a browser, where it was dropped with the ordinary spaces a paragraph drops at its ends; so `&nbsp;` keeps a space at the end of a bound value, and one alone holds a line open. ([#482](https://github.com/ng-native/ng-native/pull/482), [#447](https://github.com/ng-native/ng-native/issues/447))
- `text-shadow: none` switches a text shadow off, over a weaker rule's or an inherited one, where the declaration was dropped with a build warning and the shadow stayed. ([#464](https://github.com/ng-native/ng-native/pull/464), [#390](https://github.com/ng-native/ng-native/issues/390))
- A text decoration on an element is now drawn under the text inside it in that element's decoration colour, or its text colour when it sets none, as Chrome draws it, and `text-decoration: underline currentColor` sets the colour of the text rather than none. ([#354](https://github.com/ng-native/ng-native/pull/354), [#332](https://github.com/ng-native/ng-native/issues/332))

  Text that declares a line of its own still draws it in its own colour, and a text's `text-decoration-color` without a line of its own no longer recolours a line it is given. Android draws every line in the text's colour, as React Native's Android text has no decoration colour.

- A test of a component with a `[gesture]`, a worklet or Reanimated loads in an app that installed `@ng-native/testing` from npm, where it failed with `Cannot find module '.../@ng-native/testing/src/gestures.ts'`: the Vitest plugin's stand-ins pointed at source files the package does not ship. ([#462](https://github.com/ng-native/ng-native/pull/462), [#400](https://github.com/ng-native/ng-native/issues/400))
- A node a query returns has `parent`, the node it is under, so a test can go from a text to the row around it, and `fireEvent.layout(node, { width, height })` sends a `(layout)` event with a frame; `fireEvent(node, 'layout', ...)` takes the frame bare, as `{ layout }`, or as `{ nativeEvent: { layout } }`. ([#478](https://github.com/ng-native/ng-native/pull/478), [#448](https://github.com/ng-native/ng-native/issues/448))
- `@ng-native/testing` exports `compileCss`, which compiles a stylesheet for `render()`'s `globalStyles`, so a test no longer reaches into `@ng-native/metro`, a path a test in a pnpm workspace library could not resolve. ([#456](https://github.com/ng-native/ng-native/pull/456), [#405](https://github.com/ng-native/ng-native/issues/405))
- An icon whose `<rect>`, `<circle>`, `<ellipse>` or `<line>` leaves out a position or size, such as a `<rect>` with no `y`, now draws it at 0 as SVG does, where it crashed the app on Android. ([#367](https://github.com/ng-native/ng-native/pull/367), [#349](https://github.com/ng-native/ng-native/issues/349))

### ❤️ Thank You

- Ashley Hunter
- erKam @erkamyaman

## 0.3.0 (2026-10-02)

### 🚀 Features

- Two small breaking changes, each with an automated migration, that `nx migrate`, `ng update` and `npx @ng-native/migrate` run, and one consistency fix: ([#313](https://github.com/ng-native/ng-native/pull/313))

  - `Tracking`'s `available` is a property, as `Haptics`, `Fonts` and `SplashScreen` have it: read `tracking.available` rather than calling it. The `tracking-available-getter` migration rewrites the calls, in code and in templates. A service's `available` now follows one rule, set out on the Using a module page: a property when the answer is known at once, a method that resolves when it is a fresh native check, and a signal when it comes and goes.
  - `@ng-native/device` no longer exports `reactNative()` or its `ReactNative` type, which are how the package reaches React Native; import from `react-native` directly. The `device-react-native-import` migration notes each import it finds.
  - A `<switch>`'s own position wins over an `aria-checked` or `accessibilityState.checked` that says otherwise in the `accessibilityState` it sends, as its own `disabled` already wins over `aria-disabled`. VoiceOver and TalkBack read the native switch's position either way, so what they announce does not change.

- `@ng-native/expo/foldable` reads the hinge of a foldable device, an iPhone Duo or an Android foldable, through `expo-foldables`: `Foldable` has the posture, the hinge angle and where the fold crosses the window as signals, with `separating`, `book` and `tabletop` derived from them. `examples/foldbook` is a reader built on it. `expo-foldables` is an optional peer, and on a phone with no hinge `Foldable` answers like a phone that does not fold. ([#274](https://github.com/ng-native/ng-native/pull/274))
- `@ng-native/expo/live-activity` keeps an iOS Live Activity in step with a signal: `liveActivity(factory, props)` starts it, updates the lock screen and the Dynamic Island whenever the signal changes, picks up an activity left running from before the app started, and ends it. The Live Activity comes from `expo-widgets`, with its layout written in `@expo/ui`. The padel example shows the score on the lock screen with it. ([#319](https://github.com/ng-native/ng-native/pull/319))
- `@ng-native/expo/watch` connects an app to its Apple Watch companion: `Watch` sends live messages, shared context, queued user info, complication updates and files, and holds what the watch sends as signals. ([#256](https://github.com/ng-native/ng-native/pull/256))

  It is bound to `react-native-watch-connectivity`, an optional peer, so only apps that install it get its native code. The watch app is SwiftUI, added with `@bacons/apple-targets`; the Apple Watch page shows the setup, and `examples/padel` is a whole app built on it. iOS reports neither the state an app starts in nor when its session has activated, so `Watch` asks again until it has, holds context and user info sent before then, and keeps `reachable` from `status()`, the watch's messages and whether a live message got through as well as from iOS's change events. Elsewhere, and with no paired watch, `Watch` is inert; on iOS, a build without its native module, such as Expo Go, throws a `MissingModuleError` that says what to install and to rebuild.

- `Storage`, `SecureStorage`, `audioPlayer` and `videoPlayer` each have an entry point of their own, `@ng-native/expo/async-storage`, `/secure-store`, `/audio` and `/video`, so an app bundles with only the native module it uses installed, where Metro failed with "Unable to resolve module" for the other one. ([#255](https://github.com/ng-native/ng-native/pull/255), [#244](https://github.com/ng-native/ng-native/issues/244))

  This is a breaking change: `@ng-native/expo/store` and `@ng-native/expo/player` no longer export those four names. `Store`, `NativeStore`, `Player`, `PlayerState` and `watchPlayer` stay where they were, and `/player` now also exports `watchAudioPlayer` and `ownPlayer`, which the two players are built from. The `split-store-and-player` migration moves the imports for you: `nx migrate @ng-native/nx@latest`, `ng update @ng-native/schematics` or `npx @ng-native/migrate@latest`, as [Updating an app](https://ng-native.com/guide/updating) describes. It leaves a namespace import, `export *`, `require()`, `import()` or a test's `vi.mock` of the old entry point as it was, and prints a note with the file and line to change.

- `StatusBar` takes a new `'auto'` style that follows `ColorScheme`, and new apps follow the system's light or dark mode, claim it, and style both schemes. ([#157](https://github.com/ng-native/ng-native/pull/157), [#131](https://github.com/ng-native/ng-native/issues/131), [#151](https://github.com/ng-native/ng-native/issues/151))

  `'auto'` asks for dark content while the color scheme is light and light content while it is dark, and changes with the scheme, a `ColorScheme.set()` theme switch included. `state` reports `'auto'` rather than the style it resolved to. A claim with a fixed style keeps it. `StatusBarSource.setStyle` now takes the new `PlatformStatusBarStyle` type, which leaves `'auto'` out, so a custom source never receives it.

  The template, `nx g @ng-native/nx:app` and `ng add @ng-native/schematics` now write `"userInterfaceStyle": "automatic"` in `app.json` in place of `"dark"`, which locked iOS to dark so that `ColorScheme.set('light')` did nothing. Their root component claims `StatusBar.set({ style: 'auto' })`, so Android no longer shows white status bar icons on a light screen, and its styles have a light palette with the dark one under `@media (prefers-color-scheme: dark)`. Existing apps are unchanged.

- `@ng-native/testing` adds `injectService(Service, { providers })`, which tests a service on its own, with no component to render, in a fresh app's root injector that `cleanup()` destroys. ([#259](https://github.com/ng-native/ng-native/pull/259), [#245](https://github.com/ng-native/ng-native/issues/245))

  There is no TestBed, and `Injector.create()` finds no `@Service()` or `providedIn: 'root'` class, because the injector it makes has no root scope. `injectService` mounts an empty component with `mount()`, as `render()` does, so the service and the root services it injects resolve as they do in an app.

- `<virtual-list>` takes `contentPadding` and `rowGap`, which put space around its rows and between them, and which every offset it works out counts. ([#233](https://github.com/ng-native/ng-native/pull/233), [#201](https://github.com/ng-native/ng-native/issues/201))

  `contentPadding` is one number for every side, or `{ top, right, bottom, left }`, as `FlatList`'s `contentContainerStyle` padding: the leading side comes before the first row, the trailing side after the last, and the sides across the axis inset each row. `rowGap` is the space between one row and the next. Row positions, the content's extent, the spacer before rows that size themselves, sticky rows, `scrollToIndex`, viewability and `endReached` all account for both. Rows placed at a fixed height commit `left` and `right` insets (or `top` and `bottom` when horizontal), and rows that size themselves commit margins. With neither set, the committed props are as before. The new `VirtualListPadding` type is exported from `@ng-native/components`.

- A Live Activity or home-screen widget is drawn from an Angular template: `createLiveActivity(name, Layout)` and `createWidget(name, Layout)` from `@ng-native/expo/live-activity` take a component whose template uses the `ui-*` views, and `@ng-native/metro` compiles it at build time to the source the widget extension runs, with no JSX and no React. The template is type-checked like any other, and anything the extension cannot run is a build error with its line and column. `@ng-native/expo/expo-ui-components` adds typed `UiZStack`, `UiRectangle`, `UiRoundedRectangle`, `UiUnevenRoundedRectangle`, `UiCapsule`, `UiCircle`, `UiEllipse`, `UiAccessoryWidgetBackground`, `UiLabel` and `UiLink`, for a layout and an app alike. ([#337](https://github.com/ng-native/ng-native/pull/337))

### 🩹 Fixes

- The `AGENTS.md` a new app is generated with now says that a component's host is a flex item, so a component that fills the space it is given needs `flex: 1` on its host. ([#261](https://github.com/ng-native/ng-native/pull/261), [#247](https://github.com/ng-native/ng-native/issues/247))
- On Android, the Back button now leaves a screen that sets `preventNativeDismiss` in place and fires its `(nativeDismissCancelled)`, as a swipe does on iOS, rather than dismissing it and losing its unsaved changes. ([#223](https://github.com/ng-native/ng-native/pull/223), [#166](https://github.com/ng-native/ng-native/issues/166))

  react-native-screens ignores `preventNativeDismiss` on Android and leaves Back to JavaScript, so the native stack outlet now refuses the press itself. `NativeNavigation.back()` is not refused, so a page can still leave once it has asked.

- On Android, a single-line `<text-input>` with a line height and a fixed `height` centres its text, where it sat about 1.7pt high in a 44pt field. ([#224](https://github.com/ng-native/ng-native/pull/224), [#197](https://github.com/ng-native/ng-native/issues/197))

  Where a `height` sizes a single-line field, it now commits no `lineHeight` on Android, as on iOS: the height already says how tall the field is, and `EditText` centres the font's own line box exactly. A field without a `height` keeps its `lineHeight`, which sizes it, and a multiline field is unchanged.

- A multiline `<text-input>` on Android starts its text at the top, as on iOS and in a `<textarea>`, rather than in the vertical middle. ([#211](https://github.com/ng-native/ng-native/pull/211), [#167](https://github.com/ng-native/ng-native/issues/167))

  A multiline field on Android now commits `textAlignVertical: 'top'` when neither the `textAlignVertical` input nor a CSS `vertical-align` sets one. A single-line field is unchanged, and iOS is unchanged.

- Each `animation-*` longhand now cascades on its own, as in a browser, so `.b { animation-name: y }` beside `.a { animation: x 1s infinite }` plays `y` for 1s, forever. ([#182](https://github.com/ng-native/ng-native/pull/182))

  Before, each rule built a whole animation, and the stronger one replaced the weaker one's outright: the name alone played with a duration of 0 and never showed, and a rule that set only the timing, such as `animation-duration: 2s`, was dropped. A shorthand still resets every part, as it does on the web.

- `aria-disabled` and `accessibilityState.disabled` now stop presses on `<touchable-opacity>` and a `pressable` `<text>`, as they do on React Native's `TouchableOpacity` and `Text`. ([#170](https://github.com/ng-native/ng-native/pull/170), [#121](https://github.com/ng-native/ng-native/issues/121))

  Until now only `disabled` stopped a press, and `aria-disabled` changed only what was announced. `disabled` still decides when it is set, so `[disabled]="false" [aria-disabled]="true"` still presses. A state contributed through `contributeAccessibility` counts the same way. `<pressable>` and a `PressBehavior` host are unchanged: as in React Native's `Pressable`, only `disabled` stops their presses.

- `background: var(--surface)` is read as `background-color`, the one part of the shorthand native has, rather than refused as a shorthand a token cannot be used in. A token that is no colour unsets it, as Chrome unsets the shorthand. ([#303](https://github.com/ng-native/ng-native/pull/303))
- A border shorthand with no colour, such as `border: 2px solid` or `border-top: 1px solid`, is now drawn in the element's text colour, as on the web, rather than in native's default black. ([#262](https://github.com/ng-native/ng-native/pull/262), [#238](https://github.com/ng-native/ng-native/issues/238))

  The colour is the element's own `color` or the one it inherits, and it follows that colour when it changes. A border colour of `currentColor` works the same way, where it was dropped with a build warning before: `border-color`, the per-side and logical longhands, Tailwind's `border-current` and `border-x-current`, and a `currentColor` written in a border shorthand beside a `var()`. Bootstrap's `.spinner-border` is drawn in its text colour as a result. A `border-width` with no colour anywhere is still drawn black, native's default, as the web host draws it.

- Arithmetic of tokens that mixes a percentage and a number, such as `calc(var(--n) + 10%)` or `max(var(--p), 1)`, is now invalid, as in a browser, in a stylesheet and set on an element. ([#125](https://github.com/ng-native/ng-native/pull/125), [#123](https://github.com/ng-native/ng-native/issues/123))

  Before, it came out as a bare number, and anything that read it as one used it: an opacity, or an `hsl()` saturation. A token of it is now invalid, so a property that reads it is unset, and a declaration of it is left out. A percentage multiplied or divided by a number is still a percentage, and one multiplied by another percentage, or a number divided by one, is invalid as well.

- On Android, a keyboard's Enter or D-pad centre and TalkBack's double-tap now fire `(press)` on `<pressable>`, `<touchable-opacity>`, a `pressable` `<text>` and a `PressBehavior` host, as they do in React Native. ([#174](https://github.com/ng-native/ng-native/pull/174), [#153](https://github.com/ng-native/ng-native/issues/153))

  Android activates a focused view with a click rather than a touch, and nothing handled it, so these controls could not be activated without touching the screen. The click fires `press` alone, with no `pressIn` or `pressOut`, as in React Native's `Pressability`. It is refused while the control would refuse a touch, and a pressable around the focused one does not also press. iOS and the web host are unchanged.

- On Android, a keyboard or TalkBack click on a focusable view inside a pressable no longer presses the pressable, as in React Native. ([#204](https://github.com/ng-native/ng-native/pull/204), [#199](https://github.com/ng-native/ng-native/issues/199))

  A touchable now answers a click only when it is the view that was clicked. A touchable the click merely passes through stops it there, as React Native's `Pressability` does.

  This is a behaviour change for apps: a `(click)` listener on a view around a pressable no longer hears a click aimed at something inside that pressable, such as a nested pressable or a focusable view, where until now it did. A click on the pressable itself, or anything with no pressable between it and the listener, still reaches the listener.

  To tell them apart, the event a listener receives now carries `target`, the node the event happened on, as React Native's does.

- `color: currentColor` is now the colour the element inherits, as in Chrome, where it was dropped with a build warning. ([#294](https://github.com/ng-native/ng-native/pull/294), [#284](https://github.com/ng-native/ng-native/issues/284))

  It follows the inherited colour when that changes, and passes it on to the element's children. A custom property set to `currentColor` and read by `color`, in a stylesheet or with `setCustomProperty`, already gave the inherited colour.

- `color: inherit`, `color: currentColor` inside `@keyframes` and `text-decoration-color: currentColor` now compile as in Chrome, where they were dropped with a build warning. ([#325](https://github.com/ng-native/ng-native/pull/325), [#304](https://github.com/ng-native/ng-native/issues/304))

  - `color: inherit` and `color: unset` are the colour the element inherits, as `color: currentColor` already is, and they follow it when it changes. Tailwind's `text-inherit` and v3's `placeholder-inherit` compile as a result. Every other CSS-wide keyword is still dropped with a warning.
  - `color: currentColor` or `color: inherit` in a keyframe animates from or to the colour the element inherits, and follows it if it changes while the animation plays or is paused. `currentColor` on any other property in a keyframe is still dropped with a warning.
  - `text-decoration-color: currentColor` is the element's text colour, own or inherited, and follows it when it changes.

- A `color-mix()` with a token in it can be written in any case, such as `COLOR-MIX(IN SRGB, var(--brand) 50%, white)`, where before a stylesheet stopped the build on it, and a `color-mix()` of tokens nested in another now comes out as Chrome's colour. ([#231](https://github.com/ng-native/ng-native/pull/231), [#192](https://github.com/ng-native/ng-native/issues/192))

  The inner mix was rounded to whole channels before the outer one mixed it, which put a channel one step off: `color-mix(in srgb, color-mix(in srgb, var(--red), blue), white)` gave 192 where Chrome gives 191.

- A `var()` inside `color-mix()`, a gradient colour stop or a shadow colour can now fall back to a colour made of other tokens, such as `var(--missing, hsl(var(--h) 100% 50%))`, which is worked out from the tokens where it is used, as a browser does. ([#120](https://github.com/ng-native/ng-native/pull/120), [#115](https://github.com/ng-native/ng-native/issues/115))

  Before, such a fallback stopped the build with "expected a colour", and only a literal colour or another `var()` was taken. The fallback can be an `hsl()` of tokens, a colour of a channels token such as `rgba(var(--rgb), 0.5)`, or a `color-mix()` of tokens, at the end of any chain of `var()`s, and it follows a theme or an ancestor that changes the tokens it reads.

- An outline or a background in `currentColor`, a `var()` that falls back to `currentColor` or holds it, a border width that is a `calc()` of a token, and `display: flow-root` now compile as in Chrome, where they were dropped with a build warning or, for a `var()`, silently. ([#278](https://github.com/ng-native/ng-native/pull/278), [#270](https://github.com/ng-native/ng-native/issues/270))

  - `outline: 2px solid`, `outline-color: currentColor` and `outline: var(--w) solid currentColor` draw the outline in the element's text colour, own or inherited.
  - `background-color: currentColor` and `background: currentColor` paint the background in the text colour. That covers Bootstrap's `.spinner-grow` and `.placeholder`.
  - `var(--c, currentColor)`, and a custom property set to `currentColor`, give a border, outline or background the text colour of the element using it, not the one that sets it. These dropped the colour without a warning before. On `color` itself it is the inherited colour.
  - Each of these follows the text colour when it changes, as a border's `currentColor` already does.
  - `border-top: calc(var(--bs-border-width) * 2) solid currentcolor`, Bootstrap's `.table-group-divider`, is drawn at the width the token works out to.
  - A `calc()` of a token is typed as CSS types it: `calc(var(--n) * 1px)` reads a number token, and `calc(var(--n) * 2)` a length. A number token where a length belongs, or a length where a number does, leaves the property unset, as Chrome does, where it was read as points before.
  - `display: flow-root`, Tailwind's `flow-root`, is read as `flex`, as `block` is.

- `DevMenu.reload()` now reloads an Expo app in development through Expo's `reloadAppAsync()`, so an app in Expo Go comes back with Expo's native modules rather than failing with `Cannot find native module`. ([#217](https://github.com/ng-native/ng-native/pull/217), [#195](https://github.com/ng-native/ng-native/issues/195))

  It reloads the way Metro's own full reload does, through the Fast Refresh runtime that `@ng-native/platform` routes through Expo in an Expo app, falling back to React Native's reload with the error logged. `@ng-native/device` does not name `expo` for this, so a web build without Expo still resolves it. In a release build, and in an app without Expo, it is React Native's `DevSettings.reload()` as before.

- When `disabled` and `aria-disabled` disagree, what VoiceOver and TalkBack announce now follows `disabled`, as in React Native. ([#118](https://github.com/ng-native/ng-native/pull/118), [#116](https://github.com/ng-native/ng-native/issues/116), [#117](https://github.com/ng-native/ng-native/issues/117))

  This applies to `<pressable>`, `<touchable-opacity>`, `<switch>`, `<text-input>`, `<text>` and a `PressBehavior` host. `[disabled]="true" [aria-disabled]="false"` now commits `accessibilityState: { disabled: true }` and is announced as disabled, and `[disabled]="false" [aria-disabled]="true"` commits `{ disabled: false }` and is announced as enabled. Until now `aria-disabled` won both times. `disabled` also wins over `accessibilityState.disabled` in the same way. `aria-disabled` alone still sets the state, as before. `getByRole` reads the same commit, so a test that checked `accessibilityState` on a control carrying both inputs sees the new value. On the web host the element's `aria-disabled` follows the same rule. A stylesheet's `[aria-disabled="true"]` and Tailwind's `aria-disabled:` still match the `aria-disabled` input as written.

  `disabled` on `<pressable>`, `<touchable-opacity>`, `<text>` and `PressBehavior` now reads `undefined` rather than `false` when it is not set, so code that reads `disabled()` directly gets `boolean | undefined`.

- `display: inline` and `display: inline-block` are now read as `flex`, as `block` and `inline-flex` already were, rather than dropped with a build warning. ([#264](https://github.com/ng-native/ng-native/pull/264), [#243](https://github.com/ng-native/ng-native/issues/243))

  Every native view sits in a flex container, and a browser lays out a flex container's inline and inline-block children as blocks. So Tailwind's `inline` and `inline-block`, and Bootstrap's `.d-inline`, now show an element hidden by an earlier rule, as `md:inline` after `hidden` does on the web. Tailwind generates `.inline` whenever the word appears in a file it scans, such as a README, so an app no longer gets a warning about a class nobody wrote. `grid`, `inline-grid` and the table values are still dropped with a warning.

- `display: var(--d)` now reads a token in the two-keyword form, such as `inline flex` or `block flow`, as `flex`, and in development logs a warning naming the token and its value when it holds a display native has no layout for, such as `grid` or `table`. ([#326](https://github.com/ng-native/ng-native/pull/326), [#305](https://github.com/ng-native/ng-native/issues/305), [#306](https://github.com/ng-native/ng-native/issues/306))

  Each pair of `block` or `inline` with `flow`, `flow-root` or `flex`, in either order, is `flex`, as Chrome computes it to a display native reads as `flex`, and so is `flow` on its own. Any other value still unsets `display`, so the element lays out as a flex column, and the warning comes once per token and value. A release build doesn't check.

- `display: var(--d)` now reads its token on device, in a stylesheet or set on an element, where it was dropped with a build warning. ([#297](https://github.com/ng-native/ng-native/pull/297), [#285](https://github.com/ng-native/ng-native/issues/285))

  A token of `flex`, `none` or `contents` is that value, and one of `block`, `inline`, `inline-block`, `flow-root` or `inline-flex` is `flex`, as each is written out, in any case. A token that is none of these, or unset with no fallback, unsets `display`, as Chrome does: a weaker rule's `display: none` no longer applies.

- A custom property set on an element to a `color-mix()`, such as `[style.--tint]="'color-mix(in srgb, var(--brand) 50%, white)'"`, now resolves as the same value in a stylesheet does, where before it was unset. ([#173](https://github.com/ng-native/ng-native/pull/173), [#124](https://github.com/ng-native/ng-native/issues/124))

  Each side can be a token with `var()` fallbacks, another `color-mix()`, an `rgb()` or `hsl()` of tokens, or a colour written out, with a percentage before or after it, in any space and hue method a stylesheet takes. The mix follows a theme or an ancestor that changes the tokens it reads. A `color-mix()` of colours written out, with no `var()` in it, is mixed too.

- A component with `ViewEncapsulation.None` has its CSS matched as a global sheet once it first renders, as a browser applies it, where its rules reached only the elements its own template created: its host's class rules, and rules for the app's elements, now apply. ([#320](https://github.com/ng-native/ng-native/pull/320), [#315](https://github.com/ng-native/ng-native/issues/315))

  - `:host` in such a sheet matches nothing, as in a browser, where it matched the host.
  - The sheet comes after the app's global sheet and wins a tie with it; a component's own rule of the same selector still wins, by the extra class Angular's emulated encapsulation gives it.
  - It stays registered once the last instance is gone, as with Angular's `REMOVE_STYLES_ON_COMPONENT_DESTROY` off. A hot swap of its CSS replaces it in place.
  - `ViewEncapsulation.ShadowDom` stays scoped to the component, as a shadow root scopes it.
  - `Engine.addGlobalSheet` and `StyleResolver.addGlobalSheet` are new.

- In an Expo app, an edit that hot reload cannot apply now reloads the app through Expo's reload rather than React Native's `DevSettings.reload()`, which in Expo Go brought the app back with "Cannot find native module 'ExpoFontLoader'" until Expo Go was relaunched. ([#172](https://github.com/ng-native/ng-native/pull/172), [#129](https://github.com/ng-native/ng-native/issues/129))

  Metro reloads the app itself for an edit nothing accepts, such as a route file, a service or a change to a component that is more than its template, and it does so through React Native's Fast Refresh runtime. In a development build, `mount()` now points that runtime's full reload at `reloadAppAsync()` from `expo`, which works in Expo Go and development builds alike. An app without `expo` keeps React Native's reload, and a release build is unchanged.

- Every `@ng-native/expo` service now reports a module whose native half is not in the build with a `MissingModuleError`, where Metro showed a fatal error from the package's JavaScript before. ([#215](https://github.com/ng-native/ng-native/pull/215), [#194](https://github.com/ng-native/ng-native/issues/194))

  On iOS and Android, each service asks Expo for its package's native module before it evaluates the package, as `expoFonts()` did alone. Most Expo packages throw while they are being evaluated when their native module is missing, as in an Expo Go or a development build without it, and Metro reports that as fatal when the load is not inside another module's. The web evaluates the package as before, since a package registers its module there only once it is evaluated. `expo-camera` and `expo-maps` reach their native modules directly and are unchanged.

- A new app's `src/main.ts` now imports `expo`, so a release build runs Expo's runtime as a debug build does, with Expo's `fetch` (whose response streams a `body`), `URL`, `TextDecoderStream` and `structuredClone`, rather than React Native's. ([#268](https://github.com/ng-native/ng-native/pull/268), [#263](https://github.com/ng-native/ng-native/issues/263))

  Metro runs Expo's runtime before the app only when something in the bundle imports `expo`. In debug, `mount()`'s reload hook does; in release nothing did, so an app could work in development and fail only in a release build. An existing app gets the same by adding `import 'expo';` at the top of its `src/main.ts`. The template, the `@ng-native/nx` and `@ng-native/schematics` generators and the manual setup guide all write it.

- The typed `@expo/ui` components draw the same on iOS and Android where a template leaves something unset, and `$event.stopPropagation()` works in a toggle's `(isOnChange)` on Android. ([#283](https://github.com/ng-native/ng-native/pull/283))

  A `ui-toggle` without `isOn` now switches itself on Android, as it does on iOS, and a `ui-vstack` or `ui-hstack` without an `alignment` is centred on both. A slider's `steps` is rounded to a whole number on both, and divides the range SwiftUI actually draws, which is 0 to 1 unless both `min` and `max` are set.

- A `<ui-section>` and a `<ui-labeled-content>` now show their content, which SwiftUI drew none of. ([#242](https://github.com/ng-native/ng-native/pull/242))

  `@expo/ui`'s `SectionView` and `LabeledContentView` draw only what is in a slot named `content`, which `@expo/ui`'s own React components wrap their children in. The typed components projected their children directly, so a form's sections showed their titles and no rows, and a labelled row no value. Both now wrap their content in that slot.

- The common typed `@expo/ui` components (`UiToggle`, `UiSlider`, `UiButton`, `UiDivider`, `UiProgress`, the stacks and `UiSlot`) now take one template on iOS and Android, and a slider's `steps` reaches SwiftUI. ([#249](https://github.com/ng-native/ng-native/pull/249))

  They sent SwiftUI's prop and event names, which Compose does not read: a toggle's `isOn` is Compose's `value`, and its `onIsOnChange` is Compose's `onCheckedChange`. Each now sends the platform its own names and delivers Compose's events through the same outputs with the same `$event` shape, so `(isOnChange)` and `$event.nativeEvent.isOn` work on both. A button's `label` is drawn as text inside it on Android, and `<ui-button>`, `<ui-divider>` and `<ui-progress>` are registered there. A slider's `steps` was sent to SwiftUI as `steps`, which it does not read; it now gets the step size SwiftUI takes.

- Expo views now send their events on Android, and `@expo/ui` controls draw there. ([#248](https://github.com/ng-native/ng-native/pull/248))

  No Expo view sent an event on Android: Android sends a view's events only once its config has been asked for, which `@expo/ui`'s and every Expo package's own React components do through `requireNativeView`, and `registerExpoView` did not. It now does, for every view it registers, so this covers `expo-maps`, `expo-camera`, `expo-image` and the rest as well as `@expo/ui`. And `<ui-host>` committed as `RNHostView` on Android, the bridge for React Native content inside Compose, so no `@expo/ui` control drew: it is `HostView` now, as `@expo/ui`'s own `Host` is.

- A tab tap whose navigation fails or is refused now puts the tab bar straight back on the tab the app is on, and a deep link whose page fails to load reaches the app's `ErrorHandler` rather than ending as an unhandled promise rejection. ([#229](https://github.com/ng-native/ng-native/pull/229), [#193](https://github.com/ng-native/ng-native/issues/193))

  The tab bar's revert was sent to native only with the next render, which a failed navigation does not cause, so the bar stayed on the tab that failed. The app's `withNavigationErrorHandler` hears each failure once, as before. The Router page has a new "When a page fails to load" section on handling a lazy route that fails, however the navigation started.

- A gradient whose stop colour or stop position reads a custom property that is set but of the wrong kind now paints nothing, as in a browser, rather than taking the position written beside it or leaving the stop out. ([#228](https://github.com/ng-native/ng-native/pull/228), [#190](https://github.com/ng-native/ng-native/issues/190))

  A stop whose colour token is not set is still left out, which is how Tailwind's optional `via-*` colour disappears, and a position token that is not set still takes the position written beside it.

- A hot swap that deletes or renames a component's `@keyframes` stops the animations naming them, as a browser does, where the old keyframes stayed registered and kept playing until the app reloaded. ([#324](https://github.com/ng-native/ng-native/pull/324), [#321](https://github.com/ng-native/ng-native/issues/321))

  - It applies to emulated and Shadow DOM component sheets and to `ViewEncapsulation.None` ones, on a hot swap that edits the CSS, removes it, or changes the encapsulation.
  - A name another sheet also defines falls back to that sheet's keyframes, and a swapped sheet keeps its place among the others, so the later of two sheets still wins.
  - An animation whose keyframes the swap edits carries on along the new frames on its own clock, a scroll-driven one included, and a finished one holding its last frame lets it go when its keyframes are deleted.
  - `Engine.sheetReplaced` is new: it tells the engine a hot swap replaced one sheet with another, or with none.

- A hot style swap now applies an edit to a component's `:host` rule to the live component, as it already did for the rules inside it, where before the host kept its old style until a reload. ([#232](https://github.com/ng-native/ng-native/pull/232), [#183](https://github.com/ng-native/ng-native/issues/183))
- An `hsl()` made of tokens now reads a token holding a bare saturation or lightness, such as `--s: 100` in `hsl(var(--h) var(--s) var(--l))`, as a percentage, as a browser does, in a stylesheet and set on an element. ([#119](https://github.com/ng-native/ng-native/pull/119), [#114](https://github.com/ng-native/ng-native/issues/114))

  Before, a token holding `100` was read as 100 rather than 100%, unlike the same `100` written in the `hsl()` itself, so the colour came out wrong. The legacy comma syntax takes a percentage alone, so `hsl(var(--h), var(--s), var(--l))` with bare-number tokens is invalid, and a property that reads it is unset. A `calc()` of a percentage, whether a token, a fallback or written in it, such as `calc(var(--half) * 2)` or `calc(var(--missing, 50%) * 2)`, is a percentage too, and reads as one wherever it is used.

- A declaration whose value is invalid once its tokens are known now unsets its property, as in a browser, rather than letting a weaker rule's value for the same property show through. ([#237](https://github.com/ng-native/ng-native/pull/237), [#188](https://github.com/ng-native/ng-native/issues/188))

  The property inherits its parent's value when it inherits, and takes its initial value otherwise. A `border`, or one side's, written with tokens, `border: var(--w) var(--s) var(--c)`, now gives each token the role its value says, in any order, and when a token is none of a width, a style and a colour, or a second of one, the whole border is invalid and unset, as in Chrome, where before each token was tried in every role and whichever fitted was kept.

  A part no token fills takes its initial value, as one left out of a written border does: a medium width, the node's colour, or no style, so no line.

- A property that reads a custom property which is set but invalid where it is used is now unset, as in a browser, rather than taking the `var()`'s fallback. ([#168](https://github.com/ng-native/ng-native/pull/168), [#122](https://github.com/ng-native/ng-native/issues/122))

  This covers a token of the wrong kind (`--x: 10px` read by `color: var(--x, red)`), and a token made of others that makes nothing valid (`hsl(var(--h) 50% 50%)` with a percentage hue, a `calc()` mixing a percentage and a number, or an alias or `color-mix()` of such a token), in a stylesheet and set on an element. The property inherits its parent's value when it inherits, and takes its initial value otherwise, and a `var()` with alternatives, `var(--a, var(--b))`, no longer moves on to `--b` when `--a` is set. A token whose `var()` has nothing to substitute, because what it names is not set and it has no fallback, is still unset itself, so what reads it takes its fallback. A custom property set to `initial` is unset, and one set to `inherit` or `unset` takes its parent's value.

- The Metro preset now serves a lazy route that imports from a library outside the app's directory, which failed on the dev server with "Could not load bundle" in an integrated Nx workspace. ([#158](https://github.com/ng-native/ng-native/pull/158), [#128](https://github.com/ng-native/ng-native/issues/128))

  Expo addresses a lazy chunk by its path from Metro's server root. The server root is the app's own directory wherever the app is not a package-manager workspace, so a chunk from a library beside the app asked Metro for a file inside the app. The preset's `rewriteRequestUrl` now finds such a chunk above the server root and passes Metro its real path. It runs after any `rewriteRequestUrl` already in the config, Expo's included. Release bundles were never affected.

- `withAngularNative` takes `libraryStyles`, a list of npm packages whose components' CSS is compiled into native sheets as the app's own is. A component library from npm otherwise draws with no styles and no warning, because its CSS goes through the linker, which nothing compiles. ([#303](https://github.com/ng-native/ng-native/pull/303))
- A library opted in with `libraryStyles` builds when its CSS has a rule that does not parse, loads when it is minified, and reports what it drops in one line a file, with each warning behind `ANGULAR_NATIVE_LIBRARY_WARNINGS=all`. ([#318](https://github.com/ng-native/ng-native/pull/318))

  - A rule in a library's CSS that does not parse is dropped with a warning, as a browser drops it, where it failed the build. Angular Material's slide toggle was one.
  - A library's sheet is put on its component through the definition, so a class a minifier named only inside its own body gets it, where the module failed to load.
  - `libraryStyles` refuses an entry point (`@acme/ui/button`), a path, a scope, white space and capital letters, naming the package to write, where each matched nothing in silence.
  - A declaration whose `styles` is not a list of strings, and a file of a listed package that arrives without the list because something replaced the transform worker after `withAngularNative`, each get a warning.
  - A warning about a library's CSS written on one escaped line names the literal's line and the line within its styles, where it named a line of the file that held something else.
  - A file path Metro gives relative to the project is read against the project root, not the directory the build started in.
  - `::ng-deep` is refused as having no encapsulation to pierce, where it was called a pseudo-element.

- `loadFonts()` now rejects with a `MissingModuleError` when `expo-font` is missing, rather than throwing before a caller's `.catch` can see it, and resolves without reaching for `expo-font` when no sheet declares a face. ([#159](https://github.com/ng-native/ng-native/pull/159), [#130](https://github.com/ng-native/ng-native/issues/130))

  On iOS and Android, `expoFonts()` and `inject(Fonts)` check for `expo-font`'s native module before evaluating its JavaScript. Where the native module is not in the build, as in an Expo Go without it, the JavaScript is never evaluated, so Metro no longer reports its load failure as fatal before the `MissingModuleError`.

- A new package, `@ng-native/migrate`, holds the migrations that update an app to a new release, and `npx @ng-native/migrate@latest` runs them in an app made from the template, which has neither `nx migrate` nor `ng update`. ([#273](https://github.com/ng-native/ng-native/pull/273))

  `nx migrate @ng-native/nx` and `ng update @ng-native/schematics` run the same migrations from it, so each is written once. `sync-app-versions` now moves the `@ng-native/*` versions in every `package.json` in the workspace, outside `node_modules` and hidden directories, rather than only those of the projects Nx or `angular.json` lists. See [Updating an app](https://ng-native.com/guide/updating).

- A `<modal>` a test closes now leaves the tree before the interaction resolves, because the fake Fabric in `@ng-native/testing` reports the dismissal as iOS does and `settle()` waits for the commit that follows. ([#161](https://github.com/ng-native/ng-native/pull/161), [#138](https://github.com/ng-native/ng-native/issues/138))

  The fake sends `topDismiss` as soon as a `ModalHostView` is committed with `visible: false`, so `(dismiss)` fires and `screen.queryByText` no longer finds the modal's content, with no `fireEvent(host, 'dismiss')` in the test. A test that still sends it by hand sees `(dismiss)` once. `settle()`, and with it `fireEvent`, `userEvent` and `detectChanges`, also waits for a commit the engine owes outside change detection, which lands on the next frame, so such an interaction can take up to a frame longer to resolve.

- A `<modal>` shown a second time through `[visible]` takes touches, rather than ignoring every one. ([#155](https://github.com/ng-native/ng-native/pull/155), [#141](https://github.com/ng-native/ng-native/issues/141))

  The engine forgets the native views of a modal it leaves out of the tree while `visible` is false, so showing it again creates them afresh, as React Native's Modal.js does: Fabric never re-enables the events of a view that has been unmounted. The fake Fabric in `@ng-native/testing` now models that, so a test that presses a view committed again after it left the tree sees the press ignored, as it would be on a device.

- `nx add @ng-native/nx` now adds Babel 7's `@babel/core` at the workspace root, so the plugins in Expo's Babel preset no longer report an unmet `@babel/core` peer before an app is generated. ([#154](https://github.com/ng-native/ng-native/pull/154), [#152](https://github.com/ng-native/ng-native/issues/152))

  In an Angular workspace `@angular-devkit/build-angular` hoists Babel 8's `@babel/core` to the root, which answered that peer. The app generator already added Babel 7's; `nx add` alone now does too, at the same range.

- `nx g @ng-native/nx:app` now gives each app a Metro port of its own, so `nx run-many -t start` runs two apps side by side instead of the second failing with `EADDRINUSE`. ([#164](https://github.com/ng-native/ng-native/pull/164), [#132](https://github.com/ng-native/ng-native/issues/132))

  The first Expo app in a workspace keeps `expo start` on Expo's default port, 8081. A later app's `start` and `serve` targets run `expo start --port <n>`, with the lowest port that no other app's `start` or `serve` uses. An Expo app with no `start` command of its own counts as on 8081. Existing apps are unchanged.

- A second or later app from `nx g @ng-native/nx:app` now gets `run-ios` and `run-android` targets that pass its own Metro port, so its build loads from its own Metro rather than the first app's on 8081. ([#221](https://github.com/ng-native/ng-native/pull/221), [#186](https://github.com/ng-native/ng-native/issues/186))

  The targets run `expo run:ios --port <n>` and `expo run:android --port <n>` with the port its `start` uses. The first app in a workspace keeps the targets `@nx/expo` infers. Existing apps are unchanged.

- An app from `nx g @ng-native/nx:app` now ignores `.angular-native/`, and its `typecheck` target, like the template's `typecheck` script, loads `metro.config.js` before `ngc`, so a typecheck on a fresh checkout passes once Tailwind is added. ([#160](https://github.com/ng-native/ng-native/pull/160), [#133](https://github.com/ng-native/ng-native/issues/133))

  The command is now `node metro.config.js && ngc -p tsconfig.json --noEmit`, which the Tailwind page documented as a manual change. Loading the config builds the sheet `src/main.ts` imports and exits, and it takes a fraction of a second without Tailwind. The app's `.gitignore` gains the template's `.angular-native/` entry beside `/ios` and `/android`. Existing apps are unchanged.

  `nx add @ng-native/nx` also adds `@expo/metro` at the workspace root, at the range Expo depends on. `withNxMetro` looks for it from the app's directory up, and pnpm keeps it out of the root's `node_modules`, so with pnpm, loading the config with plain `node`, as the new `typecheck` target does, threw "Unable to load Metro config. Install `@expo/metro`". `expo start` was not affected, since pnpm's `expo` shim puts pnpm's hidden `node_modules` on `NODE_PATH`.

- `@ng-native/nx` has two new generators: `nx g @ng-native/nx:library` for a library whose tests render on the fake Fabric, and `nx g @ng-native/nx:component` for a native component with its test. ([#210](https://github.com/ng-native/ng-native/pull/210), [#146](https://github.com/ng-native/ng-native/issues/146))

  `library` runs `@nx/angular:library` without its tests (`@nx/js:library` with no bundler in the TypeScript preset). It then writes the app's `vitest.config.mts`, a `test` target that runs Vitest once, a `tsconfig.spec.json`, and a component built from `<view>` and `<text>` with a `.test.ts`, and adds `@ng-native/components`, `@ng-native/testing` and Vitest. `component` writes the same files as `@ng-native/schematics`' component schematic, under `src/lib` in a library and `src/app` in an app.

- `nx migrate @ng-native/nx@latest` now moves every `@ng-native/*` package in the root `package.json` to the new version, not just `@ng-native/nx`. ([#162](https://github.com/ng-native/ng-native/pull/162), [#134](https://github.com/ng-native/ng-native/issues/134))

  `@ng-native/nx` declares the other published packages as its `nx-migrations` package group. Nx adds none that the workspace does not already list, and like any `nx migrate`, it updates only the root `package.json`, so the `@ng-native/*` versions in an app's own `package.json` still move by hand.

- `nx add @ng-native/nx` and the app generator no longer stop at the install with `ERR_PNPM_IGNORED_BUILDS` on pnpm 11, because they decline the two install scripts `@nx/expo` brings in, `@parcel/watcher` and `unrs-resolver`, in `pnpm-workspace.yaml`. ([#214](https://github.com/ng-native/ng-native/pull/214), [#205](https://github.com/ng-native/ng-native/issues/205))

  They go under `allowBuilds` as `false`: both packages ship prebuilt binaries, and their scripts only build from source. A decision the workspace already made stays, and the placeholder pnpm writes after refusing an install is settled. The file keeps its comments and layout. An `allowBuilds` written as a flow mapping is left as it is, with a warning naming the two packages to decide. A workspace with a pnpm lockfile and no `pnpm-workspace.yaml` gets one that holds only this setting. Workspaces on npm, yarn or bun are unchanged.

- An app from `nx g @ng-native/nx:app` now lists the native modules its workspace libraries import in its own `package.json`, with their config plugins in `app.json`, so a development or release build links them as Expo Go does. ([#212](https://github.com/ng-native/ng-native/pull/212))

  `@ng-native/nx:sync-native-modules` is a sync generator, registered on the app's `start`, `export` and `prebuild` targets. It reads what each app's libraries import from Nx's project graph, and adds any native module the app does not list, including one a package they import peers on (`react-native-svg` for `@ng-native/icons`). `nx sync:check` reports an app it would change. An app generated earlier can register it with `"syncGenerators": ["@ng-native/nx:sync-native-modules"]` on those targets.

- `@ng-native/nx` has a new generator, `nx g @ng-native/nx:tailwind <app> --library <library>`, which sets up Tailwind in an app and shares each named library's theme and classes with it. ([#252](https://github.com/ng-native/ng-native/pull/252), [#148](https://github.com/ng-native/ng-native/issues/148))

  For the app it writes `src/styles.css`, wraps `metro.config.js` in `withTailwind`, passes the generated sheet to `mount` as `globalStyles`, adds `@ng-native/tailwind` and Tailwind, and makes sure `typecheck` builds the sheet first and `.gitignore` ignores `.angular-native/`. With Tailwind 4, each library gets a `theme.css` with `@source` that the app imports. With Tailwind 3 (`--tailwindVersion=3`, or a workspace that has it), each library gets a `tailwind.preset.cjs` whose `content` the app's config spreads in, and `@nx/enforce-module-boundaries` allows requiring it. Running it again changes nothing.

- `nx g @ng-native/nx:tailwind` now sets up the web build of a project whose Vite config runs `ngNativeWeb()`, with the web preset in place of the native one, whether the browser build sits beside a native app or is an app of its own. ([#299](https://github.com/ng-native/ng-native/pull/299), [#286](https://github.com/ng-native/ng-native/issues/286))

  With Tailwind 4 it writes a stylesheet importing `@ng-native/tailwind/web.css` (`src/styles.web.css` beside a native build, `src/styles.css` otherwise), adds `tailwindcss()` from `@tailwindcss/vite` after `ngNativeWeb()`, and adds `@tailwindcss/vite`. With Tailwind 3 it writes a config with `web-preset.cjs` (`tailwind.web.config.js` beside a native build, taking the rest from `tailwind.config.js`) and a `postcss.config.js` that runs Tailwind with it. `index.html` links the stylesheet. Each library named with `--library` is loaded by the web build too. A browser app of its own, which the generator refused before, gets the web build only. Running it again changes nothing.

- A `::placeholder` rule now sets a text input's placeholder colour, so `placeholder:text-gray-400` and `.field::placeholder { color: ... }` work, a token in the colour included. ([#241](https://github.com/ng-native/ng-native/pull/241))

  Before, every pseudo-element was refused, and a placeholder could only be coloured through `[placeholderTextColor]`. The rule matches a `<text-input>` only, as a browser's matches an input, and anything in it but the colour is dropped with a warning. Every other pseudo-element is still refused.

- A `<text pressable>` is now announced as a link by VoiceOver and TalkBack, as React Native's `Text` is. ([#118](https://github.com/ng-native/ng-native/pull/118), [#116](https://github.com/ng-native/ng-native/issues/116), [#117](https://github.com/ng-native/ng-native/issues/117))

  A pressable text commits `accessibilityRole: 'link'` unless it has a `role` or `accessibilityRole` of its own, or a role contributed by a directive on it, or is disabled (by `disabled`, or when that is unset by `aria-disabled`, `accessibilityState.disabled` or a directive's contributed state). A nested pressable text gets it too. The role follows `pressable` and `disabled` as they change. On the web host the element gets `role="link"`.

  This changes what screen readers announce and what tests find: `getByRole('link')` now also finds pressable texts, so a query that expected a single link can now find several. `getByText` is unchanged. Set `role` or `accessibilityRole` on the text to keep another role.

  A role contributed through `contributeAccessibility` now also ranks above the role a component implies by default, so a directive composed onto a `<switch>` that contributes a role now wins over `switch`.

- A node taken out of the tree and put back under the same parent after a commit takes touches, rather than ignoring every one. ([#206](https://github.com/ng-native/ng-native/pull/206), [#196](https://github.com/ng-native/ng-native/issues/196))

  A node that is out of the tree when a commit runs forgets its committed native views, so it is created afresh when it comes back, as React creates an element it mounts again. Its native state (a scroll offset, a text field's selection) goes with it. A node moved within one pass never leaves the tree and keeps its views.

- A custom property can now hold a relative colour of a token, such as `--tint: oklch(from var(--brand) l c h / 50%)`, in a stylesheet and set on an element, where before a stylesheet stopped the build on it and an element left it unset. ([#230](https://github.com/ng-native/ng-native/pull/230), [#191](https://github.com/ng-native/ng-native/issues/191))

  It is worked out where it is set, in any of `rgb()`, `hsl()`, `hwb()`, `lab()`, `lch()`, `oklab()` and `oklch()`, with channels written as keywords, numbers, percentages, angles or `calc()` of keywords and numbers, and it follows a theme or an ancestor that changes the token it reads. Set on an element, a relative colour inside a `color-mix()`, and one of a colour written out, `rgb(from red r g 255)`, now resolve as they do in a stylesheet.

- A release build keeps an input whose class field is called `styles`, where it emptied the input's entry in the component definition along with the compiled CSS, so a binding to it did nothing. ([#317](https://github.com/ng-native/ng-native/pull/317), [#314](https://github.com/ng-native/ng-native/issues/314))

  The compiled CSS a release build drops is now read with a JavaScript parser and only the definition's own `styles` property is emptied, in the app's components and in a linked library's. A library opted in with `libraryStyles` is read the same way, so an input called `styles`, under an alias or with a transform, no longer fails the build or leaves the component without its sheet.

- A root component's `:host` styles now apply: `mount` gives the root component a host view of its own under the surface, filling it by default, instead of mounting it on the surface root, which is never committed and dropped its background and padding without a warning. ([#280](https://github.com/ng-native/ng-native/pull/280))
- `ng add @ng-native/schematics` and its `application` schematic now set the app's iOS bundle identifier and Android package in `app.json`, where `expo prebuild` used `com.anonymous.<name>`. They default to `com.<scope>.<name>`, as `nx g @ng-native/nx:app` does, or `com.appnative` for `ng add` in a workspace with no npm scope, and a new `--bundleIdentifier` option sets one, refused with an error if iOS or Android would refuse it, including a segment that is a Java or Kotlin keyword. Both generators now refuse a Kotlin keyword, which Expo writes into the app's Kotlin files unescaped. Existing apps are unchanged. ([#309](https://github.com/ng-native/ng-native/pull/309))

  `ng update` with no package names now suggests `ng update @ng-native/schematics` for the Angular Native packages, rather than `ng update @ng-native/components`, which moved that package alone.

- `ng add @ng-native/schematics` and its `application` schematic now write a `.gitignore` in the app's directory, so the `ios/` and `android/` projects `expo prebuild` writes and the `.angular-native/` Tailwind generates are no longer offered for commit. ([#213](https://github.com/ng-native/ng-native/pull/213), [#184](https://github.com/ng-native/ng-native/issues/184))

  The lines are the template's own. Existing apps are unchanged.

- `<scroll-view>` and `<keyboard-avoiding-view>` take `contentContainerClass`, classes for their content container, matched by Tailwind and by the styles of the component they are written in. ([#181](https://github.com/ng-native/ng-native/pull/181), [#147](https://github.com/ng-native/ng-native/issues/147))

  It follows NativeWind's `contentContainerClassName`, so `<scroll-view contentContainerClass="gap-6 p-6">` pads and spaces the content without wrapping it in a view of its own. While it has a class, the content container is styled as if written in that component's template, on a device and on the web host. On `<keyboard-avoiding-view>` that container is the view `behavior="position"` moves. `contentContainerStyle` still wins over it. `HostEngine` gains `adoptScope(node, like)`, which a custom host can leave as the default no-op.

- A shadow or text shadow whose colour reads a custom property that is set but holds no colour now draws no shadow, as in a browser, rather than taking the `var()`'s fallback, and a shadow with no colour written is drawn in the node's own colour rather than black. ([#226](https://github.com/ng-native/ng-native/pull/226), [#189](https://github.com/ng-native/ng-native/issues/189))

  The same holds for a `color-mix()` of such a token, in a stylesheet and set on an element: the colour it makes is unset. A shadow's `var(--x,)` with no other colour, as in `box-shadow: var(--x,) 0 0 4px`, is drawn in the node's colour when `--x` is `inset` or unset, in `--x` when it is a colour, and not at all otherwise.

- `@ng-native/fabric` exports `DIRECT_EVENTS`, the events the engine delivers to their target only, and `@ng-native/web`'s engine reads the same set. An event in it that the web host is handed, such as `topTextLayout`, `topScrollToTop`, a `react-native-screens` event, `topTabSelected` or `topInsetsChange`, now reaches only its target there too, as it does on native. ([#311](https://github.com/ng-native/ng-native/pull/311))
- A pushed screen on iOS can now be swiped back, which it could not because the native stack received a swipe-back area of 0 points on every edge. ([#220](https://github.com/ng-native/ng-native/pull/220), [#165](https://github.com/ng-native/ng-native/issues/165))

  The stack now sends react-native-screens' default of no limit for every edge of `gestureResponseDistance`, merged with any edge a screen's `presentation` sets.

- A `<switch>` bound to a Signal Forms field marks the field touched when the user flips it, so a form that shows its errors once a field is touched shows them for a switch too, and it publishes `invalid` and `touched` as `data-invalid` and `data-touched` for a stylesheet, as `<text-input>` does. `<section-list>` takes `contentPadding` and `keyboardShouldPersistTaps` and passes them to its list as `<virtual-list>` takes them. ([#310](https://github.com/ng-native/ng-native/pull/310))
- `nx migrate @ng-native/nx@latest` and `ng update @ng-native/schematics` now also move the `@ng-native/*` versions in each project's own `package.json`, through a `sync-app-versions` migration that runs on every upgrade from this release on. ([#218](https://github.com/ng-native/ng-native/pull/218), [#185](https://github.com/ng-native/ng-native/issues/185))

  In a workspace with package-manager workspaces, the app's `package.json` is where its `@ng-native/*` packages are installed from, and `nx migrate` rewrote only the root's. The migration keeps a `^` or `~` and leaves `workspace:` links and peer ranges alone. After `nx migrate --run-migrations`, it prints the install to run. `@ng-native/schematics` now declares an `ng-update` package group, so `ng update` moves the root's `@ng-native/*` packages together as well.

- A `<native-tab>` that names both `sfSymbol` and `drawable` now shows its drawable on Android, where it had no icon because the SF Symbol was always taken first. ([#177](https://github.com/ng-native/ng-native/pull/177))

  Android's tab bar reads only a drawable and iOS's only a symbol, so the shorthand the running platform reads now comes first. A tab that names only one of them is unchanged.

- In development, a `<native-tab>` now warns once, naming its path, when it has no icon on the running platform because it names only the other platform's shorthand: `sfSymbol` without `drawable` on Android, or `drawable` without `sfSymbol` on iOS. ([#179](https://github.com/ng-native/ng-native/pull/179), [#150](https://github.com/ng-native/ng-native/issues/150))

  A tab that binds `[icon]` or `[systemItem]`, or that names both shorthands, stays quiet, and a release build never warns.

- `@ng-native/tailwind` has a Tailwind 3 preset for the web, `web-preset.cjs`, so a Tailwind 3 app styles its components in a browser through `@ng-native/web` as on a device, with or without a `prefix`. ([#279](https://github.com/ng-native/ng-native/pull/279), [#269](https://github.com/ng-native/ng-native/issues/269), [#251](https://github.com/ng-native/ng-native/issues/251))

  It is the Tailwind 3 counterpart of `web.css`: `hover:` and `focus-visible:` are the browser's own, the safe area comes from `env()`, a hairline is one device pixel on a high-density screen, and `font-mono` keeps Tailwind's stack. Its `dark:` and platform variants match the `dark` and `platform-web` classes `mount` keeps on the root as attributes (`[class~="dark"]`), so a Tailwind 3 `prefix` no longer stops them matching. `preset.cjs` is unchanged and builds the same CSS as before. The web docs describe the setup: a `tailwind.web.config.js` that swaps in the web preset, and a PostCSS config for Vite.

- A warning about a Tailwind rule native cannot express now names the rule's selector, such as `[angular-native] .grid (Tailwind): dropped 'display': ...`, rather than a line of the generated `app.tailwind.css`. ([#178](https://github.com/ng-native/ng-native/pull/178), [#136](https://github.com/ng-native/ng-native/issues/136))

  The generated sheet's lines move as classes are added, and the selector is what to search the app for. CSS escapes are undone, so `md:grid` and `2xl:grid` read as written in a template, and a rule with several selectors names each of them.

- An app made from the template now gets a deep link scheme from its own name, and no longer carries the template's `publishConfig`. ([#202](https://github.com/ng-native/ng-native/pull/202))

  The scheme was `myapp` in every app. It is now `helloworld` in the template, which `create-expo-app` replaces with the app's name, as it does for Expo's own templates: `field-notes` gets `fieldnotes`, the scheme the nx generator already gives. The template's `publishConfig` only said to publish it publicly, which the release already does, and `create-expo-app` left it in the new app's `package.json`.

- On iOS, a single-line `<text-input>` with a line height grows with the system text size again, and `Conditions` has an optional `fontScale` for it. ([#225](https://github.com/ng-native/ng-native/pull/225), [#198](https://github.com/ng-native/ng-native/issues/198))

  The line box a single-line iOS field keeps as its `minHeight` is scaled by the system text size, capped by the field's `maxFontSizeMultiplier` and not scaled when `allowFontScaling` is false, as React Native scales `lineHeight`. `Conditions` in `@ng-native/fabric` gains an optional `fontScale`, which `currentConditions()` and `watchConditions()` in `@ng-native/device` fill in from `PixelRatio.getFontScale()`; without it the scale is 1. `watchConditions()` now hands the engine the new text size before it re-measures text, which is one more commit when only the text size changes. An app that builds `Conditions` itself passes `fontScale` to get the scaling.

- On iOS, a single-line `<text-input>` with a line height centres its text, and its line height sets its height as it does on Android and in a browser. ([#180](https://github.com/ng-native/ng-native/pull/180), [#127](https://github.com/ng-native/ng-native/issues/127))

  React Native's iOS text field drew the text at the bottom of a line box taller than the font: 4.7pt low in a 44pt field with a 16px font and a 24px line height, which every Tailwind font-size utility brings, and 20.7pt low with `leading-10`. A single-line field on iOS now commits no `lineHeight` and a `minHeight` of line height, padding and border instead (the larger of it and its own `min-height`), so its height is unchanged and the text is centred. An explicit `height` still sizes the field alone. A `multiline` field keeps its `lineHeight`, and Android is unchanged.

- A custom property set on an element, `[style.--t]`, now has only CSS whitespace trimmed from its value, as Chrome does, so a no-break space or another Unicode space is kept, and `none` or `4px` with a no-break space before it is no longer read as `none` or `4px`. ([#326](https://github.com/ng-native/ng-native/pull/326), [#305](https://github.com/ng-native/ng-native/issues/305), [#306](https://github.com/ng-native/ng-native/issues/306))

  CSS whitespace is a space, a tab, a newline, a carriage return and a form feed. The same holds between colour channels set on an element: `1 0 0` separated by no-break spaces is no longer read as `rgb(1, 0, 0)`. A declaration using such a token is unset, as it is in Chrome.

- A hidden `<modal>` at the top level of the root component is left out of the tree, as one anywhere else is, rather than covering the screen and taking every touch. ([#163](https://github.com/ng-native/ng-native/pull/163), [#156](https://github.com/ng-native/ng-native/issues/156))
- `<ui-text>` shows the text written inside it, `<ui-text>Us {{ score() }}</ui-text>`, as `<text>` does, where it showed nothing: `@expo/ui`'s `Text` reads its text from a prop and takes no child views, and the content was dropped. `text` still sets it, and wins when both are given. `registerViewName` and `registerExpoView` take a `textContent` option for any other view that reads its text from a prop. ([#322](https://github.com/ng-native/ng-native/pull/322))
- Under Vitest 4, a test that renders a component injecting a device service, such as `<text-input>`, no longer fails with "Unexpected token 'typeof'" when `@ng-native/*` is installed from npm. ([#169](https://github.com/ng-native/ng-native/pull/169), [#126](https://github.com/ng-native/ng-native/issues/126))

  `ngNative()` shadows the `require` Vitest 4 passes every module in `.js` files whose package is `"type": "module"`, as the published `@ng-native/*` packages are, as well as in `.ts`, `.mts` and `.mjs`. A `.js` file in a CommonJS package keeps its `require`. The hand-written `hide-require` plugin some apps added as a workaround can be removed.

- On the web, `mount` now keeps a `dark` class on its root while `ColorScheme` is dark, so `dark:` utilities and a theme's `.dark` block apply in a browser as they do under `watchConditions` on a device, and `ColorScheme.set()` now chooses the scheme there too. ([#267](https://github.com/ng-native/ng-native/pull/267))

  The class follows `prefers-color-scheme`, or the scheme `inject(ColorScheme).set()` chose over it, and `set(null)` hands it back to the system. An app that puts `dark` on a view of its own, for a theme switch of its own, passes `darkClass: false` to `mount`, or its views now also match `dark:` whenever the system is dark.

- A browser app on `@ng-native/web` that imports an `@ng-native/expo` service now builds with `vite build`, and starts under `vite` in a workspace that has Expo installed for its native app, with the service inert as the documentation says. ([#295](https://github.com/ng-native/ng-native/pull/295), [#289](https://github.com/ng-native/ng-native/issues/289))

  `ngNativeWeb()` now resolves a `require` of an Expo module (`expo-*`, `@expo/*`, `@react-native-async-storage/*` and `react-native-watch-connectivity`) to a module that throws when it is loaded, so the `catch` around it in the packages answers as it does where the module is missing. Before, `vite build` failed to resolve `expo-modules-core` in an app without Expo, and with Expo installed both the build and the dev server's pre-bundle failed on Expo's own imports from `react-native`. An `import` of such a module in browser code still resolves as before.

- On the web, a single-line `<text-input>` with `keyboardType` `phone-pad` is now a `type="tel"` field, so browsers autofill it as one, and toggling `multiline` on a focused field keeps its caret and selection. ([#276](https://github.com/ng-native/ng-native/pull/276), [#271](https://github.com/ng-native/ng-native/issues/271))

  The other keyboards still set only `inputmode`: `type="url"` and `type="email"` trim the value an app sets, and `type="email"` and `type="number"` have no selection API, so `setSelection()` and `[selection]` would throw. `secureTextEntry` keeps the field a `type="password"` field whatever the keyboard.

- A browser app on `@ng-native/web` now starts under both `vite` and `vite build` in a workspace that has React Native installed, and `ngNativeWeb()` combines with a tool that sets its own `build.rolldownOptions.external`, such as Storybook. ([#257](https://github.com/ng-native/ng-native/pull/257), [#207](https://github.com/ng-native/ng-native/issues/207), [#250](https://github.com/ng-native/ng-native/issues/250))

  `ngNativeWeb()` now resolves `react-native` and `expo` to an empty module, in the build and in Vite's dependency pre-bundling, and no longer sets `optimizeDeps.exclude` or `build.rolldownOptions.external`. A static import of a name from `react-native` in browser code now fails the build rather than the page. The `@ng-native/device` services reach React Native only where Fabric is present, so a bundler's own `require` no longer makes them call it in a browser.

- A browser app on `@ng-native/web` that imports `@ng-native/components/reanimated` or `@ng-native/components/gestures` now builds and runs, with the worklet and gesture directives inert, where it used to fail the build. ([#323](https://github.com/ng-native/ng-native/pull/323), [#307](https://github.com/ng-native/ng-native/issues/307))

  Both entry points have a `browser` condition in `exports`, as `@ng-native/components/animations` does, and a browser build resolves them to files that reach neither Reanimated nor Gesture Handler. `WorkletStyle`, `WorkletScroll` and `NativeGesture` take their input and do nothing, `<gesture-root>` is a box that fills its parent (`@ng-native/web`'s reset gives it the `flex: 1` it has on a device), and `sharedValue()` is a plain holder with Reanimated's `value`, `get()`, `set()`, `modify()`, `addListener()` and `removeListener()`. Metro on a device never sets the `browser` condition, so iOS and Android load the same files as before, and the types are unchanged. `Gesture` and Reanimated's own functions, imported from the libraries themselves, still fail a browser build.

- On the web, a `<text-input>` with `keyboardType` `web-search` now sets `inputmode="search"`, so a phone's browser shows its search keyboard and search key. ([#296](https://github.com/ng-native/ng-native/pull/296), [#287](https://github.com/ng-native/ng-native/issues/287))

  The field stays a `type="text"` field, and the enter key stays with `returnKeyType`. The `email-address` and `url` keyboards still set only `inputmode`, deliberately: in Chromium `type="email"` has no selection API, trims the value the app sets and hides the spaces a user types from its value, and `type="url"` trims the value the app sets.

- On the web, a single-line `<text-input>` is now an `<input>`, so its text sits centred in a taller field as on iOS and Android, and with `secureTextEntry` it is a `type="password"` field that browsers and password managers treat as one. ([#265](https://github.com/ng-native/ng-native/pull/265), [#208](https://github.com/ng-native/ng-native/issues/208))

  A multiline `<text-input>` is still a `<textarea>`: the element is swapped when `multiline` is set, carrying its attributes, value, focus and listeners. A selector or a test that looked for the field as a `textarea` now finds an `input` unless the field is multiline. A multiline field with `secureTextEntry` still masks with `-webkit-text-security`.

- In development, a `<scroll-view>` or `<virtual-list>` with content that is still at zero size a second after it lays out now logs a warning naming it, which is the usual sign of a component host without `flex: 1`. ([#298](https://github.com/ng-native/ng-native/pull/298), [#290](https://github.com/ng-native/ng-native/issues/290))

  The warning says to give the host, or the element, `flex: 1` or a height, and links the Layout and views page. It comes once per element. A layout with a size within the second, or destroying the element, cancels it, so a collapsed or animating container isn't reported. A horizontal one is measured by its width. In development a `<scroll-view>` now listens to its own layout to do this. A release build doesn't check, and a `<scroll-view>` there commits no layout listener.

### ❤️ Thank You

- Anthony @anthonyjuarezsolis
- Ashley Hunter
- erKam @erkamyaman

## 0.2.0 (2026-09-30)

### 🩹 Fixes

- Tailwind's `aria-disabled:`, `aria-checked:`, `aria-busy:`, `aria-expanded:`, `aria-selected:` and `aria-hidden:` variants, and selectors such as `[aria-disabled="true"]`, now match a component carrying that aria input, and a disabled `<text>` publishes `data-disabled`, so `disabled:` and `[data-disabled]` apply to it. ([#105](https://github.com/ng-native/ng-native/pull/105), [#98](https://github.com/ng-native/ng-native/issues/98), [#99](https://github.com/ng-native/ng-native/issues/99))

  These aria attributes are inputs that set the accessibility state, and until now the component consumed them and left nothing on the node for a selector to read, so every `aria-*:` utility compiled and never applied. The component now puts each one back on the node as the attribute it came in as (`aria-disabled="false"` does not match `aria-disabled:`). What VoiceOver and TalkBack are told has not changed, and the attributes are never sent to native.

  `<text>` takes `disabled` from the same base as `<pressable>` and consumed it the same way, so `:disabled` never matched it and nothing else did either. `:disabled` still does not match a text; use `[data-disabled]` or `disabled:`.

- A custom property set on an element to a value with a `var()` inside it, such as `[style.--size]="'calc(var(--gap) * 2)'"` or `style="--fill: hsl(var(--hue) 100% 50%)"`, now resolves where it is set, as the same value in a stylesheet does, and follows a theme or an ancestor that changes the tokens it reads. ([#106](https://github.com/ng-native/ng-native/pull/106), [#100](https://github.com/ng-native/ng-native/issues/100))

  This covers the shapes a stylesheet's custom property takes: `calc()`, `min()` and `max()` of numbers, `px` and `rem` lengths, angles, times and `var()`; `hsl()` with a `var()` for a channel; and `rgb()` or `hsl()` of one channels token, such as `rgba(var(--rgb), 0.5)`, with an alpha written or from a token. A value its tokens make nothing of, such as `calc(var(--word) * 2)`, or one in a cycle, is invalid, so a rule that reads it takes its own fallback.

  A value with a `var()` inside it in any other shape, such as `rgb(var(--r) 0 0)` or `calc(var(--a, var(--b)) * 2)`, which a stylesheet refuses at build time, is now unset on an element as well. Before, a colour function with a `var()` in it was sent to native as it was written.

- An `hsl()` made of tokens now reads a bare saturation or lightness, such as `hsl(var(--h) 100 50)`, as a percentage, as CSS Color 4 does, in a stylesheet and set on an element. ([#112](https://github.com/ng-native/ng-native/pull/112), [#108](https://github.com/ng-native/ng-native/issues/108))

  Before, `100` and `50` were read as 100 and 50 rather than 100% and 50%, and the colour came out wrong. The legacy comma syntax takes a percentage alone, so `hsl(var(--h), 100, 50)` is refused at build time and unset on an element, as a browser makes nothing of it; so is a hue written as a percentage.

  An `hsl()` of tokens also matches a browser at the edges now: a saturation below 0 is none, an alpha outside 0 to 1 is clamped, and a colour past the edge of sRGB is clamped into it rather than printed with channels below 0 or above 255. A hue token in `turn`, `rad` or `grad` is read as the angle it is, and a channel token of the wrong kind, a percentage for a hue or an angle for a saturation, lightness or alpha, makes the colour invalid rather than a wrong one. And a custom property set on an element to a percentage or an angle, such as `--s: 50%` or `--h: 0.5turn`, is read as a fraction or in degrees where a number is wanted, as the same token in a stylesheet is.

- `withAngularNative` now warns when an app's `@ng-native/*` package linked from a workspace folder and a library's installed copy of it are different versions, as it already did for two installed copies. ([#104](https://github.com/ng-native/ng-native/pull/104), [#102](https://github.com/ng-native/ng-native/issues/102))

  The check found a package's copies by the `node_modules` in their paths, and a linked workspace
  package's real path has none, so an app on a `workspace:` package and a library on a registry
  version of it bundled both with no warning. Metro's `getPackageForModule` now names the package
  a file outside `node_modules` belongs to, for imports of `@angular/core` and `@ng-native/*`.

- A disabled `<text>` is now announced as disabled by VoiceOver and TalkBack, as React Native's `Text` is. ([#110](https://github.com/ng-native/ng-native/pull/110), [#107](https://github.com/ng-native/ng-native/issues/107))

  `<text>` consumed `disabled` to stop presses and publish `data-disabled`, but never put it into the accessibility state, so a disabled `<text pressable>` was announced as an active control. It now commits `accessibilityState: { disabled: true }`, merged with any `accessibilityState` the app sets, and clears it when the text is enabled again. As in React Native this applies to every disabled text, pressable or not, nested or not. On the web host the text gets `aria-disabled="true"`. An `aria-disabled` input still takes precedence over `disabled`, as it does on the other controls.

- A `var()` whose fallback is made of other tokens, such as `width: var(--missing, calc(var(--gap) * 2))`, now uses that fallback, worked out from the tokens where it is substituted, in a stylesheet and set on an element. ([#113](https://github.com/ng-native/ng-native/pull/113), [#109](https://github.com/ng-native/ng-native/issues/109))

  Before, the fallback was dropped, so the declaration was unset. This covers a fallback that is `calc()`, `min()` or `max()` of tokens, an `hsl()` or other colour made of tokens, and a fallback that is another `var()` with such a fallback of its own, `var(--a, var(--b, calc(var(--gap) * 2)))`. Inside arithmetic, `calc(var(--missing, var(--gap)) * 2)` and `calc(var(--missing, calc(var(--gap) * 2)) + 1px)` now resolve too, where a stylesheet refused them at build time. A cycle through a fallback, `--x: var(--missing, calc(var(--x) * 2))`, is invalid, as in a browser, so a rule that reads it takes its own fallback.

  Custom properties defined together are also settled as a browser settles them, whatever order they are in. A fallback such as the `1px` in `calc(var(--b, 1px) * 2)` is taken only when `--b` is unset or invalid, never because `--b` is made of other tokens and not yet worked out. A `var()` naming a token that turns out invalid takes its own fallback. And a token read inside its own fallback, `calc(var(--x, 3px) * 2)` as `--x`, is a cycle.

- `ngNative()` in `@ng-native/testing/vitest` now resolves a package a workspace library imports to the app's copy when the library's copy is the same version in another directory, so a test loads one `@ng-native/components`, as the Metro bundle does. ([#103](https://github.com/ng-native/ng-native/pull/103), [#101](https://github.com/ng-native/ng-native/issues/101))

  A library installed after the app can get its own pnpm peer context, and with it a second
  directory for `@ng-native/components` at the app's version. Vite resolved the library's imports
  to that copy, so a test that rendered a library component had two component registries, and
  Angular reported NG0912 collisions for every component in it. The rule is the one
  `withAngularNative` applies in Metro: a copy at a version of the library's own still resolves
  where it is, as does a package the app does not reach. An existing app gets it by updating
  `@ng-native/testing`; its Vitest config is unchanged.

### ❤️ Thank You

- Ashley Hunter

## 0.1.3 (2026-09-30)

### 🚀 Features

- A text's `font-weight` and `font-style` now pick the matching declared `@font-face`, as they do on the web. Once a node's style is resolved, a `font-family` naming a declared family is pointed at the face CSS's matching rules choose (closest style, then nearest weight), so `font-family: Inter; font-weight: 600` or `class="font-sans font-semibold"` draws the file declared for 600 rather than the regular face made bold on iOS, or Roboto on Android. A face with both a weight and a style is registered as `<family>-<weight>-<style>` (`Inter-600-italic`), and no longer overwrites `Inter-600` or `Inter-italic` when a face declared exactly that exists. `font-weight: bold` in an `@font-face` is now read as 700; it was dropped. ([#71](https://github.com/ng-native/ng-native/pull/71), [#51](https://github.com/ng-native/ng-native/issues/51))

### 🩹 Fixes

- The app that the starter template, `nx g @ng-native/nx:app` and `ng add @ng-native/schematics` generate now wraps its `<safe-area-view>` in a `<safe-area-provider>`, so its content is inset from the first frame on iOS instead of jumping into place after the first relayout. ([#79](https://github.com/ng-native/ng-native/pull/79), [#78](https://github.com/ng-native/ng-native/issues/78))

  Without a provider above it, a `<safe-area-view>` reads its own insets once, before it has been laid out, and gets zero. An app generated earlier can make the same change in `src/app/app.ts`: add `SafeAreaProvider` to `imports` and put `<safe-area-provider>` around the template.

- A disabled `<pressable>`, `<touchable-opacity>`, `<switch>` or `PressBehavior` host now publishes `data-disabled`, so `[data-disabled]` rules and Tailwind's `disabled:`, `group-disabled:` and `peer-disabled:` variants apply to it, and stop applying when it is enabled again. ([#95](https://github.com/ng-native/ng-native/pull/95), [#90](https://github.com/ng-native/ng-native/issues/90), [#91](https://github.com/ng-native/ng-native/issues/91))

  `:disabled` still does not match a pressable, a touchable-opacity or a `PressBehavior` host: their `disabled` is an input, not a prop left on the node, so style them with `[data-disabled]` or `disabled:`. A `<switch>` matches both, because it also sends `disabled` to native.

  `fabric.render({ props: true })` in `@ng-native/testing` now prints nested props in full, with keys sorted at every depth. It printed a nested object such as `accessibilityState` as `{}` (keeping only nested keys that happened to share a name with a top-level prop), so a disabled control looked as if it announced nothing while `getByRole(...).props`, which reads the same commit, showed `disabled: true`. What native receives has not changed. A snapshot or golden string of this output that contains a nested prop needs updating.

- A custom property set on an element to another token, `[style.--fill-color]="'var(--brand)'"` or `style="--fill-color: var(--brand)"`, now resolves to that token where it is set, following a theme or an ancestor that redefines it, instead of the rules that read it drawing nothing. ([#96](https://github.com/ng-native/ng-native/pull/96), [#93](https://github.com/ng-native/ng-native/issues/93))

  The value can have a fallback, written or itself a `var()`: `var(--missing, var(--brand))`. A fallback that is another `var()` now also works for a custom property defined in a stylesheet, and a chain of aliases, such as `--a: var(--b); --b: var(--c)`, now resolves when it ends at a token built from others, such as `--c: hsl(var(--hue), 100%, 50%)`, declared in the same rule. Custom properties in a cycle, such as `--a: var(--b); --b: var(--a)`, are all invalid, as in a browser, so a rule that reads one takes its own fallback; before, one in the cycle could take its fallback instead. A `var()` inside another value set on an element, such as `calc(var(--gap) * 2)`, is still not resolved.

- An italic or oblique `font-style` that no declared `@font-face` of the family covers is no longer sent to native once a face is matched. Both platforms draw the upright face, rather than Android dropping the custom font for its system font in italic. ([#88](https://github.com/ng-native/ng-native/pull/88))
- A text input whose `@font-face` registers after it was laid out switches to that face, in its value and its placeholder, instead of keeping the system font. ([#87](https://github.com/ng-native/ng-native/pull/87))

  A text input takes its font a different way from a paragraph. iOS sets the font on the field again only when the input's text attributes change, and Android only when `fontFamily` is in the props the input is sent. Each text input that names a newly registered family is now committed with its `maxFontSizeMultiplier` moved by the same step as a paragraph's, and with its `fontFamily` sent again once. It keeps its view, so its focus, its typed text and its cursor position stay where they were.

- Text laid out before its `@font-face` registers switches to that face when `loadFonts()` or `Fonts.load()` registers it, instead of keeping the system font until its content changes. ([#82](https://github.com/ng-native/ng-native/pull/82), [#75](https://github.com/ng-native/ng-native/issues/75))

  React Native caches a paragraph's text layout by what the paragraph asks for, so a paragraph committed again unchanged kept the fallback face it was first laid out in. Each paragraph that names a newly registered family is now committed with its `maxFontSizeMultiplier` moved by a step no text size reaches, so native lays it out again in the same view. It keeps its tag and native state. An app that sets its own `maxFontSizeMultiplier` sees it rise by 0.006 for each such face, which makes no visible difference.

- `withAngularNative` now resolves a package a workspace library imports to the app's copy when the library's copy is the same version in another directory, so the bundle holds one `@ng-native/components`, one React Native and one of each native module. ([#97](https://github.com/ng-native/ng-native/pull/97), [#92](https://github.com/ng-native/ng-native/issues/92))

  pnpm installs a package once per set of peers it resolves. A library that lists
  `@ng-native/components` but not everything the app lists, such as `@babel/core`, gets its own
  peer context, and a second directory for every package in it at the app's versions. Metro bundled
  those from the library's files: a second component registry and a second React Native. A copy at a
  version of the library's own still resolves where it is, as does a package the app does not reach,
  and Metro warns when that puts two versions of an `@ng-native/*` package in the bundle, as it
  already did for `@angular/core`.

- `withAngularNative` now resolves `@babel/runtime` from the app's project first, so every helper import Expo's Babel preset writes reaches the Babel 7 runtime the app installed, not Babel 8's. ([#80](https://github.com/ng-native/ng-native/pull/80), [#76](https://github.com/ng-native/ng-native/issues/76))

  Under pnpm, a file in a package that does not declare `@babel/runtime` looks in
  `node_modules/.pnpm/node_modules` before the workspace root. An install from before the root's
  `@babel/runtime` 7 entry, in a workspace with `@angular-devkit/build-angular`, leaves Babel 8's
  runtime there, and later installs keep it. When the project reaches no copy, the import resolves
  from where it is written, as before.

- `nx g @ng-native/nx:app` in a package-manager workspace now lists the root's Vitest, Angular and other shared dependencies in the app's `package.json` when Angular Native accepts them, instead of adding Vitest 5 beside a workspace's Vitest 4. ([#54](https://github.com/ng-native/ng-native/pull/54), [#41](https://github.com/ng-native/ng-native/issues/41))
- `nx g @ng-native/nx:app` now sets `ios.bundleIdentifier` and `android.package` in the app's `app.json`, from a new `--bundleIdentifier` option or, by default, `com.<workspace scope>.<name>`, so `expo prebuild` no longer falls back to `com.anonymous.<name>`. ([#66](https://github.com/ng-native/ng-native/pull/66), [#45](https://github.com/ng-native/ng-native/issues/45))
- `nx g @ng-native/nx:app --help` now prints the generator's description instead of `undefined`. ([#55](https://github.com/ng-native/ng-native/pull/55), [#42](https://github.com/ng-native/ng-native/issues/42))
- `nx g @ng-native/nx:app` now writes a `.gitignore` in the app that ignores the `ios/` and `android/` projects `expo prebuild` generates, as the starter template does. ([#62](https://github.com/ng-native/ng-native/pull/62), [#44](https://github.com/ng-native/ng-native/issues/44))
- `nx add @ng-native/nx` in a workspace with package-manager workspaces now pins `expo`, `react` and `react-native` at the root to the app's versions, and no longer adds `@expo/cli` there, so pnpm stops installing a second, newer React Native and React for `@nx/expo`'s `expo` peer. ([#64](https://github.com/ng-native/ng-native/pull/64), [#38](https://github.com/ng-native/ng-native/issues/38))
- `nx add @ng-native/nx` and `nx g @ng-native/nx:app` now write exact versions in a workspace that saves them, reading pnpm's, npm's, Yarn's and Bun's settings for it: the newest version each range allows, as `pnpm add` would save it, or the lowest when the registry cannot be reached. An app in a package-manager workspace takes the root's version of a package the root already pins, so its Angular and TypeScript do not drift from the rest of the workspace. ([#67](https://github.com/ng-native/ng-native/pull/67), [#40](https://github.com/ng-native/ng-native/issues/40))
- An app from `nx g @ng-native/nx:app` now has a `serve` target that runs `expo start`, in place of the `expo start --web` `@nx/expo` infers for every Expo app, since the app has no web platform. ([#58](https://github.com/ng-native/ng-native/pull/58), [#43](https://github.com/ng-native/ng-native/issues/43))
- `nx g @ng-native/nx:app` now adds the app's own directory to the workspace's packages, not a glob of its parent, when another directory there already has a `package.json`. A workspace that lists its apps one by one keeps doing so, and no other package joins the workspace unasked. ([#59](https://github.com/ng-native/ng-native/pull/59), [#39](https://github.com/ng-native/ng-native/issues/39))
- `nx g @ng-native/nx:app` now reaches a workspace's tsconfig path aliases in a package-manager workspace too, as it already did in an integrated one: the app's `tsconfig.json` extends `tsconfig.base.json` when it has a `paths` list, and its Vitest config resolves them, so `nx typecheck`, `nx test` and Metro find the workspace's libraries. ([#57](https://github.com/ng-native/ng-native/pull/57), [#36](https://github.com/ng-native/ng-native/issues/36))
- `StyleSheet` now declares the `fonts` a compiled sheet carries, so `loadFonts()` accepts the generated Tailwind module and `styleSheetOf()` as the docs show. Both failed to typecheck with `TS2559: Type 'StyleSheet' has no properties in common with type 'SheetWithFonts'`. ([#60](https://github.com/ng-native/ng-native/pull/60), [#50](https://github.com/ng-native/ng-native/issues/50))
- `font-mono` uses an app's own monospace font on every platform. On Tailwind 4, an ([#68](https://github.com/ng-native/ng-native/pull/68), [#48](https://github.com/ng-native/ng-native/issues/48))
  `@theme { --font-mono: ... }` after `native.css` used to lose on device to the preset's Menlo and
  `monospace` rules; those now set a custom property on the root that the app's `--font-mono`
  replaces. On Tailwind 3, `preset.cjs` no longer sets `theme.extend.fontFamily.mono`, which
  overrode a `mono` from the config or an earlier preset, and adds its `Courier New`, Menlo and
  `monospace` utilities only while `fontFamily.mono` is Tailwind's own `ui-monospace` stack.

- The generated `.angular-native/app.tailwind.d.ts` now imports `StyleSheet` with `import type` instead of an `import()` type, which typescript-eslint's `consistent-type-imports` rule reported as an error when an app's lint reached the file. ([#65](https://github.com/ng-native/ng-native/pull/65), [#53](https://github.com/ng-native/ng-native/issues/53))
- An `@font-face` in the Tailwind entry now bundles its font file. The generated `.angular-native/app.tailwind.js` held the `url()` as a plain path, so Metro never shipped the file and `loadFonts()` had nothing to register; it is now an import, re-pointed from the entry's folder to the generated module's. ([#56](https://github.com/ng-native/ng-native/pull/56), [#49](https://github.com/ng-native/ng-native/issues/49))
- Tailwind's theme tokens are now resolved on device, as on the web: an element that sets `--color-brand` or `--spacing`, from a component stylesheet, a `style` attribute, a `[style.--x]` binding or code, restyles every utility inside it that reads that token, in Tailwind 3 and 4. Tokens of bare colour channels (`--primary: 0 100% 50%` read through `hsl(var(--primary))`), colour tokens defined with `color-mix()`, tokens defined as `calc()` of another (percentages included, as Open Props writes its shadows), and transition, animation and filter values taken from a token now compile. Tailwind 3's `bg-opacity-*` classes fade a colour whose channels are a token, arithmetic around a token in `em` keeps its sign, `max()` and `min()` take two tokens, and the type scale's line heights land on whole points. Nodes that match the same rules under the same parent now share one resolved style, which roughly halves the time to style a long list of cards. ([#94](https://github.com/ng-native/ng-native/pull/94))
- `ios:`, `android:`, `web:`, `native:`, `dark:` and the platform `font-mono` match under a Tailwind 3 ([#69](https://github.com/ng-native/ng-native/pull/69), [#47](https://github.com/ng-native/ng-native/issues/47))
  `prefix`. Tailwind 3 prefixes every class in a variant's selector, so they matched `.tw-platform-ios`
  and `.tw-dark`, which nothing sets. `preset.cjs` records the prefix and `flattenTailwind` takes it back
  off those classes, so they match the `platform-*` and `dark` classes `mount` and `watchConditions`
  put on the root. The dark class stays `dark` with a prefix.

- The Tailwind 3 docs, the `@ng-native/tailwind` README and `preset.cjs` say how to list the preset ([#63](https://github.com/ng-native/ng-native/pull/63), [#46](https://github.com/ng-native/ng-native/issues/46))
  beside an app's own preset: after it, as `{ ...require('@ng-native/tailwind/preset.cjs'), presets: [] }`.
  Listed plainly after another preset, Tailwind 3's default theme, which it adds beneath each preset
  with no `presets` key, overrides that preset's `spacing`, `fontSize`, `colors` and the rest.

- `@ng-native/tailwind/preset.cjs` ships type declarations, so a `tailwind.config.ts` in a strict ([#61](https://github.com/ng-native/ng-native/pull/61), [#52](https://github.com/ng-native/ng-native/issues/52))
  TypeScript project can import the Tailwind 3 preset. The import used to fail with TS7016, an
  implicit `any`.

- A custom property declared only under a class, a platform class or a media query, such as `--brand` only under `.dark`, now applies only where that selector matches, instead of `flattenTailwind` substituting its one value everywhere and painting the dark value in light mode too. ([#86](https://github.com/ng-native/ng-native/pull/86))

  `flattenTailwind` substitutes a custom property at build time only when it is declared on `:root`, `:host`, `html` or `*` outside any at-rule, or through an `@property` initial value, and has one value. Any other `var()` of it is left for the engine to resolve per node, fallback included, so `var(--brand, red)` is `red` without the `.dark` class. The same applies to a Tailwind arbitrary property such as `[--my-var:red]`, which now reaches only the elements wearing that class. Tailwind's own `--tw-*` properties are unchanged.

- A themed custom property read with a fallback, such as `var(--brand, red)` where `--brand` is ([#72](https://github.com/ng-native/ng-native/pull/72), [#70](https://github.com/ng-native/ng-native/issues/70))
  declared under both `:root` and `.dark`, resolves per node on device, like one read without a
  fallback. `flattenTailwind` used to replace it with the fallback, so neither theme's value applied.

### ❤️ Thank You

- Ashley Hunter

## 0.1.2 (2026-09-30)

### 🚀 Features

- `<section-list>` draws a separator at each edge of a section, as `SectionSeparatorComponent` does. ([#23](https://github.com/ng-native/ng-native/pull/23))
  `<ng-template sectionEdgeSeparator>` is drawn between a section's header and its first item and
  between its last item and its footer, and is told the section and the sections either side. It used
  to be missing, and the documentation said to draw one inside the header or footer template instead.


### 🩹 Fixes

- `DeepLinks` delivers the url an app was launched with to every `subscribe()` listener rather than ([#24](https://github.com/ng-native/ng-native/pull/24))
  only the last one to subscribe, and one listener stopping no longer stops it reaching the others.
  An app that subscribed alongside the router took the launch link from it, and one that subscribed
  and stopped before the url was known left the router never following it.

- `DeepLinks` delivers the launch url to each `subscribe()` separately. A listener that throws is ([#28](https://github.com/ng-native/ng-native/pull/28))
  reported to Angular's `ErrorHandler` and no longer keeps the launch url from the listeners after
  it, such as the router's. The same function subscribed twice keeps getting the launch url until
  both subscriptions stop, not just one.

- `nx g @ng-native/nx:app` and `ng add @ng-native/schematics` now install `expo` `~57.0.26`, the current SDK 57 release, as `npx expo install --check` expects, and the starter template matches. ([#31](https://github.com/ng-native/ng-native/pull/31))
- `FileSystem.cache()` and `FileSystem.document()` now throw `[angular-native] expo-file-system is not installed` on the web and in a test with no fake source, as documented, instead of a `TypeError` about `cacheDirectory` or `documentDirectory`. ([#20](https://github.com/ng-native/ng-native/pull/20), [#13](https://github.com/ng-native/ng-native/issues/13))
- `nx g @ng-native/nx:app` and `ng add @ng-native/schematics` now install `expo-system-ui` with the app, as the starter template does, so the app's `userInterfaceStyle` applies on Android. ([#20](https://github.com/ng-native/ng-native/pull/20), [#13](https://github.com/ng-native/ng-native/issues/13))
- `StatusBar` changes the bar again in an app built with the iOS 27 SDK, where UIKit ignores the app-wide setters React Native's status bar module calls. `@ng-native/metro`'s config plugin now answers those calls from the view controllers iOS asks, the window's root and a screen or React Native modal presented full screen, and sets `UIViewControllerBasedStatusBarAppearance`. `expo-status-bar` and React Native's own `StatusBar` work again too. Until the app claims a style or visibility, a screen's own `statusBarStyle` and `statusBarHidden` apply. An existing app picks it up with `npx expo prebuild --clean`. ([#32](https://github.com/ng-native/ng-native/pull/32))
- `@ng-native/metro` is also an Expo config plugin, `"plugins": ["@ng-native/metro"]`, and the ([#22](https://github.com/ng-native/ng-native/pull/22))
  template and both generators add it. It adopts the UIKit scene life cycle in the `AppDelegate.swift`
  that `expo prebuild` writes, since an app built with the iOS 27 SDK that does not exits at launch
  with "UIScene life cycle is required for apps built with this SDK". React Native now starts from a
  scene delegate, which hands the links the app is opened with and receives, and its life cycle
  events, on to `AppDelegate`, so Expo's modules and code added there see them as before. What
  another plugin adds among the lines it replaces, as `@react-native-firebase/app` does, stays. For
  an app made before this release, add `"plugins": ["@ng-native/metro"]` to `app.json` and run
  `npx expo prebuild --clean`.

- A `StatusBar` claim pushed before the app's first `set()` stays on top. `set()` used to replace ([#19](https://github.com/ng-native/ng-native/pull/19))
  whatever was first on the stack, so a screen that pushed before startup code set the base lost its
  style, and dropping it later restored nothing.

- `StatusBar.set()` and `push()` no longer subscribe the caller to the bar's own state. An app that set its base style in an `effect` had that effect run again on every later `set()` or `push()`, which wrote the base back over what was just set. ([#33](https://github.com/ng-native/ng-native/pull/33))
- A `SecureStorage` signal whose first read fails, such as a keychain the app has no entitlement for, ([#17](https://github.com/ng-native/ng-native/pull/17))
  keeps its default and reports the failure on `error`, as a failed asynchronous read already did.
  It used to throw from `signal()`, so the component asking for it was never created and its screen
  rendered blank.

- The starter template now includes expo-system-ui, so its dark userInterfaceStyle applies on Android in development and release builds instead of being ignored. ([#12](https://github.com/ng-native/ng-native/pull/12))

### ❤️ Thank You

- Ashley Hunter
- erKam @erkamyaman
- Stavros Thalassinos @stavthal

## 0.1.1 (2026-09-29)

### 🩹 Fixes

- An app from `ng add @ng-native/schematics` or `nx g @ng-native/nx:app` starts without warnings. ([#5](https://github.com/ng-native/ng-native/pull/5))
  Its `app.json` sets the router root, as the template's does, so Expo no longer prints "Using
  src/app as the root directory for Expo Router". In Nx, the app's `start` target runs `expo start`
  itself rather than through `@nx/expo:start`, whose deprecation notice Nx printed on every
  `nx start`, and `nx add @ng-native/nx` adds Babel 7's `@babel/runtime` at the root, so Metro no
  longer warns about `@babel/runtime/regenerator` in an `@nx/angular` workspace. For an app made
  before this release, add `"extra": { "router": { "root": "src/app" } }` to its `app.json`; in Nx,
  also add a `start` target running `expo start` in the app's directory and `@babel/runtime@^7.20.0`
  to the root `devDependencies`.

- The template targets iOS and Android only. ([#5](https://github.com/ng-native/ng-native/pull/5))
  Its `app.json` names both as its `platforms`, and the web favicon, its `web` settings and
  `web-build/` in `.gitignore` are gone. The Angular CLI and Nx generators name the same platforms.
  Angular Native components render in a browser through `@ng-native/web`, which is set up
  separately.

### ❤️ Thank You

- Ashley Hunter

## 0.1.0 (2026-09-29)

### 🚀 Features

- The first public release: Angular components as real native iOS and Android views, in an Expo app. ([8803fb6](https://github.com/ng-native/ng-native/commit/8803fb6))
  Angular Native is built on Expo and React Native's Fabric renderer, so an app is created, run, hot
  reloaded, built and shipped with the Expo tooling you already know, and Expo's modules - the photo
  picker, location, Face ID and fingerprint, sign-in through the system browser, pictures from the
  camera view, notifications, secure storage and the rest - are available as Angular services and
  directives. Alongside that: a CSS engine that compiles stylesheets and Tailwind at build time, a
  native stack and tab router over `@angular/router`, Signal Forms support, device services, and a
  testing library that runs components in Node against a fake Fabric.

### ❤️ Thank You

- Ashley Hunter
