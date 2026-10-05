---
title: API reference
summary: Every export of @ng-native/testing, the query matrix and the events each interaction sends.
---

# API reference

Everything below is exported from `@ng-native/testing`, except the runner integrations, which have
entry points of their own: `@ng-native/testing/vitest` and `@ng-native/testing/register`. The
signatures are the declarations in the source, shortened only where a type is spelled out
elsewhere on this page.

## `render()`

```ts
function render<T>(
  component: Type<T> | string,
  options?: RenderOptions<T>,
): Promise<RenderResult<T>>;
```

Mounts a component class, or a template string, onto a fresh fake Fabric with `mount()` from
`@ng-native/platform`, and resolves once the first frame has been committed and one more task has
passed. Each call gets its own fake, and becomes what `screen` queries.

A string is compiled just in time as the template of a host component, so the template form needs
`@angular/compiler` installed; a class is used as compiled. Anything the component throws while
it is created or first checked, such as `NG0950` for a required input nobody set, rejects the
promise.

### `RenderOptions<T>`

| Option                | Type                                   | Default | What it does                                                                                                                                                                                                         |
| --------------------- | -------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inputs`              | `Record<string, unknown>`              | none    | Inputs, set with `setInput` before the first change detection pass. The only way to give an `input.required()` a value. A name that is no input of the component rejects, here and in `rerender()`. Class form only. |
| `on`                  | `Record<string, (value) => void>`      | none    | Output handlers, by the name a template binds: an output's alias, and one a host directive forwards. A name that is no output rejects. Class form only.                                                              |
| `providers`           | `(Provider \| EnvironmentProviders)[]` | none    | Providers for the app the component is mounted in: `provideNativeRouter`, `provideNativeHttpClient`, a stand-in for a service.                                                                                       |
| `imports`             | `unknown[]`                            | none    | What the template may use. Template form only.                                                                                                                                                                       |
| `componentProperties` | `Partial<T> & Record<string, unknown>` | none    | Fields assigned to the instance. On the template form's host, before its first pass; on a class, after it, followed by another pass.                                                                                 |
| `globalStyles`        | `StyleSheet \| null`                   | none    | A compiled global stylesheet, as [`compileCss()`](#compilecss) returns it. What Tailwind classes resolve against.                                                                                                    |
| `conditions`          | `Conditions`                           | none    | What `@media` queries resolve against: width, height, color scheme. With none, every media query is false. `Screen` from `@ng-native/device` reports the same size.                                                  |
| `tokens`              | `Record<string, TokenValue>`           | none    | Values only a device knows, such as the hairline width.                                                                                                                                                              |
| `processColor`        | `(value: string \| number) => unknown` | none    | React Native's `processColor`. With none, colors reach the props as the strings the stylesheet wrote, which is what a test usually wants to assert.                                                                  |
| `resolveAssetSource`  | `(value: unknown) => unknown`          | none    | React Native's `Image.resolveAssetSource`.                                                                                                                                                                           |

`dev`, `now` and `onDirty` are the engine's own options too, and pass through unchanged.

### `RenderResult<T>`

Every query in the [matrix](#queries), bound to this render, plus:

| Member              | Type                                                             | What it does                                                                                                                      |
| ------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `fabric`            | `FakeFabric`                                                     | The fake this render committed to. See [`createFakeFabric()`](#createfakefabric).                                                 |
| `componentRef`      | `ComponentRef<T>`                                                | The rendered component. `componentRef.injector` reaches anything the app provides.                                                |
| `instance`          | `T`                                                              | The component instance, or the template form's host.                                                                              |
| `fixture`           | `{ componentRef, componentInstance, detectChanges() }`           | The part of `ComponentFixture` that has a meaning here.                                                                           |
| `rerender(changes)` | `(changes?: { inputs?, componentProperties? }) => Promise<void>` | Sets each input given with `setInput`, assigns each property, and runs change detection. Inputs not named keep their values.      |
| `detectChanges()`   | `() => Promise<void>`                                            | Marks the component for check, runs change detection, and waits a task for the commit. For a plain field changed from the test.   |
| `debug(node?)`      | `(node?: FakeFabricNode) => void`                                | Prints the committed tree, or one node's subtree, as [`screen.debug`](#screen) does.                                              |
| `unmount()`         | `() => void`                                                     | Destroys the component and the app it was mounted in. `screen` falls back to the render before it. Calling it twice does nothing. |

A render's own queries keep querying that render after a later one; `screen` moves to the latest.

## `injectService()`

```ts
function injectService<T>(token: ProviderToken<T>, options?: InjectServiceOptions): T;
```

Mounts an empty component onto a fresh fake Fabric with `mount()`, as `render()` does, and returns
`token` from that app's root injector. A service with no component gets the same root an app gives
it, so a `@Service()` and the root services it injects resolve. The calls in one test share the app,
so each returns the instance the others see. `InjectServiceOptions` has one option, `providers`,
which works as it does for `render()`; a call that passes it starts a new app, which later calls
use. The next test starts another app. Every call makes its own outside a test (a `beforeAll`),
while tests run at once (`it.concurrent`), and where the runner's setup did not run (a file run with
neither `ngNative()` nor `node --import @ng-native/testing/register --test`). The app is not what
`screen` queries, and `cleanup()` destroys it. See
[A service on its own](/packages/testing/testing-services#a-service-on-its-own).

## `screen`

```ts
const screen: BoundQueries & { debug(node?: FakeFabricNode): void };
```

Every query, over whatever was rendered most recently and has not been unmounted. A query on
`screen` with nothing rendered throws `Nothing is rendered: call render() first.`

`screen.debug(node?)` prints the tree with `console.log`: one line per node, its Fabric view name,
the text of a `RawText`, and whichever of `testID`, `nativeID`, `accessibilityRole`,
`accessibilityLabel`, `placeholder` and a text field's `text` (printed as `value`) it has. That
is the same tree a failing `getBy*` query puts in its error.

## `within()`

```ts
function within(node: FakeFabricNode): BoundQueries;
```

Every query, scoped to `node` and everything under it, in whichever commit is current. The node
itself is included, so `within(screen.getByRole('alert')).getByText('Email is required')` finds the
alert's own text. The scope follows the node by its tag, so it stays valid across commits, and
matches nothing once the node has gone.

## Queries

Each of the six queries comes in six variants. `...args` is the query's own arguments, below.

| Variant                                | Returns                     | No match              | One match | More than one         |
| -------------------------------------- | --------------------------- | --------------------- | --------- | --------------------- |
| `getBy*(...args)`                      | `FakeFabricNode`            | throws                | the node  | throws                |
| `getAllBy*(...args)`                   | `FakeFabricNode[]`          | throws                | `[node]`  | every node            |
| `queryBy*(...args)`                    | `FakeFabricNode \| null`    | `null`                | the node  | throws                |
| `queryAllBy*(...args)`                 | `FakeFabricNode[]`          | `[]`                  | `[node]`  | every node            |
| `findBy*(...args, waitForOptions?)`    | `Promise<FakeFabricNode>`   | retries, then rejects | the node  | retries, then rejects |
| `findAllBy*(...args, waitForOptions?)` | `Promise<FakeFabricNode[]>` | retries, then rejects | `[node]`  | every node            |

`findBy*` is `getBy*` inside [`waitFor`](#waitfor): it retries until the query would succeed and
rejects with the query's own error once the timeout passes. Its `waitForOptions` is the third
argument, after the query's options, so a query that takes none passes `undefined`:
`screen.findByText('Going soon', undefined, { timeout: 60, interval: 10 })`.

Every error says what was looked for and prints the tree. With none: `Unable to find a node with
text "Bananas".`. With more than one: `Found 2 nodes with role "listitem", and expected one. Use
getAllByRole if more than one is expected.`

| Query               | Arguments                   | Matches a node when                                                                                                                                                                             |
| ------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ByRole`            | `(role, { name?, exact? })` | `accessibilityRole` or `role` is `role`; and, given `name`, the node's accessible name matches it: its `accessibilityLabel`, or its text content when it has none, as a screen reader reads it. |
| `ByText`            | `(text, { exact? })`        | It is a `Paragraph` and its text content matches.                                                                                                                                               |
| `ByTestId`          | `(testId, { exact? })`      | `testID` or `nativeID` matches.                                                                                                                                                                 |
| `ByLabelText`       | `(label, { exact? })`       | `accessibilityLabel` matches.                                                                                                                                                                   |
| `ByPlaceholderText` | `(placeholder, { exact? })` | A text field's or the navigation bar's search field's `placeholder` matches.                                                                                                                    |
| `ByDisplayValue`    | `(value, { exact? })`       | It is a text field and its `text`, the value `<text-input>` binds its model to, matches.                                                                                                        |

