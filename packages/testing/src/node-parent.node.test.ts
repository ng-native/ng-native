/**
 * Going up from what a query found, and sending the view around it a layout: "find the row this
 * text is in, then act on the row", as React Native Testing Library's `.parent` allows.
 */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Component, signal } from '@angular/core';
import { Text, View } from '@ng-native/components';
import { cleanup, fireEvent, render, screen, within } from '@ng-native/testing';

afterEach(cleanup);

@Component({
  selector: 'x-row',
  imports: [Text, View],
  template: `<view testID="row" (layout)="measured.set($event.nativeEvent.layout.height)">
    <text>Hello</text>
  </view>`,
})
class Row {
  readonly measured = signal(0);
}

test('a found node knows its parent, up to the top', async () => {
  await render(Row);
  const paragraph = screen.getByText('Hello');
  assert.equal(paragraph.parent?.props['testID'], 'row');
  let top = paragraph;
  while (top.parent) top = top.parent;
  assert.equal(top.parent, null);
  assert.equal(Object.keys(paragraph).includes('parent'), false, 'and prints as it did');
  const row = screen.getByTestId('row');
  const above = row.parent;
  assert.equal(within(row).getByText('Hello').parent, row);
  assert.equal(row.parent, above, 'a query within a node leaves its own parent alone');
});

test('fireEvent.layout sends the frame, by method and by name', async () => {
  const { instance } = await render(Row);
  const row = screen.getByText('Hello').parent!;
  await fireEvent.layout(row, { width: 320, height: 48 });
  assert.equal(instance.measured(), 48);
  await fireEvent(row, 'layout', { nativeEvent: { layout: { height: 60 } } });
  assert.equal(instance.measured(), 60);
  await fireEvent(row, 'layout', { layout: { height: 72 } });
  assert.equal(instance.measured(), 72);
});
