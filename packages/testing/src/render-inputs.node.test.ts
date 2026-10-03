/**
 * `render()`'s `inputs`, checked against the inputs the component has. Angular only logs an
 * unknown one, so a misspelled input used to render the component with its defaults and fail a
 * later assertion, or pass for the wrong reason.
 */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Component, Directive, input } from '@angular/core';
import { Text } from '@ng-native/components';
import { cleanup, render, screen } from '@ng-native/testing';

afterEach(cleanup);

@Directive({ selector: '[appTone]' })
class Tone {
  readonly tone = input('plain');
}

@Component({
  selector: 'app-greeting',
  imports: [Text],
  template: '<text>Hello, {{ name() }}</text>',
  hostDirectives: [{ directive: Tone, inputs: ['tone'] }],
})
class Greeting {
  readonly name = input('you');
  readonly title = input('', { alias: 'heading' });
}

test('rejects an input the component does not have, naming it and the ones it has', async () => {
  await assert.rejects(
    render(Greeting, { inputs: { nmae: 'Ada' } }),
    (error: Error) =>
      /'nmae'/.test(error.message) &&
      /Greeting/.test(error.message) &&
      /Its inputs are name, heading, tone\./.test(error.message),
  );
  assert.throws(() => screen.queryByText(/Hello/), /Nothing is rendered/);
});

test('rejects the same from rerender', async () => {
  const { rerender } = await render(Greeting, { inputs: { name: 'Ada' } });
  await assert.rejects(rerender({ inputs: { nmae: 'Grace' } }), /'nmae'/);
});

test('takes an input by its alias, and one a host directive forwards', async () => {
  await render(Greeting, { inputs: { name: 'Ada', heading: 'Hi', tone: 'warm' } });
  assert.ok(screen.getByText('Hello, Ada'));
});

@Component({
  selector: 'app-required',
  imports: [Text],
  template: '<text>{{ name() }}</text>',
})
class Required {
  readonly name = input.required<string>();
}

test('names a misspelled required input, not the read of the one left unset', async () => {
  await assert.rejects(render(Required, { inputs: { nmae: 'Ada' } }), /no input named 'nmae'/);
});

test('changes nothing when a rerender names one unknown input among known ones', async () => {
  const { rerender, detectChanges } = await render(Greeting, { inputs: { name: 'Ada' } });
  await assert.rejects(rerender({ inputs: { name: 'Grace', nmae: 'x' } }), /'nmae'/);
  await detectChanges();
  assert.ok(screen.getByText('Hello, Ada'));
});

@Component({
  selector: 'app-outer',
  imports: [Greeting],
  template: '<app-greeting name="in" />',
})
class Outer {
  readonly label = input('');
}

test('is about the rendered component only: one inside it is not its business', async () => {
  await render(Outer, { inputs: { label: 'ok' } });
  assert.ok(screen.getByText('Hello, in'));
});