Every query reads the props on the committed nodes, which are the props native was sent: what a
component writes for `testID`, `id` (as `nativeID`), `accessibilityRole` or `role` (as
`accessibilityRole`), `accessibilityLabel` and `placeholder`. A control that sets its own role
by default commits one without you writing it, the way `<switch>` commits `accessibilityRole:
'switch'`; anything else takes `[accessibilityRole]` directly.

**Text content** is every `RawText` under the node, in order, joined with nothing between them.
`<text>and <text>plums</text></text>` commits as one `Paragraph` holding a `RawText` and a nested
`VirtualText`, and its text content is `and plums`. Only the `Paragraph` is a `ByText` match; the
`VirtualText` is part of its text, not a match of its own.

**Matching** follows Testing Library's rules:

- Both sides are normalized first: whitespace runs collapse to one space, and the ends are trimmed.
  `getByText('  Pears ')` finds a paragraph holding `Pears`.
- A string matches the whole value, case-sensitively, by default.
- `{ exact: false }` matches a case-insensitive substring instead:
  `getByText('apple', { exact: false })` finds `Apples`.
- A `RegExp` is tested against the normalized value as given, so `/pears/i` is case-insensitive
  and `/^and plums$/` is anchored.
- In `ByRole`, the role itself is always an exact match, and `exact` applies to `name`.

