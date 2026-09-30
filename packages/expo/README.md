# @ng-native/expo

Expo's native modules as Angular services, and Expo's native views as elements.

Alpha: APIs may change before 1.0.

## Install

```sh
npm install @ng-native/expo
npm install @angular/core expo
```

Every Expo module (`expo-haptics`, `expo-clipboard`, `expo-file-system`, and the rest) is an
optional peer dependency: install only the ones the app actually uses.

## Services

One entry point per module, so importing haptics does not bundle the file system. Every source
file lives in `src/`, as in every other package here; the entry points an app writes do not say so,
because the `exports` map takes `@ng-native/expo/haptics` to `src/haptics.ts`. Most are
`@Service()` classes that reach their native module through a static `SOURCE` token; `Fonts`,
`SplashScreen`, `Storage`, `SecureStorage` and the sensors are `InjectionToken`s carrying their own
factory. Either way there is nothing to provide and nothing to register - injecting it is the whole
setup, and a service nobody injects is never constructed. Each token name is a type as well, so
`inject(Storage)` and `private store: Storage` both work, as `inject(Clipboard)` does for a class.

```ts
import { Clipboard } from '@ng-native/expo/clipboard';
import { FileSystem } from '@ng-native/expo/file-system';
import { Fonts } from '@ng-native/expo/fonts';
import { Haptics } from '@ng-native/expo/haptics';
import { SplashScreen } from '@ng-native/expo/splash-screen';

export class Notes {
  private readonly clipboard = inject(Clipboard);
  private readonly files = inject(FileSystem);
  private readonly haptics = inject(Haptics);

  /** A signal: how many times the pasteboard has changed. */
  protected readonly changes = this.clipboard.changes;

  protected async save(text: string): Promise<void> {
    this.files.write(this.files.document('notes.txt'), text);
    await this.clipboard.write(text);
    this.haptics.notify('success');
  }
}
```

The names say what the thing is rather than who ships it, so app code asks for a clipboard rather
than for a package. Two shapes are worth knowing about:

- `Clipboard.changes` counts pasteboard changes; it does not hold the contents. On iOS 16 and
  later, _reading_ the clipboard is what prompts the user for permission, so a signal that held
  the text would prompt on every change - including changes made by other apps. The notification
  is free and the read is explicit.
- `Fonts` is the odd one out: the method that matters is called _before_ the injector exists.
  See below.
- `Haptics` returns nothing and swallows failures. Every Expo equivalent is a promise, and nobody
  awaits a vibration; a device with no Taptic Engine would otherwise produce an unhandled
  rejection for a feature that is by definition optional.

## What this package costs to install

One package. Every Expo module is an **optional peer dependency**, so `pnpm add
@ng-native/expo` adds exactly itself - an app installs `expo-haptics` because it wants
haptics, not because this asked for it. There is one entry point per module and each imports only
its own, so reaching for haptics does not pull in the video player.

The version ranges track the SDK rather than each package, because since SDK 57 Expo does too:
`expo-battery` and `expo-video` are both `57.x` and ship together. That is also why this is one
package and not twenty: twenty would have to be version-bumped in lockstep anyway, and would need
a twenty-first to share `Permission`, `observed` and the rest.

Each service is one file: a `@Service()` class that reaches its module through an injected source
token. Nothing in the package statically imports an Expo module, because a file that does cannot be
loaded by Node at all - Expo's build output uses extensionless relative imports, and what it pulls
in reaches `react-native`, which is Flow. A `require` inside the token's factory has neither
problem: Metro still resolves the string literal and bundles the module exactly as before, and in
Node the call throws and the service goes inert. On a device, a module the app should have and does
not - never installed, or installed without the app being rebuilt since - throws a
`MissingModuleError` naming it and the commands that fix it.

That token is also the test seam, and it hangs off the service rather than sitting beside it -
`Clipboard.SOURCE`, not `CLIPBOARD_SOURCE`. One export per capability, and a token that cannot
drift away from the thing it belongs to. A fake is _provided_ rather than passed, so a test drives
the real service:

```ts
const clipboard = serviceWith(Clipboard.SOURCE, fake, () => new Clipboard());
```

Four are not services and say so: `Sensor` and `Store` are one class behind several tokens
(`Accelerometer` and `Barometer` are the same class; so are `Storage` and `SecureStorage`), and
`Fonts` and `SplashScreen` are called before an injector exists - `splashScreen.hold()` is the
first thing an entry file does. Those four take their platform as a constructor argument.

The app still installs `expo-haptics`, `expo-clipboard` and `expo-file-system` itself. That is
what links the native side; whether we import their JavaScript is a separate question, and
`Haptics` does not.

## Fonts

A font on a phone is not fetched when the text engine first needs it: it has to be registered
with the platform before anything is laid out, or the first paint is in the fallback face and
reflows when the real one lands. So a face is declared in CSS, collected at build time, and
registered before the app mounts:

```css
@font-face {
  font-family: Inter;
  src: url('./fonts/Inter-Regular.ttf');
}
@font-face {
  font-family: Inter;
  src: url('./fonts/Inter-Bold.ttf');
  font-weight: 700;
}
```

```ts
import { loadFonts } from '@ng-native/expo/fonts';

await loadFonts(styleSheetOf(GlobalStyles));
mount(rootTag, App, getFabricUIManager(), { globalStyles: styleSheetOf(GlobalStyles) });
```

`font-family: Inter` then means what it says. The `url()` becomes a `require` at build time, so
the bundler ships the file - a plain path would be a font that is simply missing on the device
with nothing anywhere to say why.

**There is no font matching on a device.** Native looks a family up by name and that is all, so a
bold cut is a family of its own: the second face above is registered as `Inter-700` as well, and
a rule that wants it asks for `font-family: Inter-700`. Writing `font-weight: 700` against a
family with one registered face gets whatever the platform synthesizes, exactly as it would in a
React Native app.

`loadFonts` takes any number of sheets and does nothing at all when none of them declare a face,
so bootstrap can call it unconditionally. Injecting `Fonts` afterwards answers what is loaded.

## Device state

Every module that reports something changing has the same three parts: a getter, a listener, and
a `useX()` hook that is those two plus React state. The hook is the only surface some of them
offer for reading a value _over time_, so it is what is rebuilt here - once, as a signal - and
each module is a thin binding onto it.

```ts
private readonly network = inject(Network);
private readonly battery = inject(Battery);

protected readonly offline = computed(() => this.network.reachable() === false);
protected readonly thrifty = computed(() => this.battery.saving() || this.battery.low());
```

- `Network.reachable()` is `null` until the platform establishes it, which is **not** the same as
  offline: a captive-portal wifi is connected and reachable by nothing, and an offline banner that
  treats `null` as false flashes on every cold start.
- `Battery.low()` is under a fifth _and not charging_; plugged in at 15% is not a reason to do
  less. Both signals start at their optimistic value, so an app never opens in its degraded mode.
- `DeviceOrientation` is the device, not the window. A layout asking which way _it_ is laid out
  wants the `orientation` media feature and needs none of this; a camera preview needs this,
  because a screen pinned to portrait still has a phone that is sideways.
- `Brightness.set()` and `DeviceOrientation.lock()` both return the function that undoes them,
  ready for `DestroyRef.onDestroy`. An app that leaves the screen at full brightness after showing
  a boarding pass is one the user experiences as a battery fault.

### Sensors and locale

The sensors are one class parameterized by the reading, not one per sensor - they are all the same
object underneath. Nothing subscribes until `start`, and the interval is explicit:

```ts
inject(DestroyRef).onDestroy(inject(Accelerometer).start(50));
```

