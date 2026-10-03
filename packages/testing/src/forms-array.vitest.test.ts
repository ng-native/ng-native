/**
 * A form with an array of items, each handed to a component of its own: the "Arrays" section of
 * the forms guide.
 */
import { Component, input, model, signal } from '@angular/core';
import { FormField, applyEach, form, required, type FieldTree } from '@angular/forms/signals';
import { Pressable, Text, TextInput } from '@ng-native/components';
import { cleanup, render, screen, userEvent } from '@ng-native/testing';
import { afterEach, expect, test } from 'vitest';

afterEach(cleanup);

interface Line {
  name: string;
  cents: number;
}

/** A control whose model is not called `value`, which `[formField]` does not take. */
@Component({
  selector: 'app-price',
  imports: [Pressable, Text],
  template: `
    <pressable accessibilityRole="button" accessibilityLabel="Add a pound" (press)="add()">
      <text>{{ cents() }}</text>
    </pressable>
  `,
})
class Price {
  readonly cents = model(0);

  protected add(): void {
    this.cents.update((cents) => cents + 100);
  }
}

@Component({
  selector: 'app-line',
  imports: [FormField, Price, Text, TextInput],
  template: `
    <text-input accessibilityLabel="Line" [formField]="line().name" />
    <app-price [(cents)]="line().cents().value" />
    @if (line().name().touched() && line().name().invalid()) {
      <text>Name is required</text>
    }
  `,
})
class LineCard {
  readonly line = input.required<FieldTree<Line>>();
}

@Component({
  selector: 'app-order',
  imports: [LineCard, Pressable, Text],
  template: `
    @for (line of f.lines; track line) {
      <app-line [line]="line" />
    }
    <pressable accessibilityRole="button" (press)="add()"><text>Add</text></pressable>
    <pressable accessibilityRole="button" (press)="swap()"><text>Swap</text></pressable>
    <pressable accessibilityRole="button" (press)="removeFirst()"><text>Remove</text></pressable>
  `,
})
class Order {
  readonly order = signal<{ lines: Line[] }>({
    lines: [
      { name: '', cents: 0 },
      { name: 'B', cents: 250 },
    ],
  });
  readonly f = form(this.order, (path) => applyEach(path.lines, (line) => required(line.name)));

  protected add(): void {
    this.f.lines().value.update((lines) => [...lines, { name: '', cents: 0 }]);
  }

  protected swap(): void {
    this.f.lines().value.update(([first, second, ...rest]) => [second!, first!, ...rest]);
  }

  protected removeFirst(): void {
    this.f.lines().value.update((lines) => lines.slice(1));
  }
}

const names = () => screen.getAllByLabelText('Line').map((field) => field.props['text']);

test('an item keeps its state through a move, and its error leaves with it', async () => {
  const { instance } = await render(Order);
  await userEvent.type(screen.getAllByLabelText('Line')[0]!, 'x');
  await userEvent.clear(screen.getAllByLabelText('Line')[0]!);
  await userEvent.press(screen.getByRole('button', { name: 'Swap' }));

  expect(names()).toEqual(['B', '']);
  expect(instance.f.lines[1]!.name().touched()).toBe(true);
  expect(screen.getAllByText('Name is required')).toHaveLength(1);

  await userEvent.press(screen.getByRole('button', { name: 'Add' }));
  expect(names()).toEqual(['B', '', '']);

  await userEvent.press(screen.getByRole('button', { name: 'Remove' }));
  expect(names()).toEqual(['', '']);
  expect(screen.getAllByText('Name is required')).toHaveLength(1);
});

test('a control with a model of another name is bound two ways to the field value', async () => {
  const { instance } = await render(Order);
  await userEvent.press(screen.getAllByRole('button', { name: 'Add a pound' })[1]!);
  expect(instance.order().lines[1]).toMatchObject({ name: 'B', cents: 350 });
  expect(screen.getByText('350')).toBeTruthy();
  // Signal Forms keys each item with a symbol, so the model no longer equals the data given.
  expect(Object.getOwnPropertySymbols(instance.order().lines[1]!)).toHaveLength(1);
});