**Hidden elements** are left out, as React Native Testing Library leaves them out by default: a view
with `display: none`, `accessibilityElementsHidden`, `aria-hidden` or `importantForAccessibility:
'no-hide-descendants'` hides itself and everything under it. `{ includeHiddenElements: true }` finds
them as well. A node scrolled off screen is not hidden; the fake has no layout to say it is. A
`<virtual-list>` keeps a few recycled rows hidden this way, still showing their last item, so a
query does not find those either.

A node a query returns has `parent`: the node it is under as of that query, and `null` at the top.
Query again after a change rather than keep a node and read its `parent` later.
So a test goes up from what it found, `screen.getByText('Hello').parent`, to the row around it.

## Interactions

Every interaction delivers its events through the handler the renderer registered with Fabric, the
one the C++ side calls on a device, so they take the same route a real event does: a touch goes
through the engine's responder negotiation and every other event bubbles from the target up. Every
event payload carries `target`, the node's React tag. Each interaction resolves after the tree has
had a task to commit.

An interaction on a node found by a query goes to the render that node came from. A node held from
an earlier commit still works: events find their target by its tag, which does not change. Its
`props` and `children` are that earlier commit's, though: query again to read what changed.

### `fireEvent`

```ts
function fireEvent(node: FakeFabricNode, name: string, payload?: unknown): Promise<void>;
fireEvent.press(node: FakeFabricNode): Promise<void>;
fireEvent.changeText(node: FakeFabricNode, text: string): Promise<void>;
fireEvent.scroll(node: FakeFabricNode, payload?: EventPayload): Promise<void>;
fireEvent.focus(node: FakeFabricNode): Promise<void>;
fireEvent.layout(node: FakeFabricNode, frame?: Partial<LayoutFrame>): Promise<void>;
fireEvent.blur(node: FakeFabricNode): Promise<void>;
```

