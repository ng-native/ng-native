---
title: Testing
summary: Testing Library for native components, in Node, with no simulator and no device.
---

# Testing

`@ng-native/testing` runs a component test in plain Node, in milliseconds. It renders your
component with the same `mount()` an app boots with, onto a fake of the native side, and gives you
Angular Testing Library's `render()` and `screen` to find things in what was rendered and React
Native Testing Library's `fireEvent` and `userEvent` to interact with it:

```ts
import { render, screen, userEvent } from '@ng-native/testing';
import { expect, test } from 'vitest';
import { App } from './app.ts';

test('counts taps', async () => {
  await render(App);

  await userEvent.setup().press(screen.getByRole('button', { name: 'Tapped 0 times' }));

  expect(screen.getByText('Tapped 1 times')).toBeTruthy();
});
```

That is the test an app generated from the template ships with, and `npm test` runs it.
[Setup](/packages/testing/setup) wires a runner into an app that does not have it yet, and
[Writing a test](/packages/testing/writing-a-test) goes from there to forms, services, `HttpClient`
and the router.

## The fake Fabric

On a device the renderer talks to `nativeFabricUIManager`, React Native's C++ UI manager: it
creates nodes, sets their props, and commits a tree for the platform to draw. `createFakeFabric()`
is an in-memory stand-in for it that records every one of those calls instead of drawing anything,
and `render()` mounts your component onto one. Nothing else is faked. The renderer, the styling
engine, the responder system that decides which view a touch belongs to, and every component are
the real ones, compiled by the same Angular transform Metro uses for the app.

So a query reads what native would have been sent. `screen.getByText('Tapped 1 times')` finds a
`Paragraph` whose text is exactly that, and a node's `props` are the flattened prop payload the
platform view would receive, with styles and Tailwind classes already resolved onto it. A press is
a `topTouchStart` and a `topTouchEnd` delivered through the event handler the renderer registered
with Fabric, so it goes through the same responder negotiation a finger does. A disabled button
ignores it for the same reason it would on a phone.

## What a test does and does not prove

It proves your component renders the tree you expect, reacts to events the way you expect, and
changes the props native would receive. That covers most of what goes wrong in a component: a
binding that never updates, a handler wired to the wrong thing, a form field that stays valid, a
role or label a screen reader will never see.

It proves nothing that Yoga or the platform decides. There is no layout: `measureInWindow` answers
only for frames you give the fake through `fabric.frames`, so a popover positioned from its
trigger's frame gets whatever you put there. There is no paint, no real keyboard, no native gesture
recognition, and no animation running on the UI thread. For those, run the app itself:
[End-to-end tests](/packages/testing/end-to-end) drives the real thing on a simulator with Maestro.

## Testing Library, without a DOM

The API is Angular Testing Library's `render()` with React Native Testing Library's queries and
events, because the tree underneath is a native one. A role is `accessibilityRole`, a label is
`accessibilityLabel`, and text is what a native text view holds. It does not use
`@testing-library/dom`, which needs a DOM there is none of. The names and semantics match where the
fake allows; where they differ, it is for one of the reasons below.

| Name                                       | Here                                                                                              | Why                                                                                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `fireEvent`                                | Returns a promise; await it                                                                       | Change detection is zoneless and commits on a later task, so the tree an event changed can only be read after that task has run.          |
| `detectChanges()`                          | Async, on the render result and `fixture`                                                         | Same reason.                                                                                                                              |
| `fixture`                                  | `componentRef`, `componentInstance` and `detectChanges` only                                      | There is no TestBed, so there is no `ComponentFixture` or `debugElement`.                                                                 |
| `container`, `nativeElement`               | Not provided; use `fabric` or `fabric.committed`                                                  | There is no DOM element to hand back.                                                                                                     |
| `imports`                                  | Template form only                                                                                | A class is compiled ahead of time, and without TestBed there is no way to override its imports.                                           |
| `rerender({ inputs })`                     | Sets the inputs you pass and leaves the rest                                                      | There is no `partialUpdate` flag because nothing is ever reset.                                                                           |
| `componentProperties` on a class           | Set after the first change detection pass, then run again                                         | `mount()` runs the first pass itself. Use `inputs` for anything the first pass needs, which is also the only way to set a required input. |
| `ByTestId`                                 | Matches `testID` or `nativeID`                                                                    | The components commit both, and most templates here identify a view with `id`, which commits as `nativeID`.                               |
| `ByRole`                                   | `name` only; no `checked`, `disabled`, `selected` or `expanded` filters                           | Not built yet. Read `accessibilityState` off the node instead.                                                                            |
| Hidden nodes                               | Left out unless `includeHiddenElements: true`; a node scrolled off screen is not hidden           | The fake has no layout, so it cannot tell what is off screen.                                                                             |
| `*ByHintText`, `*ByA11yValue`, `*ByTitle`  | Not provided                                                                                      | Not built yet.                                                                                                                            |
| `userEvent.setup()`                        | Takes no options: no `delay`, no `advanceTimers`                                                  | Every step waits one real task. `waitFor` and `findBy*` run on real timers too, so a fake clock stops them.                               |
| `userEvent.type`                           | No press before focusing, and no `selectionChange` or `contentSizeChange` events                  | A field does not need them to take text; see the [event sequences](/packages/testing/api#event-sequences).                                |
| `toBeOnTheScreen()` and the other matchers | Not provided                                                                                      | Use `getBy*` (which throws when there is no match) with `toBeTruthy()`, or `queryBy*` with `toBeNull()`.                                  |
| `debug()`                                  | Prints view names, text, and the props a query can find a node by                                 | The full prop payload of every node is unreadable at any size. `fabric.render({ props: true })` prints all of it.                         |
| Cleanup                                    | Automatic only where `afterEach` is a global (Vitest with `globals: true`); otherwise `cleanup()` | Testing Library's own rule. Each `render()` gets its own fake, so a test that skips cleanup still cannot see another test's tree.         |

[API reference](/packages/testing/api) lists every export, and exactly which props each query
reads and which events each interaction sends.

## Which runner

Vitest is the default: it is what an app generated from the template uses, it is Angular CLI's
default runner, and `ngNative()` is one line in its config. Use `node:test` when you would rather
have no test dependency at all: `node --import @ng-native/testing/register --test` is the same
compile step as a Node module hook, and it is what this repository's own integration suite runs
on. Both run the same `render()` and the same queries. [Setup](/packages/testing/setup) covers both.
