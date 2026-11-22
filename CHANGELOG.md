## 0.26.0 (2026-11-22)

### 🚀 Features

- `vitest --project ios` and `vitest --project android` start Metro, build the app's development build, boot the simulator or emulator and launch the app themselves, as `--project macos` starts the desktop host, so device tests run with one command locally and on CI. ([#1715](https://github.com/ng-native/ng-native/pull/1715))

  The build is made the first time and kept in `node_modules/.cache/ng-native-device-tests` by the project's native fingerprint (`@expo/fingerprint`), so later runs take seconds and a CI job can cache it. `deviceTests({ device })` names the simulator (`iPhone 17 Pro`) or emulator (its AVD name), booted when it is not running; without it a run uses one that is running, or the newest iPhone or first emulator. Each launch starts the app with no data of an earlier one: reinstalled on a simulator, its data cleared on an emulator.

  Before, an iOS or Android project waited for an app opened by hand, loading from a Metro started by hand. `deviceTests({ launch: false })` keeps that. A macOS run also starts its own Metro now, on a free port, instead of loading from the one on `RCT_METRO_PORT` or 8081; `deviceTests({ metroPort })` points a launched app at a Metro of your own.

  An app the pool launches, on any OS, has ten minutes to connect by default instead of 60 seconds, since the desktop host builds itself on its first run; one that exits still fails the run at once, and stopping Vitest during a build stops the build.

  A device project gives each test 30 seconds unless its config sets `testTimeout`, since a first render on a simulator just booted, as on CI, can take several, and a run prints what it is doing (booting, building, installing, waiting for Metro) with how long each took.

  A project with no `ios` or `android` folder is prebuilt for the build, with its `app.json`, `app.config.*` and `package.json` put back afterwards, so a test run leaves no change in the project's sources beyond the generated folder.


### 🩹 Fixes