One event, or the one pair a press is, then a task for the commit. `fireEvent(node, name)` with
`press`, `changeText`, `scroll`, `focus` or `blur` is the matching method; any other name is sent as
a top-level event, with `top` and a capital letter put in front unless the name has them:
`fireEvent(field, 'submitEditing', { text: 'x' })` sends `topSubmitEditing`. A payload is the native
event itself, or an event object with it under `nativeEvent`, as React Native Testing Library passes
one: `fireEvent.scroll(node, { nativeEvent: { contentOffset: { x: 0, y: 120 } } })`. `layout` sends
a `(layout)` event with the frame given, `{ x, y, width, height }`, each 0 where left out.

`fireEvent.changeText` goes to the first `TextInput` at or under `node`, so a query for the view
wrapping a field reaches the field. The navigation bar's search field (`RNSSearchBar`, from a
`<native-header-item type="searchBar">`) counts as one too, for `userEvent.type` as well. With
neither there it rejects with `No TextInput or search bar at or under this <view name>.`

### `userEvent`

```ts
const userEvent: UserEvent & { setup(): UserEvent };

interface UserEvent {
  press(node: FakeFabricNode): Promise<void>;
  longPress(node: FakeFabricNode, options?: { duration?: number }): Promise<void>;
  type(node: FakeFabricNode, text: string, options?: TypeOptions): Promise<void>;
  clear(node: FakeFabricNode): Promise<void>;
}

interface TypeOptions {
  skipBlur?: boolean;
  submitEditing?: boolean;
}
```

What a person does, as the several events the platform sends, a task apart. `userEvent.setup()`
returns the same four methods, and they can be called on `userEvent` directly too. `longPress`
holds for `duration` milliseconds, 500 by default, which is React Native's long-press delay.
`type` and `clear` go to the text field at or under `node`, and do nothing at all if it has
`editable` set to `false`: a disabled or read-only field takes no input.

### Event sequences

`touch` below is `{ identifier: 0, target, pageX: 0, pageY: 0, locationX: 0, locationY: 0,
timestamp }`. A "task" is one `setTimeout(0)`, which is when change detection runs and commits.

| Call                                      | Events, in order                                                                                                                                                                                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fireEvent.press(node)`                   | `topTouchStart` `{ ...touch, touches: [touch], changedTouches: [touch] }`, `topTouchEnd` `{ ...touch, touches: [], changedTouches: [touch] }`, both in the same task; a task.                                                                                                   |
| `fireEvent.changeText(node, text)`        | `topChange` `{ text, eventCount }` to the field; a task. `eventCount` is one more than the field's committed `mostRecentEventCount`, which is what native would send next.                                                                                                      |
| `fireEvent.scroll(node, payload)`         | `topScroll` with the payload; a task.                                                                                                                                                                                                                                           |
| `fireEvent.focus(node)`                   | `topFocus`; a task.                                                                                                                                                                                                                                                             |
| `fireEvent.blur(node)`                    | `topBlur`; a task.                                                                                                                                                                                                                                                              |
| `fireEvent(node, name, payload)`          | `top` + `Name` with the payload; a task.                                                                                                                                                                                                                                        |
| `userEvent.press(node)`                   | `topTouchStart`; a task; `topTouchEnd`; a task.                                                                                                                                                                                                                                 |
| `userEvent.longPress(node, { duration })` | `topTouchStart`; a task; `duration` ms; `topTouchEnd`; a task.                                                                                                                                                                                                                  |
| `userEvent.type(node, text, options)`     | `topFocus`; a task; then for each character, `topKeyPress` `{ key }` and `topChange` `{ text, eventCount }` with the text so far, and a task; then `topSubmitEditing` `{ text }` if `submitEditing`; then, unless `skipBlur`, `topEndEditing` `{ text }` and `topBlur`; a task. |
| `userEvent.clear(node)`                   | `topFocus`, `topChange` `{ text: '', eventCount }`; a task; `topEndEditing` `{ text: '' }`, `topBlur`; a task.                                                                                                                                                                  |

Typing starts from the field's committed `text`, so it appends to what is already there. A field
with `maxLength` stops emitting past it, the way native truncates before `onChangeText` ever fires
rather than delivering the extra characters for a handler to reject. The `topBlur` at the end of
`type` is what marks a Signal Forms field touched.

### `gestureOf`

```ts
gestureOf(node: FakeFabricNode, kind?: string): TestGesture
```

The gesture a view was given with `[gesture]`, or, with `kind` (`'Pan'`, `'Tap'`, `'LongPress'`
and the other builder names), the gesture of that kind inside it, however deeply it is composed
with `Gesture.Race`, `Gesture.Exclusive` or `Gesture.Simultaneous`. Its `callbacks` are the ones
the component gave it, by name, to call in place of a finger:
`gestureOf(row, 'Pan').callbacks['onEnd']!({ translationX: -200 })`. Throws when the view has no
gesture, or none of that kind.

## Waiting

### `waitFor`

```ts
function waitFor<T>(callback: () => T | Promise<T>, options?: WaitForOptions): Promise<T>;