The sensible interval is a property of what the app is doing with it, a compass wants a tenth of a
second and a shake detector less, and every event is a change-detection pass - so a sensor left at
its default is a phone that never idles, and a sensor nobody stops is a battery nobody gets back.

`Locale` is the odd one: both getters are synchronous, so there is no default to sit at. It is a
service because the answers _change_ - a user can switch language in Settings and come back, and a
date that was formatted correctly is then wrong. The list is ordered by preference and always has
at least one entry, which is the reason to prefer it over a single locale string: an app that
supports the user's second language should use it rather than fall back to English. `rtl()` is a
layout decision rather than a translation one, which is why it is a signal.

## Storage

Both stores are already plain promises, so what is worth having is not a wrapper but a binding: a
persisted value as a signal that writes through when set.

```ts
private readonly store = inject(Storage);
protected readonly theme = this.store.signal<'light' | 'dark'>('theme', 'light');
```

Reading it is reading the preference; `theme.set('dark')` persists. The same key always hands back
the same signal, so two components binding one preference stay in step, and a value written before
the read comes back is not undone by it.

`SecureStorage` is the keychain and the Android keystore - separate from `Storage` because the
difference should be visible at the injection site. It can also answer synchronously, so a token
never flashes its default.

## Permissions

Every Expo module that needs one spells it the same way - `getXPermissionsAsync`,
`requestXPermissionsAsync`, and a `useXPermissions()` hook that is those two plus React state. So
there is one class here rather than one facade per module, and the module stays the app's own
dependency:

```ts
import { requestCameraPermissionsAsync, getCameraPermissionsAsync } from 'expo-camera';
import { Permission } from '@ng-native/expo';

readonly camera = Permission.of(getCameraPermissionsAsync, requestCameraPermissionsAsync);

protected async open(): Promise<void> {
  if (await this.camera.ensure()) this.scanning.set(true);
}
```

`ensure()` is the method most call sites want: it checks first, so a permission the user granted
months ago shows no dialog, and it does not ask when the platform has stopped asking - which
would resolve to the same no while reading as though the user had been consulted. `blocked()` is
how an app knows to offer Settings instead.

`status()` distinguishes `unknown` from `undetermined`: nobody has asked the platform yet, versus
the platform saying the user has not decided.

## Splash screen

The ordering is the whole feature, and it is easy to get subtly wrong. The native splash hides
itself as soon as the first frame is drawn, so an app that loads fonts _before_ mounting shows a
blank window for as long as that takes:

```ts
import { splashScreen } from '@ng-native/expo/splash-screen';
import { loadFonts } from '@ng-native/expo/fonts';

splashScreen.hold(); // module scope, before anything renders

AppRegistry.registerRunnable('main', ({ rootTag }) => {
  const fonts = loadFonts(styleSheetOf(GlobalStyles));
  mount(Number(rootTag), App, getFabricUIManager(), { globalStyles: styleSheetOf(GlobalStyles) });
  void splashScreen.hideWhenReady(fonts);
});
```

Mounting does not wait for the fonts; the splash screen does. Text laid out before they arrive is
laid out again as each face registers, behind the splash, so nothing is ever seen in the fallback
face.
`hideWhenReady` waits one frame after the work, because hiding the instant it resolves uncovers
the frame that was on screen while it ran - and it uncovers even when the work fails, rather than
leaving a splash screen up forever.

## Media

`useVideoPlayer` and `useAudioPlayer` are not where the player comes from - `createVideoPlayer`
gives the same object. What the hooks add is the two things a component needs and cannot get
otherwise: the player is _released_ when the component goes, and its changing state is _readable_,
which its own mutable properties are not.

```ts
protected readonly player = videoPlayer(source, { timeUpdate: 0.5 });
```

```html
<expo-video [player]="player.native" /> <text>{{ player.state().currentTime }}</text>
```

The player itself is passed straight through: it already has `play()`, `seekBy()` and the rest,
and wrapping them would be a second place for each to be wrong. `timeUpdate` is off unless asked
for, because it is the most frequent event either player emits and a screen with no progress bar
should not pay for one.