- A desktop host built from source builds in one directory at a time: a second `ng-native-desktop` command that builds the same host waits for the first, printing that it is waiting, instead of building beside it and leaving its build log corrupt, which made the next build recompile hundreds of objects with nothing changed. ([#1719](https://github.com/ng-native/ng-native/pull/1719))
- CSS animations played natively that end in the same frame now share one commit, rather than each committing the whole tree as it ends. ([#1717](https://github.com/ng-native/ng-native/pull/1717), [#1714](https://github.com/ng-native/ng-native/issues/1714))

  Where the platform drives the engine, an animation's end marks its view and the next frame commits it, so a list of labels fading in together costs one commit as they finish. An engine with no host to schedule a frame still commits as each one ends.

- `<virtual-list>` and `<section-list>` now render ahead of a fast scroll, and take a `velocityLead` input that sets how far. ([#1669](https://github.com/ng-native/ng-native/pull/1669))

  While the list scrolls, the window reaches past the viewport in the direction of the scroll by about the distance the list covers in `velocityLead` milliseconds (500 by default) at its recent speed, in steps of a quarter viewport and up to three viewports, so a fling lands on rows already drawn. The reach drops back as the scroll slows, and 200ms after the last scroll event. The first scroll event after a `scrollToIndex`, `scrollToOffset` or `scrollToEnd` call does not count toward the speed. Later events do, including those of an animated scroll. More rows are rendered during a fast scroll than before. `velocityLead` of 0 keeps the previous window.

- Where native moves sticky rows, a jump with `scrollToIndex` past a sticky row now pins the row it lands under at once, rather than at the next scroll, and leaves no gap where a plain row took the slot of a sticky one: a sticky row's slot now goes only to another sticky row. ([#1652](https://github.com/ng-native/ng-native/pull/1652))
- `<virtual-list>` and `<section-list>` no longer mark the screen holding them for change detection on every scroll event. ([#1671](https://github.com/ng-native/ng-native/pull/1671))

  The list used to listen for scroll events as an Angular host listener, which marks the list and every view above it for checking on each event, so a fling checked the whole screen every frame. Now a scroll event checks only what its signals change: the window when rows come and go, and sticky rows while one is pinned. A `(scroll)` or `(endReached)` handler bound in a template still runs and still updates its view. A plain field written outside Angular's events that only showed up because the list scrolled now waits for the next change detection, as it does anywhere else in a zoneless app.

- `<virtual-list>` lays items out in columns with `[virtualListNumColumns]`, as `FlatList`'s `numColumns` does, spaced by `[virtualListColumnGap]`. ([#1653](https://github.com/ng-native/ng-native/pull/1653))

  A line is as tall as its tallest item, a sticky row takes a line to itself, and the first column is on the right in a right-to-left layout. Columns apply to a vertical list with `itemHeight`.

- Device tests can compare what the app drew with a reference screenshot: `await expect(node).toMatchScreenshot('name')` captures a node, a region of the window or `screen` (the whole window) on an iOS simulator or an Android emulator (Android 8 or later), and compares it with `__screenshots__/<test file>/<name>-<platform>.png` beside the test. A missing reference is recorded, except on CI; `-u` records them all again. A pixel fails the match when a channel moves by more than one step of 255, the most an iOS simulator varies between runs, unless `comparatorOptions` (`channelTolerance`, where 0 is exact, `threshold`, `allowedMismatchedPixels`, `allowedMismatchedPixelRatio`) say otherwise, in `deviceTests({ screenshots })` for the project or in the call. ([#1715](https://github.com/ng-native/ng-native/pull/1715))

  The capture comes from a native module in `@ng-native/testing`: the development build a test run makes has it, and a development build made by hand before the upgrade needs rebuilding once. Expo Go and macOS do not have it, and a screenshot there fails with a message saying so.

- An app's engine in `@ng-native/platform` is let go when the app is destroyed, as when Android recreates the activity after the font or display size changes, rather than kept for the rest of the app's life. ([#1706](https://github.com/ng-native/ng-native/pull/1706))

  The old engine stayed joined to the runtime's shared event dispatcher, so it kept itself, its root and every view it had committed, and it was handed the events that have no target in place of the app that replaced it. It now leaves the dispatcher, cancels the frame and the timers it had asked for, and stops the animations and transitions native was playing for it, whose end callbacks native would otherwise go on holding, along with what native painted for it and the scroll-driven animations (`animation-timeline: scroll()`) it drove.

  A closed window's engine does the same.

  The dispatcher in `@ng-native/fabric` no longer keeps the first engine that joined it once that engine has left.

- `releaseOnDestroy` in `@ng-native/components` and `@ng-native/components/reanimated` wraps a function a worklet calls back, such as a `scheduleOnRN` target, so that native code keeping the worklet does not keep the component too. ([#1707](https://github.com/ng-native/ng-native/pull/1707))

  react-native-worklets keeps such a function from native code after the gesture is detached, so one that reached its component kept the component and its view tree for the rest of the app's life. The function `releaseOnDestroy` returns calls the one it was given until the component, or the `DestroyRef` passed to it, is destroyed, and then does nothing.

  The stand-in document that `mount` in `@ng-native/platform` gives Angular no longer keeps the last app reachable after it is destroyed, so a component that a `render()` in `@ng-native/testing` has unmounted can be garbage-collected, with its engine and fake Fabric.

- `@ng-native/device` exports `OS_NAMES`, the OSes Angular Native runs on, and `OsName`, the type of one of them. The `OS` token, `ShortcutOs`, `TestOs` in `@ng-native/testing` and `ModulePlatform` in `@ng-native/expo` are that type, so the next OS is added in one place. ([#1556](https://github.com/ng-native/ng-native/pull/1556))

  An OS the host reports that is not in `OS_NAMES` is now an error that names it, where `OS` and the keyboard shortcuts used to read it as iOS. In a test, an `NG_NATIVE_TEST_OS` or a Vitest preset `os` outside the list fails the same way rather than testing as iOS. iOS, Android, macOS and the web host answer as before.

- `nx g @ng-native/nx:tailwind` can now wrap an app's Metro config in `withTailwind` when its one `module.exports` spans more than one line, as a newly generated app's does once it is formatted. Before, it warned it could not update `metro.config.js` and still added the `app.tailwind.js` import to `src/main.ts`, so the app's typecheck and bundle failed on a sheet nothing built. Where it cannot wrap the config, it now leaves `src/main.ts` as it is too, and its warning names both steps to take by hand. A config that exports a `const` already wrapped in `withTailwind` is left as it is, and one with a `withTailwind` of its own is left to be wrapped by hand. ([#1726](https://github.com/ng-native/ng-native/pull/1726))
- The macOS desktop host no longer requests a react-native-svg `<image>` again on each redraw after its request failed or its data was not an image, so a broken image stays blank while the app runs, as in a browser. ([#1691](https://github.com/ng-native/ng-native/pull/1691))

  An `<image>` with a path that the file boundary refused is still checked on each draw.

- The macOS desktop host draws an `<image>` with a `tintColor` as its picture's shape filled with that colour, as React Native iOS does, where it drew the picture unchanged. ([#1695](https://github.com/ng-native/ng-native/pull/1695))
- The macOS desktop host tiles an image with `resizeMode: 'repeat'` from the top left corner at its pixel size divided by its source's `scale`, as React Native iOS does, where it stretched the image to fill its box. ([#1692](https://github.com/ng-native/ng-native/pull/1692))
- The macOS desktop host draws a view's `filter` (every function but `drop-shadow()`, applied in order over the view and its children) and `mix-blend-mode`, which it drew as nothing, so the macOS build keeps those filter functions where it dropped all but `brightness()` and `opacity()` with a warning. ([#1697](https://github.com/ng-native/ng-native/pull/1697))

  A `filter` that holds a `drop-shadow()`, in a macOS build or in a rule that can apply on macOS, is still dropped whole with a warning, now naming macOS: use `box-shadow`, or scope the rule to Android with a `.platform-android` ancestor.

- Device tests can check one visual thing at a time and turn animations off: `toHaveStyle`, `toHaveSize`, `toBeWithin` and `toHaveColorAt` read what the engine committed, where native laid a node out and what it drew at a point, and `setAnimations(false)` (or `deviceTests({ animations: false })`) stops the engine's CSS transitions and `@keyframes`, UIKit's view animations on iOS and Android's animators. ([#1718](https://github.com/ng-native/ng-native/pull/1718))

  `toHaveStyle` compares colours as hex, `rgb()` or `rgba()` with numbers, `hsl()`, `hwb()`, a name or the integer native is given, lengths in points, and a shorthand the engine commits as its parts (`borderRadius`, `borderWidth`, `borderColor`, `padding`, `margin`) by each part. `toHaveColorAt` samples a capture of the window on iOS, or Android 8 (API 26) or later, within one step of 255 on each channel by default, and `colorsAt` gives the colours themselves.

  With animations off, from the next change on, a transition lands on its new value, a finite animation ends within two frames on its last frame where its fill mode keeps it, and one that repeats forever is not played, while one already running ends the next time its node is restyled; `Engine` takes the same as a `motion: 'off'` option and `setMotion()`. On Android the OS can refuse the animator scale, and `setAnimations` then resolves `false`.

- An app a device run relaunched, after the one before it exited or stopped answering, is now sent Vitest's start, with its config, before any file, where before its first file failed with `Cannot read property 'viteModuleRunner' of undefined`. ([#1721](https://github.com/ng-native/ng-native/pull/1721))
- When an app a device run launched never connects to the pool, because it exits first or the connection times out, the failure now includes the last lines of the Metro the run started, and on an iOS simulator the last lines the app printed too, so it says where the app stopped. ([#1720](https://github.com/ng-native/ng-native/pull/1720))
- New phone apps from `@ng-native/template`, `nx g @ng-native/nx:application` and `ng generate @ng-native/schematics:application` (without `--desktopOnly`) come set up for tests inside the running app on iOS and Android: `npx vitest --project ios` or `--project android` runs `src/app/app.device.ts` on a simulator or emulator with nothing to add. ([#1716](https://github.com/ng-native/ng-native/pull/1716))

  Their `metro.config.js` wraps the config in `withDeviceTests`, `src/main.ts` starts the test host when Metro is started for the tests, following rotation, the theme and reduced motion as the app does, and `vitest.config.mts` has `node`, `ios` and `android` projects (a desktop-only app keeps its `macos` ones), with `npm test` and the generated `test` target running `node` alone. Their `.gitignore` ignores the `-actual.png` and `-diff.png` a failed screenshot comparison writes under `__screenshots__`. `startDeviceTests({ mount })` also takes a function that returns the mount options, which it calls each time it mounts, so the sizes and theme the options read are the device's at that mount, as after Android recreates the activity. An existing app can add the same as https://ng-native.com/packages/testing/in-app-tests#set-up describes.

  `nx g @ng-native/nx:tailwind` and `nx g @ng-native/nx:nativescript` add the Tailwind sheet and `provideNativeScript()` to the object an app's `mountOptions()` returns, which the template's `src/main.ts` now mounts with as the desktop template's already did, where before they asked for it to be added by hand. `nx g @ng-native/nx:nativescript` now reads `src/main.ts` with TypeScript's parser (5.9 or 6, as `@ng-native/migrate` does), so it adds to the `providers` list the options object itself has, not one in a comment, a string or a nested object, whatever comments, strings or regular expressions the options hold.

- The desktop host's core, Hermes and runtime build on Linux, with no backend yet: `native/scripts/build.sh --backend none --runtime` builds Hermes over a pinned static ICU 77.1 and the runtime half, and runs their tests with `--test`. ([#1555](https://github.com/ng-native/ng-native/pull/1555))

  On macOS, a host built from source builds Hermes again once after the upgrade, since the record of what a cached Hermes was built for has moved to a new file.

### ❤️ Thank You

- Ashley Hunter
- Dor Peled

## 0.25.0 (2026-11-19)

### 🩹 Fixes

- `@ng-native/platform` and `@ng-native/web` work with Angular 22.3, which removed the internal `ɵsetLocaleId` they called at mount. On 22.3 a web app's Vite build failed with `"ɵsetLocaleId" is not exported by @angular/core`, and a native app threw when it mounted. On 22.3 a template's plurals read `LOCALE_ID` from the app's injector, so an app's `LOCALE_ID` still picks the plural rules there, as it does on 22.2 and earlier. ([#1587](https://github.com/ng-native/ng-native/pull/1587))
- On Android, a `<switch>` on screen now follows a change of scheme, by the system's dark mode or by `ColorScheme.set` on Android 12 and later, once the app is rebuilt. ([#1578](https://github.com/ng-native/ng-native/pull/1578), [#1568](https://github.com/ng-native/ng-native/issues/1568))

  React Native's switch takes AppCompat's thumb and track tints from the theme once, when it is created, and an activity that handles `uiMode` itself, as Expo's does, keeps its views across the change, so the off track could vanish against the new background. The `NgNativeColorScheme` module now tints each AppCompat switch in the activity again after each configuration change it takes in place. A `thumbColor` or `trackColor` set on the switch is kept. A switch whose theme gives it drawables other than AppCompat's is left alone, as AppCompat never tinted those. Expo Go keeps the old behaviour.

- With `@ng-native/web-compat`, a root service that listens on the window no longer throws as the last app that asked for the package is destroyed. The package's own teardown runs before the destroy hooks of the services the app made after it, and it took the window's `addEventListener`, `removeEventListener` and `dispatchEvent` away, so a service that listened with `fromEvent(window, 'resize')` and `toSignal` or `takeUntilDestroyed`, as Taiga UI's root does, failed to take its listener off, and rxjs threw an `UnsubscriptionError` from `ApplicationRef.destroy()` and `@ng-native/testing`'s `cleanup()`. ([#1421](https://github.com/ng-native/ng-native/pull/1421))

  Those three now stay on the window once the last app has gone, where `withWebCompat` gave the window no stand-ins of its own (in a test, or a Metro config without it); where it did, the stand-ins are put back as before. Every listener added to the window while an app was up still goes with the last app, so taking one off afterwards finds nothing left to remove, and a listener added after the last app has gone is kept for the next app, as the stand-ins keep one. The rest of what the package adds is still taken away.

- With `@ng-native/web-compat`, a stylesheet's selector of the `style` attribute, such as `[style]`, `[style*=top]` or `:not([style*=top])`, now matches the `style` attribute's text as a script writes it through `element.style` (a property by name, `setProperty`, `removeProperty` or `cssText`) or with `setAttribute`, and matches again each time it changes, as Chrome does. It matched none of that text before, so a library's rule such as Taiga UI's `:host:not([style*=top])` kept its element hidden after the library positioned it. ([#1419](https://github.com/ng-native/ng-native/pull/1419))

  An empty `style` attribute, which `cssText = ''` or removing a script's last property leaves, still matches `[style]`, and `removeAttribute('style')` stops it matching where a template sets no style on the element, as in Chrome. A copy made with `cloneNode` matches by the attribute it was copied with. Once a script takes away every declaration it wrote, the view's `style` prop is removed rather than left as an empty object. A style a template sets, in a `style` attribute or with a binding, is still not part of the attribute's text.

- `@ng-native/web-compat` has `provideEventPlugins()`, from `@ng-native/web-compat/event-plugins`, which runs Angular's event-manager plugins (`EVENT_MANAGER_PLUGINS`) for an app's listeners. A listener whose name a plugin claims is attached by that plugin, as it is in a browser, so Taiga UI's tabs, which listen for `tui-tab-activate.stop` through `@taiga-ui/event-plugins`, now switch when a tab is pressed. Before, such a listener heard nothing. A plugin that claims every name, as Angular's own DOM plugin does, is left to the renderer. `@angular/platform-browser` is an optional peer dependency of the package, needed only for this entry point. ([#1429](https://github.com/ng-native/ng-native/pull/1429))
- With `@ng-native/web-compat`, Angular's DOM adapter (`getDOM()`) is now set once an app that asked for the package is up, where the app has set none of its own, so Angular's `Meta` adds, finds, updates and removes its `<meta>` tags in the document's head, and `document.title` reads and writes the first `<title>`, which Angular's `Title` sets. ([#1422](https://github.com/ng-native/ng-native/pull/1422))

  `getDOM()` was null under Angular Native, so `Meta.addTag()`, `updateTag()` for a tag not yet there and `removeTag()` threw, as did code that calls them, such as Taiga UI's `provideTaiga()` for its font scaling, and `Title.setTitle()` wrote a property no `<title>` element held. The adapter creates elements and documents, dispatches events and adds and removes listeners, removes an element, finds the window, the document and the body, and answers the user agent and the path of a `<base href>` in the head. It finds no shadow root and no cookie. Angular takes a DOM adapter once and never gives it back, so this one stays once the last app has gone; it keeps nothing of an app, reading the global `document`, which is the newest app's, each time it is asked. An adapter the app has already set is left alone.

- With `@ng-native/web-compat`, the document's `getElementsByTagName`, `getElementsByTagNameNS`, `getElementsByClassName`, `getElementsByName` and `getElementById` now find `<html>` and `<head>`, as Chrome does, so `document.getElementsByTagName('head')[0]` is `document.head` and `getElementsByClassName('dark')` finds a theme class on `<html>`. ([#1420](https://github.com/ng-native/ng-native/pull/1420))

  They answered no `<html>` and no `<head>` before, which made code such as Taiga UI's `provideTaiga()` and Angular's `Meta` throw when it read `getElementsByTagName('head')[0]`. The elements come in the order `querySelectorAll` gives them, so `getElementsByTagName('*')` and `querySelectorAll('*')` hold the same elements in the same order: `<html>`, then the head and what it holds, then the page. A head a script has put in the page comes where it is in the page instead. The lists stay live: a class added to or taken off `<html>` or `<head>` changes what they hold. An element's own `getElementsBy*` still finds only what is under it.

- `<virtual-list>` and `<section-list>` now render ahead of the scroll while the JS thread is idle, so a fast fling lands on rows already drawn, and take a `windowSize` input that caps how far. ([#1639](https://github.com/ng-native/ng-native/pull/1639), [#1627](https://github.com/ng-native/ng-native/issues/1627))

  The window used to be the visible rows plus `overscan` rows on each side, so a fling outran it and showed blank space. Now, once window changes stop for 50ms, the window grows a viewport at a time, ahead of the scroll direction first, up to `windowSize` viewports in all (5 by default; `FlatList` defaults to 21): about two thirds of the extra viewports ahead of the scroll and the rest behind. When the scroll turns, what was ahead is cut back to what is kept behind. `scrollToIndex`, `scrollToOffset` and `scrollToEnd` to a row outside the window start the fill over, so a jump renders one viewport, not the whole filled window, in one pass. More rows are rendered than before, and each window change costs more change detection once the window is full. `windowSize` of 1 keeps the old window.

- `withAngularNative` takes an experimental `compilation: 'ngp'`, which compiles components with Angular's hybrid compiler (a Rust analysis pass in front of Angular's own template compiler) in place of oxc, as Analog's `compilation: 'ngp'` does. ([#1570](https://github.com/ng-native/ng-native/pull/1570))

  It needs Angular 22.2 or later. `@ng-native/metro` ships a build of `@angular/ngp` until Angular publishes it, and an app's own copy wins. Templates and the app's TypeScript are type-checked with TypeScript 7's language server as they compile, which needs `@typescript/native-preview`; `disableTypeChecking: true` turns it off, and `tsconfig` names the file to analyze. The default stays `'oxc'`, and nothing changes for an app that does not opt in.

- On macOS and iPadOS, where the app's menu bar is drawn, a `<menu-group>` named as a default menu (such as `label="File"`) with no `menuRole`, which is drawn as a second menu of that name, now logs a warning saying so, and that `menuRole="file"` adds its items to the File menu instead. ([#1613](https://github.com/ng-native/ng-native/pull/1613))
- `SegmentedControl` and `DateTimePicker` from `@ng-native/expo` register their element the first time one is made, so an app that imports one no longer needs a `registerNativeViews('segmented-control')` or `registerNativeViews('date-time-picker')` call, without which the control drew nothing and nothing warned. On iOS the library still has to be installed; on macOS the desktop host draws both with no library installed. ([#1609](https://github.com/ng-native/ng-native/pull/1609))
- On macOS `text-decoration-line: line-through` (and `textDecorationLine: 'line-through'` or `'underline line-through'`) now draws a line through the text, which it never did, and an underline or a line through takes `text-decoration-color` and a `double`, `dotted` or `dashed` `text-decoration-style`. ([#1611](https://github.com/ng-native/ng-native/pull/1611))
- On macOS `align-items: baseline` (and `alignItems: 'baseline'`) now lines text up by its first baseline, as on iOS, rather than by its top, and `<text>` sends `(textLayout)` with its lines, each where it is drawn, where it sent nothing before. ([#1607](https://github.com/ng-native/ng-native/pull/1607))
- On macOS a vertical scroll over a horizontal scroll view, such as an image pager in a feed, now scrolls the view around it instead of stopping there, and an inverted list (`<virtual-list inverted>`) scrolls the way the user's scroll direction setting says rather than the reverse. Scroll views on macOS now honour `pagingEnabled`, report a trackpad drag with `(scrollBeginDrag)` and `(scrollEndDrag)` and its momentum or a page settling with `(momentumScrollBegin)` and `(momentumScrollEnd)`, and animate `scrollTo` and `scrollToEnd` when asked to. ([#1602](https://github.com/ng-native/ng-native/pull/1602))
- On macOS a screen pushed over the screen that holds a window's `<split-view>` or tabs (such as a note opened from a tabbed app's list onto the app's own stack) now shows, filling the window, and the sidebar comes back as the screen below shows again. Before, the header changed and the window went on showing the screen below. ([#1614](https://github.com/ng-native/ng-native/pull/1614))
- On macOS the desktop host links React Native's own prebuilt Hermes, the `hermesvm.framework` and `hermesc` its iOS apps use, downloaded from Maven Central and checked against the SHA-1 published there, instead of building Hermes from source, so a build from source no longer compiles Hermes. ([#1581](https://github.com/ng-native/ng-native/pull/1581))

  The dev build links the Hermes with the debugger and a Release build the one without it. `ng-native-desktop package` puts `hermesvm.framework` in the app's `Contents/Frameworks` and signs it before the app with the same identity. The ad hoc signed prebuilt hosts, and a `--skip-notarize` dmg signed ad hoc (no `NGN_SIGN_IDENTITY`), have no Team ID for the hardened runtime's library validation to check the framework against, so they are signed with `com.apple.security.cs.disable-library-validation`. The prebuilt hosts carry the framework beside `ngn-macos`. Linux keeps building Hermes from source.

- `ng-native-desktop package` packages an app whose bundle has no assets: `hermesc` now compiles the bytecode bundle in the staging folder, which is then copied into the app's `Contents/Resources`. Before, it wrote into `Resources`, which nothing had created for such an app, and stopped with "hermesc could not compile the bundle to Hermes bytecode". ([#1580](https://github.com/ng-native/ng-native/pull/1580))
- On macOS a `<modal>` opened after launch beside a window's `<split-view>`, rather than inside one of its panes (an app-wide sheet next to a sidebar layout), now opens over the window. It never opened, and nothing said why. ([#1612](https://github.com/ng-native/ng-native/pull/1612))
- On macOS the gesture handler no longer logs "Failed to install UI runtime bindings. Please report this", and `<split-view>` and `<sidebar-item>` no longer make the host log that `NgNativeSplitViews` is missing: neither was a fault, and gestures and sidebars work as before. ([#1617](https://github.com/ng-native/ng-native/pull/1617))
- On macOS an `<image>` that loaded quickly, such as a local `require()` asset from the dev server, no longer goes blank when the view lays out again, and `(load)` reports the image's size in pixels rather than three times it. ([#1605](https://github.com/ng-native/ng-native/pull/1605))

### ❤️ Thank You

- Ashley Hunter
- erKam @erkamyaman

## 0.24.0 (2026-11-18)

### 🩹 Fixes

- `Camera` from `@ng-native/expo/camera` gains a `mute` input that sets `<expo-camera>`'s `mute` prop, and the macOS desktop host now honours it, so a muted view records with no audio track on iOS, Android and macOS. ([#1540](https://github.com/ng-native/ng-native/pull/1540), [#1537](https://github.com/ng-native/ng-native/issues/1537))

  A bare `mute` attribute is true, and `null` or `undefined` leaves the prop unset, with sound. Before, a bare `mute` committed an empty string, which no platform reads as true, and `[mute]` did not compile. On macOS the view's `mute` as `record()` starts holds for that recording; a change while it records applies to the next one. As in expo-camera on iOS, `record()` no longer reads a `mute` option of its own on macOS, which was never part of expo-camera's `CameraRecordingOptions`.

- `ColorScheme.set` on Android 12 and later, in an app rebuilt with this release of `@ng-native/components`, also sets the app's night mode through `UiModeManager.setApplicationNightMode`, so native views created after the change, such as Compose sliders, use the chosen scheme instead of the system's. ([#1566](https://github.com/ng-native/ng-native/pull/1566), [#1563](https://github.com/ng-native/ng-native/issues/1563))

  React Native's `Appearance.setColorScheme` sets only AppCompat's default night mode, which the system overwrote on activities that handle `uiMode` themselves, as Expo's do, while the CSS kept the chosen scheme. The new `NgNativeColorScheme` module ships in `@ng-native/components` and needs a native rebuild; Expo Go keeps the old behaviour. On Android 12 and later the system now keeps the scheme across launches until `set()` or `set(null)` changes it; iOS and earlier Android are unchanged.

- `@ng-native/expo` gains typed components for `<expo-video>`, `<expo-blur>`, `<expo-gl>`, `<expo-mesh-gradient>` and `<expo-live-photo>`, `Camera` takes all of `<expo-camera>`'s view props as inputs, and `MapView` also types `<expo-maps-apple>` and `<expo-maps-google>`, so a boolean prop written as a bare attribute commits as true when the component is imported. ([#1546](https://github.com/ng-native/ng-native/pull/1546), [#1542](https://github.com/ng-native/ng-native/issues/1542))

  `ExpoVideo`, `ExpoBlur`, `ExpoGL`, `ExpoMeshGradient` and `ExpoLivePhoto` are on the bare `@ng-native/expo` import. Each input is the module's own view prop, typed, and goes to the view as it is, except that `ExpoVideo`'s `player` takes a `videoPlayer()` as well as its id and commits the id. A boolean input written bare is true, `null` or `undefined` leaves the prop to the view's default, and an input left unset commits nothing, except where the module's React component sends a default of its own: `ExpoGL`'s `msaaSamples` is 4 unless set on iOS, as `expo-gl`'s `GLView` sends it. Without the component imported, a bare boolean attribute still reaches native as an empty string, which iOS, Android and macOS each drop for a boolean prop.

  `Camera`'s new inputs are `facing`, `flash`, `zoom`, `mode`, `mirror`, `autofocus`, `active`, `videoQuality`, `videoBitrate`, `animateShutter`, `pictureSize`, `selectedLens`, `enableTorch`, `videoStabilizationMode`, `barcodeScannerEnabled`, `barcodeScannerSettings`, `responsiveOrientationWhenOrientationLocked` and `ratio`. `flash` and `autofocus` are now committed as `flashMode` and `autoFocus`, the props the native view reads, as `expo-camera`'s `CameraView` renames them; before, `flash="on"` and `autofocus="on"` on the element reached no native prop. `flashMode` and `autoFocus` still work, as inputs, and `flash` or `autofocus` wins when both are set. `flash` is committed as `off` unless set, as `CameraView` sends it, so an iOS camera with `Camera` imported no longer fires the flash automatically by default; set `flash="auto"` for that.

  `MapView`'s shape colours also take a number, a colour React Native's `processColor` already returned, as `expo-maps`' own types do, and pass it to native unconverted. A template that imports `Camera` and binds one of these props to a value of the wrong type now fails to compile under strict template checking.

- Tab and Shift-Tab on the macOS desktop host pass over a disabled native control (a button, switch, segmented control or date picker) instead of moving the focus onto it. ([#1525](https://github.com/ng-native/ng-native/pull/1525))

  AppKit's `makeFirstResponder:` focuses a disabled control all the same, so the host now checks that the control is enabled before moving the focus there, and Tab goes on to the next view in order.

- On macOS, text with no `textAlign`, in `<text>` and in a `<text-input>` and its placeholder, aligns to the layout's leading side as on iOS, rather than by its script or the system's language. ([#1545](https://github.com/ng-native/ng-native/pull/1545), [#1543](https://github.com/ng-native/ng-native/issues/1543), [#1544](https://github.com/ng-native/ng-native/issues/1544))

  `<text>` with no `textAlign` in a left-to-right layout now aligns to the left, where a paragraph that starts with a right-to-left script (Hebrew, Arabic) used to align to the right; a justified paragraph's last line still follows its own script. A `<text-input>`, single line or multiline, used to take AppKit's natural alignment from the system's language and ignore `textAlign` and `writingDirection`. With no `textAlign` its text and placeholder now align to the right when `I18nManager.isRTL` is true and to the left otherwise. A `textAlign` that is set on a `<text-input>` applies as React Native iOS applies it, not turned round in right to left: `auto`, `start` and `left` align to the left, `end` and `right` to the right, and `center` and `justify` as named. That differs from `<text>`, where right to left puts `auto` and `start` on the right and `end` on the left and swaps `left` and `right`, as on iOS. `writingDirection` sets the field's base writing direction.

- On macOS, an app's views now lay out right to left whenever `I18nManager.isRTL` is true (a right-to-left system language, unless the app calls `allowRTL(false)`, or `forceRTL(true)`), as on iOS, where they laid out left to right inside window chrome AppKit had mirrored. ([#1531](https://github.com/ng-native/ng-native/pull/1531), [#1515](https://github.com/ng-native/ng-native/issues/1515))

  In a right-to-left window `--safe-area-inset-titlebar-leading` measures the close, minimise and zoom buttons from the right edge, where AppKit puts them, and a secondary click on the back chevron, which a right-to-left toolbar puts on the right, lists the back history rather than the forward one.

- On macOS, `<text>` in a right-to-left layout is aligned as on iOS, and the trackpad's back and forward swipes turn round when the app lays out right to left. ([#1541](https://github.com/ng-native/ng-native/pull/1541), [#1533](https://github.com/ng-native/ng-native/issues/1533), [#1534](https://github.com/ng-native/ng-native/issues/1534))

  In a right-to-left layout, `<text>` with no alignment, `auto` or `start` aligns to the right whatever its script, `end` aligns to the left, and `left` and `right` swap, where text used to align by its own script and keep `left` and `right` as they are. In a left-to-right layout an alignment of `auto` or `start` that is set aligns to the left, as on iOS. A text input's text and placeholder are unchanged. When `I18nManager.isRTL` is true, a two-finger or three-finger swipe to the left goes back and one to the right goes forward, as Safari's do, and the screen in front of a native stack follows the fingers to the left during an interactive back swipe.

- On macOS the desktop host draws SVG `text-anchor` (start, middle and end) and text along a `<textPath>`, where it drew all text start-anchored and drew nothing on a path. ([#1520](https://github.com/ng-native/ng-native/pull/1520), [#1508](https://github.com/ng-native/ng-native/issues/1508))

  Anchors apply per text chunk, as in Chrome: a span with its own `x`, or off a path its own `y`, starts a chunk, anchored by its own `text-anchor`; on a `<textPath>` a span's `y` places nothing and starts no chunk. On a path each glyph (a grapheme cluster, drawn as its run shaped it, kerning and joined forms kept) is placed at the point its middle reaches, turned with the path, from `startOffset` (a length or a percentage of the path), with `side="right"` setting it along the path reversed; a glyph whose middle falls off the path is not drawn. A `<tspan>`'s or `<textPath>`'s `opacity` now applies once to all the text it holds. A character's `x`, `y`, `dx` and `dy` come from the innermost element that sets them for it, as in Chrome, so a `<text>`'s `dx` and `dy` reach the first glyph on its `<textPath>` and a `<tspan>` with no characters places nothing. `method` and `spacing` are not read, and `<foreignObject>` content still does not draw.

- On macOS an svg draws the views in a `foreignObject` at its `x` and `y`, cut to its `width` and `height`, and draws them again when a commit changes one of them. ([#1532](https://github.com/ng-native/ng-native/pull/1532), [#1522](https://github.com/ng-native/ng-native/issues/1522))

  As react-native-svg does on iOS, they are drawn from their layers in the object's place among the shapes, under the transforms, opacity, clip paths, masks and filters around it, so they take no clicks. What a layer does not draw into its own contents, such as a video or a visual-effect (glass) view, does not show.

- On macOS `<dom-component>` renders its DOM component in the desktop host's WebKit web view, with its inputs and outputs bound as on iOS, from the dev server in development and from the `www.bundle` that `ng-native-desktop package` writes into the app's `Resources` in a packaged app. ([#1528](https://github.com/ng-native/ng-native/pull/1528), [#1509](https://github.com/ng-native/ng-native/issues/1509))
- On macOS `ImagePicker.capture()` from `@ng-native/expo` takes a photo with the desktop host's own camera sheet, and `Camera.takePicture()` writes a PNG with `imageType: 'png'`. ([#1530](https://github.com/ng-native/ng-native/pull/1530), [#1510](https://github.com/ng-native/ng-native/issues/1510))

  The sheet shows on the window in front with the camera's preview, mirrored, and Cancel (Escape). In photo mode its shutter is Take Photo (Return); in video mode it is Record, then Stop (Return). The photo is a JPEG at `quality`, not mirrored, shaped as iOS shapes a camera shot: no `assetId` or `fileName`, and `base64` and `exif` only when asked. `cameraPermission` on `ImagePicker` is now the camera's permission on macOS, where it used to answer denied; it is asked only when the app declares `NSCameraUsageDescription`. On a Mac with no camera `capture()` rejects. `takePicture()` rejects an `imageType` other than `'jpg'` or `'png'` on macOS, as on iOS.

- On macOS `ImagePicker.capture()` from `@ng-native/expo` records video in the desktop host's camera sheet when `mediaTypes` asks for videos. ([#1536](https://github.com/ng-native/ng-native/pull/1536), [#1529](https://github.com/ng-native/ng-native/issues/1529))

  With videos alone the sheet's shutter is Record, then Stop, with the time recorded beside it; with photos and videos it adds a Photo and Video switch, in photo mode first. The video is a QuickTime movie, not mirrored, recorded at `videoQuality` and stopped at `videoMaxDuration`, and is shaped as iOS shapes a recorded video: `type: 'video'`, a `.mov` `uri`, `width`, `height`, `duration` in milliseconds, `mimeType: 'video/quicktime'` and `fileSize`. A request for videos asks for the microphone when it has not been asked; with the microphone refused the video is recorded with no sound, as on iOS, and the request rejects with iOS's message only when the app has no `NSMicrophoneUsageDescription`. A request whose `mediaTypes` is an empty list takes a photo, as on iOS. The sheet also shows when the app is not active, as just after the OS asked for the microphone.

### ❤️ Thank You

- Ashley Hunter

## 0.23.0 (2026-11-17)

### 🚀 Features

- Every service's `available` is a `Signal<boolean>`, read as `available()`, in `@ng-native/device`, `@ng-native/expo`, `@ng-native/firebase-messaging` and `@ng-native/nativescript`. `DevMenu`, `Haptics`, `SplashScreen`, `Tracking`, `Fonts` and `Watch` had it as a property, and their signal answers at once, on the first read. `Biometrics`, `AppleSignIn`, `ScreenCapture` and `StoreReview` had it as a method that resolved, and their signal is `false` until the platform answers, which is no sooner than a turn after the first read and can take longer; `Biometrics` asks again each time the app comes back to the front. A sensor's `available()` is `false` until the platform answers, where it was `null`. The services that had no `available` gain one: `HardwareBack` and `NavigationBar` are available on Android, `StatusBar` and `Keyboard` on iOS and Android, and `Vibration` on iOS and Android. These services, where absent, now answer their return type's empty value rather than throwing: `FileSystem` on the web and in a test that provides no module hands back a file that is not there and `pickDirectory()` answers `null`, while a build missing the module on iOS, Android or macOS still throws a `MissingModuleError` when it is used; and `TextRecognition.recognize()` answers no text on Android and the web. The `available-signal` migration rewrites the reads and the awaits it can trace to a service, through `inject()`, a field or a variable initialised with one, or a type, and notes some of what it cannot, such as a namespace import or a promise still used as one. A read through a name it cannot trace, such as an untyped alias, is left as it is without a note, so check what it leaves; see [Updating an app](https://ng-native.com/guide/updating) for how to run it. `@ng-native/eslint-plugin`'s new `no-uncalled-available` rule, on in `recommended`, reports an `@ng-native` service's `available` read as a condition without calling it, where it can identify the service in TypeScript, not in templates, and `eslint --fix` adds the call. ([#1436](https://github.com/ng-native/ng-native/pull/1436))
- An `<image>` covers its box by default on iOS, Android, macOS and the web host, as React Native's `Image` does, where one with no `resizeMode` and no `object-fit` was stretched to fill it on iOS and macOS (Android already covered it). An image whose picture has different proportions from its box is now scaled to fill the box and cropped, not distorted: set `resizeMode="stretch"` (or `object-fit: fill`) on one that should stay stretched. An explicit `resizeMode`, or `object-fit` in a stylesheet, still wins. ([#1442](https://github.com/ng-native/ng-native/pull/1442))
- macOS is reported as an OS of its own. The `OS` token from `@ng-native/device` is `'ios' | 'android' | 'macos' | 'web'`, where it used to read `'ios'` on every OS but Android and the web, and a new `DESKTOP` token is `true` on macOS, worked out from `OS`. `isApplePlatform()` from `@ng-native/fabric` is `true` on iOS and macOS. `registerPlatformComponents('macos')` draws with iOS's view names, except `<refresh-control>`, `<input-accessory-view>` and `<full-window-overlay>`, which are plain views on macOS. `@ng-native/tailwind`'s `native:` variant matches on macOS too, where it matched iOS and Android only. On macOS, `Dialogs.ask()` uses the iOS prompt, `<section-list>` pins its section headers by default, and `<markdown>` draws code in Menlo, as on iOS. A check an app wrote for iOS can now answer differently on a Mac: `=== 'ios'` is false there. And a check that already let a Mac through is worth a look: `!== 'android'` is true there, as it was, and `OS_VERSION`, the macOS major on a Mac, matches macOS 26 where a check meant iOS 26. The `os-comparisons-on-macos` migration notes the ones it recognises, with their file and line: a comparison of the OS with a quoted `'ios'` or `'android'`, and of `OS_VERSION` with a number, in code, templates and inline `template` strings. A check written another way, such as against a constant that holds `'ios'`, is not noted and needs checking by hand; see [Updating an app](https://ng-native.com/guide/updating) for how to run it. ([#1435](https://github.com/ng-native/ng-native/pull/1435))

### 🩹 Fixes

- `@ng-native/device` has `AppWindows`, `CURRENT_WINDOW`, `provideMainWindow` and `provideAppLifecycle`, for several windows from one app on a host with the `NgNativeWindows` module: component windows, route windows that render a named outlet of the one Router, `canClose` guards, and `willQuit` handlers run before quitting. On iOS and Android without the module `open` resolves to `null`. `mount` from `@ng-native/platform` renders the root component in the main window where the host has windows, and `native-stack-outlet` takes its name from its route window. ([#1443](https://github.com/ng-native/ng-native/pull/1443))
- `AppWindows.quit()` in `@ng-native/device` starts quitting the app as Cmd-Q does on macOS: every window's `canClose` guard, then the `willQuit` handlers, then the app quits, and one guard that says no keeps it running. It does nothing on iOS and Android. ([#1443](https://github.com/ng-native/ng-native/pull/1443))
- `@ng-native/desktop` connects a dev run on macOS to React Native DevTools through the dev server's inspector proxy (`j` in the Expo CLI, or Developer > Open DevTools), with the console, source-mapped sources, breakpoints and a "Paused in debugger" overlay, and shows JavaScript errors, fatal and logged with `console.error`, in a red box window with Dismiss, Reload and Copy. ([#1451](https://github.com/ng-native/ng-native/pull/1451))
- On macOS `SecureStore` keeps its items in the Data Protection keychain when the app is signed with a Team ID and an application identifier, as a Mac App Store build is, and moves an item an earlier build kept in the file keychain over the first time it is read. Other builds keep using the file keychain. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- On macOS `Crypto` answers from the desktop host's `NgNativeCrypto`, over CommonCrypto and the system's secure random source: `randomUUID()`, `randomBytes()`, `randomValues()`, `digest()` and `digestString()` with expo-crypto's algorithms. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- `@ng-native/desktop` has a config plugin, `["@ng-native/desktop", { ... }]` in `app.json`, that checks the desktop options (`documentTypes`, `capabilities` and `deny`) whenever Expo reads the config, so `expo start`, `expo export` and `ng-native-desktop` stop on an option that is not valid and list every problem. The macOS build reads the bundle identifier, URL schemes, icon, version, build number, updates URL and usage strings from the Expo keys the iOS build reads. ([#1451](https://github.com/ng-native/ng-native/pull/1451))
- On macOS the arrow keys, Home and End move the focus inside a view with the `tablist`, `radiogroup`, `menu`, `menubar`, `listbox` or `grid` role, which Tab treats as one stop, and any `tabIndex`, -1 included, lets a view take the focus. The focus moves into a sheet, in-window cover or popover as it opens, Tab stays inside it, and the focus goes back to the view that had it when it closes. The `listbox`, `gridcell`, `menuitemcheckbox` and `menuitemradio` roles, which React Native drops, reach VoiceOver. ([#1451](https://github.com/ng-native/ng-native/pull/1451))
- On macOS the desktop host draws `<expo-camera>` with AVFoundation and `Camera.takePicture()` takes a JPEG through its `NgNativeCamera`, once the camera is allowed. The view skips a suspended camera, such as a MacBook's built-in one with the lid closed, for another camera. A Mac with no camera, or no permission, sends `mountError`. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- On macOS `Camera.record()` from `@ng-native/expo` records a QuickTime movie from `<expo-camera>` and resolves once the recording stops, on `stopRecording()`, `maxDuration` or `maxFileSize`. It has sound only when the microphone is already allowed and the view is not muted; the host never asks for the microphone. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- On macOS `Calendar` answers from the desktop host's `NgNativeCalendar`, over EventKit. `permission`, `writePermission` and `remindersPermission` read and ask for access when the app's `Info.plist` has the usage string. With full access, `calendars()`, `calendar()`, `defaultCalendar()`, `sources()`, `events()`, `event()` and `reminder()` read the user's calendars, events and reminders, which carry expo-calendar's methods: a calendar's `createEvent()`, `createReminder()`, `listEvents()`, `listReminders()` and `delete()`, and an event's or a reminder's `update()` and `delete()`, with alarms and a recurrence rule. `createCalendar()` makes a calendar or a reminder list (`title`, `color`, `entityType` and `sourceId`). A calendar's own `update()` rejects on macOS. Without access a read answers empty or null, and a write rejects with a message naming the permission it needs. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- On macOS a `<ui-bottom-sheet>` (`@ng-native/expo`) presents as the SwiftUI sheet the desktop host draws, as on iOS, and a sheet with detents opens at its smallest detent's height in the window, as a macOS sheet has no detents. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- On macOS `Battery` answers from the desktop host's `NgNativeBattery`, over IOKit's power sources and Low Power Mode: `level`, `state`, `saving` and `low` follow the battery and the power adapter. On a Mac with no battery `known()` is false and `state()` is `unknown`. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- `ng-native-desktop` finds the native code the macOS build compiles in, as Expo's autolinking does: a library whose `expo-module.config.json` lists `macos` and names its `macos.cmakeTarget` (and `macos.cmakeDir`, `desktop` by default), and the app's own `modules/<name>/macos/` folders, except what the plugin options' `deny` lists. It warns about dependencies with native code for iOS or Android and none for the desktop, whose native modules are absent on macOS, except `@react-native/*` and `@ng-native/*` packages, which the host answers with its own modules, `expo-*` and `@expo/*` packages, which are absent on macOS (a service built on one reports itself unavailable), and what `deny` lists. ([#1451](https://github.com/ng-native/ng-native/pull/1451))
- On macOS `audioPlayer` and `audioRecorder` from `@ng-native/expo/audio` answer from the desktop host's `NgNativeAudio`, over AVPlayer and AVAudioRecorder: a player loads a file, an http or https url or an asset, plays, pauses, seeks, and sets its rate, volume, mute and loop, and its state follows expo-audio's status events. A recorder takes the `ios` recording options and records once the microphone is allowed; without the permission, or on a Mac with no microphone, `prepareToRecordAsync()` rejects. Audio sampling and the lock screen controls do nothing on macOS. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- On macOS `assets()` loads through the desktop host's `NgNativeAsset`: an asset from the dev server is downloaded into the app's caches first, and one whose hash already has a file there is not downloaded again. Each loaded asset's `localUri` is its file. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- On macOS `AppleSignIn` signs in through the desktop host's `NgNativeAppleAuthentication`, over AuthenticationServices, in an app signed with the Sign in with Apple entitlement. Without the entitlement `available()` is false and `signIn()` rejects with `ERR_REQUEST_NOT_HANDLED`, showing no sheet. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- `ng-native-desktop package --format mas` signs an app that uses `expo-apple-authentication` with the Sign in with Apple entitlement, as the iOS build does. `--format dmg` adds it when `ios.usesAppleSignIn` is `true`, and then needs `NGN_SIGN_IDENTITY`, `NGN_PROVISIONING_PROFILE` (a Developer ID profile with the capability) and `APPLE_TEAM_ID`, with `--skip-notarize` too, and embeds the profile. ([#1451](https://github.com/ng-native/ng-native/pull/1451))
- On macOS `<apple-sign-in-button>` is drawn as Apple's `ASAuthorizationAppleIDButton`, with its `buttonType`, `buttonStyle` and `cornerRadius`, and sends `(buttonPress)` on a click. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- `ng-native-desktop` refuses an app name that contains a path separator or is `.` or `..`, so the `.app` is always made inside the output folder. ([#1451](https://github.com/ng-native/ng-native/pull/1451))
- On macOS `AppInfo` answers from the desktop host's `NgNativeApplication` and `NgNativeDevice`: `version`, `build`, `id` and `name` from the app's `Info.plist` (a dev run has no versions, and gives the app's own id and name), and `device` as the Mac's model name, `macOS` and its version, `physical` true and `type` `desktop`. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- On macOS, `AccessibilityInfo.announceForAccessibility` (and `Accessibility.announce` from `@ng-native/device`) has VoiceOver say the text, interrupting what it is saying unless `announceForAccessibilityWithOptions` asks to queue or for low priority, and `setAccessibilityFocus` moves VoiceOver, and the keyboard focus of a focusable view, to the view. A live region (`accessibilityLiveRegion` or `aria-live`, `polite` or `assertive`) announces its text each time it changes after it appears: its label, or the text of the views under it. `announcementFinished` is not sent on macOS, which reports no end to an announcement. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- On macOS `AddressSearch` suggests addresses and resolves the picked one through the desktop host's `NgNativeAddressSearch`, over MapKit's `MKLocalSearchCompleter` and `MKLocalSearch`, as on iOS. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- On macOS, VoiceOver reads a text's string (static text, or a heading or link named by its text), and a heading is AppKit's heading role with its `accessibilityLevel` (`aria-level`) on macOS 26 and later, and a group spoken as a heading before that. A level on a `<text>` heading does not reach VoiceOver yet; a `<view>` heading's does. Every role the components take has a mapping: `meter` is a level indicator, `tree` and `treegrid` an outline with `treeitem` rows, the scroll views a scroll area, and the landmark and document roles a group that says what it is. A view with a role or a label keeps its children inside it, and a control, a heading or an `accessible` view is read as one element, named by the text inside it when it has no label, as on iOS. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- On macOS, VoiceOver's Headings, Links and Landmarks rotors list an app's headings, links and landmark views (`banner`, `main`, `navigation`, `complementary`, `contentinfo`, `form`, `region`) in tree order. The app's content in a window is one group to VoiceOver, which holds the rotors. `NGN_LOG_ROTORS=1` logs each rotor's items, for checking them without a screen reader. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- Every element's shared props in `@ng-native/components` take, in both spellings, what the desktop host reads: `accessibilityLevel` and `aria-level`, `accessibilityDescribedBy` and `aria-describedby`, `accessibilityRequired` and `aria-required`, `accessibilityInvalid` and `aria-invalid`, `accessibilityPosInSet` and `aria-posinset`, `accessibilitySetSize` and `aria-setsize`, `accessibilityRowCount` and `aria-rowcount`, and `accessibilityColumnCount` and `aria-colcount`. The `aria-*` spelling is read on the host of an app's own component too, and the web host writes them as their `aria-*` attributes. iOS and Android do not read them. `@ng-native/device` has an `APPLE` token, `true` on iOS and macOS, worked out from `OS` as `DESKTOP` is. ([#1436](https://github.com/ng-native/ng-native/pull/1436))
- On macOS, `AccessibilityInfo` answers from the system: whether VoiceOver is running, reduce motion, reduce transparency, invert colours and increase contrast (`isDarkerSystemColorsEnabled`), with their change events as the setting changes. `Accessibility.screenReader` and `reduceMotion` from `@ng-native/device`, and `@media (prefers-reduced-motion)`, follow them. macOS has no bold-text or grayscale setting an app can read, so those answer false. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- `(accessibilityAction)`, `(accessibilityTap)`, `(magicTap)` and `(accessibilityEscape)` now commit the `onAccessibilityAction`, `onAccessibilityTap`, `onAccessibilityMagicTap` and `onAccessibilityEscape` props React Native's iOS view checks before it sends them, so a declared custom action reaches its binding on iOS and macOS. On macOS a view's `accessibilityActions` are VoiceOver's actions: `activate` is its press, `increment` and `decrement` step an adjustable view, `escape` is its cancel, and the rest are custom actions by their label. VoiceOver's press, and Space or Return on a focused view, send the accessibility tap or `activate` when the view listens, and otherwise click the view, as iOS's synthesized tap does. `expanded` in `accessibilityState` (or `aria-expanded`) is reported to VoiceOver. ([#1436](https://github.com/ng-native/ng-native/pull/1436))
- A boolean input whose default is `true`, bound to `null` or `undefined`, now takes that default, as one left unbound does. Before, it read `false`: `[enabled]` on `<keyboard-avoiding-view>` stopped avoiding the keyboard, `[enabled]` on `<ui-segmented-button>` and `<ui-dropdown-menu-item>` disabled them, `[showDragIndicator]` on `<ui-bottom-sheet>` hid the grabber, `[reportInsets]` on `<safe-area-provider>` stopped reporting insets, and `[cancelable]` on `<pressable>` refused to let another gesture take the press. `[visible]` on `<modal>` is unchanged. ([#1426](https://github.com/ng-native/ng-native/pull/1426), [#1425](https://github.com/ng-native/ng-native/issues/1425))
- On Android, `<ui-date-picker>` in `@ng-native/expo` no longer marks its Signal Forms field touched, or writes its value again, when Compose first draws the picker. ([#1489](https://github.com/ng-native/ng-native/pull/1489), [#1475](https://github.com/ng-native/ng-native/issues/1475))

  A report of the date the picker already holds is not taken as a pick on either platform: it emits no `touch` and leaves the `value` model as it is.

- `cursor` takes every CSS keyword cursor, such as `text`, `grab`, `not-allowed`, the resize cursors and `zoom-in`, where it took `auto` and `pointer` alone: on macOS the host draws it, and iOS draws `auto`. An image cursor, `url(...)`, is dropped with a warning, where its fallback keyword was kept. `scrollbar-width` and `scrollbar-gutter` are read: `scrollbar-width: none` hides a scroll view's indicators on iOS and Android as well, and on macOS `thin` draws the small scroll bar and `scrollbar-gutter: stable` keeps room for one. `::-webkit-scrollbar` is dropped with a warning that names them. ([#1442](https://github.com/ng-native/ng-native/pull/1442))
- A `[contextMenu]` template's item that an `@if` or `@for` shows takes its place in the menu as written, where it went to the end. ([#1443](https://github.com/ng-native/ng-native/pull/1443))
- On Android, a `<pressable>` with its own `(longPress)` inside an element with a `[contextMenu]` keeps its long press, and its `(press)`: a long press there opens no menu, as the innermost handler wins in a native app, and a right-click there still opens the menu. A `<pressable>` with a `(longPress)` around an element with a `[contextMenu]` leaves a long press on that element to the menu on Android and iOS, whatever its `delayLongPress`. A context menu on Android opens after the system's long-press timeout, which follows the Touch & hold delay setting, and TalkBack opens it with the element's long-press action. On Android a shortcut on a shifted character, such as `mod+?` or `mod+shift+?`, fires, and a shortcut does not fire while a `<modal>` is open. ([#1448](https://github.com/ng-native/ng-native/pull/1448))
- The default macOS menu bar has Close Window (Cmd-W, `menuRole` `close`) at the top of the Window menu. An app whose `<menu-bar>` has a `<menu-group menuRole="file">` gets it at the end of that File menu instead, and an app `<menu-item menuRole="close">` replaces it. ([#1443](https://github.com/ng-native/ng-native/pull/1443))
- On macOS `Clipboard.changes()` in `@ng-native/expo` counts the pasteboard's changes from the desktop host's `ngNativeClipboard` event. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- Add `cameraPermission()` and `microphonePermission()` to `@ng-native/expo/camera`, and `recordingPermission()` to `@ng-native/expo/audio`. Each returns a `Permission`, with `status()`, `granted()` and `blocked()` as signals and `check()`, `request()` and `ensure()`, that checks a refusal again when the app comes back to the front. On iOS and Android they call `expo-camera`'s and `expo-audio`'s own permission functions (`expo-audio`'s on the web too), and on macOS the desktop host's `NgNativeCamera` and `NgNativeAudio`, where calling `expo-camera` and `expo-audio` directly throws. Where the platform has no such module, as in a Node test, each answers denied; a build missing the module throws `MissingModuleError` on first use. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- Add `setAudioMode(mode)` to `@ng-native/expo/audio`: `expo-audio`'s `setAudioModeAsync` on iOS, Android and the web, and on macOS the desktop host's `NgNativeAudio`, which takes the mode and changes nothing, where calling `expo-audio`'s function directly throws. On macOS a host without `NgNativeAudio` rejects with `MissingModuleError`, saying to rebuild it, and where the platform has no audio module at all, such as in Node tests, it does nothing. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- On macOS scroll views follow the "Show scroll bars" setting, and change when it does: with scroll bars always shown, the content is laid out without the strip they take, rather than running under them. ([#1451](https://github.com/ng-native/ng-native/pull/1451))
- On macOS `ScreenCapture` answers from the desktop host's `NgNativeScreenCapture`: `prevent()` asks macOS to keep every window of the app, including the ones it opens after, out of screenshots, recordings and screen sharing through `NSWindow.sharingType` until each key is released with `allow()`. This is best effort: from macOS 15, an app capturing through ScreenCaptureKit can still capture those windows. `screenshots` stays at zero and `protectAppSwitcher()` does nothing on macOS. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- `ng-native-desktop run --url <link>` opens the app on a link, which it reads as `Linking`'s initial URL, as a click on a link to the app's scheme would, so a dev run can start on a route. A packaged app ignores it. ([#1451](https://github.com/ng-native/ng-native/pull/1451))
- `ng-native-desktop run` gives the host the capabilities in the `@ng-native/desktop` plugin options, so `Processes.spawn`, its environment and its declared paths behave in development as they do in an `app` or `dmg` that `ng-native-desktop package` made. A `--format mas` package runs in the App Sandbox, where `Processes.spawn` and declared paths are absent, and `package` warns about each. ([#1451](https://github.com/ng-native/ng-native/pull/1451))
- On macOS `Notifications.getDevicePushToken()` registers with APNs and answers the device token, a new token while the app runs reaches `devicePushToken()`, and remote notifications reach `latest()` and `response()` with their payload's data. `package` signs a `mas` build of an app that uses `expo-notifications` for APNs, and a `dmg` when `ios.entitlements['aps-environment']` is set. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- On macOS `Printing` prints through the desktop host's `NgNativePrint`, over NSPrintOperation: `print()` shows the print panel for HTML, a PDF or an image, and `printToPdf()` writes the HTML's pages to a PDF. `selectPrinter()` answers null, as macOS has no printer picker. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- `Printing.print({ window })` prints what a window shows on macOS, web views included, from an `AppWindow`, with the print dialog as a sheet on that window; on other OSes it prints nothing and resolves. A video, the camera preview and Metal content print blank. The default menu bar gains File > Print... (Command-P), which prints the key window on macOS unless the app gives its own `print` item a handler, and Close Window moves into File, before Print..., when the app has a File menu. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- `ng-native-desktop run` downloads the prebuilt macOS desktop debug host for the app's React Native version, a dev build with React Native's debugger, and `package` the prebuilt release host, each checked against the SHA-256 in `@ng-native/desktop`'s `prebuilt.json`, when the app links no native desktop code and each host library it has installed (`react-native-screens`, `react-native-safe-area-context`, `react-native-svg`, `react-native-webview`, `react-native-worklets`, `react-native-reanimated`) is the version the host was built with and not in `deny`. Otherwise, or with `NGN_DESKTOP_FROM_SOURCE=1`, the host is built from source. Each release attaches both prebuilt hosts to its GitHub release. ([#1451](https://github.com/ng-native/ng-native/pull/1451))
- On macOS files and folders the user picks or saves to stay reachable through `FileSystem` in later launches, through security-scoped bookmarks: a moved pick is reachable at the path it has now, though a uri saved before the move still names the old path, and one that is gone is forgotten. Mac App Store builds are signed with the bookmarks entitlement this needs. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- `ng-native-desktop package` (`npm run package`) makes a universal release build of the app for macOS 14 and later: `--format app` (the default) an ad-hoc signed `.app`, `--format dmg` a Developer ID signed, notarised and stapled `.dmg`, with Sparkle and the `.zip` it updates from when `--feed-url` names an appcast, and `--format mas` a sandboxed Mac App Store `.pkg`, naming the capabilities the sandbox forbids. It stops before building without full Xcode, which compiles the icon, and reads signing and notarisation credentials from the environment. ([#1451](https://github.com/ng-native/ng-native/pull/1451))
- `ng-native-desktop package` in `@ng-native/desktop` writes the updates server's code signing certificate (`updates.codeSigningCertificate` and `codeSigningMetadata`) into the app's `Info.plist`, and a `dmg` with `--feed-url` needs Sparkle's public EdDSA key, from `--sparkle-key` or `NGN_SPARKLE_PUBLIC_KEY`. Sparkle checks for updates on its own schedule by default. ([#1451](https://github.com/ng-native/ng-native/pull/1451))
- `ng-native-desktop package --format dmg --skip-notarize` makes a disk image without notarising it, signed with `NGN_SIGN_IDENTITY` or ad hoc, for testing on the Mac that built it. Without the flag, a `dmg` missing its credentials says that the flag exists. ([#1451](https://github.com/ng-native/ng-native/pull/1451))
- `ng-native-desktop package` packages the app with a Release build of the macOS host, the prebuilt one when it fits the app or one it builds, and ships the app's bundle as Hermes bytecode, compiled by the `hermesc` built from that host's own Hermes. ([#1451](https://github.com/ng-native/ng-native/pull/1451))
- A desktop-only app from `nx g @ng-native/nx:app --desktopOnly` no longer shows the `run-ios` and `run-android` targets `@nx/expo`'s plugin inferred for it, and the new `nx g @ng-native/nx:mobile <app>` and `ng generate @ng-native/schematics:mobile <app>` add iOS and Android back to a desktop-only app. ([#1517](https://github.com/ng-native/ng-native/pull/1517), [#1513](https://github.com/ng-native/ng-native/issues/1513))

  The application generator adds a desktop-only app's directory to the `exclude` list of each `@nx/expo/plugin` registration in `nx.json`, and writes the two inferred targets that still apply on macOS, `export` and `install`, in its `project.json`; `prebuild` and the EAS `build` and `submit` targets are no longer inferred for it. Apps generated before this keep the inferred targets until their directory is added to that list by hand.

  The `mobile` generator and schematic add `ios` and `android` to `expo.platforms` beside `macos`, the phone settings a mobile app's `app.json` has (portrait orientation, `ios.supportsTablet` and `android.package`), and `expo-status-bar` and `expo-system-ui`. The Nx generator removes the app from the plugin's `exclude` list, so `run-ios` and `run-android` are inferred again, or writes them on the app's own Metro port when it is not Expo's default; the schematic adds `run-ios` and `run-android` on the `expo` builder. Running either again changes nothing.

- `nx g @ng-native/nx:app --desktopOnly`, `ng add @ng-native/schematics --desktop-only` and `ng generate @ng-native/schematics:application --desktop-only` make a macOS-only app from the desktop template: `macos` alone in `expo.platforms`, its sidebar and menu bar starter screen, its in-app test in `src/app/app.device.ts` with the Metro config that runs it, `macos` and `package` targets, and a `test` target that runs the Node Vitest project, `node-macos`, alone. `nx g @ng-native/nx:init --desktopOnly` makes it the default of the `application` generator in `nx.json`. The Angular CLI's `@ng-native/schematics:vitest` builder takes a `project` option, which runs one Vitest project. ([#1450](https://github.com/ng-native/ng-native/pull/1450))
- `ng-native-desktop package --format dmg` notarises with a keychain profile (stored with `xcrun notarytool store-credentials`, named by `NGN_NOTARY_PROFILE`) or an App Store Connect API key. It does not take `APPLE_ID` and an app-specific password, because `notarytool` takes that password only as an argument, which every process on the Mac can read. ([#1451](https://github.com/ng-native/ng-native/pull/1451))
- On macOS `Network` answers from the desktop host's `NgNativeNetwork`, over Network.framework's path monitor: `connected` and `reachable` are true when the Mac has a route to the network, `type` names the interface it uses (`wifi`, `ethernet`, `cellular` or `other`, and `none` without a route), and `status()` follows each change. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- On macOS every `@ng-native/expo` service with a desktop source in v1 answers from the desktop host's TurboModule named after its Expo package (`NgNativeHaptics` for `expo-haptics`, `NgNativeSecureStore` for `expo-secure-store`, and so on, listed in `DESKTOP_MODULES`), and a desktop host without one throws `MissingModuleError` on first use, saying to rebuild it with `npm run macos`. Mobile-only services, such as sensors, brightness and orientation, stay absent. `macosPermissions(config)` in `@ng-native/device` reads a macOS build's usage strings and App Sandbox entitlements from the Expo keys an app sets for iOS: `ios.infoPlist`'s usage strings and each `expo-*` plugin's permission option, with the plugin's own default string where it is listed without one, and the app's name in place of `$(PRODUCT_NAME)`. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- On macOS, a `[contextMenu]` choice and a `(fileDragEnter)`, `(fileDragLeave)` or `(fileDrop)` reach the element they happened on only. A menu or drop zone inside another one handed them on to the one around it as well, so choosing an item in the inner menu ran the outer menu's handler too, and a drop on the inner zone also dropped on the outer. ([#1443](https://github.com/ng-native/ng-native/pull/1443))
- On macOS `MediaLibrary` answers from the desktop host's `NgNativeMediaLibrary`, over PhotoKit, and `ImagePicker.pick()` from `NgNativeImagePicker`, the system's photo picker, at a picker's size (780 by 560 points, or smaller in a smaller window). The library is read and written only with the user's permission, which is asked only when the app declares the photo library usage strings; without it, queries answer empty and `save()` answers null. `capture()` answers no assets on macOS. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- On macOS the desktop host draws `<expo-map>` with MapKit: markers, polylines, polygons and circles in their colours, the camera, the map type and controls, and the colour scheme, with iOS's `cameraMove`, `mapClick`, `markerClick` and shape click events. `setCameraPosition()` and `selectMarker()` work through its `NgNativeMaps`. The map shows the user's location only once location is allowed. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- On macOS `Location` answers its permission, `current()` and `start()` through the desktop host's `NgNativeLocation`, over CLLocationManager. The host asks for the permission only when the app's `Info.plist` gives a location usage string. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- On macOS a linked library's Fabric components are compiled into the desktop host from its codegen, as on Android, so they lay out and their events reach JavaScript. The library draws one with a subclass of `NGNView` from the host's `component-view.h`, registered for the component's name with `NGNRegisterComponentView`; a component with none registered is drawn as a plain view. ([#1451](https://github.com/ng-native/ng-native/pull/1451))
- On macOS the host builds with `react-native-gesture-handler` and `react-native-keyboard-controller` among its libraries: a library's own component C++ is found outside `common/cpp` (gesture handler's `shared/shadowNodes`), and a descriptor's header is found by what it declares, whatever its file is named. ([#1451](https://github.com/ng-native/ng-native/pull/1451))
- On macOS `LanguageModel` answers from the desktop host's `NgNativeLocalLlm`, over Apple's Foundation Models on macOS 26 and later: `generate()`, `generateObject()`, `stream()` and `session()` with tools work as on iOS, and `availability` is `notEligible` before macOS 26, `notEnabled` with Apple Intelligence off and `notReady` while macOS prepares the model. A failure carries expo-local-llm's code: a session turn that fills the context window rejects with `LanguageModelContextExceededError`, and a one-shot call with an error coded `ERR_CONTEXT_WINDOW_EXCEEDED`. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- On macOS `ImageEditor` edits images through the desktop host's `NgNativeImageManipulator`, over ImageIO and Core Graphics: resize, rotate, flip and crop, saved as JPEG or PNG. Saving as WebP rejects, since macOS cannot write it. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- `@ng-native/desktop` is the macOS desktop host: React Native's C++ core and Hermes, built from pinned sources and linked statically, mounting an app's views into AppKit, with a toolkit-free core tested on Linux and macOS. `ng-native-desktop run`, on macOS only, builds the host into `~/Library/Caches/ng-native/desktop` the first time (or downloads a prebuilt one) and opens the app from the Expo dev server, with reload and Fast Refresh, or from a bundle path or URL. ([#1451](https://github.com/ng-native/ng-native/pull/1451))
- On macOS `<expo-glass>` draws Liquid Glass (NSGlassEffectView) from macOS 26 and a frosted material before it, in the element's own corners. The desktop host's view registry reports `<refresh-control>`, `<input-accessory-view>`, react-native-keyboard-controller's views and the community `slider`, `picker` and `masked-view` absent on macOS, each a plain view there; the support table lists them, pointing at `@expo/ui`'s `ui-slider` and `ui-picker`. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- `@ng-native/desktop` recognises `react-native-gesture-handler`'s gestures on macOS: pan, tap, long press, fling, hover, manual and native view handlers from the mouse, a pan that asks for it from a trackpad's two-finger scroll, and pinch and rotation from the trackpad, with their relations (`simultaneousWithExternalGesture`, `requireExternalGestureToFail`, `blocksExternalGesture`). Worklet gestures run on the UI thread through Reanimated. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- On macOS `Location.geocode()` and `reverseGeocode()` answer from CLGeocoder through the desktop host's `NgNativeLocation`, with no permission asked, in `expo-location`'s iOS shapes. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- On macOS `Fonts` and `loadFonts()` answer from the desktop host's `NgNativeFont`, which registers each font file with CTFontManager for the app's process: a font in the app, or one the dev server serves, downloaded first. Text that asks for the name a font was loaded under is set in that font's family, with the weight picked among the faces loaded in it. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- On macOS every module and view that takes a path or a `file:` uri from JavaScript reads only what `FileSystem` can (the app's folders, the files and folders the user picked and the declared `capabilities.paths`) and a packaged app's own assets: `ImageEditor`, `TextRecognition`, `Fonts`, `Printing`, `MediaLibrary`'s `createAsset`, a request's file url and body, `Image.getSize`, `<image>`, `<expo-image>` and SVG image sources, audio and video sources, a web view's file page, `Asset.downloadAsync`, `Sharing.share`, a `dragItem`'s files and `Shell.openPath` and `showItemInFolder`. `SQLite` opens, makes and deletes a database only where `FileSystem` can write. Any other path is refused: with an error naming it where the call can fail, and otherwise left undrawn, left out of a drag, or answered false by `Shell`. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- On macOS the desktop host draws `<expo-image>`: the source that fits the view, `contentFit`, `contentPosition`, `tintColor`, `blurRadius`, a fade `transition`, blurhash and thumbhash placeholders, and a memory and disk cache by `cachePolicy`, with `expo-image`'s load events. A view whose `recyclingKey` changes from one key to another clears its image at once, as on iOS, so a reused view shows its placeholder rather than the last item's image while its own loads. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- `(mouseenter)`, `(mouseleave)`, `(mousemove)`, `(mouseover)` and `(mouseout)` on an element listen for React Native's pointer events, where they were never delivered on any host, and a finger's pointer events do not run them. `(dblclick)`, `(contextmenu)` and `(wheel)` listen for the macOS host's events of their own. A build warns of a binding to a DOM event no device sends, such as `(click)` on a `<view>`, naming what to bind instead, from the same table as `@ng-native/eslint-plugin`'s `no-dom-events`. That rule reads `expo.platforms` from the nearest `app.json`: with no desktop OS listed it reports the eight events above as never firing, and with `macos` listed the new `desktop-only-events` rule, a warning in `recommended`, says each fires only on macOS. `@ng-native/eslint-plugin` now depends on `@ng-native/metro`. ([#1442](https://github.com/ng-native/ng-native/pull/1442))
- `@expo/ui` draws on macOS: the desktop host implements each `ui-*` view in SwiftUI inside an NSHostingView, under the iOS names and with the iOS props and events, and `registerExpoUiViews('macos')` registers them. A `<ui-view-host [matchContents]="true">` takes the size of the app's views it holds, as on iOS. `ui-accessory-widget-background`, `ui-sync-toggle` and `ui-toolbar` are absent on macOS; `EXPO_UI_MACOS` in `@ng-native/expo` lists each iOS view with its SwiftUI view on macOS or the reason it is absent. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- Interaction observers now hear the typed `@expo/ui` controls from `@ng-native/expo` and the native tab bar and header bar buttons from `@ng-native/router`, each as a `click` with no value. ([#1467](https://github.com/ng-native/ng-native/pull/1467), [#1460](https://github.com/ng-native/ng-native/issues/1460))

  The `@expo/ui` controls reported are `ui-button`, `ui-segmented-button`, `ui-dropdown-menu-item`, `ui-toggle`, `ui-stepper` (iOS only), `ui-color-picker` (iOS only), `ui-date-picker`, `ui-picker` (as the picker on Android too, not the segmented button or menu item it draws) and `ui-slider`, once a drag as the finger lifts. A `ui-button`'s event carries its label as `text`, cut to 100 characters. `ui-text-field`, opening a `ui-exposed-dropdown-menu-box` and dismissing a `ui-bottom-sheet` report nothing.

  A tap on a native tab, or on a `<native-header-item>` that is a native bar button (iOS), is a `click` labelled with the item's title, or its accessibility label when it has none. The navigation a tab starts is not reported.

  `provideInteractionObserver`, `INTERACTION_OBSERVERS` and the interaction types are now also exported from `@ng-native/device`, with `describeElement`, `interactionObservers` and `notifyInteraction` for a package that reports its own controls. `@ng-native/components` exports what it did before.

- `expoModule()` from `@ng-native/expo` takes `{ platforms, desktop }` as its third argument as well as a list of platforms, and `ModulePlatform` includes `'macos'`. On macOS it never calls the loader it is given: it answers the desktop host's TurboModule `desktop` names, or calls `desktop` when it is a loader of its own, and answers null where the call gives neither, so the service is inert. `Storage` keeps working on macOS, where the desktop host registers the module `@react-native-async-storage/async-storage` uses. A desktop host without the named module throws a `MissingModuleError` that says to rebuild it with `npm run macos`. Where a module is provided on macOS, `Location` geocodes without asking for the permission and `Calendar` reaches the default calendar, the sources and the reminders, as on iOS; the calendar picker stays iOS only. `registerExpoMap('macos')` draws with MapKit, and `TextRecognition` says to rebuild the desktop host when its module is missing on macOS. ([#1436](https://github.com/ng-native/ng-native/pull/1436))
- `@ng-native/components` adds drag and drop on macOS and iPadOS: the `FileDrop` directive's `(fileDragEnter)`, `(fileDragLeave)` and `(fileDrop)` take files, text and urls dragged onto a view, and `[dragItem]` lets a view be dragged out as files, text or a url. On iPhone, Android and the web host neither does anything. In `@ng-native/testing`, `userEvent.dropFiles` drives a `FileDrop` view. ([#1443](https://github.com/ng-native/ng-native/pull/1443))
- `@ng-native/eslint-plugin`'s `no-dom-events` and the build warning now report a DOM event such as `(click)` on `<menu-bar>`, `<menu-group>`, `<menu-item>`, `<menu-separator>`, `<sidebar-item>`, `<sidebar-section>`, `<split-view>`, `<split-view-content>` and `<tray-icon>`, as on the other elements from `@ng-native/components`. ([#1446](https://github.com/ng-native/ng-native/pull/1446))
- `DocumentPicker` from `@ng-native/expo/document-picker` is the file dialogs service. `save({ suggestedName, contents | fromFile, types })` writes a file where the user chooses and answers its uri, or `null` when they dismiss the dialog: on iOS and Android the user picks a folder and the file is made in it with `suggestedName`. `pickDirectory()` opens the system folder picker and answers the folder, or `null`, as `FileSystem.pickDirectory()` does, which is deprecated in its favour. Both use `expo-file-system`'s folder picker, and answer `null` where there is none. ([#1436](https://github.com/ng-native/ng-native/pull/1436))
- On macOS, `DocumentPicker.save()` in `@ng-native/expo` writes through the desktop host's save panel, bytes included, and `pickDirectory()` opens its folder panel, answering a folder whose `createFile()` makes a file in it, as on iOS and Android. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- `@ng-native/device` has a `Dock` service, with a menu and a bounce for the Dock icon on macOS, and a `Tray` service that `<tray-icon>` from `@ng-native/components` registers with, for icons in the macOS menu bar's status area. Both report themselves absent, and do nothing, on iOS and Android. ([#1443](https://github.com/ng-native/ng-native/pull/1443))
- `Dialogs.choose` from `@ng-native/device` logs its three-button error only on Android. On macOS, where `choose` is an alert with a button for every choice, a longer list is not an error. ([#1435](https://github.com/ng-native/ng-native/pull/1435))
- `@ng-native/device` has the menu model and two seams that later desktop features build on. `defaultMenuBar(appName)` is the App, Edit, View, Window and Help menus a desktop app gets, and `mergeMenuBar(defaults, app)` merges an app's menus into it: an item with a `menuRole` replaces that role's default, `Settings...` shows only when the app gives it a handler, a group with a `menuRole` adds to that standard menu, a `file` group goes after the App menu and any other group after View. `MENU_MODEL` and `createMenuModel()` are where a menu's items register. `WINDOW_NAVIGATOR` is null until a router provides one, and `SIDEBAR_SELECTION` is provided by a sidebar item. Nothing draws these yet. ([#1436](https://github.com/ng-native/ng-native/pull/1436))
- `@ng-native/desktop` builds `react-native-worklets` and `react-native-reanimated` into the macOS host when the app has them installed: worklets run on the UI thread, and Reanimated's shared values, animations and worklet styles move views at the display's rate, with no frames taken while nothing animates. ([#1451](https://github.com/ng-native/ng-native/pull/1451))
- On macOS each window's `--hairline` is the one for the display that window is on, where every window followed the app's. A window keeps it as it moves to a display of another density; `hairlineTokens(pixelRatio)` in `@ng-native/device` gives the token for a pixel ratio. ([#1443](https://github.com/ng-native/ng-native/pull/1443))
- On macOS the desktop host draws `react-native-webview`'s web view (`<web-view>`) with WKWebView when the app has the library installed: its source, injected scripts, messages both ways, navigation events and commands, as on iOS, and `originWhitelist`. A focused web view keeps an undo history of its own, as a focused text input does, so Edit > Undo undoes the page's typing and the app's actions stay for when neither has focus. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- On macOS `Browser` answers from the desktop host's `NgNativeWebBrowser`: `open()` opens an http or https url in the default browser, and `signIn()` runs an ASWebAuthenticationSession and answers the url it was redirected to, or null when it was cancelled. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- `@ng-native/desktop` draws a view's `transform` on macOS, about its `transform-origin`, as React Native iOS does. ([#1451](https://github.com/ng-native/ng-native/pull/1451))
- On macOS a view draws CSS gradients (`background-image`), box shadows, a different radius on each corner, and a different width and colour on each side of its border, as on iOS. ([#1451](https://github.com/ng-native/ng-native/pull/1451))
- On macOS `videoPlayer` plays through the desktop host's `NgNativeVideo`, over AVPlayer, with expo-video's iOS events, and `<expo-video>` draws the player with AVPlayerView, its controls, full screen and picture in picture included. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- On macOS the desktop host downloads an Expo update's other assets with its bundle, checks each against the manifest's hash, and lays them out where the bundle looks for them, so an image new in the update shows. An asset a kept update already has with the same hash is not downloaded again. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- On macOS an Expo update whose bundle is Hermes bytecode finds its images: the desktop host answers each asset's `file:` URL by its file hash (`NgNativeUpdates.localAssets`), and `@ng-native/metro` makes React Native's `resolveAssetSource` look there first in a `macos` bundle. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- `@ng-native/desktop` hits a moved, scaled or rotated view on macOS where it is drawn, and reports touch, pointer and gesture positions in the view's own transformed coordinates. ([#1451](https://github.com/ng-native/ng-native/pull/1451))
- On macOS `Tracking` answers from the desktop host's `NgNativeTrackingTransparency`, over App Tracking Transparency: the permission is asked only when the app declares `NSUserTrackingUsageDescription`, and `advertisingId()` is null until tracking is allowed. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- On macOS `ng-native-desktop` checks for Xcode or the Command Line Tools, Swift 6.0, CMake 3.25 and Ninja 1.10 before it builds the host from source, and stops with the command that installs or updates each one missing or too old. The first build for a React Native version says up front that it takes about 4 minutes. The host and Hermes are built for macOS 14, the packaged app's minimum. ([#1451](https://github.com/ng-native/ng-native/pull/1451))
- On macOS the desktop host draws a header's `<native-search-bar>` from `@ng-native/router` as the window toolbar's search item (`NSSearchToolbarItem`), at its trailing end. It reports typing, Return, Escape, focus and blur as iOS does, and takes the search bar's `focus`, `blur`, `setText`, `clearText` and `cancelSearch` commands. ([#1451](https://github.com/ng-native/ng-native/pull/1451))
- On macOS `TextRecognition` answers from the desktop host's `NgNativeTextRecognition`, over Vision as on iOS: `available()` is true, and `recognize()` reads the lines in an image file with their confidence and their boxes in pixels from the top left. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- On macOS `<text-input>` maps `autoCorrect`, `spellCheck`, `smartInsertDelete`, `autoCapitalize`, `maxLength`, `placeholderTextColor`, the `selection` prop and `autoFocus` onto its AppKit field, switches `secureTextEntry` in place, and sends `(focus)` when it takes the keyboard. A new `smartQuotes` input turns curly quotes and dashes on or off as the user types on macOS, following `autoCorrect` when unset; iOS, Android and the web ignore it. ([#1451](https://github.com/ng-native/ng-native/pull/1451))
- `vitest --project macos` runs in the macOS desktop host. A test launch (`NGN_TESTS=1`) shows its windows without taking focus or a Dock icon, keeps its folders under `NGN_STATE_DIR`, its preferences in a defaults suite and its Keychain items under a prefix of its run, removes them as it ends cleanly (a later test launch removes the defaults suites and Keychain items of a run that did not), and answers open and save panels, Touch ID and alerts as cancelled, and a permission request with the current status, without asking. SIGTERM ends the host within three seconds, and `ng-native-desktop run` passes SIGTERM, SIGINT and SIGHUP to the host and exits with its status. The in-app test host waits for the main window on macOS, and gives Vitest the worker state it reads as it loads on Hermes. ([#1451](https://github.com/ng-native/ng-native/pull/1451))
- On macOS `<expo-symbol>` draws its SF Symbol with AppKit in the desktop host, with its type, tint, palette, weight, scale and `resizeMode`, and its view takes the symbol image's size at its point size through the host's `NgNativeSymbol`, as on iOS. Its `animationSpec` plays nothing on macOS. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- On macOS an svg draws its markers, patterns and filters: markers at a path's or line's vertices, turned with `orient`, patterns filling or stroking with their tile, and filters made of `feGaussianBlur`, `feOffset`, `feColorMatrix`, `feFlood`, `feComposite` and `feMerge`, which a drop shadow is drawn with. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- On macOS `StoreReview` answers from the desktop host's `NgNativeStoreReview`: in a Mac App Store (`mas`) build `available()` is true and `request()` asks for the system's rating prompt (unless the app runs with `NGN_NO_PROMPTS=1`), and in any other build, a sandboxed one included, it is inert. `storeUrl()` is null on macOS. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- On macOS a window's toolbar leads with back and forward chevrons that follow the window's history in `@ng-native/router`, each listing its entries by route title on a press and hold or a secondary click, and a two-finger back swipe over a native stack drags the screen in front aside with the screen below it showing, going back past a third of the width and sliding home when released early. `Menus.onNavigate` listeners in `@ng-native/device` are given the number of steps a pick from those lists goes. ([#1443](https://github.com/ng-native/ng-native/pull/1443))
- On macOS `splashScreen` answers from the desktop host's `NgNativeSplashScreen`: `hold()` keeps the app's first windows hidden past their first frame, and `hide()` or `hideWhenReady()` shows them. A hold after a window has already shown does nothing. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- On macOS `Sharing.share()` shows AppKit's share picker through the desktop host's `NgNativeSharing`: a message as text, and a url as a link or, for a `file:` uri or a path, as the file. `Sharing.available()` is true on macOS. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- `nx g @ng-native/nx:desktop <app>` and `ng generate @ng-native/schematics:desktop <app>` add macOS to an app: `@ng-native/desktop`, `macos` in `expo.platforms` with `experiments.outOfTreePlatforms: true`, the `@ng-native/desktop` config plugin, `/dist/macos` in the app's `.gitignore`, and `macos` and `package` targets that run `ng-native-desktop`. Each stops with an error on a project that has no `app.json`. The Angular CLI's `@ng-native/schematics:expo` builder takes `macos` and `package` as commands, and `macos` as an export platform. ([#1450](https://github.com/ng-native/ng-native/pull/1450))
- On macOS `<search-field>` is drawn as AppKit's `NSSearchField` at its `controlSize`, with its text, placeholder, type, `autoCapitalize` and `tintColor`. Return sends `(search)`, the clear button and Escape empty it and send `(cancel)`, and `focus()` and `blur()` work. ([#1451](https://github.com/ng-native/ng-native/pull/1451))
- On macOS, `import 'expo'` installs a `fetch` whose `Response` streams its `body` over React Native's Networking module, as Expo's `fetch` does on iOS and Android, so `HttpClient` with plain `provideHttpClient()` gets response bodies there too. The host streams the body as bytes, so `body`, `bytes()` and `arrayBuffer()` are byte-exact for a binary response too; `blob()` is made from the body as text, since React Native's `Blob` takes no bytes, and rejects with a TypeError for a body that is not UTF-8 text rather than change its bytes. `EXPO_PUBLIC_USE_RN_FETCH` set to `1` or `true` keeps React Native's own `fetch`. ([#1435](https://github.com/ng-native/ng-native/pull/1435))
- On macOS, a SIGTERM to the desktop host now runs the app's `AppLifecycle.willQuit` handlers before the host ends, where it ended without running any app code. No `canClose` guard is asked, and the host ends once the handlers have finished or two seconds after the signal, including when the signal arrives while a Command-Q is still waiting on a guard and that guard then says no. `NativeWindowEvent`'s `quitRequest` in `@ng-native/device` has an optional `terminate` flag for it. ([#1443](https://github.com/ng-native/ng-native/pull/1443))
- On macOS, VoiceOver's name for a `<modal>` sheet, cover or popover now follows its `accessibilityLabel` (or `aria-label`) when that changes or is removed while it is open, instead of keeping the label it opened with. ([#1519](https://github.com/ng-native/ng-native/pull/1519), [#1507](https://github.com/ng-native/ng-native/issues/1507))
- `@ng-native/metro` gives a `macos` bundle's `expo` the functions Expo's own libraries import as they load (`requireNativeModule`, `requireNativeView` and the rest), inert until used. `@expo/ui`'s modifiers, which call `requireNativeModule('ExpoUI')` on import, failed to load on macOS with "undefined is not a function". ([#1435](https://github.com/ng-native/ng-native/pull/1435))
- A `macos` dev bundle reads `process.env.EXPO_PUBLIC_*`. The `@ng-native/metro` preset resolved `expo/virtual/env`, which babel-preset-expo imports for those variables in dev, to an empty module, so a dev bundle threw at the first one it read. A release bundle, where the values are inlined, was not affected. ([#1435](https://github.com/ng-native/ng-native/pull/1435))
- On macOS, `native-stack-outlet` from `@ng-native/router` puts a screen's content in a safe area view, as on iOS 26, since a window's content runs under its title bar and toolbar. `<safe-area-provider>` from `@ng-native/components` publishes `--safe-area-inset-titlebar-leading`, the width of a macOS window's title bar buttons where content runs beside them, and `0px` elsewhere; `SafeArea.titlebarLeading` from `@ng-native/device` holds the same width. ([#1443](https://github.com/ng-native/ng-native/pull/1443))
- A box whose size or place transitions while its colour, or another property eased from JavaScript, transitions too has its size eased from JavaScript as well, so it eases over its duration rather than jumping to where it ends on the colour's first frame. A size transition alone is still laid out natively. ([#1442](https://github.com/ng-native/ng-native/pull/1442))
- On iPadOS a route window or an `AppWindows.open(component, { restoreKey })` window now renders again in its scene after a reload, where it went blank and closed five seconds later. ([#1488](https://github.com/ng-native/ng-native/pull/1488), [#1481](https://github.com/ng-native/ng-native/issues/1481))

  The windows are written to the app's user defaults through React Native's `Settings` on iPadOS as on macOS, so a relaunch opens them again as well.

- On iPadOS a relaunch now shows each window in the scene iPadOS restores for it, where the restored scene showed the main window and opening a hidden window left blank windows behind. ([#1498](https://github.com/ng-native/ng-native/pull/1498), [#1482](https://github.com/ng-native/ng-native/issues/1482))

  The scene host (`NgNativeWindows` in `@ng-native/components`) keeps the key of the window each scene session had in the app's user defaults, under `dev.ngnative.windowKeys`. `AppWindows` opening a key takes the scene kept for it: the restored scene, or a hidden one, where the window shows once the user opens it. A scene that connects after the app has launched goes to the windows even when it was made for the app's scene delegate, so React Native no longer starts a second time in it. The scene the app launched in waits five seconds for its own window; where the app does not open that key, a window waiting for its hidden scene shows there instead, or the scene closes.

- On an iPad, in a development build (not in Expo Go), `@ng-native/components` draws `<split-view>` as a UISplitViewController: the sidebar is its sidebar column and the content its other column, `[(collapsed)]` follows the system's sidebar button, `minWidth` and `maxWidth` bound the sidebar column, and at a compact width (Slide Over, a narrow window) UIKit collapses the columns into a stack whose root is the sidebar, keeping the router's page. Sections and items stay drawn from views. iPhone keeps the drawn split view. With the new `ios.multipleWindows` option of the `@ng-native/metro` config plugin, `AppWindows` opens each window on an iPad as a scene of its own, through the `NgNativeWindows` module: `close`, `focus` and `setTitle` act on the scene, a window the user closes reports itself closed without asking `canClose` guards, a scene iPadOS only disconnects in the background shows its window again when it reconnects, New Window opens the main window or brings it to the front, and `quit()` does nothing. Turning the option off again on a later prebuild goes back to one scene. On iPhone `AppWindows.available()` stays `false`. ([#1447](https://github.com/ng-native/ng-native/pull/1447))
- `@ng-native/components` carries native iOS code, linked in a development build (not in Expo Go). `<native-button>` is a UIButton on iOS, a glass button on iOS 26 and later, sized for Yoga and with `controlSize` as UIKit's button size. ([#1447](https://github.com/ng-native/ng-native/pull/1447))
- On iOS, in a development build (not in Expo Go), `@ng-native/components` draws the iPad menu bar from `<menu-bar>` through UIMenuBuilder, with its items' shortcuts. A `<menu-item>` whose shortcut UIKit's own menus already have (a handled `find` on mod+f, say), or that an earlier item of the app has, goes into the menu bar without the shortcut. A `[shortcut]` whose key iOS can map works from a hardware keyboard on iPhone and iPad, except a chord UIKit's own menus already have, or one a focused text input takes first. `UndoStack` is available on iOS, over one undo manager that every window shares, with each action an undo step of its own, so shake to undo, mod+z and Edit > Undo on an iPad reach the app's actions while no text input, or other view with an undo history of its own, has focus. `[contextMenu]` opens on a long press on iOS, and on a secondary click from an iPad pointer, as a UIContextMenuInteraction on the element's own view, found by its `nativeID` (an element without one is given one), and a `(longPress)` on the same element then does not also fire. On iPadOS, `(fileDrop)` takes files, text and links dragged onto a view, a dropped text file arriving in `files` and not as `text`, and `[dragItem]` lets a view be dragged out, through `DragAndDrop` in `@ng-native/device`. ([#1447](https://github.com/ng-native/ng-native/pull/1447))
- On iOS, a `<pressable>` with its own `(longPress)` inside an element with a `[contextMenu]` keeps its long press, and its `(press)`: a long press there opens no menu, as the innermost handler wins in a native app, and on iPadOS a pointer's secondary click there opens none either. `Menus` in `@ng-native/device` has `setTakesLongPress(nativeID, takes)`, which the `NgNativeMenus` module takes beside `setContextMenu`. ([#1447](https://github.com/ng-native/ng-native/pull/1447))
- `provideInteractionObserver()` in `@ng-native/components` reports the taps and long presses a control fires, and on iOS and Android the scrolls and swipes a user drags, as a plain `InteractionEvent`, for an analytics or monitoring tool that cannot see React Native's own `Pressable` and `ScrollView` in an Angular Native app. ([#1453](https://github.com/ng-native/ng-native/pull/1453), [#1452](https://github.com/ng-native/ng-native/issues/1452))

  A `click` or `long-press` comes from `<pressable>`, `<touchable-opacity>`, a pressable `<text>` and a component composing `PressBehavior`, including Android's click from a keyboard, the D-pad or TalkBack. A `scroll` or `swipe` comes from `<scroll-view>` and `<virtual-list>` on iOS and Android, and not for a scroll made by code; the web host reports taps and long presses only. `HostEngine` gains an optional `tagOf()`, which `Engine` already had.

- A component can name itself in interaction reports, or be left out of them, with an `interactionName` attribute on its host. ([#1495](https://github.com/ng-native/ng-native/pull/1495), [#1471](https://github.com/ng-native/ng-native/issues/1471))

  `host: { interactionName: 'Checkout card' }`, or `interactionName="Checkout card"` where the component is used, makes `InteractionEvent.component` report that name instead of the selector, including for a page with no selector. An empty `interactionName` leaves the component out, so its controls report the component around it, or no `component`. The attribute is read only when an interaction is reported and is never committed to the native view.

- An interaction event from `provideInteractionObserver()` in `@ng-native/components` now carries `component`, the selector of the nearest component the pressed control or dragged scroll view is rendered inside, so taps on every `<app-button>` can be grouped without a `testID` on each. ([#1463](https://github.com/ng-native/ng-native/pull/1463), [#1458](https://github.com/ng-native/ng-native/issues/1458))

  It is found only when an observer is registered and an interaction fires. It is absent for a control in the root component's own template, and on the web host. A component that composes `PressBehavior` onto its own host is named by `element`, as before, and `component` is the one around it.

- `InteractionEvent.component` now names routed pages, the component that declares a native tab bar for a tab tap, and components matched by an attribute selector. ([#1494](https://github.com/ng-native/ng-native/pull/1494), [#1470](https://github.com/ng-native/ng-native/issues/1470), [#1472](https://github.com/ng-native/ng-native/issues/1472))

  The component is read from the definition Angular mounted on each host, by its selector, rather than from the host element's name. A control on a page shown by `<native-stack-outlet>` or `<native-tabs-outlet>` reports that page, where it reported the component around the outlet or none. A tap on a native tab reports the component whose template declares the tab bar. A component with a selector such as `section[x-card]` is reported by that selector, where it was skipped as a plain view, and a component of several selectors by the one its host matches. A page with no selector and no `interactionName` reports no `component`. An element web-compat keeps a plain view, such as an emulated `<iframe>`, is never reported as a component.

- `@ng-native/testing/device` runs Vitest component tests inside the running app on a Mac, an iOS simulator or an Android emulator. A Vitest project with `deviceTests({ platform: 'macos' })` starts the desktop host with fresh state, keeps a snapshot file per platform, and after a crash fails the file that was running with the crash report's path and runs the rest on a new host. ([#1446](https://github.com/ng-native/ng-native/pull/1446))
- A stylesheet's `:hover`, `:focus-within` and `:focus-visible` rules apply, where they were dropped with a build warning. `:hover` matches while a mouse, a trackpad or a pencil is over the element, never a finger, and only an element a `:hover` rule could match is told of the pointer, so an app with no such rule commits nothing more. On iOS and Android it takes the `pointerEvents` option of the `@ng-native/expo` config plugin, as `hovered` does. `:focus-within` matches the focused element and each element it is in. `:focus-visible` matches focus the host says came from the keyboard, which the macOS host reports, and a focused text field; on iOS and Android, where a tap focuses only a text field, it matches every focused element. Media queries answer `hover`, `any-hover`, `pointer` and `any-pointer`: `hover` and `fine` on macOS, `none` and `coarse` on iOS and Android. `(pointerEnter)` and `(pointerLeave)` no longer run a second time for a pointer entering a view inside the one listening. On macOS, `fontScale` in the conditions and in `Accessibility` is 1. ([#1442](https://github.com/ng-native/ng-native/pull/1442))
- `HostEngine` in `@ng-native/fabric` has `watchProp(node, key, listener)`, which hears each change `setProp` makes to one prop of a node, taking it away included. ([#1443](https://github.com/ng-native/ng-native/pull/1443))
- On macOS a screen with `gestureEnabled: false`, from its presentation or its page's host bindings, is not left by the OS's back and forward inputs (a two-finger swipe, Cmd-[ and Cmd-], mouse buttons 4 and 5), as it is not left by a swipe on iOS. `NavigationHistory`'s `back()` and `forward()` from the app still go. ([#1443](https://github.com/ng-native/ng-native/pull/1443))
- On iOS and macOS, `<native-header-item [menu]>` in `@ng-native/router` takes a template of `<menu-item>`s, `<menu-group>`s and `<menu-separator>`s, as `[contextMenu]` and `<menu-bar>` do: a group is a submenu, or with `inline` a section, a separator starts a section, a `[(checked)]` item shows its state, and the chosen item's `(select)` runs. An item with a `menuRole` and no `(select)` is left out with a warning, since a header menu has no OS action to run for it. A choice from a menu drawn before its items changed runs the item chosen, or nothing once it has gone. The `HeaderMenu` object and `(menuSelect)` keep working. `buildMenuTemplate`, `treeOrder` and `menuModelInTreeOrder` are in `@ng-native/device`, and `@ng-native/components` still exports `treeOrder`. ([#1443](https://github.com/ng-native/ng-native/pull/1443))
- `watchConditions()` from `@ng-native/device` updates the `--hairline` token when a window resize reports a new pixel ratio, such as a Mac window moved to a display of another density, so `border-hairline` and `var(--hairline)` stay one physical pixel thick. React Native's `StyleSheet.hairlineWidth` keeps the value it had at startup. ([#1443](https://github.com/ng-native/ng-native/pull/1443))
- `untrackedGesture()` from `@ng-native/components/gestures` keeps one gesture of a composed gesture out of interaction reports while the others are still reported, as in `Gesture.Race(Gesture.Tap(), untrackedGesture(Gesture.Pan()))`. ([#1487](https://github.com/ng-native/ng-native/pull/1487), [#1474](https://github.com/ng-native/ng-native/issues/1474))

  It returns the gesture it is given, and an untracked composed gesture keeps every gesture it is made of out. It is read when the gesture is attached to an element with `[gesture]` on iOS and Android, and like `[trackGesture]="false"` it adds no work when no interaction observer is registered.

- Interaction observers now hear native gestures attached with `[gesture]` on iOS and Android: a tap as a `click`, a long press as a `long-press`, a fling or a fast pan as a `swipe`, and a slower pan, a pinch or a rotation as the new `gesture` type. ([#1466](https://github.com/ng-native/ng-native/pull/1466), [#1459](https://github.com/ng-native/ng-native/issues/1459))

  Each such event names the gesture in a new `gesture` field and carries the element the gesture is attached to, with the `component` around it as a pressed control has. A pan or a fling adds `direction` and `distance`, and a pinch `scale`; a gesture's `direction` is the way the finger moved, and a pan that ends where it started has a `distance` of 0 and no `direction`. Only a gesture that ends successfully is reported, once, and with no observer registered a gesture does no reporting work. `[trackGesture]="false"` keeps an element's gestures out.

- `FileSystem.pickDirectory()` in `@ng-native/expo/file-system` opens the system folder picker on iOS and Android and answers the folder the user chose, or `null` when they dismiss it. A file is made in that folder with its `createFile(name, mimeType)` and written with `write()`. ([#1417](https://github.com/ng-native/ng-native/pull/1417))
- `FileSystem.readdir()`, `stat()` and `watch()` in `@ng-native/expo` answer on iOS and Android in the same forms as on macOS: `readdir()` sorts the entries by name, gives a folder's `uri` without a trailing slash and rejects a folder that is not there (on Android it resolved to an empty list), `stat()` gives a folder's `size` as 0 rather than the total of what is in it, and `watch()` reports a folder's `uri` without a trailing slash. ([#1521](https://github.com/ng-native/ng-native/pull/1521), [#1512](https://github.com/ng-native/ng-native/issues/1512))

  On Android, `stat()` and `watch()` also reach a path whose uri holds a character a uri cannot, such as an unescaped space, where they threw before.

- `FileSystem` from `@ng-native/expo/file-system` lists a folder with `readdir()`, describes a path with `stat()` (its size, whether it is a folder, and when it was modified and created) and reports changes to a path with `watch()`, through `expo-file-system`'s `Directory`, `File` and `Paths`. `paths` names the app's `cache` and `document` folders as uris, and has `home`, `desktop`, `downloads`, `temp` and `appData`, which are `null` on iOS and Android. Where the service is absent, `readdir()` answers no entries, `stat()` answers `null` and `watch()` reports nothing. ([#1436](https://github.com/ng-native/ng-native/pull/1436))
- On macOS `FileSystem` in `@ng-native/expo` reads and writes through the desktop host's `NgNativeFileSystem`, and `paths` names `home`, `desktop`, `downloads`, `temp` and `appData`. `pickDirectory()` opens the desktop host's folder panel, and a picked folder's `createFile()` makes the file in it. A file there is synchronous as it is on iOS and Android, through the host's synchronous file calls: `exists` and `size` say what is there when read, `create()`, `write()` and `delete()` are done when they return (`create()` fails rather than empty a file that is there), and `textSync()` reads at once. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- A url that names a page of another tab in the root's `presented` outlet, such as `/home(presented:library/7)`, now shows that page when it arrives before `present()` ever showed it: as a launch link, as a link while the app runs, or through `router.navigateByUrl()` or `router.navigate()`. Before, the router failed with `NG04002: Cannot match any routes`. ([#1412](https://github.com/ng-native/ng-native/pull/1412), [#1407](https://github.com/ng-native/ng-native/issues/1407))

  The page is given its route in the `presented` outlet only when no route there takes the url. That navigation is then cancelled with a redirect and starts again, once, to the same url with the same state. A url that names no page of the app, or a page `present()` shows in its own tab instead, such as one behind a `canMatch` guard, still fails with `NG04002`. With no presentation of its own, as from a link, the page is presented as a modal. `router.config` now holds one more route in the `presented` outlet, after the pages' routes there, with the path `**` and a `canMatch` guard. It is added again as the next navigation starts after `resetConfig()`.

- `<native-stack-outlet>` and `<native-tabs-outlet>` now bind route resources to a page's inputs under `withComponentInputBinding()` and `withRouterResources()`, as `RouterOutlet` does: a blocking resource arrives as its value and a `nonBlocking()` one as the resource itself. Before, a route resource never reached an input on either outlet. ([#1484](https://github.com/ng-native/ng-native/pull/1484), [#1478](https://github.com/ng-native/ng-native/issues/1478))

  Both outlets now bind through Angular's own input binder, so an update to a param, query param or data after the page opens reaches its input a microtask after the navigation, as under `RouterOutlet`, rather than during it.

- `<native-stack-outlet>` and `<native-tabs-outlet>` now bind route data to a page's inputs by the options given to `withComponentInputBinding()`, as `RouterOutlet` does. With `queryParams: false` a query param no longer reaches an input of the same name, and with `unmatchedInputBehavior: 'undefinedIfStale'` an input keeps its default until its key has been in the route. Before, both options were ignored. ([#1444](https://github.com/ng-native/ng-native/pull/1444))
- On macOS the windows an app had open come back after a reload or a relaunch: the main window, each route window at the path it last opened, and each `AppWindows.open(component, { restoreKey, inputs })` window with its inputs, where `provideRestorableWindows({ name: Component })` in `@ng-native/device` names its component. They are kept in the app's user defaults through React Native's `Settings`, and a window the user or the app closed is forgotten. Opening a `restoreKey` that is open brings that window to the front rather than opening a second. ([#1443](https://github.com/ng-native/ng-native/pull/1443))
- `Processes.spawn(program, args, { cwd, env })` runs a program the app declares in `capabilities.spawn` on macOS, never through a shell, with its standard output, standard error, standard input, exit and `kill`; an undeclared call throws `UndeclaredCapabilityError`, and only the variables `capabilities.env` declares reach the program. A new `Shell` service in `@ng-native/device` has `openExternal`, `openPath` and `showItemInFolder` on macOS. Both resolve null or false on iOS, Android and the web, where they are absent. ([#1446](https://github.com/ng-native/ng-native/pull/1446))
- `Processes` from `@ng-native/device` holds the environment a desktop app was started with, in `env`, read from the desktop host's module. It is absent on iOS, Android and the web, where `available()` is `false` and `env` is empty. ([#1446](https://github.com/ng-native/ng-native/pull/1446))
- `Printing` from `@ng-native/expo/printing` is a new service over `expo-print`, an optional peer: `print({ html })` or `print({ uri })` shows the print dialog, `printToPdf(html)` renders HTML to a PDF file and answers its uri, and `selectPrinter()` opens iOS's printer picker and answers the printer, or `null` when it is dismissed and on Android. Where the service is absent, on the web and in a test that provides no module, `print()` does nothing and the others answer `null`; on iOS, Android and macOS a build without the module throws a `MissingModuleError` when one is called. ([#1436](https://github.com/ng-native/ng-native/pull/1436))
- `present()` from `@ng-native/router` takes an `anchor`, an element or a component, and commits its view's tag as the presented screen's `anchor` prop, which the macOS host shows the screen as a popover at. iOS, iPadOS included, and Android ignore it. ([#1443](https://github.com/ng-native/ng-native/pull/1443))
- `@ng-native/eslint-plugin` has a new `prefer-hairline-token` rule, a warning in `recommended`, that reports `StyleSheet.hairlineWidth`, which React Native works out once at startup, and suggests `var(--hairline)`, which `watchConditions()` updates when a window reports a new pixel ratio. ([#1443](https://github.com/ng-native/ng-native/pull/1443))
- Twenty-two more service pages carry a Platforms line, drawn from the support table: AppInfo, ([#1446](https://github.com/ng-native/ng-native/pull/1446))
  Battery, Browser, Calendar, Clipboard, Crypto, DocumentPicker, FileSystem, Fonts, Haptics,
  ImageEditor, ImagePicker, KeepAwake, Locale, Location, MediaLibrary, Network, Notifications,
  Printing, SplashScreen, TextRecognition and Updates, each available on macOS, iPadOS and iPhone,
  on Android except TextRecognition, and absent on the web host. The TextRecognition page now says
  it runs on macOS as well as iOS.

- `@ng-native/device` exports `platformsLine` and `supportRowOf`, which read the OS support table for one service. Each service page in the documentation that has a row there opens with a "Platforms" line drawn from it. ([#1446](https://github.com/ng-native/ng-native/pull/1446))
- Each window `AppWindows` opens has a `Screen` and a `SafeArea` of its own, sized by that window, and its media queries resolve against the window's size and scale. A change of colour scheme, text size or reduced motion that `watchConditions` gives the app reaches every window, with the `dark` class, where windows kept the conditions they opened with and only took their own resizes. ([#1443](https://github.com/ng-native/ng-native/pull/1443))
- `@ng-native/device` exports `OS_SUPPORT`, also as `@ng-native/device/os-support`: what each desktop API and macOS-only input does on macOS, iPadOS, iPhone, Android and the web host. The documentation's new "What each OS has" page is drawn from it. ([#1446](https://github.com/ng-native/ng-native/pull/1446))
- `nx typecheck` in a workspace whose libraries are the package manager's links resolves `@ng-native/testing/device` and its other entry points to the app's own copy, as it does the other packages' entry points. ([#1446](https://github.com/ng-native/ng-native/pull/1446))
- `Notifications` in `@ng-native/expo` works on macOS: the notifications that arrive while the app runs and the ones the user clicks reach `latest` and `response`, and a date in a trigger crosses to the host as milliseconds. The Android channels and the categories have no macOS counterpart and answer empty or do nothing there. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- `@ng-native/expo/notifications` exports `ImportanceLevel`, the numbers of `expo-notifications`' `AndroidImportance` enum, so `setChannel()` can be given an importance without loading the module. Each request `scheduled()` answers now has `at`, the `Date` it fires at: for a date trigger on Android, and for a calendar trigger on iOS that fires once, in the Gregorian calendar, with a whole date and time and no time zone. It is `null` for every other trigger, an iOS date trigger included, since iOS reports one as an interval. ([#1418](https://github.com/ng-native/ng-native/pull/1418))
- `@ng-native/router` keeps a back and forward history for each window, as `NavigationHistory`, for desktop OSes: one list per window spanning every change of its outlet, with forward building its page again from the URL. It moves through it for the OS's back and forward commands. `@ng-native/device` gives View > Back and Forward each OS's keys through `navigationShortcut`: Cmd-[ and Cmd-] on Apple's OSes, Alt-Left and Alt-Right elsewhere. `mount` from `@ng-native/platform` no longer fails when an environment initializer asks for `AppWindows`. ([#1443](https://github.com/ng-native/ng-native/pull/1443))
- On macOS, a window whose outlet shows nothing (its route closed while the window stays open) now has its back and forward chevrons and their history menus cleared, where they kept the last titles and did nothing when chosen. ([#1443](https://github.com/ng-native/ng-native/pull/1443))
- `NavigationHistory` keeps the last 100 entries of a window and drops the oldest, so an app that navigates for days no longer grows the list for as long as it runs. ([#1443](https://github.com/ng-native/ng-native/pull/1443))
- Interaction observers now hear a `<switch>` the user flips and a `<native-button>` pressed where the platform draws it (iOS and macOS), each as a `click` with no value. ([#1464](https://github.com/ng-native/ng-native/pull/1464), [#1460](https://github.com/ng-native/ng-native/issues/1460))

  A switch's event carries its label, IDs and role but not whether it is now on, and its `source` is `click`, as it has no touch point; so is a native button's on iOS and macOS. A native button on Android was already reported through the responder. Observers run after the control's own outputs, and a disabled native button reports nothing.

- `@ng-native/components` has `<native-button>`, a platform button whose label is the text inside it, with `kind` (`default`, `cancel`, `destructive` or `plain`), `controlSize`, `sfSymbol`, `drawable`, `icon`, `[disabled]` and `(press)`. On macOS and iOS it commits the `NgNativeButton` view, which the macOS host draws as an NSButton; on Android it is a view pressed as a `<pressable>` is, and the web host draws an HTML `button`. `<switch>`, `<activity-indicator>`, and `@ng-native/expo`'s `<segmented-control>`, `<date-time-picker>` and `<search-field>` take `controlSize` (`mini`, `small`, `regular` or `large`), which `@ng-native/device` exports as the `ControlSize` type: AppKit's control sizes on macOS, and ignored on Android and the web. `@ng-native/eslint-plugin`'s `no-html-controls` names `<native-button>` for an HTML `<button>`. ([#1442](https://github.com/ng-native/ng-native/pull/1442))
- `<native-button>` with no `kind` no longer commits `kind: 'default'`, so on macOS it is a plain push button rather than the window's default button: it is not drawn in the accent colour and Return does not press it. Only `kind="default"` takes Return. ([#1442](https://github.com/ng-native/ng-native/pull/1442))
- A `<modal>`'s `(requestClose)`, `(show)`, `(dismiss)` and `(orientationChange)` reach that modal's own handler only, as React Native delivers them. A modal presented from inside another one handed them on to the one around it as well, so one Escape on macOS, or one back press on Android, closed both. ([#1442](https://github.com/ng-native/ng-native/pull/1442))
- `<modal>` from `@ng-native/components` takes an `anchor`, an element or a component, and commits its view's tag as the `anchor` prop, which the macOS host shows the modal as a popover at. iOS, iPadOS included, and Android ignore it. ([#1443](https://github.com/ng-native/ng-native/pull/1443))
- The error `@ng-native/metro` throws when an app asks for macOS without `experiments.outOfTreePlatforms` now shows what to add to app.json, `"expo": { "experiments": { "outOfTreePlatforms": true } }`, merged into the `expo` object already there rather than replacing it, and says to return `experiments: { outOfTreePlatforms: true }` from the config in `app.config.js` or `app.config.ts`. It also throws for an app.json that lists `macos` in `expo.platforms` without the flag, which Expo's config reading drops from the platforms before the check saw it. ([#1435](https://github.com/ng-native/ng-native/pull/1435))
- `withAngularNative()` bundles `macos` (`npx expo export -p macos`, Expo SDK 58) with React Native's iOS paths: React Native's own `Platform.OS === 'ios'` checks match `macos` too, in dev and release, so `Alert.alert` keeps its body, and `Platform.select` answers from `macos`, then `ios`, then `native`, then `default`. App code sees `Platform.OS` as `'macos'`. On macOS, `expo/*` and every `expo-*` package resolve to an empty module, except `expo/virtual/env`, which resolves normally so a dev bundle reads `EXPO_PUBLIC_*` values, and `import 'expo'` installs `URL`, `URLSearchParams`, `TextDecoderStream`, `DOMException` and `structuredClone`. A `macos` bundle's sheets keep a `skewX()` or `skewY()`, which the macOS host draws, and refuse a filter iOS does not draw, whether a rule is scoped with `.platform-macos` or not. The preset throws when `expo.platforms` lists `macos`, or the command asks for it, without `experiments.outOfTreePlatforms: true`, which Expo needs to bundle `macos` at all. ([#1435](https://github.com/ng-native/ng-native/pull/1435))
- `@ng-native/components` has `<menu-bar>`, `<menu-group>`, `<menu-item>` and `<menu-separator>`, `[shortcut]` with `(shortcutPress)`, and `[contextMenu]`, and `@ng-native/device` has the `Menus` service that sends them to a host with the `NgNativeMenus` module. The menu bar is drawn where the host has one, and its shortcuts work from a hardware keyboard elsewhere. A context menu opens on a right-click on macOS, and on a long press or a right-click on Android, where the long press then does not also fire `(longPress)`. On Android the shortcuts work from a hardware keyboard and are listed in the Keyboard Shortcuts helper. ([#1443](https://github.com/ng-native/ng-native/pull/1443))
- Interaction observers now hear an action picked from a `<native-header-item>`'s `[menu]` in `@ng-native/router`, and each segment picked in a `<segmented-control>` from `@ng-native/expo`, as a `click`. ([#1492](https://github.com/ng-native/ng-native/pull/1492), [#1476](https://github.com/ng-native/ng-native/issues/1476))

  A menu action is reported on iOS, where header bar menus are drawn, after the action runs or `(menuSelect)` is emitted, with the action's title as `label` and the `role` `menuitem`; a disabled action, or one the menu no longer has, reports nothing. A segmented control, with the `SegmentedControl` component imported, is reported on iOS and macOS after its `change`, without the segment picked.

- A streaming `markdown` element holds back a last line of only a list marker (`+`, `*`, `1.` or `1)`) until the line ends, so it no longer draws as text in the paragraph above until the item's first letter arrives. ([#1479](https://github.com/ng-native/ng-native/pull/1479), [#1468](https://github.com/ng-native/ng-native/issues/1468))

  The hold applies after any quote markers too, and clearing `streaming` still draws the source as it is.

- A streaming `markdown` element holds back a last line of only dashes or `=` (with pipes, colons and spaces) until the line ends, so the text above it stays a paragraph rather than flashing as a heading, and a table whose delimiter row starts with one dash (`- | -`) streams as a table rather than as a paragraph and a list. ([#1462](https://github.com/ng-native/ng-native/pull/1462), [#1456](https://github.com/ng-native/ng-native/issues/1456))
- On macOS, the desktop host draws `react-native-svg`'s views with Core Graphics when the app has `react-native-svg` installed, so `@ng-native/icons` draws there: groups, paths, rects, circles, ellipses and lines, linear and radial gradients, clip paths, luminance masks, `use` and `symbol`, images and text. `foreignObject` and `textPath` draw nothing yet. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- On macOS, a global sheet an app adds with `app.engine.addGlobalSheet()` reaches every window, where it reached only the hidden app surface and drew nothing. A window already open, one opened later, and a sheet replaced or removed all follow, and a window opens with the tokens the app has at that moment, such as the hairline, and takes each `updateTokens` after. ([#1443](https://github.com/ng-native/ng-native/pull/1443))
- `@ng-native/platform` lays out again the text in a desktop window (`AppWindows`, on macOS) that names a font face registered after the window drew, as it already did for the app's own surface. The window's text stayed measured in the fallback face, so a taller face was clipped. ([#1443](https://github.com/ng-native/ng-native/pull/1443))
- The web host in `@ng-native/web` keeps a component's `interactionName` off its DOM element, as iOS and Android keep it off the native view, while interaction reports still read it. ([#1504](https://github.com/ng-native/ng-native/pull/1504), [#1501](https://github.com/ng-native/ng-native/issues/1501))
- `InteractionEvent.component` is set on the web host too, naming the component around a tapped control as it is on iOS and Android. ([#1490](https://github.com/ng-native/ng-native/pull/1490), [#1469](https://github.com/ng-native/ng-native/issues/1469))

  `@ng-native/web` marks each component's host element as the native renderer does, and the root component is told by being the outermost component rather than by its depth under a surface, so a control in the root component's own template still reports no `component` on either host.

- A `<virtual-list>` or `<section-list>` scrolled partway into a row taller than the rows after it, such as a photo over its comments, now renders every row down to the end of the viewport. Before, it stopped about a viewport below the top of that row, leaving the rest of the screen blank until the tall row scrolled away. Horizontal lists, measured rows and fixed heights all had it. ([#1455](https://github.com/ng-native/ng-native/pull/1455), [#1454](https://github.com/ng-native/ng-native/issues/1454))
- `Updates` in `@ng-native/expo` adds `checkForAppUpdate()` and the `appUpdateAvailable` signal, for a whole-app updater. In a macOS `dmg` build it is Sparkle, through the desktop host: `checkForAppUpdate()` shows Sparkle's check, and `appUpdateAvailable` follows what it has found. On iOS and Android `checkForAppUpdate()` opens the app's store page, from `ios.appStoreUrl` or `android.playStoreUrl` in the app config, and resolves `true`, or `false` when the config names none or `expo-updates` or `expo-store-review` is not installed; an app without `expo-store-review` still builds. `appUpdateAvailable` stays `false` on iOS and Android, as the stores give the app no way to ask. On macOS in development and in `app` and `mas` builds, and on the web, both are inert. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- `@ng-native/device` adds `UndoStack`, which puts the app's own actions on the OS's undo manager (NSUndoManager on macOS, UIUndoManager on iOS and iPadOS), so Edit > Undo and Redo, mod+z and shake to undo take them back while no text input has focus. It is absent on Android and in the web host. `@ng-native/testing` adds `fakeUndo()`, which `provideDesktopFakes()` provides. ([#1443](https://github.com/ng-native/ng-native/pull/1443))
- `@ng-native/testing`: a `render` that names no `os` renders as the project's (the Vitest preset's `os`, from `expo.platforms`), so a desktop-only app's tests get a Mac's tokens, pointer and desktop fakes without passing `os: 'macos'` to each render. `userEvent.keyboard` presses a drawn menu bar's key equivalents, as AppKit does. A `<native-button>` is found by its label with `getByRole('button', { name })`, and `userEvent.press` sends it the press the host's button does, unless it is disabled. ([#1446](https://github.com/ng-native/ng-native/pull/1446))
- `@ng-native/testing` tests an app on another OS. The Vitest preset takes `os` (`'ios'`, `'android'`, `'macos'` or `'web'`), following `expo.platforms` in `app.json` when unset, and an extensionless import resolves the OS's platform file first (`.macos`, then `.ios`, then `.native` on a Mac). `render(X, { os, osVersion })` renders one component as another OS: its tokens, view names, platform class, variants, and a Mac's `hover` and `fine` pointer. `userEvent` gains `hover`, `unhover`, `dblClick`, `rightClick`, `wheel`, `keyboard('mod+k')` and `tab()`, and `fakeMenus`, `fakeDock`, `fakeTray`, `fakeWindows`, `fakeProcesses` and `provideDesktopFakes` record what an app sends the desktop host, which a render on macOS gets by default. ([#1446](https://github.com/ng-native/ng-native/pull/1446))
- In `@ng-native/testing`, `render(X, { os: 'macos' })` renders the component in the main window `AppWindows` opens, with a recording fake of the host's windows and of its deep links, as `provideDesktopFakes()` now also provides. `screen.windows()` lists the open windows, each with queries bound to its own views, and `screen`'s queries search every window. A menus fake finds an item with `item({ menuRole, label })` and chooses one with `choose(...)`. `userEvent.rightClick` answers the context menu it opened, to choose from; `userEvent.dropFiles` drops files on a view; and `userEvent.closeWindow`, `quit`, `reopen` and `openUrl` play the window's close button, Cmd-Q, a Dock click and a link opening the app. ([#1446](https://github.com/ng-native/ng-native/pull/1446))
- `@ng-native/template-desktop` starts a macOS-only app: `npx create-expo-app my-app --template @ng-native/template-desktop`. It lists `macos` alone in `expo.platforms`, with `experiments.outOfTreePlatforms: true` and the `@ng-native/desktop` config plugin, has the scripts `start`, `macos`, `package`, `test` and `typecheck`, and starts on a sidebar and split view with a menu bar, sized for the Mac. Its tests run in two Vitest projects: `node-macos`, which `npm test` runs in Node, and `macos`, which `npx vitest --project macos` runs inside the app on a Mac, from `src/**/*.device.ts`, with Metro started with `EXPO_PUBLIC_DEVICE_TESTS=1`. `@ng-native/desktop` is published with the other packages. ([#1450](https://github.com/ng-native/ng-native/pull/1450))
- `@ng-native/tailwind` has `macos:` and `desktop:` variants, beside `ios:` and `android:`, in `native.css` and the Tailwind 3 preset; `desktop:` is macOS today. On native, `hover:` and `hovered:` take `web.css`'s form: `hover:` matches a real `:hover` as well as the pressed state and `data-hover`, `hovered:` matches `:hover` and `data-hover` only, and `focus-visible:` matches `:focus-visible` and `data-focus`. On macOS that is a focused text field, or another element the keyboard focused; on iOS and Android it is still every focused element. `font-mono` and an HTML `code` element are in Menlo on macOS. ([#1442](https://github.com/ng-native/ng-native/pull/1442))
- On macOS `database()` in `@ng-native/expo` opens its database through the desktop host's `NgNativeSqlite`. `prepareAsync` and `serializeAsync` throw there, and a row's keys are not in the order of the `SELECT`. ([#1449](https://github.com/ng-native/ng-native/pull/1449))
- On an iPad, a `<split-view>` brings its sidebar back when its window gets wider again, after a narrower width or a compact one had hidden it, and that hiding no longer sets the sidebar's `collapsed` to `true`. ([#1493](https://github.com/ng-native/ng-native/pull/1493), [#1483](https://github.com/ng-native/ng-native/issues/1483))

  `collapsed` still follows the sidebar button and the swipe that opens or shuts the sidebar, and a sidebar the user shut stays shut as the window's size changes.

- `@ng-native/device` adds the rules for a desktop app's declared capabilities, and the `@ng-native/desktop` plugin options they are declared in (`documentTypes`, `capabilities.spawn`, `capabilities.env`, `capabilities.paths` and `deny`), importable in Node from `@ng-native/device/desktop-options` for a config plugin. A spawn capability is an absolute program or a bare name resolved on `/usr/bin`, `/bin`, `/usr/sbin`, `/sbin`, `/opt/homebrew/bin` and `/usr/local/bin`, with literal arguments and anchored `{name:regex}` placeholders (`{name:regex}...` for zero or more); a placeholder takes no argument starting with `-` unless its pattern starts with one, and shells, `env`, programs that run their arguments as a command, and `.bat` and `.cmd` files are refused. `validateDesktopOptions` names where each problem is, unknown keys included. ([#1441](https://github.com/ng-native/ng-native/pull/1441))
- `@ng-native/router` adds `SidebarItemPath`, the `sidebar-item[path]` directive: the route selects the item with `<native-tab>`'s matching, the longest path that starts the url winning, and choosing the item navigates to its path. A tab bar on macOS is the window's sidebar, and a `<native-tab>` naming only a `drawable` warns there, as it does on iOS, that it has no icon. ([#1446](https://github.com/ng-native/ng-native/pull/1446))
- On macOS the content written inside a `<sidebar-item>` fills the row the host puts it in, with no `flex: 1` of its own. The row's padding, gap and centred row layout apply only where the row is drawn from views, on iOS and Android. ([#1446](https://github.com/ng-native/ng-native/pull/1446))
- `@ng-native/components` adds `<split-view>`, `<sidebar>` (`[(collapsed)]`, `minWidth`, `maxWidth`, `autosave`), `<sidebar-section>` (`title`, `collapsible`) and `<sidebar-item>` (`label`, `badge`, `sfSymbol`, `drawable`, `icon`, `[(selected)]`, `(select)`, and content that replaces the default row). The macOS desktop host draws them as a split view with a source-list sidebar. On iOS, Android and the web host they are drawn from views: two columns, or below `Screen.compact`'s width (Material's expanded width, 840dp, on Android) a stack whose root is the sidebar, where choosing an item shows the content and `showSidebar()` or Android's back button returns to the sidebar. ([#1446](https://github.com/ng-native/ng-native/pull/1446))
- `@ng-native/fabric` gives every surface on a runtime one event dispatcher, which registers with Fabric once and hands each event to the engine that made its target. With two surfaces, such as two desktop windows, the later one no longer takes the earlier one's events. `Engine.leaveEvents()` stops a surface's engine taking events as the surface goes. ([#1443](https://github.com/ng-native/ng-native/pull/1443))

### ❤️ Thank You

- Ashley Hunter
- Dor Peled
- erKam @erkamyaman
- Gabriel Silva @GabeSilvaDev
- Mohamed Ben Makhlouf @medbenmakhlouf

## 0.22.2 (2026-11-06)

### 🩹 Fixes

- `background-image: var(--g)` now draws the gradients its token holds, `currentColor` in a background token's last layer is now the text colour, and a written `background: platform-color(...)` in a stylesheet now takes away a weaker rule's image, as Chrome does for each. ([#1395](https://github.com/ng-native/ng-native/pull/1395))

  `background-image: var(--g)` was dropped with a warning in a stylesheet and in a `style` attribute or `[style.background-image]` binding. It now reads a token from a stylesheet, one set on an element, or a fallback. A token of `none`, one with a colour in it or one that holds no image leaves no image, as in Chrome, where such a value is invalid.

  A token such as `--x: center currentColor` in `background: linear-gradient(...), var(--x)` or `background: var(--x)` was read as invalid, so nothing was drawn. Its colour is now the element's text colour, its own or inherited, and follows it when it changes. The same holds for a token set on an element, a `var()` fallback, and `background: linear-gradient(...), currentColor` in a `style` attribute or `[style.background]` binding, which was dropped with a warning.

  `background: platform-color(link)` in a stylesheet now writes no image and the initial position, size and repeat, as `background: red` does, where a weaker rule's image stayed. A system colour such as `background: LinkText` already did this, and so did a `style` attribute or a `[style]` binding.

- `ScreenCapture.protectAppSwitcher()` now hides the app's snapshot in recent apps on Android 13 and later without blocking screenshots, where it rejected with an `UnavailabilityError` from `expo-screen-capture`. ([#1414](https://github.com/ng-native/ng-native/pull/1414), [#1413](https://github.com/ng-native/ng-native/issues/1413))

  It calls `Activity.setRecentsScreenshotEnabled(false)` through this package's native half, and `unprotectAppSwitcher()` calls it with `true`. The setting is applied again to an activity that is recreated while it is on. It needs a development build. On Android before 13, and in Expo Go on Android, both calls now resolve without doing anything. `blurIntensity` is used on iOS only, which is unchanged.

- A `text-shadow` with no colour, or in `currentColor` written out, in a token or as the fallback of a `var()`, in a stylesheet is now drawn in the element's text colour, as Chrome draws it, where it was dropped with a warning. It follows the text colour when that changes, as a `box-shadow` with no colour does, and a text inside it with a colour of its own draws the shadow it inherits in that colour, as CSS inherits `currentColor` as the keyword. ([#1398](https://github.com/ng-native/ng-native/pull/1398))
- A `null` bound to an optional number or boolean input in `@ng-native/components` or `@ng-native/expo`, or to an optional boolean input in `@ng-native/router`, is now unset, as `undefined` is. Before, a number input sent `NaN` to native and a boolean input sent `false`. ([#1409](https://github.com/ng-native/ng-native/pull/1409), [#1408](https://github.com/ng-native/ng-native/issues/1408))

  Among them are `[numberOfLines]` on `<text>`, `[maxLength]` on `<text-input>`, `[spacing]` on `<expo-glass-container>` and `[collapsable]` on `<view>`; `[size]` on `<expo-symbol>` takes its default of 24. A binding that turns from a value to `null` removes the prop, so native goes back to its default. A boolean bound to `null` now takes the default an unset one takes rather than `false`, which shows most where that default is `true`: `[editable]` on `<text-input>` leaves the field editable, `[animating]` on `<activity-indicator>` spins and `[scrollEnabled]` on `<scroll-view>` scrolls. The same goes for `[accessible]` and `[focusable]` on a component that is accessible or focusable by default, `[stickySectionHeadersEnabled]` (sticky on iOS), `[alwaysBounceVertical]` on a vertical scroll view, and `aria-busy`, `aria-checked`, `aria-disabled`, `aria-expanded` and `aria-selected`, which are left out of the accessibility state rather than set to `false`.

- A property children inherit now eases in them while an element transitions or animates it: the text inside a view whose `color` transitions takes each frame's colour, where it jumped to the end colour at once, and the text inside a view whose `color` a `@keyframes` animation plays follows the frames, where it kept no colour at all. A child that sets the property itself keeps its own. ([#1397](https://github.com/ng-native/ng-native/pull/1397))
- Tabs that are each `flex: 1 1 0%` (Tailwind's `flex-1`) in a row as wide as its content now share the row's width as in Chrome, so tabs of different lengths come out the same width wherever that keeps each word whole, where a `w-fit`, `max-w-max` or `inline-flex` row had each tab at the width of its own text. ([#1403](https://github.com/ng-native/ng-native/pull/1403))

  A tab whose even share would be narrower than its longest word is held at that word, and the other tabs share what is left, so no word is broken. That applies to an item with a `flex-basis` of `0%` or `0` in any row fitted to its content, including one kept from stretching by `align-self: flex-start` and one stretched across a `width: fit-content` box, where such tabs were the same width even when that was narrower than a word. Chrome under the layout reset keeps the even share and lets the word overflow the tab, so there the widths differ from Chrome's. An item with a `min-width` of its own keeps that minimum, and none is held wider than its row.

  An item with a basis of `0%` that does not grow is held at its longest word in such a row, where it was at the width of its text, or 0 wide in a row kept from stretching. One with a basis of `0` points that does not grow stays 0 wide, as in Chrome.

  Reading each tab's longest word takes two more commits when such a row is first laid out or what it holds changes. An item's own `min-width: auto` in such a row now holds as in Chrome too, where it had the even share or the width of its text.

### ❤️ Thank You

- Ashley Hunter
- erKam @erkamyaman
- Gabriel Silva @GabeSilvaDev

## 0.22.1 (2026-11-05)

### 🩹 Fixes

- `injectToken('--accent')` from `@ng-native/device` reads a CSS custom property's resolved value as a signal, at the root or at a given node; on iOS and Android it follows the colour scheme, media conditions and stylesheet changes, and on the web it follows class and inline style changes under the mount point, the `dark` class `mount` keeps included. `Engine.token` and `Engine.watchToken` do the same without Angular. A shape's `fill` or `stroke` written as `var()` on the shape itself is resolved against the tokens in scope. ([#1411](https://github.com/ng-native/ng-native/pull/1411), [#1410](https://github.com/ng-native/ng-native/issues/1410))

### ❤️ Thank You

- Ashley Hunter

## 0.22.0 (2026-11-04)

### 🩹 Fixes

- On iOS a large title no longer drops into place on every push when a header item holds a `ui-host` with `matchContents`, on a stack whose root page has no header, in a development build with `@ng-native/expo`. ([#1400](https://github.com/ng-native/ng-native/pull/1400), [#1399](https://github.com/ng-native/ng-native/issues/1399), [#1405](https://github.com/ng-native/ng-native/issues/1405))

  react-native-screens lays the navigation bar out at once whenever a header item's size changes, and such a host has its size only once SwiftUI lays it out, during the push. `@ng-native/expo` now defers that layout until the push or pop ends, for every header item. Expo Go keeps the drop; a host with a fixed size, or `systemImageName`, avoids it there.

- A box whose `box-sizing` alone changes is now laid out again on iOS and Android, where it kept the size it had: React Native's Yoga does not compare `boxSizing` when a view's props change. To do that, a `content-box` box whose sizes, padding and border are each in points or unset is committed as the border box it makes, with `boxSizing: 'border-box'` and its padding and border added to its `width`, `height` and their least and most. It lays out the same, but the props a test reads from a commit change for such a box, a web-compat `div` and text field among them. ([#1393](https://github.com/ng-native/ng-native/pull/1393))

  A `content-box` box with a percentage size or padding is committed as it was, and still keeps its size on iOS and Android when its `box-sizing` alone changes.

  A `content-box` box with an `aspect-ratio` and a `width` or `height` in points is committed with the ratio of its border box, so the ratio is of its content box, as in Chrome, where Yoga took it of the border box. One with an `aspect-ratio` and no size in points, or with a least or most size, is committed as it was. The padding added to the width is read in the box's direction, its own, inherited, or the app's.

- A `z-index` of a math function in a stylesheet, such as `calc(3 / 2)` or `min(-2.5, 4)`, now compiles to the integer Chrome rounds it to, as the same value set in a style already did, where it was dropped with a warning. ([#1387](https://github.com/ng-native/ng-native/pull/1387))

  A math function that comes to a length, such as `calc(1px)`, is still dropped with a warning, as Chrome drops it. One that comes to NaN, such as `sqrt(-1)`, compiles to 0, as Chrome reads it. A `round()` to the nearest, such as `round(-1.5, 1)`, is dropped with a warning, since the compiler would round a negative tie away from zero where Chrome rounds it up. A `round()` with a negative interval, such as `round(up, 3, -2)`, rounds as Chrome does, and the function and strategy names are read in any case. A z-index past the range of a 32-bit integer, such as `calc(infinity)` in a stylesheet or `calc(1e20)` in either, is clamped to that range, as Chrome clamps it. One with a string in it, such as `calc("2")`, is dropped with a warning, as Chrome drops it.

- On iOS a stack's root page with a large title now launches with the title expanded, where it showed collapsed in the bar until the page was pulled down. ([#1402](https://github.com/ng-native/ng-native/pull/1402), [#1401](https://github.com/ng-native/ng-native/issues/1401))

  `<native-stack-outlet>` commits its `RNSScreenStack` only once its first screen has joined it, with that screen, as react-native-screens' own JavaScript does. Committed empty, the stack was laid out with a compact bar before the root page arrived, and the page's scroll view kept the offset that bar gave it. A test that reads the committed tree of an outlet with no screen no longer finds an `RNSScreenStack` there.

- On Android a tap on an open `<native-search-bar>` no longer presses the `<native-header>` item hidden under it: while the field is open, the header's other `<native-header-item>`s take no touches. ([#1406](https://github.com/ng-native/ng-native/pull/1406), [#1404](https://github.com/ng-native/ng-native/issues/1404))

  react-native-screens hides those items when the field opens, but a hidden view keeps its bounds, and React Native's Android touch dispatch finds a target by bounds alone. The items' content now inherits `pointer-events: none` between the search bar's `topOpen` and `topClose`, so the props committed for that content change while the field is open, including an item added while it is open. Content that sets its own `pointer-events` to `auto` still takes touches. iOS sends no open or close and is unchanged.

### ❤️ Thank You

- Ashley Hunter

## 0.21.0 (2026-11-03)

### 🩹 Fixes

- `background: <gradient>, var(--x)` now keeps or drops its gradients as Chrome does for a token holding a position, a size or a colour beside them, such as `10% 20%`, `center / cover` or `center red`, and a stylesheet's token can now hold a gradient. ([#1388](https://github.com/ng-native/ng-native/pull/1388))

  A last layer the token holds is read as a whole: a position with an optional size, a repeat, an attachment, up to two boxes and a colour, each at most once, so `none none`, `fixed scroll` and `center center center` now make the shorthand invalid, as in Chrome. This holds for a token in a stylesheet, one set on an element, and a stylesheet fallback such as `var(--x, 10px 20px)`.

  `--g: linear-gradient(...)` in a stylesheet is no longer dropped with a warning, and `background: var(--g)` draws it.

  `background: var(--x)` of a colour now takes away an image a weaker rule declared, as Chrome does, where the image was left before.

  `[style.background-image]` and a `background-image` in a `style` attribute now draw linear gradients and `none`, where the text was committed as it was before. Any other value, a token among them, is dropped with a warning.

- A stylesheet's `background: <gradient>, var(--x, center / cover)` now keeps the gradient when `--x` is unset, as Chrome does, where a fallback of several words with no colour made the shorthand invalid. ([#1390](https://github.com/ng-native/ng-native/pull/1390))

  In development such a fallback no longer draws a warning that the custom property is undefined and the declaration dropped, which it said for `var(--x, none)` too.

- `@ng-native/expo` has a `TextRecognition` service whose `recognize(imageUri, { languages, level })` reads the text in an image on iOS, answering the whole text and each line with its confidence and its box in the image's pixels. ([#1385](https://github.com/ng-native/ng-native/pull/1385))

  It is Vision's `VNRecognizeTextRequest`, from new native code in `@ng-native/expo`, so it needs a new development build. It runs offline and does not need Apple Intelligence. A box is measured from the image's top left corner with the orientation in the file's metadata applied. In Expo Go, on Android, on the web and in Node, `available` is false and `recognize` rejects with a `MissingModuleError`; a test provides a stand-in through `TextRecognition.SOURCE`.

- `@ng-native/router` has a `TabBarInsets` service whose `bottom` signal is what the tab bar covers of the bottom of the window now, for an overlay outside the tabs: 0 while the bar is hidden or covered, or with no tabs. ([#1375](https://github.com/ng-native/ng-native/pull/1375), [#1359](https://github.com/ng-native/ng-native/issues/1359))

  On iOS, each opened tab of a `<native-tabs-outlet>` holds a view of no width after its page to measure the bar, and a `<safe-area-provider>` in the app is what tells an iPad's bar at the top from one along the bottom. On iOS, a page presented in a tab's own stack counts as covering the bar. On Android, it does not, since the bar stays.

  On Android, the height comes from a new native module in `@ng-native/expo`, so the app needs that package and a new development build. In Android Expo Go, which cannot load it, `bottom` stays 0. The value includes the home indicator or the system navigation bar, so an overlay takes the larger of it and the safe-area inset rather than their sum.

- A `box-shadow` with no colour in a stylesheet is now drawn in the element's text colour, as Chrome draws it, where it was dropped with a warning, and a stylesheet's `font` shorthand now puts `font-style` back to `normal`, so a weaker rule's italic no longer shows through. ([#1389](https://github.com/ng-native/ng-native/pull/1389))

  The shadow follows the text colour when it changes, own or inherited, as a border with no colour does. Such a shadow in a `@keyframes` frame is still dropped with a warning, as other uses of `currentColor` there are.

- A box written as wide as its content in a right-to-left box, with a physical inset on one side and a logical one on the other, such as `left: 10px; inset-inline-start: 5px`, is fitted between the two as in a browser, where it was stretched between them. ([#1377](https://github.com/ng-native/ng-native/pull/1377))

  In a right-to-left box `inset-inline-start` is the right, so with `left` it gives the box an inset on each side.

- A development reload while a page of another tab is presented over the tab in front comes back with that page presented, where it logged `NG04002: Cannot match any routes` and came back without it. ([#1379](https://github.com/ng-native/ng-native/pull/1379), [#1368](https://github.com/ng-native/ng-native/issues/1368))
- A `null` bound to `[width]` on `<native-toolbar-item>`, or to `[titleFontSize]`, `[largeTitleFontSize]` or `[backTitleFontSize]` on `<native-header>`, is now unset as `undefined` is, where it sent native `NaN`. ([#1378](https://github.com/ng-native/ng-native/pull/1378), [#1370](https://github.com/ng-native/ng-native/issues/1370))
- An item with a percentage `flex-basis` and a width of its own, such as `flex: 0 0 50%; width: 10px`, is measured at that width in a row kept from stretching by `align-self: flex-start` or its column's `align-items`, as in a browser, where it was measured at its content. ([#1381](https://github.com/ng-native/ng-native/pull/1381))

  The share is then taken of the width the row comes to. A change to that width, set on the element or by a class, has the row measured again; before, a row fitted to its content kept its old width until something else in it changed.

- `@ng-native/router` lays a stack's hidden navigation bar out with a large title before the first `<native-header largeTitle>` page is pushed onto it, so on iOS that push no longer starts from the compact bar, with the inline title fading out and the large title dropping into place. ([#1396](https://github.com/ng-native/ng-native/pull/1396), [#1394](https://github.com/ng-native/ng-native/issues/1394))

  The bar is hidden while the stack's root page has no header, and react-native-screens turns large titles on only once the push has started. A header with a large title now asks a new native module in `@ng-native/expo` to lay the hidden bar out once beforehand, so the app needs that package and a new development build. In Expo Go, which cannot load it, the first such push still starts from the compact bar.

- An `aspect-ratio` of a width and a height set in a style, such as `16 / 9` or `calc(16 / 9) / 1`, is now committed as the one number native takes, and a style value or a custom property with a bracket left open, such as `translateX(1px`, is read with it closed, as Chrome reads both. ([#1386](https://github.com/ng-native/ng-native/pull/1386))

  Before, a ratio with math on either side reached native as text and drew no ratio, and a value with a bracket left open was dropped or reached native as text. A ratio with a side of 0, or with `auto` in it, still reaches native as it is written.

  A ratio in a style with a side CSS reads no number from, such as `1 / 0x10`, `1 / Infinity` or `1 / -2`, or with a third side, is dropped with a warning, so the stylesheet's ratio shows, as in Chrome.

- A negative written out in a style, such as `width: -4px`, `-1em` or `-10vw`, on a property with no value below zero is now dropped with a warning, as Chrome drops it, so the stylesheet's value shows instead. ([#1384](https://github.com/ng-native/ng-native/pull/1384))

  This covers the props a math function below zero is clamped on: sizes, padding, font size, line height, border widths and radii, gaps, flex basis, grow and shrink, and aspect ratio. A negative `opacity` is kept, since CSS clamps it. This includes a binding such as `[style.width.px]` that comes out negative, which Angular sends as `-4px`. A style object's own numbers, such as `{ width: -4 }`, are React Native's and are unchanged.

  A shorthand in a style with one part a browser drops, such as `padding: 1px -1px` or `padding: 1px calc(1px + 2)`, is now dropped whole with a warning, where its other sides were kept before.

- A `font-size` of 0 no longer throws on Android or draws its text at the default size on iOS: the engine commits a size of 0.001 in its place, too small to see. ([#1376](https://github.com/ng-native/ng-native/pull/1376), [#1369](https://github.com/ng-native/ng-native/issues/1369))

  React Native on Android requires a font size above zero, so `font-size: 0`, `0em` or a `calc()` clamped to 0 threw `FontSize should be a positive value`, from a stylesheet, an inline style or a token alike. Android draws no text smaller than one device pixel, so there the text leaves a faint mark one pixel tall in a line box about 1dp tall, where Chrome leaves no box.

- `@ng-native/router` lets a `canDeactivate` guard decide a native pop of a pushed screen, and follows a screen native has already dismissed without asking its guards, so a refusing guard no longer leaves the url on a screen that is gone. ([#1380](https://github.com/ng-native/ng-native/pull/1380), [#1366](https://github.com/ng-native/ng-native/issues/1366), [#1367](https://github.com/ng-native/ng-native/issues/1367))

  The pushed screen in front holds `preventNativeDismiss` while leaving it would run a guard, as a presented screen already did, and lets go once it would not. On iOS a swipe back, the back button and a pick from its menu then go to the router, where the guard answers, as Android's Back button and header back arrow already did. On iOS a held push cannot be swiped back interactively: the swipe asks rather than following the finger, as with React Navigation's `usePreventRemove`.

  A screen native dismisses anyway, such as a `formSheet` dragged down or closed by a tap outside it on Android, is followed without asking its guards or those of the routes showing inside it. A refusal used to keep the router on the dismissed screen, where its guard went on refusing the navigations that leave it, such as a tab switch or presenting another screen.

  A stack inside a presented screen no longer passes on the hold of a guarded screen inside it as the page's own refusal, so a swipe down on the presented screen asks about leaving the whole screen.

- On iOS, a `position: fixed` box as wide as its content wraps its text in its page, as in a browser and on Android, where it wrapped in a narrower box it was written in, and on both platforms a fixed box committed under its page keeps its static position on an axis it has no inset on. ([#1382](https://github.com/ng-native/ng-native/pull/1382))

  Such a box, one with no width of its own (`width: auto` counts as none) and not stretched between a `left` and a `right`, is now committed under its page on iOS, as a fixed box inside a scroll view already was. There it draws over the page's other content and an ancestor's `opacity` or `transform` no longer reaches it. On iOS a fixed box goes back under its parent once nothing holds it under its page: it has a width of its own or is stretched between a `left` and a `right`, and nothing between it and its page scrolls or clips, whether the box itself or a box it is in changed. A fixed or absolute box is also taken out from under its parent when a box it is in starts to clip by an `overflow` set on that box as a value, and an absolute one goes back as that box stops, where before only a class or a rule doing so moved it.

  On an axis with no inset, a fixed box under its page was placed at the page's start. It is now placed where a browser has it, as the only child of the box it is written in: inside that box's padding and border in points, aligned as that box aligns its children, and from the right in a box laid out right to left. Inside a scroll view it still starts at the page's start on that axis, on both platforms. An absolute box committed under the box it is placed against, past a parent that clips, is placed at its static position the same way.

- A box in the flow that is `width: fit-content` and holds a percentage width or an item that grows is no narrower than content that cannot get narrower, and overflows its container as in a browser, where it was held to the container's width. ([#1383](https://github.com/ng-native/ng-native/pull/1383))

  For example, a `w-fit` row holding a `width: 500px` box and a `flex-1` label in a 362 point column is 530 wide, and the label keeps its 30, where the row was 362 wide and the label had no width. While such a box is measured, the items whose share is set aside no longer shrink, and nothing out of the flow in it counts. A box in it with a width in points counts at that width, not for what overflows it, one with a `max-width` in points counts no wider than that, an item of a row with a `flex-basis` in points that does not grow counts at that basis, and a box moved by a `left` or `right` in points counts where it was before the move. Both hold for a box on a line, such as an `inline-flex` one, as well. A `width: fit-content` box between two insets, and one holding no percentage width or growing item, is still held to the room it has.

  A change to a box's `box-sizing` is now taken as one that moves boxes, as a change to its padding is, so a box around it that is as wide as its content follows it, where it kept the width it had. On iOS and Android the box whose `box-sizing` alone changed still keeps its old size, since React Native's Yoga does not compare `boxSizing`.

### ❤️ Thank You

- Ashley Hunter

## 0.20.0 (2026-11-02)

### 🩹 Fixes

- A `background` shorthand of gradients over a token's colour, `background: linear-gradient(180deg, #ffffff33 0%, #ffffff00 67.7%), var(--primary)`, compiles to the gradients as its image and the token as its `background-color`, where Metro dropped the whole declaration with "'background' mixes var() with other values". The token has to be the whole of the last layer, with no token in the other layers. A last layer that is a gradient with a token in it goes through the existing gradient path as before, and a token anywhere else is still dropped with that warning. ([#1308](https://github.com/ng-native/ng-native/pull/1308), [#1295](https://github.com/ng-native/ng-native/issues/1295))
- `@ng-native/expo` has `AddressSearch`, from `@ng-native/expo/address-search`: `suggest(query, options)` answers a signal of the postal addresses that match a query signal, and `resolve(suggestion)` answers the picked one's line one, town, postcode, country and other parts, with no permission and no API key. ([#1310](https://github.com/ng-native/ng-native/pull/1310), [#1300](https://github.com/ng-native/ng-native/issues/1300))

  On iOS it uses MapKit's `MKLocalSearchCompleter` and `MKLocalSearch`. On Android it uses the platform's `Geocoder` once the query has not changed for 300 ms, and that geocoder answers whole addresses rather than completions. `region: 'GB'` keeps the suggestions to that country on Android, to the area around it on iOS 18 and later, and puts that area first on earlier iOS versions. It is native code of `@ng-native/expo`, so an app needs a new development build to use it. In Expo Go the suggestions stay empty.

- In `@ng-native/router`, a `<native-header-item>` at the `left` or the `right` with no content and a `systemImageName` or a `title` is a native `UIBarButtonItem` on iOS, with `<native-toolbar-item>`'s inputs and `(press)`. ([#1309](https://github.com/ng-native/ng-native/pull/1309))

  It commits in the header's `headerLeftBarButtonItems` or `headerRightBarButtonItems` rather than as a custom view, in its place among the side's items as written, and takes `barButtonItemStyle` (`plain` or `prominent`), `tintColor`, `disabled`, `accessibilityLabel`, `hidesSharedBackground` and `sharesBackground`. An item with content stays a custom view, as before. The new `hidden` input leaves any header item out of the bar. Android's header draws nothing for a bar button and says so once in development.

- In `@ng-native/expo`, `Location.geocode()` and `Location.reverseGeocode()` no longer ask for the location permission on iOS, so an app that only geocodes shows no location prompt there. ([#1307](https://github.com/ng-native/ng-native/pull/1307))

  Apple's geocoder needs no permission, and `expo-location` asks for none before geocoding on iOS. Before, both methods asked for the foreground permission first on every platform and answered an empty list when it was refused. On Android they still ask first and answer an empty list without it, because `expo-location` refuses to geocode there without the foreground permission.

- `FontRegistry.loadSheet()` warns in development when it is given a `null` sheet, as `loadFonts()` does. ([#1346](https://github.com/ng-native/ng-native/pull/1346), [#1338](https://github.com/ng-native/ng-native/issues/1338))

  The warning is said once per process, whichever of the two receives the `null`, and its wording names both. A `null` sheet is what `styleSheetOf()` returns for a class with no compiled sheet.

- A percentage width capped at `max-content` is the smaller of the two, a `width: fit-content` or `max-content` capped box between a `left` and a `right` stays as wide as its content, and a percentage `flex-basis` in a box fitted to its content is a share of that box's width, as in a browser. ([#1348](https://github.com/ng-native/ng-native/pull/1348), [#1341](https://github.com/ng-native/ng-native/issues/1341), [#1342](https://github.com/ng-native/ng-native/issues/1342), [#1343](https://github.com/ng-native/ng-native/issues/1343))

  These change committed layout. A `width: 50%; max-width: max-content` box with wide content took all of it, and now stops at the percentage: `maxWidth` is committed as the percentage, and a height capped the same way behaves alike. An absolute or fixed box written as wide as its content filled the room between its insets, and is now fitted within what they and its margins leave, which needs layout read back from native and costs two more commits when something in it changes. An item with `flex: 0 0 50%` in a `width: fit-content` row was as wide as its content, and now takes half of the row. A basis of `0%` is unchanged. With `direction: rtl` on a subtree, such a box between two insets sits at the left inset.

- A row that is `width: fit-content` or `max-width: max-content` stays as wide as its items when one of them grows, as in a browser, where with `layoutConformance: 'strict'` it had no width at all when the item grew from a basis of zero points (`flex: 1 1 0px`, or React Native's `flex: 1`), and could otherwise fill all the room on offer. ([#1327](https://github.com/ng-native/ng-native/pull/1327), [#1315](https://github.com/ng-native/ng-native/issues/1315))

  The engine fits such a row to its content, as it already fits a row with `align-self: flex-start` in a column, and fits a `width: fit-content` box around a row the same way. A row first laid out with a width, a stretch or a growth of its own, and then let go of it in its `style`, is fitted to its content again, where it kept the width Yoga gave it, which could be none or all the room on offer.

- A row as wide as its content, such as one with `align-self: flex-start` in a column, stays as wide as its items when one of them grows by `flex-grow` or React Native's `flex`, as in a browser, where it filled all the room it could have; and a `flex` of several values, a keyword or a basis in a `style` attribute or a `[style]` binding commits its grow, shrink and basis. ([#1305](https://github.com/ng-native/ng-native/pull/1305), [#1295](https://github.com/ng-native/ng-native/issues/1295))

  React Native's Yoga gives such a row all the room on offer once any item grows, so a segmented control whose tabs are `flex: 1` filled the screen. The engine fits the row to its content with the items' growth set aside, as it already did for items with a percentage basis, and commits it at that width, which costs two more commits when something in the row changes. A row that is stretched, or has a width, still shares all of it among its items.

  `style="flex: 1 1 auto"` was committed as a string native drops, so the item did not grow at all. A `flex` such as `1 1 auto`, `2 3`, `none`, `auto` or `30%` now commits `flexGrow`, `flexShrink` and `flexBasis`, as a stylesheet does, and one that is no CSS `flex`, such as `1 -1` or four values, is dropped with a warning in development. One number, `flex: 1`, is still React Native's own `flex` in a style attribute, a binding and a style object.

- `@ng-native/expo` has a config plugin with a `pointerEvents` option, off by default, that turns on React Native's W3C pointer events on iOS and Android, so a trackpad, a mouse or a pencil reaches `Pressable.hovered` and `@defer (on hover)`. ([#1357](https://github.com/ng-native/ng-native/pull/1357), [#1325](https://github.com/ng-native/ng-native/issues/1325))

  Add `["@ng-native/expo", { "pointerEvents": true }]` to the plugins in `app.json`, then run `npx expo prebuild` and make a new development build. It also sets `UIApplicationSupportsIndirectInputEvents` in Info.plist, which iOS 16 needs to tell a trackpad or a mouse from a finger. It has no effect in Expo Go. A finger's pointer events do not set `hovered` or fire `@defer (on hover)`. The development warning for `@defer (on hover)` now names the option.

- `styleSheetOf()` and `loadFonts()` warn in development in a browser build too, where `ngDevMode` stands in for the `__DEV__` a browser bundler does not define. ([#1347](https://github.com/ng-native/ng-native/pull/1347), [#1339](https://github.com/ng-native/ng-native/issues/1339))

  The warning about a `styleSheetOf()` read from a static field of the component's own class, and the one about a `null` sheet given to `loadFonts()` or `FontRegistry.loadSheet()`, were said on a device only. `__DEV__` still decides wherever it is defined, so a release build on a device stays silent. The `globalStyles: null` warning of `mount()` from `@ng-native/platform` is still a device warning, since `@ng-native/web` has its own `mount()`.

- Clamp a math function that comes out below zero to 0 on a property that cannot be negative, in a stylesheet, a `style` attribute, a `[style]` binding and a `calc()` of tokens, and refuse a length added to a number with a warning. ([#1352](https://github.com/ng-native/ng-native/pull/1352), [#1330](https://github.com/ng-native/ng-native/issues/1330), [#1337](https://github.com/ng-native/ng-native/issues/1337))

  The properties are sizes, padding, `font-size`, `line-height`, `gap`, border and outline widths, border radii, `flex-basis`, `flex-grow`, `flex-shrink`, `aspect-ratio` and `opacity`. `width: calc(1px - 5px)` commits `0` where it committed `-4`. A margin, an inset and `letter-spacing` keep their negative.

  A negative written out on one of these properties other than `opacity` in a stylesheet, such as `width: -4px`, is now dropped with a warning, as a browser drops it, where it was committed. `opacity` clamps a negative however it is written. A token or fallback that holds a negative written out and is used whole on one other than `opacity`, `width: var(--t)` with `--t: -4px`, leaves the declaration unset, in a stylesheet and set on an element, as it is invalid there in a browser. A fallback in `em` or a viewport unit is clamped to 0 instead.

  A stylesheet `calc()` or `min()` that mixes a length and a number, such as `width: calc(1px + 2)`, is dropped with a warning where it compiled to a length.

  In a `style` attribute or a binding, a math function CSS refuses, by its types or for the property, is dropped where it was left as text over a stylesheet's value, and warns in development. That covers a transform with such a function in its arguments, which was already dropped.

  `flex: calc(1 - 2)` in a style is a grow of 0 where it was refused, and `line-height: calc(1 - 2)` is 0 where it was a negative multiple.

- A `background` of gradients over a `var()` now draws neither when the token is unset or is a word that fits no part of a background, as Chrome does, where the gradients stayed and only the colour went. ([#1356](https://github.com/ng-native/ng-native/pull/1356), [#1317](https://github.com/ng-native/ng-native/issues/1317))

  `background: var(--x)` of such a token takes away an image a weaker rule declared. A gradient set as the token on an element is drawn as one more layer under the written ones, and its colour under them. A length, two lengths, `none`, or words such as `center` or `no-repeat` in the token or its fallback leave the written gradients and no colour, as in a browser.

- In `@ng-native/web-compat`, a checked radio put in the page, or moved into another group by setting its `name`, `form` or `type`, unchecks the radio that was checked in that group, as in a browser. Before, both stayed checked. ([#1290](https://github.com/ng-native/ng-native/pull/1290))

  An `<input>` whose `type` HTML does not know, such as `datetime` or an empty string, is a text field: it can be typed into, has a selection, and matches `:read-write` and `:placeholder-shown`. Before, it was drawn as a plain view that took no text.

- In a development build, `styleSheetOf()` in `@ng-native/fabric` warns when it is called too early to see a class's own sheet, as from a static field of the component's own class, where it reads `null` or a styled base class's sheet. `mount()` in `@ng-native/platform` warns when given `globalStyles: null`, and `loadFonts()` in `@ng-native/expo` warns when given a `null` sheet. `styleSheetOf()` warns once per class, the other two once per app run; a release build never warns. ([#1321](https://github.com/ng-native/ng-native/pull/1321), [#1312](https://github.com/ng-native/ng-native/issues/1312))
- `ngNative()` has Vitest process every installed package that lists `@angular/core` as a dependency or a peer, so a library such as `@tanstack/angular-query-experimental` shares the test's `@angular/core` and its `inject()` no longer fails with NG0203. ([#1301](https://github.com/ng-native/ng-native/pull/1301), [#1299](https://github.com/ng-native/ng-native/issues/1299))

  Vitest handed such a package to Node, which loaded a second instance of `@angular/core` for it, so the library's `inject()` saw none of the test's injection context and a partial-compiled one reached the runtime unlinked. A package that does not list `@angular/core` still goes in `ngNative({ inline })`. The plugin's patterns are now added only when `test.server.deps.inline` is not `true`, where they stopped the run with "ex.test is not a function".

- `userEvent.type` from `@ng-native/testing` types each character into the text the field shows. After a keystroke the app refused or rewrote and put its own text back, the next character is added to that text, as on a device, where before it was added to the refused text: typing `a3` into a field that takes only digits and holds `12` now ends with `123`, not `12`. ([#1323](https://github.com/ng-native/ng-native/pull/1323))
- `userEvent.type` in `@ng-native/testing` types each character at the field's caret, replacing a selection, rather than always at the end of the text. ([#1349](https://github.com/ng-native/ng-native/pull/1349), [#1340](https://github.com/ng-native/ng-native/issues/1340))

  A field that moves the caret or the selection with `setSelection()` while handling a keystroke now has the next character typed there, where `userEvent.type` used to append it. A test that typed into such a field and expected the appended text needs the text a text field gives: for a caret set to 0 after each key, typing `ab` ends with `ba`. A field that never moves the caret, or that refuses or rewrites a key, behaves as before.

  When the app puts different text back without a selection, the caret keeps its distance from the end of the old text, as an iOS field does. A key that does not fit in what `maxLength` leaves, such as an emoji for one free unit, is dropped whole.

- In `@ng-native/metro`, a component's compiled sheet is on its class as soon as the class is defined, so `styleSheetOf(Component)` called at the top level of the module that declares it returns the sheet. Before, the sheet was attached after the rest of the module had run, and such a call returned `null`. ([#1303](https://github.com/ng-native/ng-native/pull/1303), [#1296](https://github.com/ng-native/ng-native/issues/1296))
- In `@ng-native/router`, `NativeNavigation.back()` called while a navigation is still running waits past a guard's redirect and goes back once the redirected navigation lands. Before, the redirect dropped the back, and the screen the guard redirected to stayed on top. ([#1291](https://github.com/ng-native/ng-native/pull/1291))
- In `@ng-native/router`, a page of another tab shown with `present()` shares one instance of each service the routes above it provide between those routes' guards, the page's guards and resolvers, and the page, as in its tab. ([#1304](https://github.com/ng-native/ng-native/pull/1304), [#1280](https://github.com/ng-native/ng-native/issues/1280))

  Before, the presented copy put every provider on the page's own route, so a service an ancestor's guard wrote and the page or a resolver read was two instances. A page with providers of its own that had been shown in its tab first also reused the injector Angular made for it there, under the tab's instances rather than the presented ones. The presented page's `ActivatedRoute` now has a parent route for each route it sits inside, each without a component, and reads their data and params through Angular's inheritance.

- In `@ng-native/router`, a page of another tab shown with `present()` keeps the `title`, `canDeactivate`, `runGuardsAndResolvers` and `resources` of the routes above it, as in its tab, and `present()` shows a page behind a `canLoad` guard where its url puts it. ([#1324](https://github.com/ng-native/ng-native/pull/1324), [#1313](https://github.com/ng-native/ng-native/issues/1313))

  Before, the presented copy of each route above the page kept only its providers, `canActivate`, `canActivateChild`, `resolve` and `data`. A title set above a page with none of its own was missing from the presented page's route, a `canDeactivate` guard above the page did not run when it was dismissed, and resolvers above it ran again on the default `paramsChange` whatever the route said. Such a guard now runs as the presented page is dismissed, with `null` for the component, since the copy of a route above the page has none.

  A route above the page with a `canLoad` guard had its children loaded without running the guard, and the page presented. The page is now shown where its url puts it, where the router runs the guard.

- On iOS, a swipe no longer dismisses a presented screen that a `canDeactivate` guard refuses to leave, and a refused swipe no longer strands the router on a page nobody can see; on Android, dragging a `formSheet` down still dismisses it whatever the guard says. ([#1351](https://github.com/ng-native/ng-native/pull/1351), [#1331](https://github.com/ng-native/ng-native/issues/1331), [#1332](https://github.com/ng-native/ng-native/issues/1332))

  A screen shown with `present()`, on the stack or over another tab, now sets `preventNativeDismiss` when leaving it would run a `canDeactivate` guard, and a dismissal it refuses goes to the router, where the guard answers. A swipe the guard allows dismisses the screen after it has answered. Android's Back button and header back arrow go the same way. A page that also binds `preventNativeDismiss` hears `nativeDismissCancelled` for these attempts, even while its binding is false. Pushed screens are not held: on iOS, a swipe back from one is not stopped by its guard.

  A `canDeactivate` guard of a route above a page presented from another tab is given no component. When it fails, the failure now goes to the app's `ErrorHandler` and the page is dismissed, where the navigation failed and the page stayed up.

- A page of another tab presented with `present()` is the page its url names, whatever was presented before it: presenting `/library/new` after `/library/7`, where the tab has `new` before `:id`, showed the `:id` page with `id` set to `new`. The routes presented pages are copied to at the root now keep the order their routes have in the tab. ([#1328](https://github.com/ng-native/ng-native/pull/1328))
- On iOS, a pointer event on an engine node is no longer dropped by Fabric when an app has turned on React Native's W3C pointer events, so `Pressable.hovered` and `@defer (on hover)` follow the pointer in such an app. ([#1354](https://github.com/ng-native/ng-native/pull/1354))

  React Native leaves those events off by default on iOS and Android, so nothing changes in an app that has not set `RCTSetDispatchW3CPointerEvents(YES)`. `fabric.emit` from `@ng-native/testing` now drops a `topPointer*` event on a view whose node has no committed view, as Fabric does.

- `<markdown>` can draw links in the app's own schemes, such as `myapp:item/42`, as links reported through `(linkPress)`: list them in a new `[linkSchemes]` input, or for every `<markdown>` with `provideMarkdownLinkSchemes('myapp')` from `@ng-native/components/markdown`. ([#1364](https://github.com/ng-native/ng-native/pull/1364), [#1362](https://github.com/ng-native/ng-native/issues/1362))

  A listed scheme is never opened by `<markdown>`, even when no handler calls `preventDefault()`, so the app routes it. The input replaces the provider's list when it is set, an empty one included. Schemes are matched without regard to case. A scheme that is not listed is still drawn as the link's text, `javascript:` among them, and `http`, `https`, `mailto` and `tel` are opened on press as before. Changing the list draws the document again, a streaming one too.

- `LanguageModel.session()` keeps a conversation with the on-device model across turns, with tools the model can call through `defineTool()`, on iOS. ([#1311](https://github.com/ng-native/ng-native/pull/1311))

  A session's `stream()` and `respond()` see the turns before them, `transcript` is the conversation as plain JSON, and `toolCalls` lists the tool calls running now, on the session and on each reply. Tool handlers run in the session's injection context, so they can `inject()`. A cancelled or failed turn is left out of the transcript, as the model leaves it out of its context. A conversation that outgrows the context window fails with `LanguageModelContextExceededError`. The session is released when the injector it was made in is destroyed, or with `release()`. On Android, `expo-local-llm` refuses a session with tools, and that error reaches the reply unchanged. `LanguageModelStream` gains a `toolCalls` signal, which is always empty for the one-shot `stream()`.

- A `<keyboard-avoiding-view behavior="height">` laid out for the first time while the keyboard is already up keeps the height it shrinks to. It took the height it had shrunk to as its own, so on the next layout it measured no overlap and grew back under the keyboard. ([#1329](https://github.com/ng-native/ng-native/pull/1329))
- `border`, `outline`, `box-shadow`, `background`, `font` and `text-decoration` in a `style` attribute or a `[style]` binding now draw, committing the props a stylesheet commits, where each was committed as text native does not read. ([#1355](https://github.com/ng-native/ng-native/pull/1355), [#1336](https://github.com/ng-native/ng-native/issues/1336), [#1318](https://github.com/ng-native/ng-native/issues/1318))

  The same goes for `border-top` and the other sides, logical sides included, and for `border-width`, `border-color` and `border-radius` of several values. A value these do not read (a `background` with a position, size, `url()` or a token in a gradient, a `box-shadow` with a token beside other parts, a `font` with `small-caps`) is dropped with a warning in development. `[style.border-color]` and the other colour properties except `color` take `currentColor`.

- Work out `calc()`, `min()`, `max()` and `clamp()` in a `style` attribute or a `[style]` binding as a stylesheet does, for lengths in `em` and viewport units, percentages, numbers and transform arguments. ([#1350](https://github.com/ng-native/ng-native/pull/1350), [#1344](https://github.com/ng-native/ng-native/issues/1344), [#1333](https://github.com/ng-native/ng-native/issues/1333), [#1334](https://github.com/ng-native/ng-native/issues/1334), [#1335](https://github.com/ng-native/ng-native/issues/1335))

  A value set this way commits what a stylesheet commits for the same declaration where it was committed as text native drops, or dropped. That covers `opacity`, `flex-grow`, `flex-shrink`, `aspect-ratio`, a unitless `line-height`, `font-weight`, the `flex` shorthand, and the arguments of a transform. A `translateX(1em)` in a bound transform is measured against the font size in scope too.

  A `calc()` of tokens set on an element now needs whitespace either side of `+` and `-`, as CSS does: `calc(var(--gap)+2px)` is invalid, so the declaration that reads it is unset. A `clamp()` inside one, with a `var()` in it, is read.

  A value with a comparison only the box or the font size can settle, such as `min(50%, 100px)` or `min(1em, 20px)`, is left as written, and native drops it.

- A `calc()` of lengths in `px` or `rem` and numbers, set in a `style` attribute or bound with `[style]` or `[style.x]`, is committed as the points it comes to, as the same value in a stylesheet is: `flex: 1 1 calc(10px + 10px)` and `width: calc(2 * 1rem)` were committed as their text, which native drops. A `calc()` with a percentage, an `em` or a viewport unit is left as before. ([#1322](https://github.com/ng-native/ng-native/pull/1322), [#1316](https://github.com/ng-native/ng-native/issues/1316))
- `@ng-native/router` has `injectPageFocused()`, a signal that is true while a page's tab is selected and nothing is stacked over it, for stopping work such as a poll or a socket while the page stays mounted behind another. ([#1361](https://github.com/ng-native/ng-native/pull/1361), [#1358](https://github.com/ng-native/ng-native/issues/1358))

  It reads the same state as `SCREEN_IN_FRONT` from `@ng-native/device`. It does not follow the app going to the background, which `AppState` does.

- In `@ng-native/router`, a bar button `<native-header-item>` takes a `[menu]` that opens a native `UIMenu` on iOS and reports the action chosen through `(menuSelect)`, and an item with a `[spacing]` is a fixed gap among the bar buttons on iOS. ([#1353](https://github.com/ng-native/ng-native/pull/1353))

  The new types are `HeaderMenu`, `HeaderMenuAction` and `HeaderSubmenu`. A tap on a bar button with a menu opens the menu rather than sending `(press)`. Android's header draws neither, and its one development warning for bar buttons now names them. The header has no flexible spacer.

### ❤️ Thank You

- Ashley Hunter
- erKam @erkamyaman
- Gabriel Silva @GabeSilvaDev

## 0.19.2 (2026-10-29)

### 🩹 Fixes

- On iOS, `Notifications` puts the data of a push sent through FCM or straight to APNs in `request.content.data`, which `expo-notifications` fills only for a push from Expo's push service. ([#1289](https://github.com/ng-native/ng-native/pull/1289), [#1287](https://github.com/ng-native/ng-native/issues/1287))

  This covers `latest`, `response`, `take()`, `presented()`, and the notification a `setHandler()` handler is passed, including the one on a timeout error given to its `handleError`. The keys come from `request.trigger.payload` and are used only when `content.data` is null or missing. The keys the push services add are left out: `aps`, FCM's `fcm_options`, `gcm.` and `google.` keys, and on a push from Expo's service its `experienceId`, `projectId` and `scopeKey`. Android, local notifications and an Expo push whose `data` the module already read are unchanged.

- `fileRoutes` gives a lazy page's `canMatch` guards the same instances of its `routeMeta` providers that the page and its resolvers get, as Angular does for an eager page. ([#1292](https://github.com/ng-native/ng-native/pull/1292))

  Before, a lazy page's `canMatch` guards ran in an injector of their own, made for each navigation and destroyed after it, so a service a guard wrote was not the one the page read. The injector is now made once for the page's route, and the page's routes are loaded into it. With `withAutoCleanupInjectors()`, it is destroyed when the page is left and made again on the next visit, as an eager page's is.

- On iOS, a `<refresh-control>` that is already refreshing when its page is pushed, or when its tab is shown for the first time, starts spinning once the screen has appeared, so it no longer leaves a gap under a large title. ([#1298](https://github.com/ng-native/ng-native/pull/1298))

  Before, native began it as the page mounted, before UIKit had laid the page out under its bars. Under a large title that left a gap the spinner's height between the title and the content, which stayed after the spinner stopped and showed on pages shown after it. React Native's own `RefreshControl` does the same. Now a control under a `<native-stack-outlet>` or `<native-tabs-outlet>` commits `refreshing` from the screen's `appear` (a tab's `didAppear`), so the spinner shows as the push finishes rather than during it. On Android, and on a view no outlet shows, nothing changes.

  `SCREEN_SHOWN` in `@ng-native/device` is the signal it reads: false for a screen until native says the screen has appeared, then true, and always true outside an outlet.

  In a Node test rendered for iOS, a refresh control under an outlet now commits `refreshing: false` until the test emits the screen's `topAppear` (for a tab, `topDidAppear`) with `fabric.emit`, since the fake Fabric sends no appear events.

- `nx g @ng-native/nx:library` in the TypeScript preset adds the app's Babel 7 `@babel/core` to the library's dev dependencies, so pnpm 10 no longer prints "Failed to create bin" for `expo` and unmet `@babel/core` peers on every install. ([#1288](https://github.com/ng-native/ng-native/pull/1288), [#1285](https://github.com/ng-native/ng-native/issues/1285), [#1286](https://github.com/ng-native/ng-native/issues/1286))

  `@angular/compiler-cli` depends on Babel 8, which otherwise answered React Native's `@babel/core` peer in the library under pnpm 10, giving the library its own copies of `react-native` and `expo`. pnpm 11 resolves the peer to the root's Babel 7 already. A library generated before this can add `"@babel/core": "^7.29.7"` to its `devDependencies` by hand.

### ❤️ Thank You

- Ashley Hunter

## 0.19.1 (2026-10-28)

### 🩹 Fixes

- `FirebaseMessaging.unregister()` in `@ng-native/firebase-messaging` deletes the app's Firebase installation, so FCM answers `UNREGISTERED` for its FID, sets `installationId` to null, and stops re-registering on a token roll and re-reading the FID on coming back to the front until `register()` runs again. Call it on sign-out when pushes belong to the signed-in user. ([#1284](https://github.com/ng-native/ng-native/pull/1284), [#1282](https://github.com/ng-native/ng-native/issues/1282), [#1283](https://github.com/ng-native/ng-native/issues/1283))

  On Android, a call without `google-services.json` in the app now rejects with `ERR_NO_FIREBASE_CONFIG`, as on iOS, rather than a generic error. `FirebaseMessaging` reads nothing from `Notifications` until `register()` runs, so a test that fakes `Notifications` without `devicePushToken` can inject it. The docs show an `app.config.js` that leaves out a missing Firebase config file, so prebuild works without one.

### ❤️ Thank You

- Ashley Hunter

## 0.19.0 (2026-10-28)

### 🩹 Fixes

- On iOS, `@ng-native/expo` registers its `@expo/ui` modifiers once per app launch instead of on every reload, which could crash a development build in `ViewModifierRegistry.register` during a hot reload. ([#1261](https://github.com/ng-native/ng-native/pull/1261))

  `@expo/ui`'s modifier registry is shared by the whole process and has no lock, and Expo recreates modules on the JavaScript thread on each reload while the main thread can still be reading the registry for SwiftUI views on screen. The modifiers are the same on every reload, so they are now registered the first time the module is created.

- On iOS, a `ui-bottom-sheet` whose content is in a navigation stack puts its `modifiers` on the content inside that stack, so `ignoreSafeArea` lets the content run under the home indicator. ([#1269](https://github.com/ng-native/ng-native/pull/1269))

  The content is in a navigation stack where the build has SwiftUI's toolbar (`@expo/ui` 57.0.20 and later) and the sheet is not sized to its content. The stack sets up the safe area again for what is inside it, so the modifiers were outside its reach on the `ui-group`; they are now on the `ui-zstack` inside the stack, and the sheet's own presentation modifiers stay on the group. Presentation modifiers given this way, such as `presentationCornerRadius`, still apply. A content modifier such as `background` or `padding` there applies below the sheet's bar, where it has one. A sheet sized to its content, and a build without the toolbar, are unchanged.

- A `<virtual-list>` row whose item comes back to the window after leaving it, with nothing arriving to take its place (a filter put on below the scroll position and taken off again), takes back the slot it left. It took another parked slot, so the window held its key twice: with `track row.key` Angular threw `NG0955` (duplicated keys) and the row was drawn twice, and with `track row.slot` a hidden copy of it was kept. An item that comes back as another `itemType` gets a slot of that type, and its old one is let go. ([#1265](https://github.com/ng-native/ng-native/pull/1265))
- A `<native-tabs-outlet>` under a route parameter, such as `city/:name`, now finds a url inside a tab when the parameter is written with characters a url escapes (an accent or a space, `são-paulo`, `new york`) or with matrix parameters (`rio;lang=pt`). It compared the router's url with the tab's url built from the unescaped segment, so no url was inside a tab: tapping back to a tab opened its first screen instead of the page it was on, and a tap dropped the matrix parameters. A page pushed into such a tab before it was opened now has the tab's first screen under it, as it has elsewhere. ([#1266](https://github.com/ng-native/ng-native/pull/1266))

  A url that gives a tab's own segment matrix parameters, such as `library;sort=a/7`, is now inside that tab too, under a parameter or not. It was in no tab, so tapping away and back opened the tab's first screen without them.

- Fixes from a security review. ([#1279](https://github.com/ng-native/ng-native/pull/1279))

  - `@ng-native/web-compat`: `XMLSerializer` escapes the namespace it writes in an `xmlns` attribute, so a namespace holding a quote or markup can no longer add attributes or elements to the output.
  - `@ng-native/web-compat`: only an `<iframe>` in the HTML namespace becomes a web view or an emulated frame. One in SVG or MathML, such as one inside an SVG image's markup, or one made with `createElementNS` in another namespace, is a plain element, and its `srcdoc` is not loaded.
  - `@ng-native/web-compat`: on Android, a message from a frame inside a web view's page that reports its origin as `null` arrives with the origin `null` instead of the web view's own origin. A `srcdoc` page loaded with no base, which Android also reports as `null`, is still heard from the app's origin.
  - `@ng-native/web-compat`: a message posted to an iframe for an origin (not `*`) waits until the page its new `src` or `srcdoc` names has loaded. On Android, one posted as `srcdoc` replaced a `data:` page reached that page.
  - `@ng-native/web-compat`: on iOS, an iframe whose `src` has no host, such as a `data:` URL, is shown as an empty page with a warning. react-native-webview there threw on it and closed the app.
  - `@ng-native/web-compat`: an SVG `<img>` in a template's content, a `DOMParser` document or markup `setHTML` is sanitizing is not fetched until it is put in a document that loads it.
  - `@ng-native/web-compat`: an emulated frame more than ten frames deep stays blank, so a page that frames itself no longer loads without end.
  - `@ng-native/web-compat`: `DOMParser` parses XML that declares a namespace prefix on every level of deep nesting in time that grows with the declarations instead of with their square.
  - `@ng-native/router`: native tabs leave a tap on a tab that was visited and sits behind a `canActivate`, `canActivateChild` or `canMatch` guard to the router: the tab is selected once the guard agrees, instead of showing its kept page while the guard runs. This needs react-native-screens 4.30 or later; earlier versions select at once as before.
  - `@ng-native/router`: a page `present()` shows over another tab runs each guard of the routes above it with the providers down to that route, not with the page's own.
  - `@ng-native/router`: `fileRoutes` runs a page's `canMatch` guards with the providers in its `routeMeta`, eager or lazy, as Angular runs a route's guards with its own providers.
  - `@ng-native/components`: the Markdown component compares each changed block once when a new `source` arrives, where deeply nested blocks such as quotes inside quotes cost three times more for every level.
  - `@ng-native/tailwind`: a `var()` name holding a character that has a meaning in a regular expression, such as `--a**`, no longer stops the build with a `SyntaxError`. A line break in the Tailwind entry's file name no longer ends the generated module's header comment.
  - `@ng-native/web`: an image whose `referrerPolicy` is set is painted with an `<img>` that sends that policy, since a CSS background is fetched with the page's.
  - `@ng-native/metro`: the dev server keeps a parked route history exactly as the app sent it, so a deeply nested body can no longer crash the server.

- The safe HTML methods in `@ng-native/web-compat` (`setHTML`, `appendHTML`, `prependHTML`, `beforeHTML`, `afterHTML` and `replaceWithHTML`) now remove an `<iframe>` inside `<svg>` or `<math>`, and any element registered as a web view, such as `<web-view>` or `<dom-component>`. Before, such an element passed the safe sanitizer and became a react-native-webview with scripts on, so untrusted markup could run a script at the page's origin and post messages to the app as that origin. ([#1271](https://github.com/ng-native/ng-native/pull/1271))

  `<dom-component>` in `@ng-native/expo` now sends a changed input only to its own page. Before, once a link in the content took the web view to another site, that site could define `window.__ngNative` and receive every input the app changed afterwards.

- On iOS 26 and later, a stack page's `:host` layout (`flex-direction`, `justify-content`, `align-items`, `gap`) lays out the elements at the root of its template again, and a `:host > ...` selector matches them again. ([#1260](https://github.com/ng-native/ng-native/pull/1260), [#1212](https://github.com/ng-native/ng-native/issues/1212))

  The safe area view the stack outlet puts a page's content in on iOS 26 and later, which starts it below an opaque `<native-header>`, is now made by the engine as a view of the screen's own (`Engine.wrapChildren`) rather than as an element of the page's tree. The page's template stays in its host, the screen, so its `:host` rules and selectors reach it as written, and the layout `:host` gives its children is committed on the safe area view, which holds them. For a page whose `:host` gives no such layout, the native views and their props are the ones committed before, and the header is still a child of the screen either way. Before iOS 26 and on Android nothing changes.

- On iOS, a navigation that would put a screen on a stack hidden behind a `fullScreenModal` another stack presents now resolves false and leaves the url and the screens as they were, where before it resolved true and showed nothing. ([#1270](https://github.com/ng-native/ng-native/pull/1270), [#1253](https://github.com/ng-native/ng-native/issues/1253))

  A screen a tab's own stack presents as `fullScreenModal` takes the app's stack out of the window, and react-native-screens' iOS stack makes no change while it is out of the window. So `present()` or `push()` of a top-level route, `present()` of a page of another tab, or a plain router navigation to such a route, from that modal, changed the url without showing the screen, and the next `back()` took off the screen nobody saw. These are now aborted before the url changes. A navigation inside the stack presenting the modal, to another tab, back to a screen still on the app's stack, or a `replace()` or `reset()`, goes ahead as before. Android is unchanged.

- A running Metro dev server compiles a component again once its `templateUrl` or `styleUrl` file changes or is deleted, so a reload, a relaunch or a hot update gets the component as the file is now rather than as it was compiled before. ([#1259](https://github.com/ng-native/ng-native/pull/1259), [#1166](https://github.com/ng-native/ng-native/issues/1166))

  Metro transforms again only the file that changed, and kept the component's own module, with the old template or sheet compiled into it, until the component's `.ts` file changed or Metro restarted; a touch that left the `.ts` file's text as it was did not help. `withAngularNative` now wraps `server.enhanceMiddleware` to reach the dev server, which checks the templates and stylesheets each module was compiled from before it answers a bundle request or sends a hot update. A hot update after such an edit carries the component's module as well as the template's or stylesheet's, and swaps it in place.

- New package `@ng-native/firebase-messaging`: a `FirebaseMessaging` service that registers the app's Firebase Installation ID with FCM and answers it, for a backend that sends through FCM's HTTP v1 API with the `fid` target. ([#1281](https://github.com/ng-native/ng-native/pull/1281), [#1278](https://github.com/ng-native/ng-native/issues/1278))

  `register()` asks for the notification permission, registers with FCM (on iOS with the APNs token from `Notifications`) and sets `installationId`; after that, it registers again when the push token rolls while the app runs, and reads the FID again each time the app comes back to the front. Its config plugin turns on registration by installation ID on iOS and Android, turns off Firebase's app delegate proxy on iOS and gives the `GoogleUtilities` pod modules in the Podfile. Firebase's config files are Expo's `ios.googleServicesFile` and `android.googleServicesFile`. It needs a development build: in Expo Go, on the web host and in tests every call answers null.

### ❤️ Thank You

- Ashley Hunter
- erKam
- Gabriel Silva @GabeSilvaDev

## 0.18.2 (2026-10-25)

### 🩹 Fixes

- `Keyboard.windowTop` on Android now includes how far down the screen the app's window starts, in the lower half of a split screen or in a freeform window, when `provideNativeKeyboard()` from `@ng-native/expo` is provided. ([#1246](https://github.com/ng-native/ng-native/pull/1246), [#1189](https://github.com/ng-native/ng-native/issues/1189))

  `<keyboard-avoiding-view>`, a focused `<text-input>` and web-compat's `innerHeight` compared the keyboard's top on the screen with views measured in a window that starts lower down, so they treated the keyboard as lower than it was. A `KeyboardSource` can now report the window's top on the screen as `screenTop`, and the `NgNativeKeyboard` module reads it. Expo Go, and apps without `provideNativeKeyboard()`, still leave it out: React Native has no way to read it.

- `@ng-native/expo/calendar` reads and writes the device's own calendars, their events and, on iOS, their reminders. ([#1244](https://github.com/ng-native/ng-native/pull/1244))

  `inject(Calendar)` lists the calendars and the events in a range, finds a calendar, event or reminder by id, creates a calendar, and holds full, write-only (iOS 17 and later) and reminders permissions as signals. It wraps `expo-calendar`'s object API, which needs a development build. What only iOS has, the default calendar, the picker, the sources and the reminders, answers empty on Android instead of throwing. `EntityTypes`, `Frequency` and `Availability` come with it, usable without loading the module.

- `<text-input>` on iOS 26 and later no longer loses characters typed quickly into an empty field, because iOS is sent the latest `eventCount` as the `mostRecentEventCount` prop only with a change to a multiline field's text style. ([#1257](https://github.com/ng-native/ng-native/pull/1257), [#1251](https://github.com/ng-native/ng-native/issues/1251))

  UIKit gives an empty field's first typed text a paragraph style whose line break strategy differs from the one React Native compares an echoed `text` prop with, so an echo carrying the latest count replaced that text with the same string and dropped the keystrokes queued behind the replace. On iOS the prop now stays at 0, the count a field starts at, so an initial value and a value set before anything is typed still arrive as the prop; text set from code after typing, a refused or rewritten keystroke and a bound selection arrive with the count through `setTextAndSelection`, as before. The commit that changes a multiline field's color, font or another text style carries the latest count, so the text already typed is restyled. Android is unchanged. In `@ng-native/testing`, `fireEvent.changeText` and `userEvent.type` count each field's changes themselves, so an iOS field's committed `mostRecentEventCount` reads 0 after typing, but after a multiline field is restyled.

- A `<text-input>` focused while the keyboard is up now scrolls clear of the keyboard in a sheet attached to the bottom of the screen on iOS, and no longer asks a scroll view resting under a navigation bar to scroll to zero. ([#1258](https://github.com/ng-native/ng-native/pull/1258), [#1247](https://github.com/ng-native/ng-native/issues/1247))

  On iOS, React Native measures a view in a presented sheet from the sheet's top, while the keyboard's top counts from the top of the screen, so `engine.reveal()` stopped short by the sheet's distance from the top of the screen and could leave the field behind the keyboard. It now takes that distance off the keyboard's top for a screen presented as `modal`, `formSheet` or `pageSheet`, and for a `<modal>` with `presentationStyle` `pageSheet` or `formSheet`, when the sheet is as wide as the window and taller than the room above the keyboard: such a sheet is attached to the bottom of the screen. A narrower sheet (an iPad's, or one floating at a partial detent) and a shorter one, which may have risen over the keyboard, are measured as before. Android is unchanged.

  `reveal()` also clamped its target at zero, so a scroll view resting above zero under a navigation bar (`contentInsetAdjustmentBehavior="automatic"`) was sent to zero, under the bar, for a move of a few points. It now sends it no further up than zero or where it already is, whichever is further up. React Native's own `scrollTo` on iOS still stops at zero when the scroll view has no `contentInset` of its own.

- `nx g @ng-native/nx:nativescript <app>` sets up `@ng-native/nativescript` in an app: the packages, the config plugin, the iOS and Android types, and `provideNativeScript()`. ([#931](https://github.com/ng-native/ng-native/pull/931))
- `@ng-native/nativescript` calls iOS and Android APIs from TypeScript through `@nativescript/react-native`, and shows native views built in TypeScript. ([#931](https://github.com/ng-native/ng-native/pull/931))

  `provideNativeScript()` installs the runtime, `NativeScript.call()` runs a function for the platform on the JavaScript thread, `runOnUI()` runs a function on the platform's main thread, `<ns-view>` shows a UIView or an Android View a worklet builds, and `androidContext()` is the Activity to build an Android view with. The app's config plugins list `"@ng-native/nativescript"`. See https://ng-native.com/packages/nativescript.

  On Android the config plugin sets `android.enableMinifyInReleaseBuilds=false` and `nsSkipStaticBindings=true` in `gradle.properties`, since `@nativescript/react-native` 9.1.2 cannot build or run a release on Expo SDK 58 with R8 on, and its release bindings task needs React Native's CLI, which an Expo app does not have. A release APK is larger without R8.

- An app with `@nativescript/react-native` installed and no Babel config of its own gets the worklets plugin with `strictGlobal`, so a worklet naming a native class, such as `UILabel.new()`, no longer fails as the app starts with `Property 'UILabel' doesn't exist`. ([#931](https://github.com/ng-native/ng-native/pull/931))

  An app with its own Babel config gets a warning saying what to add to it.

- An equal `padding-inline-start` and `padding-inline-end` compile to `paddingStart` and `paddingEnd` in a stylesheet with an `@media` rule in it, as they do in one without, and so do `margin-inline-*`, `inset-inline-*` and `border-inline-*`. They were compiled to left and right. A sheet whose only blocks inside blocks are top-level at-rules such as `@media` is no longer printed again by lightningcss before it is compiled, so it compiles as it would without them. ([#868](https://github.com/ng-native/ng-native/pull/868))

  An `overflow-x` and an `overflow-y` set to the same value in one rule, which compiled to `overflow` beside an `@media` rule, are now refused there with the warning to write `overflow`, as they already were in a sheet without one.

### ❤️ Thank You

- Ashley Hunter
- erKam
- Shahar Kazaz

## 0.18.1 (2026-10-24)

### 🩹 Fixes

- An app or library `@ng-native/nx` generates in a workspace with tsconfig path aliases resolves them in its tests with `vite-tsconfig-paths`, so on Nx 24 a test that imports one of the workspace's libraries no longer fails with `Cannot find package`. ([#1242](https://github.com/ng-native/ng-native/pull/1242))

  `nxViteTsPaths` from `@nx/vite`, which the generators wrote before, is a stub that resolves nothing from Nx 24. The `vitest-tsconfig-paths` migration rewrites each Vitest config the generators wrote that way, and adds `vite-tsconfig-paths` to the root `package.json` when it lists none.

### ❤️ Thank You

- Ashley Hunter

## 0.18.0 (2026-10-23)

### 🚀 Features

- Tests under `@ng-native/testing` run without the `Intl` constructors Hermes lacks (`DisplayNames`, `DurationFormat`, `ListFormat`, `Locale`, `PluralRules`, `RelativeTimeFormat` and `Segmenter`), so code that builds one fails its test with a `TypeError`, as it fails on a device, rather than passing on Node's. ([#1137](https://github.com/ng-native/ng-native/pull/1137), [#1129](https://github.com/ng-native/ng-native/issues/1129))

  This is breaking for a test that relies on one of them. Both `ngNative()` and `@ng-native/testing/register` remove them; `Intl.Collator`, `Intl.DateTimeFormat` and `Intl.NumberFormat` are unchanged. A polyfill an app installs in a Vitest setup file, or in a module given to `node --import` after `@ng-native/testing/register`, stays, and one that installs only what `Intl` lacks sees them missing: `ngNative()` removes them ahead of the app's own setup files. To keep Node's full `Intl` in Vitest, pass `ngNative({ intl: 'node' })`.

- Under `provideWebCompat()`, an HTML element starts as a browser's own stylesheet has it: `position: static`, so an absolute element is placed against the nearest ancestor that says `relative` rather than against its parent, and, as a flex item, `flex-shrink: 1` with `min-width: auto` and `min-height: auto`, so it gives up room down to its content. A button's label is in the middle of its height until a stylesheet lays the button out. An app whose layout relied on every HTML element being a containing block, or on flex items never shrinking, should set `position: relative` or `flex-shrink: 0` where it needs them. ([#1116](https://github.com/ng-native/ng-native/pull/1116))

### 🩹 Fixes

- An accessibility setting that changes while `@ng-native/device` is still reading the settings at startup keeps its new value, in `Accessibility` and in the `prefers-reduced-motion` condition `watchConditions` keeps. The startup read answers asynchronously, and its answer replaced whatever a change event had reported in the meantime, so a setting turned off in that gap read as on until it changed again. The startup answer now fills in only the settings no event has reported. ([#1059](https://github.com/ng-native/ng-native/pull/1059))
- `Accessibility` in `@ng-native/device` keeps the startup settings that did read when one of the screen reader, reduced motion or bold text reads fails, instead of dropping all four, and `@ng-native/testing` takes a text field to be a view named `TextInput` or `AndroidTextInput` as `@ng-native/fabric` does, through the new `isTextInputView(viewName)` export, rather than any view with `TextInput` in its name. ([#1209](https://github.com/ng-native/ng-native/pull/1209), [#1183](https://github.com/ng-native/ng-native/issues/1183))

  The setting whose read failed stays off, and the other three and the font scale are taken as the platform answered.

- A view's `transform`, `opacity` or a colour changed again and again, such as a progress bar stepped every 50ms, is set on native with no commit from its third change within a second, so a run of such changes costs two commits rather than one each. ([#1172](https://github.com/ng-native/ng-native/pull/1172))
- `provideNativeKeyboard()` in `@ng-native/expo` reports where the keyboard stopped when the app started listening while the keyboard was already moving on Android. `Keyboard.height` and `Keyboard.metrics` took that position only at the keyboard's next motion before, staying at zero until then. ([#1234](https://github.com/ng-native/ng-native/pull/1234), [#1092](https://github.com/ng-native/ng-native/issues/1092))
- In a library's sheet under `provideWebCompat()`, `will-change`, `contain`, `perspective` and `backdrop-filter` are no longer dropped: the engine reads them to place the absolute elements inside a static box, and sends none of them to a native view. ([#1230](https://github.com/ng-native/ng-native/pull/1230))

  A `perspective` or a `backdrop-filter` other than `none`, and a `contain` of `size`, `inline-size`, `paint`, `strict` or `content`, are kept with a warning that native does not draw or contain that part. Any of the four whose value reads a token is still dropped with a warning, as all four still are from an app's own sheet. `element.style`, a `style` attribute and a `[style.x]` binding no longer send them to the native view either.

- `Keyboard.windowTop` in `@ng-native/device` is read from where React Native measures the app's root, so `<keyboard-dock>`, `<keyboard-avoiding-view>`, a focused `<text-input>` and `provideWebCompat()`'s window stay against the keyboard when the status bar is hidden or shown while it is up, on Android with React Native's edge-to-edge flag off (as in Expo Go). React Native keeps measuring from below where the bar was until the app's root is laid out again, while the bar's own height changed at once; the dock dropped behind the keyboard by the bar's height when the bar was hidden. ([#1236](https://github.com/ng-native/ng-native/pull/1236), [#1065](https://github.com/ng-native/ng-native/issues/1065))
- `Keyboard.dismiss()` from `@ng-native/device` puts the keyboard away. It called React Native's `Keyboard.dismiss()` alone, which blurs only a field React Native's own `TextInput` component recorded as focused, and a `text-input` is the native component with no such record, so the call did nothing on iOS or Android. It now sends `blur` to the focused `text-input`, as a scroll view does at a tap outside the field. A view or a pressable that has the focus, from a hardware keyboard or a D-pad, is left alone: a scroll view no longer sends it `blur`, or takes a tap away from its children to dismiss a keyboard that such a focus does not hold. A `search-field` or an `@expo/ui` text field does not report its focus to the engine, so `dismiss()` does not reach it yet. ([#870](https://github.com/ng-native/ng-native/pull/870))
- The `Keyboard` service in `@ng-native/device` reports a keyboard that is already up when it starts, on iOS and Android, so `height`, `visible` and `metrics` no longer read as a hidden keyboard until it next moves. On iOS, a service that starts while the keyboard is still moving reports where it lands. It starts from the last show or hide React Native's own `Keyboard` module recorded, and `watchConditions` now loads that module at startup so it records from then on. A keyboard the native header's search bar opened before the first `<text-input>` appeared is the usual case. An app that does not call `watchConditions` gets the start only for a keyboard opened after something first used the `Keyboard` service. ([#1144](https://github.com/ng-native/ng-native/pull/1144), [#1093](https://github.com/ng-native/ng-native/issues/1093))
- A navigation to a page under a screen further down the stack now drops the history entries of the screens it took off, and a failed or refused Back, or a failed navigation back to a kept screen, no longer leaves history or a route's observables changed. ([#1224](https://github.com/ng-native/ng-native/pull/1224), [#1181](https://github.com/ng-native/ng-native/issues/1181))

  Before, `Router.navigate()` to a page under a kept screen, such as `/compose/step` from a screen pushed over `/compose`, left the entries of the screens it took off behind the new one. A Back through history that failed, or that a guard refused, wrote the old url over the entry it went back to, with the default `canceledNavigationResolution: 'replace'`; that entry is now put back and the one left shows again. A failed navigation that changed a route's params, query params, fragment, url or data left the new values in that route's observables, and in inputs bound to them with `withComponentInputBinding()`, after its snapshot was put back; the old values are now sent again.

- On iOS, `Brightness.restore()` and the function `Brightness.set()` returns now put back the level the screen had before a level was set. Before, they called expo-brightness's `restoreSystemBrightnessAsync()`, which does nothing on iOS, so a screen set to full brightness for a boarding pass stayed at full brightness after the app until the device locked. The level is read when a `set()` comes while no app holds a level, and a change made in Control Center while a level is held is undone when it is put back. Leaving the app while a level is held still keeps that level until the device locks. Android is unchanged. ([#1078](https://github.com/ng-native/ng-native/pull/1078))
- On iOS a tap on an `<input-accessory-view>` written inside a `<scroll-view>` or a list no longer dismisses the keyboard. ([#1227](https://github.com/ng-native/ng-native/pull/1227), [#1168](https://github.com/ng-native/ng-native/issues/1168))

  The bar is drawn above the keyboard, outside the scroll view, so a tap on it that no control takes (a disabled button, the space between two) is not a tap outside the field, as in UIKit. The scroll view's `keyboardShouldPersistTaps` handling dismissed the keyboard for it, as React Native's own `ScrollView` does; this diverges from React Native on purpose. On Android, where the element is a plain view, a tap on it dismisses the keyboard as before.

- `<ng-icon [svg]>` reads markup it is given in time that grows with the markup's length, broken markup included. Some broken shapes took time that grew with the square of their length, all on the JS thread, at about 5 seconds for 100 KB in V8 and longer in Hermes: ([#1107](https://github.com/ng-native/ng-native/pull/1107))

  - a tag that never closes, `<a<a<a…`, or a tag name or the space before it with no `>` after;
  - an attribute name with no `=` after it;
  - a comment, a processing instruction or a CDATA section left open;
  - a `transform` or `gradientTransform` with a word and no `(`, or brackets that never close.

  Markup nested a few thousand elements deep overflowed the stack as it was drawn. Elements nested more than 32 deep are now left out of the drawing with everything inside them.

  A comment, processing instruction or CDATA section left open now hides the rest of the markup, as it does in a browser. An attribute is read only after a space, a tab or a line break, as XML writes it. The markup of every icon in the `@ng-icons` sets reads as before.

- `@ng-native/metro` applies an edit to a component's external template (its `templateUrl` file) after a reload when the template hosts an outlet, such as `<native-stack-outlet>` or `<native-tabs-outlet>`. An edit to such a template asks for a reload rather than a hot swap, and the reload, served the component's module from Metro's cache, kept showing the template as it was until the component's own `.ts` file changed. ([#1241](https://github.com/ng-native/ng-native/pull/1241))
- A back through history to the older of two entries one screen holds, such as `historyGo(-4)` to a screen's own entry after a query change in place gave it a second one, now returns to that screen rather than to a newer screen at the same url. ([#1133](https://github.com/ng-native/ng-native/pull/1133), [#1097](https://github.com/ng-native/ng-native/issues/1097))

  The native stack remembers each history entry still in history that a screen has been shown in, not only the last, including across a back to the screen and a query change on it. Native pops, `popTo()` and Back went to the newer entry already and are unchanged.

- An `@keyframes` animation on an element held unseen for a frame (what `provideWebCompat()` does for an overlay a library inserts) now starts when the hold lets go, as a browser starts it when it first paints the element, rather than as the element is inserted. Started under the hold, an animation of opacity that React Native's animated module played natively set the view's opacity over the hold's, so a fade-out showed the overlay whole through the frame it was meant to be unseen. Its clock starts from the release, so it ends a frame later than before. ([#1223](https://github.com/ng-native/ng-native/pull/1223), [#1190](https://github.com/ng-native/ng-native/issues/1190))
- A drag kept from the page by a `touchmove` listener holds still the scroll view the finger is in when the element under the finger is moved out of it in the same move, as CDK's drag and drop moves the item it drags to the body. ([#1101](https://github.com/ng-native/ng-native/pull/1101))
- `<native-header tabBarHidden>` hides the tab bar while its page is the one in front of the tab in front, for a detail or editor page pushed in a tab's stack, as UIKit's `hidesBottomBarWhenPushed` does. ([#1174](https://github.com/ng-native/ng-native/pull/1174), [#1124](https://github.com/ng-native/ng-native/issues/1124))

  The bar comes back when the page is popped or covered by another push, when another tab is selected, and when the header goes or the input turns false. A `[barHidden]` bound on `<native-tabs-outlet>` overrides every page's request. The bar appears and disappears without UIKit's slide, since react-native-screens hides it on the tab bar as a whole. `<native-tabs-outlet>` now commits `tabBarHidden` as `false`, rather than leaving it unset, while nothing hides the bar.

- Foldable in @ng-native/expo/foldable reads the posture and the angle from expo-hinge (Expo SDK 58) when it is installed, and keeps reading expo-foldables where expo-hinge is not installed or reports no hinge. ([#1051](https://github.com/ng-native/ng-native/pull/1051))

  expo-hinge's closed, partiallyOpen, fullyOpen and unknown statuses become the existing 'closed', 'partially-open', 'fully-open' and 'unknown' postures, and its angle becomes angle(). expo-hinge does not report where the fold crosses the window, so fold(), separating(), book() and tabletop() still come from expo-foldables, and are null or false without it. With expo-hinge in the app and expo-foldables not, reading the posture, fold or angle no longer throws an error asking to install expo-foldables. expo-hinge is a new optional peer dependency, and Foldable.HINGE stands in for it in a test.

- A `fill` or `stroke` a stylesheet sets on an element around a library's drawing reaches the drawing's shapes, as a browser hands it down through every element, so Material's calendar arrows, inside an icon button with `fill: currentColor`, draw in the button's colour instead of black. An icon's shapes from `@ng-native/icons` take no paint this way, as before. ([#1203](https://github.com/ng-native/ng-native/pull/1203))

  A paint attribute on the `<svg>` itself still wins over one handed down from a box around it, as in a browser: `<svg fill="none" stroke="currentColor">` inside Material's icon button draws an outline, not a filled shape.

- A navigation back to a screen further down the stack that fails now puts back the screens it took off, and a failed navigation no longer leaves a second history entry for the page showing. ([#1158](https://github.com/ng-native/ng-native/pull/1158), [#1090](https://github.com/ng-native/ng-native/issues/1090))

  Before, the screens above the kept screen were destroyed as the navigation started, so a failure left the router on the old url with that screen gone, and the next navigation could stack an empty screen. They are now kept until the navigation succeeds, as a replaced screen already was, and a cancel after the screen is shown, from a page that navigates as it is created, still takes them off. A navigation that wrote its url and then failed, or was refused by a guard with `urlUpdateStrategy: 'eager'`, including one a guard redirected to a page that fails or refuses it, no longer leaves that url's entry behind as a copy of the one before it, with the default `canceledNavigationResolution: 'replace'`. Back right after a failed navigation now goes back from the screen showing, including a screen whose page underneath failed; before, it did nothing.

- Under `provideWebCompat()`, a drawing's shape whose `fill` is no colour native reads, `contrast` as Highcharts writes one for a label, is painted in the text's colour rather than in native's default black, so the label stays visible on a dark shape. A `stroke` native cannot read is still drawn as none, as a browser drops it, and an `@ng-native/icons` shape is unchanged. ([#1148](https://github.com/ng-native/ng-native/pull/1148))
- `@ng-native/fabric` exports `isTextInput(node)`, which says whether a node commits as a text input (`TextInput` on iOS, `AndroidTextInput` on Android), and `@ng-native/components` and `@ng-native/web-compat` use it in place of their own copies of those view names. ([#1140](https://github.com/ng-native/ng-native/pull/1140), [#1098](https://github.com/ng-native/ng-native/issues/1098))
- `<expo-symbol [size]>` in `@ng-native/expo` is now a point size on iOS, as SwiftUI's `.font(.system(size:))` takes it: in a development build the symbol draws as large as SwiftUI draws it, and its view is the size of the symbol's image at that point size, weight and scale rather than `size` points square. ([#1228](https://github.com/ng-native/ng-native/pull/1228), [#1159](https://github.com/ng-native/ng-native/issues/1159))

  Most symbols draw 15 to 60% larger than before, and their views are wider or taller than `size`, so layouts around them can move. `@ng-native/expo`'s iOS native module gains a synchronous `NgNativeSymbol.imageSize(name, pointSize, weight, scale)` for this. Without that module, as in Expo Go, the view stays `size` points square with the symbol fitted into it. Android is unchanged: `expo-symbols` has no Android view.

- The starter template, and the apps `nx g @ng-native/nx:app` and `ng add @ng-native/schematics` write, start on Expo SDK 58: `expo` `~58.0.16`, React Native 0.88.0, React 19.3.0, `expo-status-bar` `~58.0.3`, `expo-system-ui` `~58.0.6` and `react-native-safe-area-context` `~5.10.1`, as `npx expo install --check` expects. The packages still run on SDK 57, so an existing app moves when it chooses to, with `npx expo install expo@^58.0.0` and then `npx expo install --fix`. ([#1055](https://github.com/ng-native/ng-native/pull/1055))

  - The app's `tsconfig.json` extends `expo/tsconfig.base.json`. SDK 58's `expo` has an exports map, and Vitest cannot find `expo/tsconfig.base` without its extension, so every test file failed to load with `Failed to load tsconfig 'expo/tsconfig.base'`. An app already on SDK 58 makes the same change to its own `tsconfig.json`.
  - `src/main.ts` no longer types `registerRunnable`'s `rootTag` as `number | string`, which React Native 0.88's `RootTag` type is not, and which failed `npm run typecheck` on SDK 58. An app already on SDK 58 removes the annotation from its own `src/main.ts`: `({ rootTag }) =>`.
  - A widget or Live Activity layout keeps an `@if` or `@switch` that matches no branch as an empty child in its place, as JSX keeps a `false`, rather than dropping it. expo-widgets 58 identifies each view by its position among its siblings, so the views after such a block now keep their identity when it changes, as they do in a JSX layout. Native skips the empty child on SDK 57 and 58, so nothing draws differently.

- New package @ng-native/eslint-plugin reports what compiles but does nothing on a device: a DOM event such as (click) or (keydown) on an HTML element or an element from @ng-native/components, a window, document or body listener, the same in a host object or a @HostListener, Angular's routerLink, an HTML control such as `<button>`, `<input>` or `<img>`, an element name with a capital such as `<View>`, a DOM member read off a nativeElement, an import from @angular/platform-browser, @angular/animations or zone.js, provideZoneChangeDetection, provideHttpClient, and a read of document, localStorage, sessionStorage, indexedDB, location, history, matchMedia or getComputedStyle, directly or through window or globalThis. Each report names what to use instead, and a file that starts with 'use dom' is skipped. eslint --fix renames (click) to (press) on a pressable and an element name to its lowercase one, and the editor offers (changeText) for (input) on a text input and provideNativeHttpClient for provideHttpClient. Its recommended config lints .ts and .html files through angular-eslint. ([#1046](https://github.com/ng-native/ng-native/pull/1046))

  The @ng-native/nx application generator and @ng-native/schematics' ng add and application schematic take --linter=eslint, which adds an eslint.config.mjs with the recommended config, the plugin and what it runs on, and an nx lint or ng lint target. The default, --linter=none, adds none of them, and the template is unchanged.

- Under `provideWebCompat()`, `element.style.filter`, a `filter` in a `style` attribute and a `[style.filter]` binding now take filter functions, such as `brightness(1.2) blur(2px)`, and give the view the filter list a stylesheet's `filter` compiles to, where every filter function was refused before. ([#1231](https://github.com/ng-native/ng-native/pull/1231))

  `blur()` takes a length in `px` or `rem`, `hue-rotate()` an angle, `drop-shadow()` two or three lengths and a colour, and the other functions a number or a percentage. A filter with a `url()` or any other value native has no form of is no filter, as in a browser. React Native draws `brightness()` and `opacity()` on iOS and Android, and the other functions on Android only.

- `Dialogs.choose()` in `@ng-native/device` takes an optional third argument, `{ message }`, the smaller line under the title that explains what a choice does: the action sheet's message on iOS and the dialog's message on Android. ([#1155](https://github.com/ng-native/ng-native/pull/1155), [#1125](https://github.com/ng-native/ng-native/issues/1125))
- An app `mount()` started is destroyed when Fabric stops the surface it is on, so an Android activity recreated after a font size or display size change no longer leaves the old app running beside the new one, with its timers, subscriptions and effects. ([#942](https://github.com/ng-native/ng-native/pull/942))

  Fabric stops a surface through the global `RN$stopSurface`, which React's renderer installs. `mount()` wraps it, around whatever is there and again when something replaced it, so React's handler and anything else that wraps the global are still called. An error the app's destroy throws goes to its `ErrorHandler`.

- A stylesheet's `tint-color: platform-color(...)` compiles, where it was dropped with a "not mapped yet" warning. `tint-color` holds the platform colour names as `color` and the other colour properties do. ([#1205](https://github.com/ng-native/ng-native/pull/1205))
- In a library's sheet under `provideWebCompat()`, a clip band whose edge is a token, `clip-path: polygon(0 0, var(--position, 50%) 0, var(--position, 50%) 100%, 0 100%)`, is no longer refused: the engine settles it for each image, so the band follows the token as a script sets it and goes back to the fallback as it is taken away. ([#1115](https://github.com/ng-native/ng-native/pull/1115))
- A stylesheet's `padding-horizontal`, `padding-vertical`, `margin-horizontal` and `margin-vertical` compile as `padding-inline`, `padding-block`, `margin-inline` or `margin-block` with the same one value does, to both edges of the axis. An `em` value (`padding-horizontal: 1.5em`), which was sent to native unresolved and drew no padding, now resolves against the font size, and a `calc()` of lengths (`calc(1rem + 2px)`, `calc(10% + 4px)`), which was dropped, now compiles. A second value is dropped with a warning that points to `padding-inline`, and `inherit` with the warning any CSS-wide keyword gets. On the web host the browser reads the CSS itself and has none of these properties, so there they do nothing. ([#1205](https://github.com/ng-native/ng-native/pull/1205))
- A style or a custom property bound to text from outside the app's own code, such as a theme fetched from a server, no longer throws in the middle of change detection. Two shapes did, and while the text stayed bound the rest of that view's bindings were skipped on every tick: ([#1106](https://github.com/ng-native/ng-native/pull/1106))

  - a function named after a property every object has, `[style.color]="'constructor(from red r g b)'"` (`TypeError: keywords is not iterable`);
  - brackets nested a few thousand deep, in a `calc()`, a `color-mix()`, a relative colour or a `var()` fallback, which overflowed the stack.

  Both are now left unset, as any other value the engine cannot read is. Brackets nested more than 32 deep are not read.

  Two smaller cases of the same kind are fixed with them. A bound word named after such a property, `constructor`, is no longer sent to native as a font weight, and `constructor(var(--c))` is no longer drawn as `rgb(var(--c))`. A colour function that is not a colour is no longer read a second time as part of a `color-mix()`, which read each one nested in its fallbacks twice: sixteen of them, about 300 characters, took some 400 ms.

- `UiBottomSheet` in `@ng-native/expo` takes `interactiveDismissDisabled`, `backgroundInteraction` and `modifiers` inputs, so a sheet can stay up against a swipe and, on iOS 16.4 and later, leave the screen behind it to take touches. ([#1163](https://github.com/ng-native/ng-native/pull/1163), [#1126](https://github.com/ng-native/ng-native/issues/1126))

  On iOS `interactiveDismissDisabled` is SwiftUI's `interactiveDismissDisabled`: a swipe down takes the sheet to its smallest detent and no further. On Android it turns off the swipe, the back button and a tap outside the sheet, and with them the drag between the sheet's half and full heights, which Compose's sheet cannot keep without the swipe. `backgroundInteraction` is SwiftUI's `presentationBackgroundInteraction`, taking `'automatic'`, `'enabled'`, `'disabled'` or `{ upThrough: <detent> }`, and is iOS only: Android has no equivalent. `modifiers` adds SwiftUI modifiers after the sheet's own presentation modifiers, on iOS only. The new `UiBottomSheetBackgroundInteraction` type is exported. Every Android sheet now commits `sheetGesturesEnabled` and `properties` to Compose's sheet, at their defaults unless dismissal is disabled.

- With the same url on the stack twice, a back through history lands on the screen of the history entry it returns to, and `popTo()` or a native pop of several screens at once on iOS lands on the screen it pops to. Before, each could land on the newer screen at that url and leave screens above the one asked for. ([#940](https://github.com/ng-native/ng-native/pull/940))
- Android's back button, and NativeNavigation.back(), at the root of a tab now go to the first tab in the bar, rather than to a first tab an @if has taken out of it. ([#1062](https://github.com/ng-native/ng-native/pull/1062))

  The first tab is read from the bar as it is when back is pressed: a tab an @if puts before the others becomes the one back goes to, and a first tab taken away and shown again is returned to where it was left. On the first tab in the bar, the button is declined, so Android leaves the app.

- On Android, a `HardwareBack.handle()` handler a screen subscribes from its constructor is asked only while that screen is in front, so a screen pushed or presented over it gets the back press instead of the handler of the screen underneath. ([#1053](https://github.com/ng-native/ng-native/pull/1053))

  Before, the screen below had subscribed after the stack it is in, so React Native asked its handler first: a form that claimed the button to confirm leaving kept a screen it had opened from going back. A handler subscribed outside an injection context, or where no screen is provided, such as an app's root component or a service, is asked as before, whatever is showing.

- `audioRecorder()` from `@ng-native/expo/audio` records with `expo-audio`: a recorder owned by the component that makes it, released when it is destroyed, with its `getStatus()` as a `state` signal, as `useAudioRecorder` and `useAudioRecorderState` give a React component. ([#1027](https://github.com/ng-native/ng-native/pull/1027))

  The recorder is made with the options merged for the platform, as `useAudioRecorder` makes it, so `metering` works on Android, which reads `isMeteringEnabled` only from those. The player page also shows `expo-audio`'s `setAudioModeAsync({ playsInSilentMode: true })`, which an app calls directly to play with the iOS silent switch on.

- A component that imports Animated or AnimatedStyle from @ng-native/components/animations can be loaded in a Vitest test, where ngNative() now stands in for that entry point. ([#1042](https://github.com/ng-native/ng-native/pull/1042))

  The stand-in is the browser build's Animated graph with no frames between: timing, spring and delay finish as soon as they start, the value is where the animation ends, and the end callback is called with finished set to true. Easing and the sequence and parallel composites behave as they do on a device, and the stand-in is also exported as @ng-native/components/stand-ins/animations.

- On Android, a `<keyboard-avoiding-view>`, a `<keyboard-dock>` and a field focused with the keyboard up no longer come up short of the keyboard by the status bar's height where React Native's edge-to-edge flag is off, as in Expo Go. ([#1021](https://github.com/ng-native/ng-native/pull/1021))

  React Native reports the keyboard's `screenY` from the top of the screen, and on Android without that flag measures a view from below the status bar. The three now take the bar's height off `screenY` before comparing the two, so an app that passed the status bar's height as `keyboardVerticalOffset` to make up for it should pass it no longer. iOS is unchanged. `Keyboard.windowTop` and `KeyboardSource.windowTop` from `@ng-native/device` are new.

- On Android with `provideNativeKeyboard()`, a keyboard that is already up and still when the `Keyboard` service starts listening is reported at once: `Keyboard.height`, `metrics` and `position` say where it is, where they said zero until it next moved. That happens when the first thing to use the service, such as a `<keyboard-avoiding-view>`, appears while a field that does not use it, such as the native header's search bar, has the keyboard open. ([#1047](https://github.com/ng-native/ng-native/pull/1047))
- On Android, the header's back arrow no longer leaves a screen whose page sets `preventNativeDismiss`: it fires `(nativeDismissCancelled)` and keeps the screen, as the Back button does. ([#1026](https://github.com/ng-native/ng-native/pull/1026))

  Every screen is committed with react-native-screens' `nativeBackButtonDismissalEnabled` off, as react-navigation's native stack does, so the arrow reaches the router, which goes back as before for a screen that does not refuse. iOS is unchanged.

- On Android a dashed or dotted border with rounded corners stays dashed while its `border-color` or `border-width` transitions, and when an element's own style gives every side the same new width or colour, where it was drawn solid. ([#1151](https://github.com/ng-native/ng-native/pull/1151), [#1057](https://github.com/ng-native/ng-native/issues/1057), [#1058](https://github.com/ng-native/ng-native/issues/1058))

  Android strokes a rounded border dashed only from the unsided `borderWidth` and `borderColor`, and only while all four sides equal them. These are now worked out from the props the view is committed with, after the element's style and each frame of a transition, so they follow the sides; before, they came from the stylesheet alone.

- A failed startup read of the accessibility settings in `@ng-native/device` no longer leaves an unhandled promise rejection, and `watchConditions` no longer tells the engine about reduced motion after its unsubscribe has been called. `Accessibility` and `watchConditions` keep the neutral settings when the read fails, and the change events still correct them. ([#1139](https://github.com/ng-native/ng-native/pull/1139), [#1095](https://github.com/ng-native/ng-native/issues/1095))
- In an app with `provideWebCompat()`, an `<img>` that a library's stylesheet or a script clips to a band of itself with `clip-path: polygon(a 0, b 0, b 100%, a 100%)` is drawn through that band, and the compiler keeps such a band in a library's sheet and sends it to no native view. ([#1103](https://github.com/ng-native/ng-native/pull/1103))
- Under `provideWebCompat()`, a `focus` and a `blur` event say `cancelable: true`, so a library that calls `preventDefault()` on its input's blur and checks the event is cancelable first (a combobox closing its list) sees it stopped. A browser sends both as not cancelable. ([#1123](https://github.com/ng-native/ng-native/pull/1123))
- Under `provideWebCompat()`, `finish()` and `cancel()` on an `@keyframes` animation from `element.getAnimations()` now end it on the view: `finish()` draws it at its last frame where it fills forwards and at its resting style where it does not, and `cancel()` at its resting style, fill or not, and leaves it cancelled while the element asks for the same animation. One React Native's animated module was playing natively is stopped there, where before it played on to its end. `cancel()` of one that has ended and is held at its last frame by its fill lets go of that frame. A transition's `finish()` and `cancel()` still settle `finished` and `playState` only. The engine has `endPlaying(node, 'finish' | 'cancel')` for this. ([#1216](https://github.com/ng-native/ng-native/pull/1216), [#1186](https://github.com/ng-native/ng-native/issues/1186))
- With `@ng-native/web-compat` on Android, an element in a screen under a navigation header is measured where it is drawn and touched rather than the header's height above it, so `getBoundingClientRect()` and a touch's `clientY` agree and a library's own hit test finds the element under the finger. ([#1104](https://github.com/ng-native/ng-native/pull/1104))
- `mount()` from `@ng-native/web` runs the app's initializers (`provideAppInitializer` and `APP_INITIALIZER`) before the root component is created, as the native `mount()` does, rather than never running them. ([#1054](https://github.com/ng-native/ng-native/pull/1054))

  An initializer that returns a promise is started without delaying the first render, and one that fails reaches the `ErrorHandler`. An island mounted with `injector` is unchanged: its host app runs its own initializers.

- On Expo SDK 57 and earlier, the build now warns about an `@font-face` that declares a weight range, such as `font-weight: 200 800`, because expo-font registers only a variable font's default instance there. ([#1145](https://github.com/ng-native/ng-native/pull/1145))

  On those versions iOS draws that instance at every weight, and Android draws it below 700 and its system font from 700. From Expo SDK 58 the text's `font-weight` picks the instance (on iOS the nearest named instance, on Android 10 and later from the `wght` axis), and the build does not warn. The Fonts page now says what each platform draws on each SDK, and to declare one file per weight before SDK 58. The face is still registered as before.

- A `var()` in a property the compiler does not translate, such as `caret-color: var(--x)` or `scroll-margin: var(--x)`, is dropped with the warning the same property written out gets ("not mapped yet" or "has no React Native equivalent"), where the warning called it a shorthand. ([#1222](https://github.com/ng-native/ng-native/pull/1222), [#1180](https://github.com/ng-native/ng-native/issues/1180))
- A dashed or dotted border the same on every side is drawn dashed or dotted on Android when it has rounded corners, where it was drawn solid. ([#871](https://github.com/ng-native/ng-native/pull/871))

  Once the cascade and every token have settled a view's border, the engine sends React Native's unsided `borderWidth` and `borderColor` beside the four sides wherever the four agree and the width is not 0: Android strokes a rounded border from those alone. This holds for a width or colour from a `var()`, in `em` or a viewport unit, or given side by side. A border whose sides differ, or that has a logical side of its own, is sent as its sides only, as before.

- A `<touchable-opacity>` eases back after a press to the opacity its classes or style give it, where one dimmed by a class eased up to 1 first, and one given an opacity by an inline `[style]` or a bound `[style.opacity]` now dims while pressed. ([#1061](https://github.com/ng-native/ng-native/pull/1061))

  The resting opacity is whatever the cascade resolves when the press ends, from a component's sheet, a global sheet such as Tailwind's, an inline `[style]` or a bound `[style.opacity]`, and a change to it while the control is pressed or fading back is followed. A Tailwind `opacity-*` class on the control now applies at rest, where the component's own `opacity: 1` rule outranked it. The component no longer commits `opacity: 1` at rest when nothing sets an opacity, which native draws as 1 all the same.

- `tint-color` and `shadow-color` in a stylesheet take a relative color or `color-mix()` of a token, a `light-dark()` side holding one, and `currentColor`, as `color` does, where the first three were dropped at build time as "not mapped yet" and `currentColor` was sent to native as a word it reads no color in. ([#1204](https://github.com/ng-native/ng-native/pull/1204), [#1156](https://github.com/ng-native/ng-native/issues/1156))

  lightningcss knows neither property, so each arrived as raw terms and was read as a color written out, a platform color or a lone `var()` only. A value it cannot take, such as `inherit` or a misspelled color name, is now dropped with a warning saying why, where the word was sent on as the color.

- A stylesheet's `text-wrap: pretty` (and `text-wrap-style: pretty`, Tailwind's `text-pretty`) sets iOS's `lineBreakStrategyIOS` to `standard`, the line breaking UILabel and SwiftUI use, and `word-break: keep-all` (`break-keep`) sets it to `hangul-word`, where both were dropped as having no React Native equivalent. ([#1225](https://github.com/ng-native/ng-native/pull/1225), [#1138](https://github.com/ng-native/ng-native/issues/1138))

  `text-wrap: balance` (`text-balance`) sets Android's `textBreakStrategy` to `balanced`; iOS has no balanced breaking. `wrap`, `auto` and `stable` set each platform's default, and `word-break: normal` sets iOS's `none`. Both props are inherited, so a class on a view reaches the text inside it, and a prop bound on a `<text>` wins. `text-wrap: nowrap` and the other `word-break` values are still dropped, with a message that says what to write.

- A stylesheet's `text-shadow` takes `platform-color()` or a system colour such as `LinkText` as its colour, written out or as a `var()` fallback, and commits it as `textShadowColor` the way `color` commits it, where each was dropped with a warning. ([#1218](https://github.com/ng-native/ng-native/pull/1218))
- A `<text-input>` moves its caret or selection to a bound `[selection]` on iOS and Android, on the first render and whenever the binding changes, where it went out only as a prop, which Android has no use for and iOS reads only as the field appears or its text is replaced. ([#1060](https://github.com/ng-native/ng-native/pull/1060))

  As in React Native's `TextInput`, the selection is sent with the `setTextAndSelection` command whenever it differs from the one native last had, so a caret the user moves goes back to the bound selection, and a selection with no `end` is a caret at `start`, where iOS put the end at 0. A text set from code carries the bound selection with it. On Android, `(selectionChange)` now fires, as Android's field reports selection changes only when asked to, and `cursorColor` and `selectionHandleColor` follow `selectionColor` when they are not set, as React Native's do.

- `ngNative()` removes the module copies a Vitest run leaves in the system temp directory when the run closes on Windows, as it already did on other platforms. ([#1050](https://github.com/ng-native/ng-native/pull/1050))
- `@ng-native/testing` finds an `@expo/ui` `<ui-button>` by role and name, and `userEvent.press` and `fireEvent.press` fire its `(buttonPress)`. ([#1221](https://github.com/ng-native/ng-native/pull/1221), [#1178](https://github.com/ng-native/ng-native/issues/1178))

  Its role is `button` and its name is its `label`, or the text inside it, as a screen reader reads SwiftUI's and Compose's buttons. Its SwiftUI `role`, such as `destructive`, no longer matches `getByRole`. On iOS, SwiftUI's `disabled` modifier makes it `disabled` and a press on it sends nothing. A press also reaches a `<ui-button>` in a `ui-bottom-sheet`'s bar on iOS. A query for `getByRole('button')` alone now finds `<ui-button>`s as well as core buttons, so a test that expected one match may need a `name`. Other `@expo/ui` controls are not covered yet.

- `compileCss()` from `@ng-native/testing` takes `generated: true`, to compile a sheet as the build compiles a library's, with `::before`, `::after` and the rest a browser reads. ([#1109](https://github.com/ng-native/ng-native/pull/1109))
- Under `@ng-native/testing`, a press reaches a pressable inside an open `ui-bottom-sheet`, and the `ui-toolbar-item`s written inside a sheet are in the rendered tree on iOS, as they are on a device with a development build. ([#1132](https://github.com/ng-native/ng-native/pull/1132), [#1119](https://github.com/ng-native/ng-native/issues/1119), [#1127](https://github.com/ng-native/ng-native/issues/1127))

  A press now stops checking `pointerEvents` at a view committed with `layoutRoot`, `@expo/ui`'s view host for a sheet's or a popover's content, which takes its content's touches itself; before, the sheet's `pointerEvents: 'none'` host stopped every press inside it. While something is rendered, `render()` puts an `expo` global in place whose `getViewConfig` answers for every view, where there is no `expo` global already, and removes it once nothing is rendered. Components that ask the build whether it has a view, as `ui-bottom-sheet` does for SwiftUI's toolbar, render as they do in a development build. A test that sets its own `expo` global keeps it.

- On iOS, a sideways swipe on a `ui-swipe-actions` row of `@ng-native/expo` no longer presses a `pressable` inside the row's `ui-view-host`, and the responder system of `@ng-native/fabric` now asks `onMoveShouldSetResponderCapture` and `onMoveShouldSetResponder` on every move while a node holds the touch, as React Native does, so a node above the responder can take a drag from it. ([#1233](https://github.com/ng-native/ng-native/pull/1233), [#1169](https://github.com/ng-native/ng-native/issues/1169))

  The row takes a drag once the finger has moved 20 points sideways, and further sideways than down. A pressable that gives up the touch is told it was terminated, so it does not press; one with `cancelable` false keeps the touch and presses as before. A tap, and a drag mostly down the row, still press. Only the nodes above the responder are asked, from the lowest node above both it and the moving finger's target; the responder answering yes keeps the touch.

- A shape with no paint of its own takes the `fill` or `stroke` its `<svg>` sets as an attribute, so `<svg fill="currentColor">` icons such as Material's date picker toggle draw in the text colour around them instead of black. ([#1201](https://github.com/ng-native/ng-native/pull/1201))
- A new app's `src/main.ts`, from the template, `@ng-native/nx:app` or `ng add @ng-native/schematics`, stops `watchConditions` as the app is destroyed, so an Android activity recreation (a font scale change, for one) no longer leaves the old app watching the device's conditions beside the new one. An existing app's entry point is changed the same way by the `stop-watching-conditions` migration, which `nx migrate`, `ng update` and `npx @ng-native/migrate` run: what `watchConditions(app.engine)` returns is kept as `const stopWatching = watchConditions(app.engine);` and passed to `app.applicationRef.onDestroy(stopWatching)`. A call it cannot rewrite is left with a note saying what to add. ([#1217](https://github.com/ng-native/ng-native/pull/1217), [#1191](https://github.com/ng-native/ng-native/issues/1191))
- A `position: static` box with a `filter`, a `backdrop-filter` or a `perspective` other than `none`, a `contain` of `layout`, `paint`, `strict` or `content`, or a `will-change` naming `transform`, `translate`, `rotate`, `scale`, `perspective`, `filter`, `backdrop-filter`, `contain` or `position` is now the box an absolute element inside it is placed against, as in a browser, rather than the nearest positioned ancestor. It is committed `position: relative`, with its insets dropped as a static box's are, as one with a `transform` already was. An app's own stylesheet reaches this through `filter` only: it drops the other properties. Under `provideWebCompat()`, a library's sheet, `element.style`, a `style` attribute and a `[style.x]` binding reach it through the others too. ([#1214](https://github.com/ng-native/ng-native/pull/1214), [#1192](https://github.com/ng-native/ng-native/issues/1192))
- A tap on another `<text-input>` inside a `<scroll-view>`, `<virtual-list>` or `<section-list>` no longer dismisses the keyboard while a field has focus, with `keyboardShouldPersistTaps` at `'never'` or `'handled'`. ([#1022](https://github.com/ng-native/ng-native/pull/1022))

  The field takes the focus with the keyboard still up, as in React Native; before, it took a second tap. Any other tap does what `keyboardShouldPersistTaps` says, as before.

- `SafeArea` from `@ng-native/device` forgets what a `<safe-area-provider>` from `@ng-native/components` reported once that provider is destroyed. It kept the provider's frame and insets, so `Screen.window` stayed at the frame the provider last measured: after a rotation it still reported the old width and height, and `orientation` and `compact` with it. Now `frame` goes back to null, `insets` to zero and `known()` to `false`, the `--safe-area-inset-*` custom properties go back to zero, and `Screen.window` follows `Dimensions` again until another provider reports. A provider destroyed after another one has reported leaves that report alone, and one destroyed while an older provider is still up puts back what that one last reported. ([#1064](https://github.com/ng-native/ng-native/pull/1064))
- A `<native-tab>` in `@ng-native/router` with a `template` or `svg` icon no longer closes the app on iOS with react-native-screens 4.29 or later (Expo SDK 58): it commits the icon as an `image` with a `template` rendering mode, the form those releases read, and keeps `iconType: 'template'` for earlier ones. ([#1219](https://github.com/ng-native/ng-native/pull/1219))

  react-native-screens 4.29 dropped the `template` icon type, and native aborts on an icon type it does not know, as the tab bar is created. The router reads the version from `react-native-screens/package.json`, so the app has to have react-native-screens installed, which it already needs for native tabs. Android is unchanged.

- A url string given to `NativeNavigation.push()`, `replace()`, `present()` or `reset()` now has its path parsed as `navigateByUrl()` and `popTo()` parse it: `push('/user/a%20b')` opens `/user/a%20b` with the parameter `a b`, `push('/user/1;tab=posts')` gives the segment `1` the matrix parameter `tab`, and a named outlet such as `(aux:b)` reaches its outlet. Before, the path went to `navigate()` as segment text, so its escapes were escaped again (`/user/a%2520b`, the parameter `a%20b`), and a `;` or an outlet's brackets became part of a segment. This includes a page of another tab given to `present()`. A deep link that arrives while the app is running is pushed this way without `withLinkParent`, so it now opens with the same parameters as when the app launches on it, and a `popTo()` with the same string now finds the screen. ([#1077](https://github.com/ng-native/ng-native/pull/1077))
- A `stackAnimation` given to `NativeNavigation.reset()` or `replace()` is now the one the new screen arrives with, on iOS and Android: `reset('/sign-in', { presentation: { stackAnimation: 'none' } })` lands with no animation. Before, it was never read, and the reset slid on iOS as a back from the screen it took away. Such a navigation is given `replaceAnimation: 'push'` unless it names its own, or its `stackAnimation` is `default`, and `reset()` and `replace()` now declare the `presentation` option. A reset to a screen still on the stack puts up no new screen, and still animates as a back from the screen it takes away. ([#872](https://github.com/ng-native/ng-native/pull/872))
- On iOS 26 and later, a stack page under an opaque `<native-header>` starts below the bar with react-native-screens 4.30 (Expo SDK 58), rather than behind it. From 4.30 react-native-screens lays every screen out under the navigation bar on iOS 26 and later, opaque or not, and insets the content with a safe area view its own stack item wraps it in, which `@ng-native/router` had no equivalent of. The stack outlet now commits each page's content in the same `RNSSafeAreaView` on iOS 26 and later, insetting the top edge while the page's header is shown and not translucent, as react-native-screens does. A translucent header, a large title, a hidden header and a page with no header keep the content under the bar as before. With react-native-screens 4.26 (Expo SDK 57) the view insets by nothing, since the screen already starts below an opaque bar there. Under such a header on iOS 26 and later, `<screen-safe-area-view>` leaves the top edge to the stack, so the bar is not counted twice. Before iOS 26 and on Android nothing changes. On iOS 26 and later, whatever react-native-screens version, the page's template is in that view rather than directly in the screen, so a layout a page's `:host` style gives its children (`justify-content`, `align-items`, `gap`, `flex-direction`) no longer reaches them and a `:host > ...` selector no longer matches: lay the page out on an element at the root of its template instead. ([#1206](https://github.com/ng-native/ng-native/pull/1206))
- A listener a script adds with `Renderer2.listen` keeps the options it was given, so under `@ng-native/web-compat` a document `touchmove` listener that says it is not passive keeps a drag from the page, as CDK's drag and drop does, where the page used to scroll under the dragged item. A renderer extension's `listen` hook is passed the options as its last argument. ([#1100](https://github.com/ng-native/ng-native/pull/1100))
- `<refresh-control [colors]>` reaches Android as colours native reads, each entry through `processColor` as React Native's `processColorArray` does, where the strings were sent as written. ([#1150](https://github.com/ng-native/ng-native/pull/1150), [#1079](https://github.com/ng-native/ng-native/issues/1079))

  An entry with no colour is sent as transparent, as React Native sends it. `<expo-symbol [colors]>` takes the same path, as Expo's own `SymbolView` processes its palette on iOS.

- `NativeNavigation.present()` shows a page of a tab behind the one in front over it after the app calls `router.resetConfig()`, where it failed with "Cannot match any routes" for a page whose route had been presented that way before the reset. ([#1052](https://github.com/ng-native/ng-native/pull/1052))
- A custom property can hold `platform-color()` or a system colour such as `LinkText`, and `var()` of it in a colour property commits what the colour written there commits. ([#1175](https://github.com/ng-native/ng-native/pull/1175))

  `--accent: platform-color(link)` was refused where it was defined, so `color: var(--accent)` was dropped. It is now read in a component's sheet, its `:host` rules, a global sheet, a `@media` override such as `prefers-color-scheme: dark`, and a bound `[style.--accent]`, and as a `var()` fallback. A platform colour has no channels, so a `color-mix()`, a relative colour, a gradient, a `box-shadow` or a faded colour (Tailwind's `bg-accent/50`) worked out of such a token is dropped: the build warns where the sheet that sets the token also does that, and in development the engine warns on the device, naming the declaration and the token. A `text-shadow` takes such a token as its colour, as its colour is a property of its own.

- A plain Router.navigate() or navigateByUrl() to a url further down a native stack now goes back through history to that screen's entry, as popTo() does, so the history no longer keeps entries for the screens it takes off and Back goes to the screen below. ([#1045](https://github.com/ng-native/ng-native/pull/1045))

  The screen already there is still the one shown, and the stack does not grow. The entry keeps the state it was pushed with, the screen's presentation included. The navigation still resolves true. A navigation with skipLocationChange leaves the history as it is, and so does one from a stack inside a tab whose history went through another tab since that screen was shown, where the entry that far back is the other tab's. An app whose router sets canceledNavigationResolution to 'computed' keeps the history as before, since the router counts its own entries there.

- A box as wide as its content that holds a percentage `flex-basis` in a row, as Angular Material's chip does, is as wide as its content again, where it filled the room it was in and could widen the screen. ([#1068](https://github.com/ng-native/ng-native/pull/1068))
- `platform-color()` in a colour property of an element's own style (`style="color: platform-color(link)"`, `[style.color]` or `[style]`) commits the platform colour a stylesheet commits, where it was sent to native as text and drew no colour. ([#1213](https://github.com/ng-native/ng-native/pull/1213), [#1179](https://github.com/ng-native/ng-native/issues/1179))

  A stylesheet's `outline-offset` takes a `calc()` of lengths, `calc(2px * -1)`, and a function of a token, `calc(var(--x) * -1)` as Tailwind's `-outline-offset-(--x)` writes it, where both were dropped with a "not mapped yet" warning. A `calc()` with a percentage in it is dropped as `outline-offset: 37%` is.

- `@ng-native/device` exports an `OS` injection token beside `OS_VERSION`, so a service can gate a feature on the operating system, such as Apple Foundation Models on iOS 26, and a test can provide the OS it wants with `{ provide: OS, useValue: 'android' }`. ([#1162](https://github.com/ng-native/ng-native/pull/1162), [#1120](https://github.com/ng-native/ng-native/issues/1120))

  It is `'ios'` or `'android'` from `Platform.OS` on a device, and `'web'` in the `@ng-native/web` host, which provides it. In a test it is the platform the test renders as: `'ios'`, or `'android'` after `registerPlatformComponents('android')`. A service no longer needs to import `Platform` from `react-native`, which a Vitest spec cannot load.

  Inside an island (`mount` with an `injector`, or `<ng-native-island>`), the web host provides `OS` only in the island's own injector. A root service of the host app reads `'ios'` there, so an app that uses islands and has root services that inject `OS` provides `{ provide: OS, useValue: 'web' }` in its own `bootstrapApplication` providers.

- `nx typecheck` in a workspace whose libraries are package links resolves `@ng-native/web-compat`'s entry points, `@ng-native/web-compat/ng-icons` among them, from its `dist` as it does the other packages that publish them. ([#1165](https://github.com/ng-native/ng-native/pull/1165))
- `@ng-native/nx` installs in a workspace on Nx 24, which `create-nx-workspace` now creates, as well as on Nx 23. Its peer range on `nx` and its `@nx/devkit` range were `^23.0.0`, so npm refused `nx add @ng-native/nx` in an Nx 24 workspace with `ERESOLVE`. Both now take `^23.0.0 || ^24.0.0`. The `init`, `app`, `library`, `component` and `tailwind` generators and every migration run on Nx 24 as they do on 23. ([#1215](https://github.com/ng-native/ng-native/pull/1215), [#1184](https://github.com/ng-native/ng-native/issues/1184))
- `Brightness`, `KeepAwake` and `ScreenCapture` each keep a window of their own when their Expo module is absent, so creating a second of them in Node tests or on the web host no longer throws. ([#1044](https://github.com/ng-native/ng-native/pull/1044), [#1040](https://github.com/ng-native/ng-native/issues/1040))

  Each window is kept by what it is for as well as by its native module, so the same object provided as the source of two services, such as one fake given to both `StatusBar.SOURCE` and `NavigationBar.SOURCE`, gives each service its own claims too. Every app on one present native module still shares that module's window. `sharedBySource` from `@ng-native/device`, the helper `@ng-native/expo` uses for this, takes what the value is for as its first argument.

- Where a native module is not there, as on the web host or in Node tests, each app keeps its own window claims, so the claims of an app that is never destroyed no longer show in every app mounted after it. This covers `Brightness`, `KeepAwake` and `ScreenCapture` without their Expo modules, `DeviceOrientation` without `expo-screen-orientation`, `StatusBar` without React Native, and `NavigationBar` off Android or without `expo-navigation-bar`. ([#942](https://github.com/ng-native/ng-native/pull/942))
- A `<text-input>` on the web host keeps the listeners and `IntersectionObserver` observations added to it through its node when `multiline` changes, so an `@defer (on interaction | hover | viewport)` trigger on it still loads its content. ([#1063](https://github.com/ng-native/ng-native/pull/1063))

  Switching `multiline` replaces the field's `<input>` with a `<textarea>`, or back. Listeners added with the node's `addEventListener` and observations made by passing the node to an `IntersectionObserver` now move to the new element and leave the old one, as the engine's own listeners already did. A `once` listener that already fired, or one whose `signal` aborted, is not added again.

- `@defer (on interaction)`, `(on hover)` and `(on viewport)` load their content on the web host, rather than keeping the placeholder forever and reporting an error to the `ErrorHandler` for each trigger. ([#1056](https://github.com/ng-native/ng-native/pull/1056))

  Angular registers these triggers on the element itself: it asserts in a development build that the element is an `Element`, listens with `addEventListener`, and watches it with the page's `IntersectionObserver`. An element node from `@ng-native/web` now passes `instanceof Element`, forwards `addEventListener` and `removeEventListener` to the DOM element it wraps, and can be observed by an `IntersectionObserver`, whose entries name the node it was given.

- With `provideWebCompat()`, the window has an in-memory `localStorage` and `sessionStorage`, `getSelection()` (on the window and the document) with nothing selected, an `open()` that returns `null` and a `ShadowRoot`, so a library that reads them while it loads no longer throws; an app that did not ask for the package gets none of them. ([#1074](https://github.com/ng-native/ng-native/pull/1074))
- A library that adds a window listener as its modules load, as Angular's CDK does, no longer throws where it is imported outside a lazy route: `withWebCompat` gives the window stand-in listeners before any module runs, and hands what they were given to the window once an app is up. ([#1067](https://github.com/ng-native/ng-native/pull/1067))
- With `@ng-native/web-compat`, the window ends at the top of the keyboard while it is up and starts under the navigation header, so `innerHeight`, `visualViewport.height`, element and touch positions, `resize` and `document.body` follow both, and an overlay a library places in the window, such as an Angular Material menu or bottom sheet, stays out from under the keyboard and the header. ([#1099](https://github.com/ng-native/ng-native/pull/1099))
- An element's `getAnimations()` answers as the Web Animations API does under `@ng-native/web-compat`, with a `finished` that settles when an animation ends or stops, and `updateTiming({ fill: 'forwards' })` to hold one at its last frame. ([#1086](https://github.com/ng-native/ng-native/pull/1086))
- A touch event from `@ng-native/web-compat` has `targetTouches`, the fingers down that came down on the element it is sent to, so a CDK drag and drop item no longer throws `Cannot read property 'pageX' of undefined` as a finger comes down on it. ([#1100](https://github.com/ng-native/ng-native/pull/1100))
- A table in an app with `@ng-native/web-compat` is laid out as a table: its rows are rows of cells in columns, with `colspan`, `rowspan` and `table-layout: fixed`, so Angular Material's calendar shows its weeks as rows of days instead of one column. ([#1069](https://github.com/ng-native/ng-native/pull/1069))
- A touch on a drawing in `@ng-native/web-compat` reaches the shape a browser finds under the finger, text among them, and sends the mouse events of a tap, so a chart shows a series' tooltip. ([#1085](https://github.com/ng-native/ng-native/pull/1085))
- An SVG text under `@ng-native/web-compat` has `getNumberOfChars()` and `getSubStringLength()`, measured as `getComputedTextLength()` is, so a chart library that cuts a label short with an ellipsis can. ([#1110](https://github.com/ng-native/ng-native/pull/1110))
- A link (`<a>`) inside an `<svg>` in an app with `@ng-native/web-compat` is drawn as a group of the shapes it holds, so a drawing with links in it, such as the SVG logo, draws where it showed nothing. ([#1081](https://github.com/ng-native/ng-native/pull/1081))
- A web library's `<select>` under `provideWebCompat()` now chooses the way a browser's does in three cases where it did not: ([#1161](https://github.com/ng-native/ng-native/pull/1161))

  - Pressing the option it already shows closes the list and says no `input` or `change`, where it said both, so a form no longer marks the field as changed when nothing was.
  - An option inside a disabled `<optgroup>` cannot be pressed, and is not the one shown first when nothing is chosen.
  - Of two options with the same value, or with no value and the same text, the one chosen by `selectedIndex`, by `selected` or by a press is the one the select shows and reports, where the first of them always was. Taking that option out chooses again, as removing the chosen option does, instead of moving to the other one. A `value` set by a script or a binding still chooses the first option of that value.

- In an app with `provideWebCompat()`, an `<input type="range">` keeps its value within its `min`, `max` and `step`, has `valueAsNumber`, `stepUp()` and `stepDown()`, and moves under a finger with `input` and `change` events, so Material's slider can be dragged. ([#1082](https://github.com/ng-native/ng-native/pull/1082))
- With `@ng-native/web-compat`, an overlay a library puts in `document.body`, such as an Angular Material menu, is first seen in the frame after it is inserted, styled and placed, where it was drawn for a frame as it was inserted, and a sheet that opens at the foot of the screen is placed where it was the first time when it opens again. ([#1087](https://github.com/ng-native/ng-native/pull/1087))
- `withWebCompat` and `webCompat()` resolve `@ng-icons/core` to the new `@ng-native/web-compat/ng-icons` entry point, whose `NgIcon` is the one from `@ng-native/icons`, so a library's icons, Spartan UI's helm among them, draw as native shapes. `@ng-icons/core` is an optional peer. ([#1114](https://github.com/ng-native/ng-native/pull/1114))
- With `provideWebCompat()`, `navigator.userAgent` names a phone of the platform the app runs on and `navigator.maxTouchPoints` is set while the app is up, so a library that picks touch handling from them, such as Highcharts, treats the app as a touch device. ([#1070](https://github.com/ng-native/ng-native/pull/1070))
- Under `provideWebCompat()`, an element of an app that has been destroyed still answers as an element (`getAttribute`, `classList.add`, `style` and the rest), as an element out of the document does in a browser, so a library's timer that fires after its app is gone no longer throws. An element of an app that never asked for the package still has none of it. ([#1121](https://github.com/ng-native/ng-native/pull/1121))
- `provideWebCompat()` in `@ng-native/web-compat` ends the window at the keyboard's top as the app's window measures it, taking `Keyboard.windowTop` off the keyboard's `screenY` as the keyboard-aware components do. On Android with React Native's edge-to-edge flag off, as in Expo Go, `innerHeight` was the status bar's height too tall while the keyboard was up, so an overlay placed from the window's bottom sat that far behind the keyboard. ([#1235](https://github.com/ng-native/ng-native/pull/1235))
- In an app with `@ng-native/web-compat`, HTML's inline elements (a span, a label, a button) and a library's custom elements are laid out inline as a browser lays them out, so what a label holds sits on one line: a required field's label shows its words and its marker side by side, where they were stacked and the floated label lost its words. ([#1066](https://github.com/ng-native/ng-native/pull/1066))
- In an app with `provideWebCompat()`, an `<img>` is the platform's image view: it shows its `src` resolved against the page's address, says its `alt`, takes its size from its `width` and `height` or its loaded picture, has `naturalWidth`, `naturalHeight`, `complete`, `load` and `error`, draws an SVG picture, and draws on a canvas once loaded. ([#1083](https://github.com/ng-native/ng-native/pull/1083))
- An element that `@ng-native/web-compat` moves to another parent while a finger is on it keeps its touch: the document has it where it was put at once, and native is told when the finger lifts, so a drag that puts its element on the body as it begins, as CDK's drag and drop does, goes on. ([#1101](https://github.com/ng-native/ng-native/pull/1101))
- An emulated `<iframe>`'s window under `@ng-native/web-compat` answers `matchMedia` by the frame's own `width` and `height`, with the page's colour scheme and motion, and tells a listener as its size changes. ([#1112](https://github.com/ng-native/ng-native/pull/1112))
- A `<foreignObject>` in an SVG with no `x`, `y`, `width` or `height` takes the whole drawing, as in a browser, so the HTML in it is drawn instead of being given no area. ([#1076](https://github.com/ng-native/ng-native/pull/1076))
- Under `@ng-native/web-compat`, `focus()` on what is not a text field scrolls it into sight only in answer to a touch, and never with `{ preventScroll: true }`, so a library that focuses a panel as its page is built no longer opens the screen part way down. ([#1111](https://github.com/ng-native/ng-native/pull/1111))
- A `<legend>` in a `<fieldset>` sits on the fieldset's top border, with the border through the middle of the legend, as a browser draws it; a fieldset with no border leaves the legend where it is written. ([#1075](https://github.com/ng-native/ng-native/pull/1075))
- A text field takes `caret-color` from its inline style (`transparent` hides the caret, as a one-time code field does, and another colour colours the selection), and an input with a `size` of zero or less is twenty characters wide again, as a text area with a `cols` of zero or less is. ([#1080](https://github.com/ng-native/ng-native/pull/1080))
- `document.elementFromPoint(x, y)` and `document.elementsFromPoint(x, y)` answer the element drawn at a point of the window when `provideWebCompat()` is provided, passing over elements with `pointer-events: none` or `display: none`, so a library that asks what a finger moved onto gets an answer. ([#1073](https://github.com/ng-native/ng-native/pull/1073))
- With `withWebCompat` in the Metro config, a library that adds a listener to `document` as its module loads, before any app is up, no longer throws, and each app with `provideWebCompat()` hears what the library listened for. ([#1113](https://github.com/ng-native/ng-native/pull/1113))
- With `provideWebCompat()`, HTML elements have `draggable` (read and written as the attribute, true by default for an image and a link with an href) and a read-only `isContentEditable`, and `:read-write` treats a `contenteditable` value that is no keyword as inherited, as a browser does. ([#1071](https://github.com/ng-native/ng-native/pull/1071))
- A chart's line series drawn as a `<path>` of thousands of points no longer stalls iOS for seconds on each drawing: it is drawn thinned to the lowest and highest point of each point-wide column, while `getAttribute('d')` and `getBBox` still read the whole path. ([#1084](https://github.com/ng-native/ng-native/pull/1084))
- `document.execCommand('copy')` copies the text of the field a script has called `select()` on to the clipboard, through `expo-clipboard` when the app has it, so a "copy" button from a browser library works; it answers `false` without the module or for any other command. ([#1072](https://github.com/ng-native/ng-native/pull/1072))
- A stylesheet's `border` (and each side), `outline` and `text-decoration` take a `platform-color()` written in them, as `text-shadow` does, so `border: 1px solid platform-color(link)` commits the platform's colour for each side where it was dropped with a warning. A `box-shadow` still drops one. ([#1238](https://github.com/ng-native/ng-native/pull/1238), [#1226](https://github.com/ng-native/ng-native/issues/1226))

### ❤️ Thank You

- Ashley Hunter
- Emanuel Hosu @Emanuel-Hosu
- erKam @erkamyaman
- Gabriel Silva @GabeSilvaDev
- Shahar Kazaz @shaharkazaz
- Wassim Aarab @WassimAarab08

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
