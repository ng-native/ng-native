/**
 * `@ng-native/expo` re-exports the typed `@expo/ui` components from `expo-ui-components`, so an app
 * imports them from the main entry like the package's other components.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as main from '@ng-native/expo';
import * as components from '@ng-native/expo/expo-ui-components';

describe("@ng-native/expo's main entry", () => {
  it('exports every component expo-ui-components does', () => {
    const missing = Object.keys(components).filter(
      (name) =>
        (main as Record<string, unknown>)[name] !== (components as Record<string, unknown>)[name],
    );
    assert.deepEqual(missing, []);
  });
});