## Notifications

Only the part React was holding. Scheduling, channels, categories, badges and tokens are already
plain promises, and an app calls those on the module directly.

What is here is the difference between a notification _arriving_ and a user _tapping_ one - the
second is a navigation instruction - and the response that **launched** the app, which happened
before any listener existed. Missing that is the single most common way notification routing is
got wrong.

```ts
const tapped = inject(Notifications).take();
if (tapped) this.router.navigateByUrl(routeFor(tapped));
```

`take()` rather than the signal, because routing on a tap is a one-off and a signal is not: an
effect on one fires again whenever its component is recreated, sending the user back to a screen
they had navigated away from. A second tap on the same notification is a new instruction and is
handed over again.

Pair it with `Permission.of(getPermissionsAsync, requestPermissionsAsync)` from the module.

## Photos, files, location and privacy

- **`ImagePicker`** (`image-picker.ts`): `pick()` and `capture()`, each resolving to the picked
  assets, empty if they canceled. `capture()` asks for the camera itself.
- **`Location`** (`location.ts`): a `position` signal, filled by `current(accuracy)` once or by
  `start({ accuracy, distance })` until the function it returns is called.
- **`Biometrics`** (`biometrics.ts`): `available()`, `kinds()` and `authenticate(message)`, which
  fails rather than passes when the module is missing.
- **`Browser`** (`browser.ts`): `open(url)`, and `signIn(url, redirectUrl)`, which resolves to the
  URL the sign-in page redirected back to, or null.
- **`AppInfo`** (`app-info.ts`): the version, build, identifier and device, as plain values.
- **`Camera`** (`camera.ts`): a directive on `<expo-camera>` whose `takePicture()` takes a picture
  from the view on screen, without a React ref.
- **`StoreReview`** (`store-review.ts`): `available()`, `hasAction()`, `request()` and
  `storeUrl()`. Whether the prompt appears is the platform's decision, and a call that resolves is
  not a prompt that was shown.
- **`Tracking`** (`tracking.ts`): App Tracking Transparency's `permission`, `available()` and
  `advertisingId()`, which is null until tracking is allowed.
- **`DocumentPicker`** (`document-picker.ts`): `pick(options)`, resolving to the files picked,
  empty if they canceled.
- **`Crypto`** (`crypto.ts`): `randomUUID()`, `digestString()`, `digest()`, `randomBytes()` and
  `randomValues()`. The one service that throws without its module, since an empty identifier or
  hash is a wrong answer that looks right.
- **`BackgroundTask`** (`background-task.ts`): `status()`, `register(name, options)`,
  `unregister(name)` and `triggerForTesting()`. The task itself is defined with
  `expo-task-manager` at the top level of `main.ts`, since the platform runs it without
  bootstrapping Angular.
- **`ScreenCapture`** (`screen-capture.ts`): `prevent(key)` and `allow(key)`, which stay
  prevented while any key is held, and a `screenshots` signal counting the screenshots taken.
- **`ImageEditor`** (`image-editor.ts`): `edit(uri, actions, options)` over
  `expo-image-manipulator`, resolving to the saved file and releasing the native context and
  image it made, and `manipulate(uri)` for the module's own context.
- **`MediaLibrary`** (`media-library.ts`): `save(uri, album)`, which asks for write-only access
  itself, `assets(query)` and `metadata(query)` over the module's own `Query`, albums, the read
  and write permissions, and `watch()` for changes, which starts listening only when called.

## The rest

Four more modules whose only entry point was a hook, each the same story: the work underneath is a
plain promise, and what the hook adds is a _lifecycle_.

- **`database(name, migrations)`** replaces `SQLiteProvider` and `useSQLiteContext`. Opened on
  first use rather than at startup - a database opened eagerly is a file handle and a journal for
  an app that may never read from it - and opened _once_ however many callers arrive while it is
  opening, because two connections to one file is a lock waiting to happen. Migrations run in
  order, each in a transaction, with the version recorded in SQLite's own `user_version`.
