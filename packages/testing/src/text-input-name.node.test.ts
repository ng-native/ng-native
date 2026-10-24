/**
 * Which committed views a query treats as a text field: the two names the platforms commit one
 * under, as `@ng-native/fabric` says them, and no other.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isTextInput } from './queries.ts';
import type { FakeFabricNode } from './test-utils.ts';

const named = (viewName: string) => ({ viewName }) as FakeFabricNode;

test('is a text field under the name each platform commits it by', () => {
  assert.equal(isTextInput(named('TextInput')), true);
  assert.equal(isTextInput(named('AndroidTextInput')), true);
});

test('is not a view that only has the words in its name', () => {
  assert.equal(isTextInput(named('TextInputForm')), false);
  assert.equal(isTextInput(named('RNSSearchBar')), false);
  assert.equal(isTextInput(named('View')), false);
});
