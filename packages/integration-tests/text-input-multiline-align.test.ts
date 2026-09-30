/**
 * Where a multiline text input's text starts.
 *
 * iOS and a web `<textarea>` start it at the top. Android's `EditText` centres it: React Native
 * maps an unset `textAlignVertical` to `Gravity.NO_GRAVITY`, which `ReactEditText` reads as the
 * `EditText`'s own gravity, `center_vertical`. So a multiline field commits `top` on Android unless
 * the app says otherwise.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  Engine,
  registerPlatformComponents,
  registerViewName,
  type StyleSheet,
} from '@ng-native/fabric';
import { createFakeFabric } from '@ng-native/testing';

const sheet: StyleSheet = {
  rules: [
    {
      compounds: [{ classes: ['align-middle'] }],
      combinators: [],
      specificity: 10,
      order: 0,
      declarations: { textAlignVertical: 'center' },
    },
  ],
};

function commitInput(props: Record<string, unknown>, classes: string[] = []) {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1);
  const input = engine.createElement('text-input', sheet);
  for (const [key, value] of Object.entries(props)) engine.setProp(input, key, value);
  for (const name of classes) engine.addClass(input, name);
  engine.appendChild(engine.root, input);
  engine.commit();
  const committed = () => fabric.committed[0]!.props;
  return { engine, input, committed };
}

describe('a multiline text input on Android', () => {
  beforeEach(() => registerPlatformComponents('android'));
  afterEach(() => {
    registerPlatformComponents('ios');
    registerViewName('text-input', 'TextInput');
  });

  it('starts its text at the top', () => {
    const { committed } = commitInput({ multiline: true });
    assert.equal(committed()['textAlignVertical'], 'top');
  });

  it('keeps a textAlignVertical the app set, or a vertical-align from CSS', () => {
    assert.equal(
      commitInput({ multiline: true, textAlignVertical: 'bottom' }).committed()[
        'textAlignVertical'
      ],
      'bottom',
    );
    assert.equal(
      commitInput({ multiline: true }, ['align-middle']).committed()['textAlignVertical'],
      'center',
    );
  });

  it('leaves a single-line field centred, and resets when multiline goes', () => {
    assert.equal(commitInput({}).committed()['textAlignVertical'], undefined);
    const { engine, input, committed } = commitInput({ multiline: true });
    engine.setProp(input, 'multiline', false);
    engine.commit();
    assert.equal(committed()['textAlignVertical'], null, 'reset on native');
  });
});

describe('a multiline text input on iOS', () => {
  it('commits no textAlignVertical, since UITextView starts at the top', () => {
    assert.equal(commitInput({ multiline: true }).committed()['textAlignVertical'], undefined);
  });
});