- **`Updates`** checks and downloads in one call, because an app that checks without downloading
  has learned something it cannot act on. `apply()` **restarts the app**, which is why nothing here
  does it automatically: the moment is one the app knows and this does not. In Expo Go it reports
  itself disabled rather than offering a banner that can never resolve.
- **`assets(modules)`** preloads the images a screen should not pop in with, and resolves even when
  one fails - a picture that will not appear is not a reason for the screen behind it to fail too.
- **`KeepAwake.hold()`** returns the release, and is never a bare activate: a screen that holds the
  display on and never lets go is a phone that never sleeps, which the user experiences as a
  battery fault and never attributes to the app that caused it.

## Views

Most Expo modules need nothing from this package. `requireNativeModule`, `EventEmitter`,
`SharedObject` and `SharedRef` have no React in them, so a module that only calls into native is
imported and used as its own documentation says - the services above are a nicer surface, not a
shim. Autolinking is unaffected too: it is driven by the `expo` package and the
`expo-module.config.json` in each module, neither of which knows what renderer is above it.

What does need something is a module that renders. `requireNativeViewManager` returns a React
class, and the Fabric component underneath it is registered under a name derived from the module
name and, in Expo Go, from a per-project identifier. `registerExpoView` derives the same name and
hands it to the engine:

```ts
import {
  registerExpoView,
  registerExpoViews,
  registerExpoUiViews,
  registerNativeViews,
} from '@ng-native/expo';

registerExpoViews('expo-image', 'expo-blur'); // Expo's own
registerNativeViews('web-view', 'slider'); // the community libraries in Expo's bundled list
registerExpoUiViews(Platform.OS); // every @expo/ui control the platform has
registerExpoView('my-module-view', 'MyModule'); // anything else
```

### @expo/ui

The closest thing in the ecosystem to what this project is for: every one of these is a real
platform control - a real `Picker`, a real `BottomSheet`, a real `Gauge` - rather than something
drawn to look like one. `@expo/ui` reaches them through `requireNativeView('ExpoUI', ...)`, which
is the derivation `registerExpoView` already mirrors, so the whole surface is a table of names.

Element names are platform-neutral where both platforms have the control, so an app writes
`<ui-slider>` once and `<ui-vstack>` gets Compose's `Column` on Android. Where only one platform
has it - a `Gauge` is SwiftUI's, a `SearchBar` is Compose's - the element exists only there, since
registering for the wrong platform is an element that commits as nothing.

**A `<ui-host>` is required around any of them.** SwiftUI and Compose lay out their own subtrees,
and the host view is what bridges Yoga's layout to theirs; without one the control has no size and
does not appear - which looks exactly like a module that failed to install.

`<expo-image>` is then an element like any other, and its props are the ones the module's native
view declares - which is to say the ones the React component would have passed down, after
whatever resolving it does in JavaScript:

```html
<expo-image [source]="[{ uri }]" contentFit="cover" [transition]="{ duration: 400 }" />
```

Most of that is deliberately not wrapped. An Angular component per Expo view, prop for prop, is
a maintenance burden with no end; a name plus the module's own documentation covers the common
case, and an app that wants a nicer surface can write the component it actually needs.

The exception is strict templates, where an unknown element and every prop on it is a type error.
The views apps reach for most (`ui-host`, `ui-menu`, `ui-button`, `ui-divider`, `ui-slot`,
`ui-image`, `ui-text`, `ui-date-picker`) and `segmented-control` have thin typed components:
import `UiHost`, `SegmentedControl` and the rest, and the element is typed while committing exactly
as before. Keep registering the names too. The component supplies the types and the registration
makes the element commit as the native view. Their events are outputs so `$event` is typed. The
element's own event is what arrives, so bind them in a template.
