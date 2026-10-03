---
title: Testing styles
summary: A component's own CSS with nothing extra, and a global stylesheet passed to render().
---

# Testing styles

Continues from [Writing a test](/packages/testing/writing-a-test). A component's own `styles` are
compiled into it by the same transform as the app, so they apply in a test with nothing extra. A
global stylesheet, which is what Tailwind classes resolve against, is passed to `render()` as
`globalStyles`, compiled by the same CSS compiler Metro uses:

```ts
import { Component } from '@angular/core';
import { Text, View } from '@ng-native/components';
import { compileCss, render, screen } from '@ng-native/testing';
import { expect, it } from 'vitest';

@Component({
  selector: 'app-badge',
  imports: [Text, View],
  template: '<view testID="badge" class="badge"><text>New</text></view>',
})
class Badge {}

it('applies a global stylesheet', async () => {
  await render(Badge, {
    globalStyles: compileCss('.badge { background-color: rgb(1, 2, 3) }', 'global'),
  });

  expect(screen.getByTestId('badge').props['backgroundColor']).toBe('rgb(1, 2, 3)');
});
```

Styles flatten onto a node's props rather than sitting under a `style` key, so `backgroundColor` on
the node is exactly what the native view is told to paint. A small stylesheet written for the test,
rather than the app's real one, keeps the test about which rule wins rather than about what a
color token is worth this week. `createRequire` because the compiler is CommonJS.

## A style with a transition

A property with a `transition` eases to its new value over frames, so an awaited interaction is
not enough: right after `await userEvent.press(...)` the prop is still near where it started.

- Wait for the value: `await waitFor(() => expect(panel().props['opacity']).toBe(1))`.
- Or render with `reducedMotion: true` in `conditions`, where the component has a
  `@media (prefers-reduced-motion: reduce)` rule that drops the transition, and assert at once.
- Or drive the clock: `render(Panel, { now: () => time })` gives the engine the test's clock, and
  `engine.advanceAnimations()` followed by `engine.commit()` runs the frame the clock is at, with
  the engine from the render's `componentRef.injector.get(Engine)`.
