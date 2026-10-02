---
title: Writing a test
summary: Render, query, interact and assert - the recipes for forms, async work, services,
  HTTP, the router and styling follow.
---

# Writing a test

This page is the one test every other one on this site builds on: render a component, find what it
drew, interact with it, and assert. Every sample is Vitest, and every one is taken from a test in
this repository that runs on every change, so it works as written, imports included. For
`node:test`, swap Vitest's `test` and `expect` for `node:test` and `node:assert`, as
[Setup](/packages/testing/setup#nodetest) shows; nothing else changes.

## Render, interact, assert

```ts
import { Component, signal } from '@angular/core';
import { Pressable, Text, View } from '@ng-native/components';
import { render, screen, userEvent } from '@ng-native/testing';
import { expect, it } from 'vitest';

@Component({
  selector: 'app-counter',
  imports: [Pressable, Text, View],
  template: `
    <view>
      <text>{{ count() }}</text>
      <pressable
        accessibilityRole="button"
        accessibilityLabel="Count"
        (press)="count.set(count() + 1)"
      >
        <text>+1</text>
      </pressable>
    </view>
  `,
})
class Counter {
  protected readonly count = signal(0);
}

it('counts a press', async () => {
  await render(Counter);

  await userEvent.setup().press(screen.getByRole('button', { name: 'Count' }));

  expect(screen.getByText('1')).toBeTruthy();
});
```

The component is declared in the test file, decorator and all; the Vitest plugin compiles it
ahead of time exactly as Metro would. `render()` mounts it and resolves once the first frame has
been committed, and `screen` queries whatever was rendered last.

The button is found by its role and its name, the same two things a screen reader announces for
it: `accessibilityRole` gives the `<pressable>` the `button` role, and `accessibilityLabel` names
it. Querying by role first checks the accessible role and name your test renderer exposes - it is
not proof that VoiceOver or TalkBack announce the same control the same way, so verify an
important flow on a device with each running before relying on it. With no label, the name is the
text inside the node, so `getByRole('button', { name: '+1' })` would find it too.

`userEvent.press` puts a finger down and lifts it again, a task apart, through the same responder
system a real touch goes through. Every interaction is awaited, because change detection runs on a
later task and a query before it would still see `0`.

## Inputs and outputs

`inputs` sets a component's inputs before its first change detection pass, which is what lets a
required input work, and `on` subscribes to its outputs:

```ts
import { Component, input, output } from '@angular/core';
import { Pressable, Text } from '@ng-native/components';
import { render, screen, userEvent } from '@ng-native/testing';
import { expect, it, vi } from 'vitest';

@Component({
  selector: 'app-greeting',
  imports: [Pressable, Text],
  template: `
    <pressable accessibilityRole="button" (press)="greeted.emit(name())">
      <text>Hello, {{ name() }}</text>
    </pressable>
  `,
})
class Greeting {
  readonly name = input.required<string>();
  readonly greeted = output<string>();
}

it('takes inputs and listens to outputs on the class', async () => {
  const greeted = vi.fn();
  await render(Greeting, { inputs: { name: 'Ada' }, on: { greeted } });

  await userEvent.press(screen.getByRole('button', { name: 'Hello, Ada' }));

  expect(greeted).toHaveBeenCalledWith('Ada');
});
```

Or render a template, the way a parent component would use it. `imports` is what the template may
use, and `componentProperties` is what its bindings read. Continuing in the same file, with
`Greeting` from above still in scope:

```ts
it('renders a template, as a parent would use the component', async () => {
  const greeted = vi.fn();
  await render('<app-greeting [name]="name" (greeted)="greeted($event)" />', {
    imports: [Greeting],
    componentProperties: { name: 'Grace', greeted },
  });

  await userEvent.press(screen.getByRole('button', { name: 'Hello, Grace' }));

  expect(greeted).toHaveBeenCalledWith('Grace');
});
```

The template form is compiled just in time, so it needs `@angular/compiler` installed as a
development dependency. The component class form does not.

`rerender` changes inputs on a component that is already rendered, and waits for the result - also
continuing with `Greeting` from above:

```ts
it('rerenders with new inputs', async () => {
  const { rerender } = await render(Greeting, { inputs: { name: 'Ada' } });

  await rerender({ inputs: { name: 'Grace' } });

  expect(screen.getByText('Hello, Grace')).toBeTruthy();
});
```

## Recipes

Each of these picks up from here, one task at a time:

- [Testing a form](/packages/testing/testing-forms) - typing, touched state, disabling a field.
- [Testing async work](/packages/testing/testing-async) - `findBy*` and `waitFor`.
- [Testing with services](/packages/testing/testing-services) - replacing a dependency with a
  stand-in.
- [Testing HttpClient](/packages/testing/testing-http) - answering requests from the test.
- [Testing the router](/packages/testing/testing-navigation) - pushing screens on the native
  stack.
- [Testing styles](/packages/testing/testing-styling) - a component's own CSS and a global
  stylesheet.

## Debugging

`screen.debug()` prints the committed tree: view names, text, and the props a query can find a
node by. The outer `View` is the rendered component's host, which commits as a view of its own.
For `Counter` above:

```text
View
  View
    Paragraph
      RawText "0"
    View accessibilityRole="button" accessibilityLabel="Count"
      Paragraph
        RawText "+1"
```

A `getBy*` query that finds nothing throws with the same tree in its message, so a failing test
already says what was there instead:

```text
Unable to find a node with role "button" and name "Increment".

View
  View
    Paragraph
      RawText "0"
    View accessibilityRole="button" accessibilityLabel="Count"
      Paragraph
        RawText "+1"
```

The names are Fabric's, not the template's: a `<view>` or a `<pressable>` is a `View`, a `<text>`
is a `Paragraph` with its text in a `RawText`, and a `<text-input>` is a `TextInput`. When the
props that matter are not the ones printed, `fabric.render({ props: true })` on the render result
prints every prop of every node.