interface WaitForOptions {
  timeout?: number; // 1000
  interval?: number; // 50
}
```

Calls `callback` until it returns without throwing, and resolves to what it returned. Between
attempts it waits `interval` milliseconds on a real timer, which is also what lets change detection
commit. Once `timeout` has passed, it rejects with the callback's last error, so a failed `waitFor`
reads like the assertion inside it. A fake clock stops it: advance the clock yourself instead.

### `waitForElementToBeRemoved`

```ts
function waitForElementToBeRemoved(
  target:
    | FakeFabricNode
    | readonly FakeFabricNode[]
    | (() => FakeFabricNode | readonly FakeFabricNode[] | null | undefined),
  options?: WaitForOptions,
): Promise<void>;
```

Resolves once the node, the nodes, or whatever the callback returns have left the committed tree.
A callback that throws or returns `null` counts as removed. It rejects at once if the target is
already gone when it starts, as Testing Library's does, because a wait for something that is
already absent passes for the wrong reason.

### `settle`

```ts
function settle(): Promise<void>;
```

One task: long enough for zoneless change detection to run and commit whatever is pending. A change
the engine sees outside change detection, such as a modal's dismissal with no `(dismiss)` listener,
commits on the next frame instead, and `settle` waits for that frame too. Every interaction above
ends with it. It is exported for a test that changes state some other way, a
signal set on `instance` for example, and then wants to read the tree.

### `cleanup`

```ts
function cleanup(): void;
```

Unmounts everything rendered so far, and destroys every app `injectService()` created. It runs after
every test by itself when `afterEach` is a global, which it is in Vitest with `globals: true`; with
`node:test` or Vitest's default, call it from an `afterEach` of your own if a test should not leave
its render mounted. Every render has its own fake, so a test that skips cleanup still cannot see
another test's tree.

## Asserting how much re-rendered

The engine counts what it commits in `engine.stats`, and a test reaches the engine through the
render's injector. `createdNodes` and `clonedNodes` are the two a test of re-rendering reads: a
node created is a view native builds, and a node cloned is one whose props or children changed, or
that holds one that did.

```ts
import { Engine } from '@ng-native/fabric';

const { componentRef } = await render(Orders);
const { stats } = componentRef.injector.get(Engine);
const before = { ...stats };

await userEvent.press(screen.getByText('Tapped 0'));

