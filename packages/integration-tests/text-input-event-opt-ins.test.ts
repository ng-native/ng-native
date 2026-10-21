/**
 * The events Android's text field sends only when a prop asks for them. `ReactTextInputManager`
 * watches content size, scrolling and key presses behind `onContentSizeChange`, `onScroll` and
 * `onKeyPress` props, which React Native's `TextInput.js` sets by passing a handler through. A
 * listener here is not a prop, so without the opt-in none of the three ever fires on Android.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { registerPlatformComponents } from '@ng-native/fabric';
import { cleanup, fireEvent, render, screen } from '@ng-native/testing';
import { compileSource } from './compile.ts';

const source = `
import { Component } from '@angular/core';
import { TextInput } from '../components/src/text-input.ts';
@Component({
  selector: 'x-fields',
  imports: [TextInput],
  template: \`
    <text-input
      testID="listened"
      multiline
      (contentSizeChange)="sizes.push($event.nativeEvent.contentSize.height)"
      (scroll)="scrolls = scrolls + 1"
      (keyPress)="keys.push($event.nativeEvent.key)"
    />
    <text-input testID="quiet" multiline />
  \`,
})
export class Fields {
  sizes: number[] = [];
  scrolls = 0;
  keys: string[] = [];
}
`;

type Fields = { sizes: number[]; scrolls: number; keys: string[] };

const OPT_INS = ['onContentSizeChange', 'onScroll', 'onKeyPress'];

async function fields(): Promise<Fields> {
  const file = path.join(import.meta.dirname, 'text-input-event-opt-ins.fixture.ts');
  const mod = await compileSource(source, file, file.replace(/\.ts$/, '.generated.ts'));
  return (await render(mod['Fields'] as Type<Fields>)).instance;
}

describe("a text input's events that Android sends only on request", () => {
  afterEach(() => cleanup());

  it('are asked for on Android by the field that listens, and reach it', async () => {
    registerPlatformComponents('android');
    try {
      const instance = await fields();
      const listened = screen.getByTestId('listened');
      assert.equal(listened.viewName, 'AndroidTextInput');
      for (const prop of OPT_INS) {
        assert.equal(listened.props[prop], true, prop);
        assert.equal(screen.getByTestId('quiet').props[prop], undefined, prop);
      }
      await fireEvent(listened, 'contentSizeChange', { contentSize: { width: 300, height: 60 } });
      await fireEvent(listened, 'scroll', { contentOffset: { x: 0, y: 4 } });
      await fireEvent(listened, 'keyPress', { key: 'a' });
      assert.deepEqual(instance.sizes, [60]);
      assert.equal(instance.scrolls, 1);
      assert.deepEqual(instance.keys, ['a']);
    } finally {
      registerPlatformComponents('ios');
    }
  });

  it('are not asked for on iOS, whose field sends them unasked', async () => {
    await fields();
    const listened = screen.getByTestId('listened');
    assert.equal(listened.viewName, 'TextInput');
    for (const prop of OPT_INS) assert.equal(listened.props[prop], undefined, prop);
  });
});
