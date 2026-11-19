# Production pattern validation

This report records how Angular Native holds up against realistic production application patterns:
what each scenario in the canary exercises, what was verified and how, the framework problems each
one exposed, and what remains. It is kept current as the work proceeds, so partial progress is
always readable.

Scenarios live in the canary under `src/app/<area>/`, reachable from the home index. Framework
regression tests live in `packages/integration-tests` (run from that package with
`node --import ./register-linker.mjs --test "**/*.test.ts"`); scenario tests live next to each
scenario as `*.test.ts` and run with `pnpm --filter canary test`.

Severity scale: **Release blocker** (a production app of this shape cannot ship), **High** (a
common pattern is broken or needs a framework-specific hack), **Medium** (wrong in an edge case, or
an awkward API with a workaround), **Low** (cosmetic, tooling, or documentation).

## Issues found

| #   | Severity        | Area                 | Issue                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Status                                                                                                                                                                                                                                                                                                                                     | Regression test                                                                                                                                                                                                     |
| --- | --------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Low             | Testing              | `__DEV__` is undefined under both test runners, so any app code reading it throws in a test                                                                                                                                                                                                                                                                                                                                                                                                | Fixed                                                                                                                                                                                                                                                                                                                                      | `packages/testing/src/dev-global.*.test.ts`                                                                                                                                                                         |
| 2   | Release blocker | Lists                | `<virtual-list>` required every row height up front (`itemHeight`), so a feed or chat whose rows size to their content could not be built without guessing heights in JavaScript                                                                                                                                                                                                                                                                                                           | Fixed: rows without `itemHeight` are laid out in flow and measured (`estimatedItemHeight`, `virtualListRow`)                                                                                                                                                                                                                               | `virtual-list-measured.test.ts`                                                                                                                                                                                     |
| 3   | High            | Lists                | Recycling slots were keyed by index, so an insert above the window moved every rendered row's view (and any row component state) to a different item                                                                                                                                                                                                                                                                                                                                       | Fixed: slots follow the item's key (`keyExtractor`)                                                                                                                                                                                                                                                                                        | `virtual-list-measured.test.ts` (identity, keyed slots)                                                                                                                                                             |
| 4   | High            | Lists                | No way to hold the visible content still when rows are inserted or removed above it (new posts at the top of a feed, older messages in a chat)                                                                                                                                                                                                                                                                                                                                             | Fixed: `maintainVisibleContentPosition` on `<virtual-list>`, RN's shape                                                                                                                                                                                                                                                                    | `virtual-list-measured.test.ts` (holding position)                                                                                                                                                                  |
| 5   | Medium          | Lists                | Every row of an inverted list (the documented chat pattern) logged Angular's NG0318 warning in development, because the row style carried a transform list; one LogBox warning per row as a chat scrolls                                                                                                                                                                                                                                                                                   | Fixed: row transforms are CSS text the engine converts                                                                                                                                                                                                                                                                                     | `virtual-list.test.ts` (flips the rows without a style value Angular warns about)                                                                                                                                   |
| 6   | Medium          | Lists                | `scrollToIndex` and `scrollToOffset` on a horizontal `<virtual-list>` scrolled along y, so a carousel could not be scrolled to an item                                                                                                                                                                                                                                                                                                                                                     | Fixed                                                                                                                                                                                                                                                                                                                                      | `virtual-list.test.ts` (scrolls to a row along the axis it lays rows out on)                                                                                                                                        |
| 7   | Medium          | Docs                 | The lists page advised `track row.index` for rows holding state; after any insert above, that state shows on a different item                                                                                                                                                                                                                                                                                                                                                              | Fixed: docs now recommend `track row.key`, and `linkedSignal` for resetting state in recycled rows                                                                                                                                                                                                                                         | Covered by the identity test                                                                                                                                                                                        |
| 8   | High            | Platform             | The Metro preset's global `Node` stand-in answered `instanceof Node` with true for every object, so Vitest's `expect(array).toContain(x)` threw "expected a DOM node" in every app test, and any app or library code probing `instanceof Node` misread plain objects on device                                                                                                                                                                                                             | Fixed: the engine brands its nodes and the stand-in recognises only those                                                                                                                                                                                                                                                                  | `metro-config.test.ts` (the Node stand-in)                                                                                                                                                                          |
| 9   | Medium          | Lists                | Recycling reused a slot only when a row left and another arrived in the same pass (Angular's `@for` destroys a slot missing from the window), and mixed row kinds shared one pool: scrolling about a hundred mixed posts created 668 native nodes                                                                                                                                                                                                                                          | Fixed: freed slots are parked hidden (six per type) until a row of their type arrives, and `itemType` keeps a pool per kind. The same scroll now creates 155                                                                                                                                                                               | `virtual-list.test.ts` (keeps a slot that left for a row arriving in a later pass), `virtual-list-measured.test.ts` (recycles only into the same type), `feed.test.ts` (reuses the views of a row of the same kind) |
| 10  | High            | Testing              | A failed assertion about a node a query returned (`assert.equal(node, null)`, `expect(node).toBeNull()`) printed the engine's whole object graph through `instanceHandle`: 53,000 characters for one text node, and a forty-second hang for a small screen                                                                                                                                                                                                                                 | Fixed: the handle is non-enumerable, so a node prints as its view, props and children                                                                                                                                                                                                                                                      | `packages/testing/src/node-inspect.node.test.ts`                                                                                                                                                                    |
| 11  | Medium          | Testing              | Queries found views under `display: none` and views hidden from accessibility, where React Native Testing Library leaves them out by default; a test could assert on something no user can see                                                                                                                                                                                                                                                                                             | Fixed: hidden subtrees are excluded unless `{ includeHiddenElements: true }`                                                                                                                                                                                                                                                               | `packages/testing/src/hidden.node.test.ts`                                                                                                                                                                          |
| 12  | High            | Lists                | `<virtual-list>` had none of the scroll view's keyboard tap policy: with the keyboard up, a tap in a list (a chat transcript) neither dismissed the keyboard nor followed `keyboardShouldPersistTaps`                                                                                                                                                                                                                                                                                      | Fixed: the scroll view's policy is shared, and the list takes `keyboardShouldPersistTaps` (default `never`, as FlatList)                                                                                                                                                                                                                   | `primitives-behaviour.test.ts` (virtual list as a scroll view)                                                                                                                                                      |
| 13  | High            | Text input           | A multiline field whose value is set from code keeps the height of its previous text: a chat composer cleared after sending stays three lines tall. Fabric measures a text input from its state, which takes a JavaScript-set text only in the layout after measuring                                                                                                                                                                                                                      | Fixed: a value set from code is measured again in a commit of its own (`HostEngine.remeasure`)                                                                                                                                                                                                                                             | `controlled-inputs.test.ts` (is measured again after a value set from code)                                                                                                                                         |
| 14  | High            | Keyboard             | Nothing could keep a bar on the keyboard during an interactive dismissal. The documented `<keyboard-avoiding-view>` leaves the composer where it was while the finger drags the keyboard down, with a gap opening under it, because iOS reports no keyboard frames until release                                                                                                                                                                                                           | Fixed: `<keyboard-dock>`, the window's input accessory on iOS (UIKit carries it with the keyboard) and an in-flow bar padded clear of the keyboard on Android, with `covered()` for the content above                                                                                                                                      | `keyboard-dock.test.ts`; verified on the iOS simulator by recording the drag                                                                                                                                        |
| 15  | Medium          | Lists                | With `maintainVisibleContentPosition`, a header changing size (a typing indicator, which sits at the bottom of an inverted chat) shifted the message being read by its height each time it appeared or went                                                                                                                                                                                                                                                                                | Fixed: header resizes are held like inserts while the viewport is past the header                                                                                                                                                                                                                                                          | `virtual-list-measured.test.ts` (holds when the header before it changes size)                                                                                                                                      |
| 16  | Low             | Testing              | `settle()` is documented as enough for a change to commit, but after a change made in a timer a `waitFor` on application state can resolve before Angular's scheduled pass, so the next assertion on the rendered tree sees the previous frame                                                                                                                                                                                                                                             | Open: documentation should steer assertions on rendering to `waitFor`/`findBy` on the rendered tree; the canary test that failed under the full parallel gate turned out to be issue 49                                                                                                                                                    | -                                                                                                                                                                                                                   |
| 17  | High            | Forms                | Signal Forms' `focusBoundControl()` - how a failed submit sends the user to a field - threw on any form with more than one field (`compareDocumentPosition is not a function`) and on any field bound to a toggle, picker or date (`element.focus is not a function`)                                                                                                                                                                                                                      | Fixed: engine nodes answer `compareDocumentPosition` in tree order, and `focus()` puts the cursor in a text input or scrolls anything else into view in its scroll view (`measureLayout`)                                                                                                                                                  | `form-focus.test.ts`                                                                                                                                                                                                |
| 18  | High            | Forms                | No picker or date control worked with `[formField]`: `@expo/ui`'s pickers needed hand-wired events, and the two platforms' date pickers take and report dates differently (ISO text and `dateChange` on iOS, milliseconds and `dateSelected` on Android)                                                                                                                                                                                                                                   | Fixed: `ui-date-picker` has a `value` model (a `Date`) and `disabled` on both platforms; `ui-picker` (iOS) takes `options` and a `value` model                                                                                                                                                                                             | `ui-form.test.ts`                                                                                                                                                                                                   |
| 19  | Low             | Forms (Angular)      | `errorSummary()` lists errors from the last field to the first, and Signal Forms has no public way to find the first invalid field in screen order, so "focus the first error" needs the order written out                                                                                                                                                                                                                                                                                 | Open, upstream: the scenario keeps an explicit order                                                                                                                                                                                                                                                                                       | -                                                                                                                                                                                                                   |
| 20  | Low             | Testing              | A recorded view command did not say which node it went to, so a test could not tell which of several fields was focused or scrolled                                                                                                                                                                                                                                                                                                                                                        | Fixed: each command carries its node, off the enumerable keys                                                                                                                                                                                                                                                                              | `form-focus.test.ts`                                                                                                                                                                                                |
| 21  | High            | Keyboard             | Moving between fields with the keyboard up (the keyboard's Next key) left the new field half behind the keyboard: UIKit scrolls a field clear as the keyboard rises, not when focus moves beneath it                                                                                                                                                                                                                                                                                       | Fixed: a text input focused with the keyboard up scrolls itself just clear of it (`HostEngine.reveal`, measured in window coordinates)                                                                                                                                                                                                     | `form-focus.test.ts` (moving between fields with the keyboard up); verified on the simulator                                                                                                                        |
| 22  | High            | Forms                | SwiftUI's date picker reports its default date (now) as a change the moment it appears, so an empty date field bound to a form filled itself in, passed `required` and marked the form dirty with no user input                                                                                                                                                                                                                                                                            | Fixed: the picker's report on appearing is not taken as the user's choice                                                                                                                                                                                                                                                                  | `ui-form.test.ts` (does not take the date SwiftUI reports as it appears)                                                                                                                                            |
| 23  | High            | Expo UI              | `<ui-host [matchContents]>` did nothing: native reads `matchContentsVertical` and `matchContentsHorizontal`, which `@expo/ui`'s React wrapper derives and `UiHost` did not. The host collapsed and its SwiftUI control was drawn outside it, visible but untappable and absent from the accessibility tree                                                                                                                                                                                 | Fixed: `UiHost` splits the input per axis                                                                                                                                                                                                                                                                                                  | `ui-form.test.ts` (a SwiftUI host); `expo.test.ts` had asserted the pass-through and now asserts the flags                                                                                                          |
| 24  | Medium          | Forms                | The `@expo/ui` pickers never marked their field touched, so a form's errors for a date or a choice appeared only after a submit                                                                                                                                                                                                                                                                                                                                                            | Fixed: both emit `touch` when the user picks                                                                                                                                                                                                                                                                                               | `ui-form.test.ts` (marks its field touched)                                                                                                                                                                         |
| 25  | High            | Engine               | A node Angular moved to a different parent was re-parented natively, which Fabric forbids: `ShadowNodeFamily::setParent` asserts (a native crash in a debug build, seen on the simulator), and a release build keeps the old parent for measurement and layout. It happened for content projected into a container mounted again, and for every Android scroll view with a `<refresh-control>`, which is moved into the swipe layout after its first commit                                | Fixed: a node committed under another parent is created again with its subtree, as React does; the fake Fabric now enforces the rule for every test                                                                                                                                                                                        | `reparent.test.ts`; the fake's invariant (it found the Android refresh case in existing tests)                                                                                                                      |
| 26  | High            | Keyboard             | React Native's sticky input accessory claims the keyboard only when it first appears, so a docked bar vanished for good once any other field on the screen had been focused                                                                                                                                                                                                                                                                                                                | Fixed: `<keyboard-dock>` mounts its accessory again once the keyboard has gone and stayed gone                                                                                                                                                                                                                                             | `keyboard-dock.test.ts` (after another field has had the keyboard); verified on the simulator                                                                                                                       |
| 27  | High            | Keyboard, navigation | A docked bar belongs to the keyboard's window, above every screen, so it stayed drawn over a sheet presented from its screen (seen on the simulator) and would over a screen pushed on top                                                                                                                                                                                                                                                                                                 | Fixed: stack and tab outlets provide `SCREEN_IN_FRONT` per screen; the dock gives the keyboard up while covered and claims it back when in front                                                                                                                                                                                           | `router-keyboard-dock.test.ts`; verified on the simulator with a form sheet                                                                                                                                         |
| 28  | Low             | Docs                 | In landscape a page's content runs under the Dynamic Island unless the page insets its left and right edges, as in UIKit scroll views and React Native; nothing in the docs says so                                                                                                                                                                                                                                                                                                        | Open: document `<safe-area-view [edges]="['left', 'right']">` for pages that rotate                                                                                                                                                                                                                                                        | -                                                                                                                                                                                                                   |
| 29  | High            | Navigation           | No way to pop several screens at once or back to a stack's root: `NativeNavigation` had push, replace, present, reset and back, and popping to the root of a tab's own stack had no API at all                                                                                                                                                                                                                                                                                             | Fixed: `popTo(commands)` and `popToRoot()`, answered by the innermost stack in front, through history where it lines up                                                                                                                                                                                                                    | `router-deep.test.ts`, `router-back.test.ts` (tabs)                                                                                                                                                                 |
| 30  | High            | Navigation           | A deep link that launches the app arrives once `Linking.getInitialURL()` settles, while the router's first navigation is still running, and following it cancelled that navigation: the app opened with no root screen under the link, so Back had nowhere to go                                                                                                                                                                                                                           | Fixed: links wait for the first navigation to finish                                                                                                                                                                                                                                                                                       | `router-deep.test.ts` (a deep link into a nested screen)                                                                                                                                                            |
| 31  | Medium          | Navigation           | `withLinkParent` built one level of stack under a deep link, so a link five screens deep opened on two                                                                                                                                                                                                                                                                                                                                                                                     | Fixed: the parent's parent is asked in turn. Compatibility: an app whose `parentOf` answers for its parents too now gets the deeper stack it describes                                                                                                                                                                                     | `router-deep.test.ts`                                                                                                                                                                                               |
| 32  | Medium          | Development          | After a full reload in a development build (`expo.reloadAppAsync`, which the framework calls when an edit is more than a template), the first `@expo/ui` view created crashed natively in `ExpoFabricView.injectInitializer`; relaunching the app cleared it                                                                                                                                                                                                                               | Open, not yet isolated: seen once on the simulator; release builds do not reload                                                                                                                                                                                                                                                           | -                                                                                                                                                                                                                   |
| 33  | High            | Search               | The navigation bar's search field could not be written from code ("writing `query` from code does not reach the field"), so tapping a recent search or a suggestion could not fill it; its submit, cancel, focus and blur events were not declared, and it had no `focus`, `blur` or `clear`                                                                                                                                                                                               | Fixed: `query` is two-way in both directions (`setText`, after render so a restored query reaches a committed field); `(search)`, `(cancel)`, `(searchFocus)`, `(searchBlur)`; `focus()`, `blur()`, `clear()`, `cancelSearch()`; `autoCapitalize`, `obscureBackground`, `hideNavigationBar`, colours                                       | `router-search-bar.test.ts`                                                                                                                                                                                         |
| 34  | High            | Scrolling            | Pull to refresh never worked on iOS, in `<scroll-view>`, `<virtual-list>` or `<section-list>`: no spinner, no `(refresh)`. The refresh control was committed inside the content view, and the native control looks for its scroll view once, when inserted; Fabric mounts a new subtree bottom-up, so it looked before the content view was in the scroll view and never attached. The fake Fabric has no such rule, so every test passed                                                  | Fixed: the control is projected as the scroll view's own first child, as RN's `ScrollView.js` commits it; verified on the simulator on a scroll view and a virtual list                                                                                                                                                                    | `refresh-control.test.ts`                                                                                                                                                                                           |
| 35  | Medium          | Lists                | `<virtual-list>` declared none of the scroll view's own props (`pagingEnabled`, `snapToInterval`, `decelerationRate`, `showsHorizontalScrollIndicator`, `scrollEventThrottle`, `keyboardDismissMode` and the rest). Bound anyway they reached native raw: `decelerationRate="fast"` arrived as a string, a horizontal list did not rubber-band sideways, and a template type-checker would reject them                                                                                     | Fixed: the scroll view's props are one typed base both components extend, resolved the same way                                                                                                                                                                                                                                            | `virtual-list.test.ts`                                                                                                                                                                                              |
| 36  | Low             | Styling              | A `var()` naming a custom property nothing in scope defines, with no fallback, dropped its declaration silently (as a browser does, where the inspector shows it struck out); the browse screen's pinned headings were transparent because of a mistyped token                                                                                                                                                                                                                             | Fixed: in development the engine warns once per name                                                                                                                                                                                                                                                                                       | `css-undefined-token.test.ts`                                                                                                                                                                                       |
| 37  | High            | Rendering            | In a development build the first `console.warn` or uncaught error crashed the app natively in `-[RCTComponentViewRegistry dequeueComponentViewWithComponentHandle:tag:]`, hiding the message. LogBox renders it with React on a surface of its own, React numbers its views 2, 4, 6..., and so did the engine: native keeps one registry of views by tag for every surface, so LogBox mounted a view under a tag already in use. Two Angular surfaces would have collided the same way     | Fixed: one counter for every engine, starting at 2^30; before the fix a `console.warn` alone crashed the app on the simulator; after it, an uncaught error opens LogBox as it should (a warning after the fix is not yet re-checked)                                                                                                       | `engine-commit.test.ts`                                                                                                                                                                                             |
| 38  | Medium          | Testing              | A component using `@ng-native/components/reanimated` (`[workletStyle]`, `[workletScroll]`, `sharedValue`), or importing `react-native-reanimated` or `react-native-worklets`, could not be loaded under the documented Vitest setup: Node cannot load their React Native source                                                                                                                                                                                                            | Fixed: `ngNative()` stands in for all three. A shared value is a signal, a worklet style is applied and reapplied as its values change, a worklet scroll runs per scroll event, and every animation settles at once and runs its callback                                                                                                  | `packages/testing/src/reanimated.vitest.test.ts`                                                                                                                                                                    |
| 39  | Medium          | Testing              | A role query's `name` matched the text inside a node even when the node had an `accessibilityLabel`, which a screen reader reads instead: a button labelled "Archive Re: the release notes" holding the text "Archive" matched `{ name: 'Archive' }`, so queries found nodes by names no user hears                                                                                                                                                                                        | Fixed: the accessible name is the label, or the text only when there is no label                                                                                                                                                                                                                                                           | `testing-library.node.test.ts`                                                                                                                                                                                      |
| 40  | Low             | Testing              | A gesture built inside a child component, such as a list row's swipe, could not be reached from a test, and a composed gesture (`Gesture.Race`) kept nothing of what it was built from                                                                                                                                                                                                                                                                                                     | Fixed: `gestureOf(node, kind)` finds a view's gesture, or the one of a kind inside a composed one                                                                                                                                                                                                                                          | `gestures.vitest.test.ts`                                                                                                                                                                                           |
| 41  | Low             | Animation            | `sharedValue()` returned the framework's narrower `SharedValue` type, so passing one to Reanimated's own `cancelAnimation` failed to type-check                                                                                                                                                                                                                                                                                                                                            | Fixed: it returns Reanimated's own type                                                                                                                                                                                                                                                                                                    | Canary type-check (`inbox-row.ts`)                                                                                                                                                                                  |
| 42  | Medium          | Storage              | `update()` on a stored signal before its read came back was applied to the default and written through, replacing what was stored: a note added while the notes were being read left that one note on the disk. `set()` winning over the read is right for a preference; an update is a change to the stored value                                                                                                                                                                         | Fixed: an update made before the read is shown at once and, once the read is back, applied again to the stored value and written; a `set` still wins                                                                                                                                                                                       | `store.test.ts`                                                                                                                                                                                                     |
| 43  | Low             | Device state         | `observed()` (network, battery, brightness and the rest) let the first answer overwrite a change the listener had already reported, so a network that dropped while the app started could read as connected until the next change                                                                                                                                                                                                                                                          | Fixed: the first answer is dropped once the listener has spoken                                                                                                                                                                                                                                                                            | `device-state.test.ts`                                                                                                                                                                                              |
| 44  | Medium          | Tooling              | The documented `typecheck` (`tsc --noEmit`) does not check templates, so a binding to an input or output that does not exist compiles and does nothing: `<switch [value]>` with `(valueChange)`, React Native's names, where the component's model is `checked`, left a switch that never changed anything                                                                                                                                                                                 | Partly fixed: `ngc` with `strictTemplates` checks a whole app, which the canary now does (it found only views registered by name, now declared with `CUSTOM_ELEMENTS_SCHEMA`), and the setup guide shows how. The app template and generators still run `tsc`, since `ngc` needs `@angular/compiler-cli` in every app: left for a decision | Canary `typecheck`                                                                                                                                                                                                  |
| 45  | Low             | Documentation        | The offline guide's example stops sending at the first failure and tries again only on the next reconnect or add, so a server error while connected leaves the queue waiting; it also covers adds only, with no edits, deletes or conflicts                                                                                                                                                                                                                                                | Open: the field-notes scenario shows a backoff, a single apply per change, and conflict copies                                                                                                                                                                                                                                             | -                                                                                                                                                                                                                   |
| 46  | High            | Lists                | A `<virtual-list>` whose items were replaced while it was scrolled, as a filter replaces them, kept the old row index (or reset to the first row after the items were briefly empty), while native kept its scroll offset: the window rendered rows where the viewport was not, and a filtered or cleared list showed blank until the next drag. Seen on the simulator in the stress list                                                                                                  | Fixed: the window is worked out from the offset native is at, in the new items, and a list that now ends before that offset scrolls back to its end; verified on the simulator                                                                                                                                                             | `virtual-list.test.ts`, `virtual-list-measured.test.ts`                                                                                                                                                             |
| 47  | Low             | API                  | `<switch>`'s model is `checked`, as Signal Forms' checkbox controls require, where React Native's `Switch` takes `value` and `onValueChange`. A React Native developer's first `<switch [value]=... (valueChange)=...>` binds nothing, and without template type-checking (issue 44) nothing says so                                                                                                                                                                                       | Open. Current: `[(checked)]`. Expected by a React Native developer: `value`. Proposal: have `ngc` template checking in the template app (issue 44), which reports `Can't bind to 'value'`; an alias would break `[formField]`, which looks for `checked`. Compatibility: none, it is a tooling change                                      | -                                                                                                                                                                                                                   |
| 48  | High            | Overlays             | Nothing could draw above a sheet or a modal: they are presented above the app's root view, so a toast, banner or loading cover at the root was covered by the first sheet the user opened, and the framework had no way to reach react-native-screens' full-window overlay                                                                                                                                                                                                                 | Fixed: `<full-window-overlay>` (iOS `RNSFullWindowOverlay`, a window above the app's that lets touches through where it is empty; Android a view filling the window); verified on the simulator with a toast and a loading cover over a sheet                                                                                              | `router-overlay.test.ts`                                                                                                                                                                                            |
| 49  | High            | Navigation           | A push or presentation asked for while the router's first navigation was still running, a lazily loaded root waiting on its import, cancelled that navigation: the app opened on the pushed screen with no root beneath it and Back had nowhere to go. A notification tapped at launch, or a redirect in a root component, does exactly this. It also made a canary test fail under load, which was put down to test timing (issue 16) until the missing screen was identified as the root | Fixed: `push` and `present` wait for the first navigation to end; `reset` goes at once                                                                                                                                                                                                                                                     | `router-startup.test.ts`                                                                                                                                                                                            |
| 50  | High            | Lists                | After a jump past a header, the iOS grid showed a gap and no pinned header: a sticky row's slot went to a plain row, which kept the translate native moved the sticky row by, and the drive made over the jump's offset was not drawn until the next scroll. The fake Fabric keeps no native translate, so every test passed                                                                                                                                                               | Fixed: a sticky row hands its slot only to another, and a scroll drive tells native where the scroll is when it is made or moved; verified on the simulator in the virtual grid                                                                                                                                                            | `virtual-list.test.ts` (sticky slots; where a jump landed)                                                                                                                                                          |

## Patterns

Status values: **Not started**, **In progress**, **Implemented** (scenario built, automated tests
pass), **Verified** (also exercised on a simulator or emulator).

| Priority | Pattern                                        | Status      |
| -------- | ---------------------------------------------- | ----------- |
| P0       | 1. Infinite heterogeneous feed                 | Verified    |
| P0       | 2. Chat and messaging                          | Verified    |
| P0       | 3. Complex forms                               | Verified    |
| P0       | 4. Keyboard stress                             | Verified    |
| P0       | 5. Master-detail CRUD                          | Verified    |
| P0       | 6. Deep navigation                             | Verified    |
| P0       | 7. Tabs with independent stacks                | Verified    |
| P0       | 8. Sheets and modals                           | Verified    |
| P0       | 9. Search                                      | Verified    |
| P0       | 10. Dynamic collection mutations               | Verified    |
| P0       | 11. Complex scrolling                          | Verified    |
| P0       | 12. Gesture conflicts                          | Verified    |
| P0       | 13. Async state and races                      | Verified    |
| P0       | 14. Offline-first                              | Verified    |
| P0       | 15. Large-list performance                     | Verified    |
| P1       | Swipe actions (see 12)                         | Verified    |
| P1       | Context menus                                  | Not started |
| P1       | Drag-to-reorder                                | Not started |
| P1       | Cross-container drag and drop                  | Not started |
| P1       | Selectable photo grid                          | Not started |
| P1       | Compositional home screen (rails only, see 11) | In progress |
| P1       | Expandable hierarchy                           | Not started |
| P1       | Collapsing profile header                      | Not started |
| P1       | Skeleton transitions                           | Not started |
| P1       | Global transient overlays                      | Verified    |
| P1       | Floating controls                              | Not started |
| P1       | Full-screen image viewer                       | Not started |
| P1       | Media feed autoplay                            | Not started |
| P1       | Rich text editor                               | Not started |
| P1       | Web content                                    | Not started |
| P1       | Image and file picking                         | Not started |
| P1       | Camera workflow                                | Not started |
| P1       | Sharing                                        | Not started |
| P1       | File import and export                         | Not started |
| P1       | Maps                                           | Not started |
| P1       | Authentication                                 | Not started |
| P1       | Purchases and paywall                          | Not started |
| P2       | Architectural stress cases                     | Not started |
| -        | System integration                             | Not started |

## Test infrastructure

The canary had no automated tests of its own. It now runs Vitest with `@ng-native/testing`'s
`ngNative()` plugin, the same setup a generated app has, so each scenario is tested the way an app
developer would test it. Doing so exposed issue 1.

## 1. Infinite heterogeneous feed

**Scenario:** `src/app/feed/` (home, "Feed"). A simulated server (`feed-backend.ts`) with latency,
paging, posts arriving at the top and failures on demand; a per-visit store (`feed-store.ts`) with
paging, refresh, optimistic likes and bookmarks with rollback, edit and delete; rows
(`feed-post.ts`) of text, a photo with a server-supplied aspect ratio, or a horizontal paged
gallery inside the vertical list. Toolbar actions: "3 new" (posts arrive while reading), "5,000
posts" (fills the feed to 5,000 items), Online/Offline, and Stats (the engine's commit counters).

**Automated coverage:** `feed.test.ts` (12 tests): first page; exactly one request per page however
many scroll events reach the end; failed page, retry; optimistic like and rollback; a late failure
of a superseded like does not roll back the later one; a liked post keeps its state across
recycling and no other row picks it up; posts arriving while reading hold position and raise the
"new posts" pill; posts arriving at the top show in place; a like re-clones at most three native
nodes and creates none; delete and edit in place; a recycled gallery is put back on its own post's
page. Framework behaviour is covered in `packages/integration-tests/virtual-list-measured.test.ts`
and `height-index.test.ts`.

**On the iPhone 17 Pro simulator (debug build, iOS 26.5):** rows size themselves correctly on first
paint with no overlap; twelve and then twenty maximum-speed flings over 100 and 5,006 posts showed
no gaps, overlaps or wrong content; inserting posts while reading kept the visible post exactly in
place, and a frame-by-frame recording of the insert shows no transient jump frame; the pill
appears. Engine counters after the 5,006-post run: 460 commits, 12 over 8 ms, worst 27.5 ms (debug
build, including the page loads).

**Framework problems found:** issues 2 to 9. Issue 2 was the headline: a feed could not be built
without knowing every post's height in JavaScript. With it fixed, a naive offset table rebuilt on
every measurement cost about 1.1 ms per pass at 10,000 rows in interpreted Node (about 7 ms on the
simulator by the benchmark ratio), most of a frame during a fling through unmeasured rows; the
list now keeps its sizes in a Fenwick tree (`height-index.ts`), so a measurement costs a
logarithmic walk and the table is built only when the items change.

**Remaining limitations:**

- Holding position is a `scrollTo` after the commit. On the simulator it lands in the same frame as
  the mount, but a correction made mid-fling uses the last scroll event's offset, so a fling that is
  moving when posts arrive can hitch by up to a frame of travel. Native
  `maintainVisibleContentPosition` adjusts inside the mount; using it would need the rows to be
  direct children of the scroll content rather than of a canvas.
- Rows measured above the viewport for the first time (after `scrollToIndex` into an unmeasured
  region, then scrolling back up) are corrected a frame after native laid them out.
- A recycled row keeps its components' fields, as a reused `UITableViewCell` does; the gallery puts
  its own page back when handed a new post. This is documented, with `linkedSignal` as the reset.
- Release-build profiling and Android are still to do (see pattern 15).

## 2. Chat and messaging

**Scenario:** `src/app/chat/` (home, "Chat"). A 3,000-message history loaded 40 at a time
(`chat-backend.ts`), text and picture messages of varied height, outgoing messages that send, fail
offline and retry, Sam typing then replying, and a Live mode with a reply every 1.5 s. The
transcript is an inverted `<virtual-list>` with measured rows, per-kind recycling,
`maintainVisibleContentPosition` (`autoscrollToTopThreshold: 80`, so at the newest message replies
are followed and further up the position is held) and `keyboardDismissMode="interactive"`. A
"N new" button appears while reading history. The composer is a growing multiline field in a
`<keyboard-dock>`.

**Automated coverage:** `chat.test.ts` (8 tests): newest message at the bottom of an inverted list;
one history request per page however often the top is reached; sending keeps the composer
focused and empties it; a failed send is marked and retried; typing indicator then reply; replies
while reading hold the position and count into the jump button, which returns to the newest;
replies at the newest message are followed with no correction; the transcript keeps clear of what
the dock and keyboard cover.

**On the iPhone 17 Pro simulator:** the keyboard raises the composer with no gap; the composer grows
to three lines and, after issue 13's fix, shrinks back when sent; with the dock, an interactive drag
carries the composer on the keyboard frame by frame (recorded and inspected frame by frame), and
after release it rests above the home indicator; four live replies arriving while reading history
moved nothing on screen after issue 15's fix (identical frames), while the jump button counted 4
to 8; flings through history paged in older messages and came to rest without movement.

**Compared with iOS Messages:** the bar follows the keyboard during interactive dismissal; the
transcript's room above the bar is updated when the gesture ends rather than continuously, so the
gap between the newest message and the bar opens during the drag and closes on release.

**Remaining limitations:**

- `<keyboard-avoiding-view>` remains the documented tool for forms; it cannot follow an interactive
  dismissal (issue 14's dock is the answer for bars).
- Android keyboard behaviour (the dock's in-flow path, edge-to-edge insets) is covered by Node tests
  only so far.
- Rotation with the keyboard up has not been exercised yet (pattern 4).
- A synthetic drag ending inside the home indicator's system gesture area left the simulator's
  keyboard parked with only its suggestion bar showing; it did not reproduce with drags ending
  elsewhere and could not be checked with a real finger.

## 3. Complex forms

**Scenario:** `src/app/forms/application.ts` (home, "Application form"). Twenty-three fields in five
sections: names, email, phone, a date of birth, a country, a two-line address with town, a state
that exists only for the US, a postcode whose shape and keyboard follow the country, a username
checked with a simulated server as it is typed (debounced, cancellable), a password and its
confirmation, a newsletter toggle that reveals a frequency, a text-message toggle disabled until
there is a phone number, a list of dependants the user adds to and removes from, a multiline bio
with a count, and terms. Every text field has a keyboard type, a content type, an autofill hint and
a Next key; submit sends the user to the first field that needs fixing. The rules are one Signal
Forms schema (`application-form.ts`); `form-row.ts` shows a field's first error once touched.

**Automated coverage:** `application.test.ts` (9 tests): the field count; Next moves focus in
screen order; typing into one field re-clones fewer than 12 native nodes and creates none;
state and ZIP appear only for the US, with a number pad; the frequency appears with the newsletter
and texts enable with a phone number; removing the first dependant keeps what was typed for the
second; the username is checked once the user stops typing and a taken name is reported; a failed
submit focuses the first name and shows the errors; a field keeps its native view (and so its focus
and cursor) while the form changes around it. Framework behaviour: `form-focus.test.ts`,
`ui-form.test.ts`, `controlled-inputs.test.ts`.

**On the iPhone 17 Pro simulator:** tapping a field low on the page raises the keyboard and UIKit
scrolls it clear; Next moves through the fields and, after issue 21's fix, each lands fully above
the keyboard; the lowercase keyboard for the username and the next-arrow return key show; an
interactive drag dismisses the keyboard; the text-message toggle is greyed until a phone number is
typed; a failed submit scrolls back to the first name with the keyboard up and every error shown;
after issue 23's fix the compact date picker opens the calendar and the country menu opens and
selects; choosing the United States brings in the State picker and relabels the postcode.

**Remaining limitations:**

- SwiftUI's date picker always shows a date; an empty date field shows today (though, after
  issue 22, the form's value stays empty). An optional date is best asked for behind a button.
- `ui-picker` is iOS only: `@expo/ui` has no Compose picker of that shape, so an Android form needs
  another control for a choice.
- The first error is found from an order written in the page (issue 19).
- Android and the hardware keyboard are still to exercise (pattern 4).

## 4. Keyboard stress

**Scenario:** `src/app/keyboard/` (home, "Keyboard lab"): email, decimal, phone and URL fields one
after another, fields in a sideways carousel of cards, a long page with a field at the very bottom,
a `<keyboard-dock>` note bar, a note form presented as a form sheet with two detents, and a rotate
control. The chat (pattern 2) and the application form (pattern 3) cover the composer and a long
form.

**Automated coverage:** `keyboard-lab.test.ts` (Next moves from email to amount; the sheet saves
only with a title and hands the note back), and in the framework `form-focus.test.ts` (a field is
revealed above the keyboard, including one inside a horizontal scroll view on a vertical page),
`keyboard-dock.test.ts`, `router-keyboard-dock.test.ts` and `reparent.test.ts`.

**On the iPhone 17 Pro simulator:** each keyboard type comes up as asked (the email keyboard with
@, a decimal pad, a phone pad); focusing a page field hides the docked bar, as UIKit does for the
responder's own accessory, and after issue 26's fix the bar comes back when the field lets go;
after issue 27's fix the bar steps down while the note sheet is presented and returns after Save;
focusing the sheet's field expands the sheet to its large detent above the keyboard; the sheet
saves and hands the note back to the page; hardware-keyboard typing (idb's HID input) hides the
software keyboard and every layout followed; rotated to landscape the page, the dock and the header
reflow.

**Not yet verified:** the software keyboard while rotated (the simulator was holding a
hardware-keyboard state from the typing), Android, and iPad.

**Observed once, not reproduced:** typing into the sheet's field through idb's hardware keyboard
while the sheet was shrinking back from its large detent kept only the first character; the same
steps with the field instrumented delivered every character and the model matched.

## 5. Master-detail CRUD, 6. Deep navigation, 8. Sheets and modals

**Scenario:** `src/app/projects/` (home, "Task manager"), a small task manager and one of the
reference applications: projects, a project's tasks (a filtered `<virtual-list>`), a task, its
comments, a comment's author and their open tasks, so a stack goes as deep as the user likes. A
task is edited, or a new one written, in a form sheet with two detents; it can be ticked off
optimistically, duplicated, deleted after a destructive confirmation, and renamed "by someone else"
on the simulated server, which a refresh brings to every screen. `project-data.ts` is one store
for every screen, with optimistic writes, rollback, and local writes kept over a refresh that lands
while they are in flight. Deep links go through `withLinkParent(projectLinkParent)`.

**Automated coverage:** `projects.test.ts` (8 tests, against the real app shell and routes): six
screens deep and `popTo('/projects')` in one step; a cold-start deep link to a comment opens on
the task, the project and the list, and Back retraces them; an edit saved in the sheet shows on
every screen; the sheet refuses a swipe down while dirty and asks, keeps editing on "Keep editing"
and closes unchanged on "Discard"; delete after confirming leaves the task's screen; a refused
toggle rolls back with a notice; a change still on its way survives a refresh; a server-side rename
reaches every screen. Framework: `router-deep.test.ts`, `router-back.test.ts`,
`router-dismiss.test.ts` (dismissal prevention and a double-tapped present).

**On the iPhone 17 Pro simulator:** the project list, a project's tasks and a task render and push
natively; the editor sheet opens at its medium detent and rises to the large one for the keyboard;
with an unsaved edit a swipe down is refused, the sheet settles at its medium detent and "Discard
your changes?" appears, "Keep editing" keeps the sheet and the edit, and a second swipe then
"Discard" closes it with the task unchanged; a cold-start deep link to a comment opened on the
comment with its task, project and the list behind it, and Back walked all of them; a deep link
while running pushed its chain and "Back to all projects" took three screens off in one step.

## 7. Tabs with independent stacks

**Scenario:** the canary's existing Tabs page (library, search and profile tabs, the library with a
stack of its own).

**On the iPhone 17 Pro simulator:** an album pushed inside the library tab is still there after a
trip to the search tab and back; tapping the library tab while it is selected pops its stack to the
root natively (react-native-screens' repeated-selection effect), and the router follows, since
pushing the same album again works. Framework coverage for tab stacks is `router-back.test.ts`
(back and `popToRoot` in the tab in front, never a tab behind) and `router-tabs.test.ts`.

**Remaining limitations (patterns 5 to 8):**

- The interactive edge-swipe back gesture could not be driven: idb cannot synthesise the
  `UIScreenEdgePanGestureRecognizer` UIKit accepts. The outlet's handling of the resulting
  `dismissed` event is covered in Node.
- A navigation state is not restored after the app is terminated: history is in memory
  (`NativePlatformLocation`). An app wanting that would persist the url and the scroll positions
  itself.
- Scroll position and search text surviving a tab switch rest on the tab staying mounted, which the
  framework's tests cover; they were not measured on the device here.
- Synthetic taps on a `UISwitch` inside a scroll view registered only some of the time (a switch on
  a page without the same scroll view toggled every time). Instrumented, no JavaScript took the
  touch; this looks like the tool, not the framework, but it is not settled.

## 9. Search

**Scenario:** `src/app/search/` (home, "Search"): a music catalogue of 1,206 items searched from
the navigation bar's native search field. The library filters on every keystroke; the store is
asked through Angular's `resource()` once typing has paused for 300 ms, and a newer query cancels
the request in flight through its `AbortSignal`, so a slow answer to an older query is never shown
over a newer one; loading, "nothing found" and a failure with a retry are rows of the list;
scopes are chips under the header (react-native-screens has no scope bar); recent searches and
suggestions show while the field is focused, and taking one fills the field; a result opens on
its own screen and Back finds the query, the results and the list as they were, without asking the
store again.

**Automated coverage:** `music-search.test.ts` (7 tests): live filtering; one store request for six
keystrokes; a cancelled request whose late answer never appears; the error row and retry; a recent
search put in the field (`setText`) and searched; a scope; the round trip to a result.

**Remaining limitations:** search tokens and a native scope bar are not available
(react-native-screens has neither).

**On the iPhone 17 Pro simulator:** focusing the navigation bar's field shows the recent searches;
tapping one writes it into the native field and filters the library to 201; typing "river" filters
as each key lands and the store's answers arrive under the library's; a store result opens on its
own screen and Back returns to the field, the results and the scroll position as they were.

## 10. Dynamic collection mutations

**Scenario:** `src/app/collections/` (home, "Queue"): a 60-track queue in two sections, "Up next"
and "Later", in a keyed `<virtual-list>` with section headings as rows. Tracks are inserted three
at a time, deleted ten at a time, moved up, moved between sections, sorted, shuffled, reversed and
filtered; "Burst" applies forty random changes over two seconds. Every change goes through
`LayoutAnimation`, so rows glide to their new places.

**Automated coverage:** `playlist.test.ts` (7 tests). After every change, each visible row shows
the track its key names and no key shows twice. A row on screen before and after a sort, a shuffle
and a reverse keeps its native view. A move between sections keeps the row's view and recounts both
headings. Batch insert and delete, the burst, and filtering and clearing the filter are covered, and
each change configures exactly one layout animation.

**On the iPhone 17 Pro simulator:** a video of Shuffle and then Burst, taken frame by frame, shows
rows mid-glide during the shuffle and every settled frame with the right titles, no overlap and no
blank rows; the section counts follow the burst (12, 14, 15). No framework change was needed: the
keyed slots and parking built for the feed (issues in section 1) already keep identity through
reordering.

**Remaining limitations:** insert, delete, the section move and the filter are covered by the
tests but were not recorded on the device; drag-to-reorder is not built (there is no gesture-driven
reordering in the components package).

## 11. Complex scrolling

**Scenario:** `src/app/browse/` (home, "Browse"): a music app's browse screen. A vertical
`<virtual-list>` of 48 rows with self-sizing rows (24 genre headings and 24 shelves), each shelf
a horizontal `<virtual-list>` of 30 albums nested inside it. Each genre's heading is pinned
(`stickyIndices`) while its shelf scrolls past. Chips jump to a genre (`scrollToIndex`); a "Top"
button appears past 900 points (a `(scroll)` handler that sets a signal only when the threshold
is crossed) and scrolls back; pull to refresh reloads every shelf; an album opens on its own screen.
Each shelf keeps its sideways position in a per-screen `ShelfPositions` store keyed by shelf id,
and puts it back after the render that hands it a shelf, since its row, and the horizontal list
in it, is recycled into other genres as the page scrolls.

**Automated coverage:** `browse.test.ts` (8 tests): shelves commit as horizontal scroll views
without their own indicator; a shelf scrolled sideways shows later albums; a shelf recycled into
another row starts at that shelf's position, not the previous one's, and coming back restores the
first; the heading of the genre being scrolled past is the one pinned; the jump and "Top"; the
threshold button; a refresh keeps each shelf's position; an album and back. Removing the restore
fails two of them. Framework: `refresh-control.test.ts`, `virtual-list.test.ts` (scroll view
props), `css-undefined-token.test.ts`.

**On the iPhone 17 Pro simulator:** shelves scroll sideways natively inside the vertical list; with
Jazz, Soul and Blues scrolled sideways, a recording of four fast flings to the end and six back
(about 150 frames) shows every other shelf at its start in every frame and those three back where
they were; the jump lands on Vocal with its heading pinned and opaque; "Top" appears and returns;
pull to refresh shows the spinner and reloads (after the fix for issue 34), including when a
fling overshoots the top, and every shelf keeps its place through it; an album and Back return to
the shelves as they were.

**Framework problems found:** issues 34 to 36. Issue 34 affected every pull to refresh on iOS,
including the feed's in pattern 1, which had not been tried on the device; with the fix, pulling
the feed shows the spinner and puts newer posts on top.

**Remaining limitations:**

- A pinned heading follows the scroll a commit behind native, so in a fast fling it overlaps the
  heading pushing it off for a frame or two (documented on the list).
- A collapsing header driven by a worklet (`[workletScroll]`) is shown on a `<scroll-view>` in the
  gestures page, but not yet on a `<virtual-list>`; a horizontal pager of vertical lists is left to
  pattern 12.
- The fake Fabric does not model insertion order, which is why issue 34 passed every test; the
  regression test pins the structure instead.

## 12. Gesture conflicts

**Scenario:** `src/app/inbox/` (home, "Mail"): a mail client's list where gestures compete. Each
row is a `Gesture.Race` of a pan (swipe left to show Archive and Delete, or all the way or with a
fast flick to delete) against a press and hold (start selecting) and a tap (open, or close an open
row); the pan and the row's slide run on the UI thread and only the outcome reaches Angular through
`scheduleOnRN`. The rows are in a vertical `<virtual-list>` per folder, and the two folders are
pages of a horizontal paging `<scroll-view>`, under a native stack. The pager has a
`Gesture.Native()` which each row's pan blocks; the pan activates only leftwards and fails
rightwards or vertically, so a vertical drag scrolls the list and a rightward one pages. The
swipe's actions are also accessibility actions.

**Automated coverage:** `inbox.test.ts` (9 tests), driving each row's gestures through
`gestureOf`: a full swipe and a fast flick delete; a partial swipe opens the row on its actions and
Archive moves the message; a short one springs back; a tap closes an open row rather than opening
the message, and opens a closed one; a row recycled for another message arrives closed; press and
hold, taps to add, and Archive for the selection; the accessibility action deletes.

**On the iPhone 17 Pro simulator:** a partial swipe opens the row on Archive and Delete; a full
swipe deletes (the count drops as the row slides away); a vertical drag starting on a row scrolls
the list; a tap on an open row closes it; press and hold selects and a tap adds to the selection;
Archive moves the selection; a tap opens the message and Back returns; rows scrolled away while
open come back closed; on the Archive page a rightward drag on a row pages back to the inbox.

**What it took:** the first attempt, with no relation between the row and the pager, lost every
row swipe to the pager, which is how UIKit resolves two horizontal recognisers; the relation above
is the fix, and `blocksExternalGesture` alone left the pager unable to page at all until the pan
could fail rightwards. Both are now on the gestures page. Pressing and holding then crashed the app
natively: the row's callback read `this`, which a worklet-rewritten callback does not have (as the
gestures page says), and the error that should have shown in LogBox crashed the app instead
(issue 37).

**Framework problems found:** issues 37 to 41.

**Remaining limitations:**

- The navigation stack's edge swipe back was not exercised: `idb` cannot start a touch at the
  screen edge. The rows' pan activates only leftwards, so it cannot take that swipe.
- A leftward drag on a row always swipes the row; reaching the Archive page is a tap on its tab, as
  in apps that put swipeable rows in a pager.
- Android is not yet exercised.

## 13. Async state and races

**Scenario:** `src/app/orders/` (home, "Orders"): an order tracker. An order's screen loads it with
`resource()` keyed on the order shown and polls it every two seconds only while the screen is in
front (`SCREEN_IN_FRONT`) and the app is active (`AppState`); "Next order" moves to another order on
the same screen; "Cancel order" waits for the server once however often it is tapped. The
simulated server answers with what was true when it was asked, after a delay that can be made
longer for one order, so answers arrive out of order and a slow answer is stale.

**Automated coverage:** `orders.test.ts` (9 tests): the next order's screen never shows the late
answer for the previous one, whose request is aborted; polling moves the order on; polling stops
while another screen is pushed over it and while the app is in the background, and starts again
on return; leaving the screen aborts its request and polls no more; a server slower than the poll
is still heard; a cancel tapped twice is sent once, shows at once from its own answer, and a poll
that left before it cannot put the old status back (setting the resource aborts it); a failed
load shows an error and retries. Replacing the polling condition with `true` fails the two pausing
tests, and dropping the resource `set()` after cancelling fails the cancel test.

**Framework problems found:** none new. The pausing uses `SCREEN_IN_FRONT` from pattern 4, without
which a covered screen, which the native stack keeps alive, would keep polling. Issue 43 was
found here, in the way device values are first read.

**On the iPhone 17 Pro simulator (Release build):** an order's status moves on as it is polled;
ten seconds with the app in the background left an order at version 1, where polling would have
moved it on; a double-tapped cancel was sent once.

**Remaining limitations:** out-of-order answers are exercised by the tests only, since the
simulated server's delays are what make them.

## 14. Offline-first

**Scenario:** `src/app/offline/` (home, "Field notes"): notes that work with no connection.
`FieldNotes` keeps the notes and an outbox of changes in `Storage` signals, so both survive the
app closing; changes land at once and are queued, an edit to a change still waiting folds into it,
and deleting a note that was never sent drops it from the outbox. The outbox is sent in order
whenever `Network` says the server can be reached and an in-app airplane switch is off, with a
growing wait after each failure and an immediate try on reconnecting. Each change carries an id
the server applies once, so a change whose reply was lost is sent again safely. A change made on
a copy someone else has since changed keeps both: the other device's text as the note, and this
device's as a conflict copy that is sent in turn. Editing waits for the stored notes to be read.

**Automated coverage:** `offline-notes.test.ts` (7 tests): offline changes show at once and wait,
with the edit folded in and the unsent delete dropped; everything waiting is sent on reconnecting;
notes and the outbox survive the app being closed and opened again over the same storage, and
are sent then; a server error is retried after a wait and applied once; a lost reply is resent
and applied once; a conflict keeps both copies on the device and the server; the airplane switch
holds and releases the outbox. Framework: `store.test.ts` (issue 42), `device-state.test.ts`
(issue 43).

**Framework problems found:** issues 42 to 45. Issue 42 was the serious one: the natural way to
add to a stored list, `notes.update((list) => [...list, note])`, lost every stored note when it
ran before the read came back, which on a cold start it can.

**On the iPhone 17 Pro simulator (Release build):** with the in-app switch on, a note added shows
"Waiting to send" and "Offline, 1 change waiting"; after killing and relaunching the app the note
came back from AsyncStorage with its outbox, and was sent and marked saved.

**Remaining limitations:** the simulator's own network was not switched off, so expo-network's
change events were not exercised on the device; the in-app switch stands in for them. `Database` (expo-sqlite) is not in the canary, so the guide's SQLite version
is not exercised.

## 15. Large-list performance

**Scenario:** `src/app/stress/` (home, "Stress list"): 10,000 rows that size themselves (one to four
lines of note), each with a remote thumbnail (twenty distinct images, so a fling measures rendering
rather than downloads), twenty rows repriced every 100 ms while "Live prices" is on, filtered on
every keystroke, and a readout for a measured run: JavaScript frames and late ones (a
`requestAnimationFrame` gap over 25 ms), commits and those over 8 ms, the worst commit and the
worst render pass, and native nodes created and cloned. Time to first render is shown on opening.

**Automated coverage:** `stress-list.test.ts` (3 tests): a window of the ten thousand renders and
reports its first render; filtering; a measured run with live prices reports its counts. The
screens bench (`pnpm bench:screens feed` in `packages/integration-tests`) flings a 5,000-row feed
of two kinds of self-sizing row at 60 points a frame, reporting each row's layout as native would.

**Bench (interpreted Node, roughly a seventh of the simulator's speed):** per frame, scroll and the
layouts it causes together, median 0.35 ms, p95 0.98 ms, worst 1.8 ms; no native node created
during the fling (every row reuses a slot of its own kind). The existing fixed-height benches:
0.31 ms (rows by index), 0.67 ms (rich rows by index, 5,328 nodes created), 0.39 ms (rich rows by
slot, 64 created).

**Release build on the iPhone 17 Pro simulator:** first render of the 10,000-row screen 28.8 to
30.6 ms. A measured run of 28.6 s with live prices on throughout, twelve maximum-speed flings down
and eight back, then typing a filter: 1,717 JavaScript frames, none late (worst gap 21 ms); 383
commits, none over 8 ms, worst commit 5.9 ms, worst render pass 9 ms; 36 native nodes created and
8,883 cloned. The app process peaked at 49% of one core during the flings (sampled once a second
with `ps`) and its footprint rose from 84 MB to 105 MB, mostly the decoded thumbnails. The
frame-by-frame check of the feed from pattern 1 also holds: no gaps or wrong rows in fling
recordings.

**Framework problems found:** issue 46, found by filtering after a fling; issue 47 by the stress
of writing a new screen without template checking.

**Remaining limitations:**

- UI-thread frame drops were not measured: the counter is the JavaScript thread's. Instruments
  (Core Animation FPS, hitches) would be the tool, and was not run.
- No comparison against a native `UITableView` or a React Native `FlatList` of the same screen was
  run for this list; the canary's renderer bench compares Angular Native and React on its own
  screen.
- Android is not measured.

## P1: Global transient overlays

**Scenario:** `src/app/overlays/` (home, "Overlays"): a root `Toasts` service with one toast and
one loading cover, drawn by `<x-toast-host>` last in the app's root template inside
`<full-window-overlay>`, and raised from a screen and from a sheet presented over it.

**Automated coverage:** `overlays.test.ts` (2 tests): a toast raised from the sheet is drawn in
the overlay and not in the navigation stack; the loading cover shows, is announced as loading, and
goes, followed by a toast. Framework: `router-overlay.test.ts` (3 tests).

**On the iPhone 17 Pro simulator (Release build):** a toast raised in the sheet shows above it; the
loading cover darkens the whole window, sheet and status bar included, and swallows a tap made
while it shows; with nothing shown, taps reach the sheet beneath.

**Framework problems found:** issue 48.

**Remaining limitations:** the toast does not move up for the keyboard; a snackbar with an action
and a queue of several toasts are not built; Android is not exercised.

## P1: Full-screen image viewer

**Scenario:** `src/app/viewer/` (home, "Photo viewer"): a grid of twelve photos, each opening a
viewer presented as a page sheet. The viewer is a horizontal paging scroll view of photos, each a
zooming scroll view of its own (`minimumZoomScale` 1, `maximumZoomScale` 4, `centerContent`), so a
pinch and a pan are native; a double tap (`Gesture.Tap().numberOfTaps(2)`) zooms in on where it
landed with `zoomToRect`, or back out; paging away from a zoomed photo zooms it back out; the pages
are sized from the window, so a rotation keeps the photo shown; swiping down dismisses the sheet.

**Automated coverage:** `photo-viewer.test.ts` (6 tests): opens on the photo tapped, as a page
sheet; a double tap zooms in where it landed and a second zooms out; paging moves the counter and
zooms out the photo left; a pinch the page reports counts as zoomed; a rotation keeps the photo
shown and fills the new window; Done closes it.

**On the iPhone 17 Pro simulator (Release build):** opens on the photo tapped; a double tap zooms in
and a second zooms out; a swipe pages to the next photo; a swipe down closes the viewer.

**Remaining limitations:** a pinch was not driven on the device (`idb ui pinch` exists and was not
tried); the interactive dismissal is the page sheet's, not a drag that follows the finger and
fades the backdrop as Photos does; rotation was tested with a stand-in window only.

## P1: Authentication

**Scenario:** `src/app/auth/` (home, "Account"): a `Session` service, a `signedIn` guard that sends
anyone else to sign in and remembers where they were going, a sign-in form (Signal Forms, email and
password with the content types and autocomplete iOS uses), a one-time-code step, and on success a
`reset` to the screen asked for. Three wrong passwords lock the form. The session ends by signing
out or by expiring, from any screen, including a settings sheet, with a `reset` to sign-in.

**Automated coverage:** `auth.test.ts` (5 tests): a guarded screen asks to sign in, then replaces
sign-in with itself and leaves nothing to go back to; wrong passwords and the lock; a wrong code;
expiry while a sheet is up leaves only sign-in, with the notice; signing out, and the guarded
screens asking again.

**On the iPhone 17 Pro simulator (Release build):** the guard shows sign-in; the password step
offers iOS's Save Password prompt, so the content types reach native; the code step lands on the
account screen with no back button; expiring the session from inside the settings sheet dismisses
the sheet and leaves only sign-in, with the notice.

**Framework problems found:** issue 49, found while tracking down a flaky test rather than by this
scenario, but the same shape: navigation at startup.

**Remaining limitations:** signup and forgotten password are not built (they are forms like the
ones in pattern 3); the session is not stored, so it does not survive a restart; biometric unlock
(`Biometrics` in `@ng-native/expo`) is not wired in.

## System integration (assessed from the architecture, not built)

Nothing here was built or run; this is what the framework's structure allows, from its sources and
documentation.

- **Custom URL schemes:** `DeepLinks` and `withLinkParent`; exercised on the simulator throughout
  this work (`canary://...`), cold and warm, including a link five screens deep (issues 30, 31).
- **Universal links:** the same `DeepLinks` path once the app has the associated-domains
  entitlement, which is Expo configuration. Not exercised.
- **Push notification navigation:** `Notifications` reads the response that launched the app as
  well as later ones. Navigating from it at launch, before the first screen has loaded, lost the
  root screen until issue 49 was fixed. Not exercised with a real notification.
- **Widgets, interactive widgets, Live Activities, Control Center controls, share and notification
  extensions:** separate native targets (WidgetKit, ActivityKit, extensions), outside the app's
  JavaScript runtime, added through Expo config plugins or native projects. The framework neither
  helps nor stands in the way. Gap: sharing data with them needs an App Group container, and
  no store over one is provided; an app can wrap one in a `NativeStore` of its own and hand it to
  `new Store(...)`, with a native module to reach the container.
- **App Intents, Siri, Shortcuts, Spotlight:** an intent that opens the app arrives as a URL or a
  user activity, and a URL reaches `DeepLinks`. An intent that should run app logic without opening
  the app needs native code or a headless JavaScript task; the framework has no headless story for
  Angular (a task can run plain functions, not components or injected services).
- **Background tasks and background transfers:** Expo's task modules define tasks as plain
  functions registered at startup, which the framework does not prevent; a task cannot use the
  app's injector, so shared logic has to live in plain modules. Not exercised.

Recommended next steps: an App Group store beside `Storage`, and a documented pattern, with a test,
for running app logic in a headless task.