expect(stats.createdNodes - before.createdNodes).toBe(0);
expect(stats.clonedNodes - before.clonedNodes).toBeLessThan(10);
```

The counters run from the mount, so a test compares against a copy taken before the interaction.
`commits` counts commits, and `slowCommits` those after the mount that took longer than 8ms, a
frame at 120Hz; the timings beside them (`firstCommitMs`, `worstCommitMs`, `worstRenderMs`) are
real time, and belong in a benchmark rather than an assertion. `fabric.calls` counts the same
operations as native receives them, from the last `fabric.reset()`.

## `compileCss()`

```ts
function compileCss(css: string, name?: string, options?: CompileCssOptions): StyleSheet;
```

Compiles a stylesheet as the build compiles an app's, for `render()`'s `globalStyles`. `name` is
what a message about the sheet calls it. A declaration or rule native cannot express throws, so a
test never passes on a sheet that lost a rule; pass `onUnsupported` to be told of each instead, and
the rest of the sheet is kept. See [Testing styling](/packages/testing/testing-styling).

## `memoryDatabase()`

```ts
function memoryDatabase(): MemoryDatabase;
```

An in-memory SQLite database with the part of `expo-sqlite`'s interface a service uses, on Node's
`node:sqlite`. Give it to `openDatabasesWith` from `@ng-native/expo/database` to test a service
built on `database()`: see [Database](/packages/expo/database#in-a-test).

## `createFakeFabric()`

```ts
function createFakeFabric(): FakeFabric;
```

The fake `nativeFabricUIManager` itself, for a test that mounts with `mount()` directly rather than
through `render()`. It records every call instead of drawing, and adds what a test needs:

| Member                           | What it is                                                                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `committed`                      | The root nodes of the most recent `completeRoot`. Each `FakeFabricNode` has `viewName`, `props`, `children`, `reactTag`, `handle` and `instanceHandle`. |
| `render(options?)`               | The committed tree as an indented string of view names and text. `{ props: true }` adds every node's props, after its text where it has text.           |
| `find(viewName)`                 | The first committed node with that view name.                                                                                                           |
| `emit(node, type, nativeEvent?)` | Calls the registered event handler, as the C++ side does. Everything in [Interactions](#interactions) is built on it.                                   |
| `frames`                         | `measureInWindow`'s answers, by `nativeID` and then by view name. A node with no entry is not measured, as on a platform that has not laid it out.      |
| `responderCalls`                 | Every `setIsJSResponder` call, in order.                                                                                                                |
| `commands`                       | Every `dispatchCommand`, in order: `focus`, `blur`, `setTextAndSelection` and the rest.                                                                 |
| `calls`                          | How many of each node operation the renderer made. `fabric.reset()` zeroes them.                                                                        |

It also does what native does that a test would otherwise have to stand in for. A `ModalHostView`
committed with `visible: false` reports `topDismiss` as soon as that commit is done, as iOS does
once the dismissal has animated, so a modal a test closes leaves the tree and `(dismiss)` fires. One
dismissal gets through per close, so a test that also sends `fireEvent(host, 'dismiss')` does not
see `(dismiss)` twice.

## `@ng-native/testing/vitest`

```ts
function ngNative(options?: { inline?: (string | RegExp)[]; libraryStyles?: string[] }): Plugin;
```

The Vite plugin for Vitest. It compiles every decorated `.ts` file with `@ng-native/metro`'s AOT
transform and links every partial-compiled package; tells Vitest to process `@angular/*`,
`@ng-native/*` and `@ng-icons/*` itself rather than hand them to Node, plus anything in `inline`;
adds a setup file that installs the animation globals; and turns off Vitest's `injectCjsGlobals`.
`libraryStyles` names the npm packages whose components' own stylesheets are compiled, the same
list the Metro preset takes, so a test draws a library's components with their styles.
[Setup](/packages/testing/setup#under-the-hood) says why each is needed.

## `@ng-native/testing/register`

```sh
node --import @ng-native/testing/register --test
```

Installs the animation globals and registers a Node module hook that does what the Vitest plugin
does, for `node:test` or any other script run under Node. It also strips types from every `.ts`
file under `node_modules`, which Node refuses to. `@ng-native/testing/loader` is the hook on its
own, for a suite that registers it with `module.register()` and passes
`{ data: { skip: string[] } }`: URL fragments whose TypeScript is left to Node untouched.
