/**
 * Interaction observers hear the controls the host draws, which the press machine never sees: a
 * `<switch>` flipped, and a `<native-button>` pressed where it is a UIButton or an NSButton. Each
 * is a `click`, with no value, as React Native analytics tools report a `Switch`.
 */
import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { registerPlatformComponents, registerViewName } from '@ng-native/fabric';
import { cleanup, fireEvent, render, screen, settle } from '@ng-native/testing';
import { provideInteractionObserver, type InteractionEvent } from '@ng-native/components';
import { compileFixture } from './compile.ts';

type Fixture = { events: string[]; off: { set(value: boolean): void } };

let Component: Type<Fixture>;

before(async () => {
  const mod = await compileFixture('fixtures/native-control-interactions.ts');
  Component = mod['NativeControlInteractionsFixture'] as Type<Fixture>;
});

afterEach(cleanup);

const node = (id: string) => screen.getByTestId(id);

/** Render with an observer that notes what the fixture's outputs had logged when it heard each event. */
async function renderObserved() {
  const heard: InteractionEvent[] = [];
  const logged: string[][] = [];
  const rendered = await render(Component, {
    providers: [
      provideInteractionObserver((event) => {
        heard.push(event);
        logged.push([...rendered.instance.events]);
      }),
    ],
  });
  return { ...rendered, heard, logged };
}

async function flip(id: string, value: boolean): Promise<void> {
  await fireEvent(node(id), 'change', { value });
  await settle();
}

/** Everything but the time and the tag, which change from run to run. */
const stable = ({ timestamp, nativeTag, ...rest }: InteractionEvent) => {
  assert.equal(typeof timestamp, 'number');
  assert.equal(typeof nativeTag, 'number', 'the tag of the view the control committed');
  return rest;
};

for (const os of ['ios', 'android'] as const) {
  describe(`a switch flipped on ${os}`, () => {
    before(() => registerPlatformComponents(os));
    after(() => {
      registerPlatformComponents('ios');
      registerViewName('switch', 'Switch');
    });

    it('is reported as a click with the switch identity and no value', async () => {
      const { heard, logged, instance } = await renderObserved();
      await flip('wifi', true);
      assert.deepEqual(instance.events, ['wifi true', 'wifi touched']);
      assert.deepEqual(heard.map(stable), [
        {
          type: 'click',
          element: 'switch',
          label: 'Wi-Fi',
          testID: 'wifi',
          nativeID: 'wifi-switch',
          role: 'switch',
          source: 'click',
        },
      ]);
      assert.deepEqual(
        logged,
        [['wifi true', 'wifi touched']],
        'after the switch has run its own outputs',
      );
    });

    it('is reported once a flip, either way', async () => {
      const { heard } = await renderObserved();
      await flip('wifi', true);
      await flip('wifi', false);
      assert.deepEqual(
        heard.map((event) => [event.type, event.testID]),
        [
          ['click', 'wifi'],
          ['click', 'wifi'],
        ],
      );
    });

    it('is reported when the app does not take the flip, which is a dead control', async () => {
      const { heard } = await renderObserved();
      await flip('locked', true);
      assert.deepEqual(
        heard.map((event) => [event.type, event.testID]),
        [['click', 'locked']],
      );
    });
  });
}

describe('a native button pressed', () => {
  for (const os of ['ios', 'macos'] as const) {
    describe(`on ${os}, where the host draws it`, () => {
      before(() => registerPlatformComponents(os));
      after(() => registerPlatformComponents('ios'));

      it('is reported as a click with the button identity and its title', async () => {
        const { heard, logged, fabric, instance } = await renderObserved();
        fabric.emit(node('save'), 'topButtonPress', {});
        await settle();
        assert.deepEqual(instance.events, ['save']);
        assert.deepEqual(heard.map(stable), [
          {
            type: 'click',
            element: 'native-button',
            label: 'Save the draft',
            testID: 'save',
            role: 'button',
            text: 'Save',
            source: 'click',
          },
        ]);
        assert.deepEqual(logged, [['save']], 'after the button has run its own (press)');
      });

      it('is reported when nothing listens to it, which is a dead tap', async () => {
        const { heard, fabric } = await renderObserved();
        fabric.emit(node('silent'), 'topButtonPress', {});
        await settle();
        assert.deepEqual(
          heard.map((event) => [event.type, event.testID, event.text]),
          [['click', 'silent', 'Nothing happens']],
        );
      });

      it('is not reported while disabled', async () => {
        const { heard, fabric, instance, rerender } = await renderObserved();
        instance.off.set(true);
        await rerender();
        fabric.emit(node('save'), 'topButtonPress', {});
        await settle();
        assert.deepEqual(heard, []);
        assert.deepEqual(instance.events, []);
      });
    });
  }

  describe('on Android, where the responder presses it', () => {
    before(() => registerPlatformComponents('android'));
    after(() => registerPlatformComponents('ios'));

    it('is reported once a press, as any touchable is', async () => {
      const { heard, instance } = await renderObserved();
      await fireEvent(node('save'), 'touchStart', { touches: [{}], changedTouches: [{}] });
      await fireEvent(node('save'), 'touchEnd', { touches: [], changedTouches: [{}] });
      await settle();
      assert.deepEqual(instance.events, ['save']);
      assert.deepEqual(
        heard.map((event) => [event.type, event.element, event.text, event.source]),
        [['click', 'native-button', 'Save', 'touch']],
      );
    });
  });
});

describe('a native control with a broken observer, or none', () => {
  it('works with no observer registered', async () => {
    const { fabric, instance } = await render(Component);
    await flip('wifi', true);
    fabric.emit(node('save'), 'topButtonPress', {});
    await settle();
    assert.deepEqual(instance.events, ['wifi true', 'wifi touched', 'save']);
  });

  it('keeps working past an observer that throws', async () => {
    const warn = console.warn;
    const warnings: unknown[][] = [];
    console.warn = (...args: unknown[]) => warnings.push(args);
    try {
      const heard: InteractionEvent[] = [];
      const { fabric, instance } = await render(Component, {
        providers: [
          provideInteractionObserver(() => {
            throw new Error('broken tool');
          }),
          provideInteractionObserver((event) => heard.push(event)),
        ],
      });
      await flip('wifi', true);
      fabric.emit(node('save'), 'topButtonPress', {});
      await settle();
      assert.deepEqual(instance.events, ['wifi true', 'wifi touched', 'save']);
      assert.deepEqual(
        heard.map((event) => event.testID),
        ['wifi', 'save'],
      );
      assert.equal(warnings.length, 1);
    } finally {
      console.warn = warn;
    }
  });
});
