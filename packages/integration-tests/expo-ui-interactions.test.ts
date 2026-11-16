/**
 * Interaction observers hear the `@expo/ui` controls SwiftUI and Compose draw, which the press
 * machine never sees. Each tap is a `click` with the control's identity and no value, reported once
 * the control's own outputs have run, from the native event each platform sends for it.
 */
import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';
import type { Type, WritableSignal } from '@angular/core';
import { registerPlatformComponents } from '@ng-native/fabric';
import { registerExpoUiViews } from '@ng-native/expo';
import { cleanup, render, settle, type FakeFabricNode } from '@ng-native/testing';
import { provideInteractionObserver, type InteractionEvent } from '@ng-native/components';
import { compileFixture } from './compile.ts';

interface Fixture {
  events: string[];
  locked: WritableSignal<boolean>;
  pickerStyle: WritableSignal<'segmented' | 'menu'>;
  room(): string | number | null;
}

let Component: Type<Fixture>;

before(async () => {
  const mod = await compileFixture('fixtures/expo-ui-interactions.ts');
  Component = mod['ExpoUiInteractionsFixture'] as Type<Fixture>;
});

after(() => {
  registerPlatformComponents('ios');
  registerExpoUiViews('ios');
});

afterEach(cleanup);

const all = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...all(node.children)]);

async function boot(platform: 'ios' | 'android', observe = true) {
  registerPlatformComponents(platform);
  registerExpoUiViews(platform);
  const heard: InteractionEvent[] = [];
  const logged: string[][] = [];
  const rendered = await render(Component, {
    providers: observe
      ? [
          provideInteractionObserver((event) => {
            heard.push(event);
            logged.push([...rendered.instance.events]);
          }),
        ]
      : [],
  });
  await settle();
  const { fabric } = rendered;
  const byTestID = (id: string) => all(fabric.committed).find((n) => n.props['testID'] === id)!;
  const emit = async (node: FakeFabricNode, event: string, payload: object = {}) => {
    fabric.emit(node, event, payload);
    await settle();
  };
  /** One report per tap: the element and its test ID. */
  const reports = () => heard.map((event) => [event.type, event.element, event.testID]);
  return { ...rendered, heard, logged, byTestID, emit, reports };
}

/** Everything but the time and the tag, which change from run to run. */
const stable = ({ timestamp, nativeTag, ...rest }: InteractionEvent) => {
  assert.equal(typeof timestamp, 'number');
  assert.equal(typeof nativeTag, 'number', 'the tag of the view the control committed');
  return rest;
};

/** Each control, the event its platform sends for a tap, and what it logs first. */
const taps = {
  ios: [
    ['save', 'topButtonPress', {}, 'ui-button', 'save'],
    ['wifi', 'topIsOnChange', { isOn: true }, 'ui-toggle', 'wifi'],
    ['guests', 'topValueChange', { value: 3 }, 'ui-stepper', 'guests'],
    ['tint', 'topSelectionChange', { value: '#00ff00' }, 'ui-color-picker', 'tint'],
    ['when', 'topDateChange', { date: 86_400_000 }, 'ui-date-picker', 'when'],
    ['room', 'topSelectionChange', { selection: 'hall' }, 'ui-picker', 'room selection'],
  ],
  android: [
    ['save', 'topButtonPressed', {}, 'ui-button', 'save'],
    ['wifi', 'topCheckedChange', { value: true }, 'ui-toggle', 'wifi'],
    ['when', 'topDateSelected', { date: 86_400_000 }, 'ui-date-picker', 'when'],
    ['segment', 'topButtonPressed', {}, 'ui-segmented-button', 'segment'],
    ['item', 'topItemPressed', {}, 'ui-dropdown-menu-item', 'item'],
  ],
} as const;

for (const platform of ['ios', 'android'] as const) {
  describe(`@expo/ui controls tapped on ${platform}`, () => {
    for (const [id, event, payload, element, logs] of taps[platform]) {
      it(`reports ${element} as one click, after its own output`, async () => {
        const { byTestID, emit, heard, logged, instance } = await boot(platform);
        await emit(byTestID(id), event, payload);
        assert.ok(instance.events.includes(logs), `${element} ran its output`);
        assert.deepEqual(
          heard.map((each) => [each.type, each.element, each.testID, each.source]),
          [['click', element, id, 'click']],
        );
        assert.ok(logged[0]!.includes(logs), 'after the control has run its own output');
      });
    }

    it('reports a slider once a drag, as the finger lifts', async () => {
      const { byTestID, emit, reports } = await boot(platform);
      const slider = byTestID('volume');
      const moved = platform === 'android' ? 'topValueChange' : 'topValueChanged';
      if (platform === 'ios') await emit(slider, 'topEditingChanged', { isEditing: true });
      await emit(slider, moved, { value: 0.6 });
      await emit(slider, moved, { value: 0.7 });
      assert.deepEqual(reports(), [], 'nothing while the thumb moves');
      if (platform === 'ios') await emit(slider, 'topEditingChanged', { isEditing: false });
      else await emit(slider, 'topValueChangeFinished');
      assert.deepEqual(reports(), [['click', 'ui-slider', 'volume']]);
    });

    it('reports nothing without an observer', async () => {
      const { byTestID, emit, instance } = await boot(platform, false);
      const [id, event, payload, , logs] = taps[platform][0];
      await emit(byTestID(id), event, payload);
      assert.deepEqual(instance.events, [logs]);
    });
  });
}

describe('an @expo/ui button', () => {
  it('carries its label as text and the role of a button, not SwiftUI role', async () => {
    const { byTestID, emit, heard } = await boot('ios');
    await emit(byTestID('save'), 'topButtonPress');
    assert.deepEqual(heard.map(stable), [
      {
        type: 'click',
        element: 'ui-button',
        testID: 'save',
        role: 'button',
        text: 'Save',
        source: 'click',
      },
    ]);
  });

  it('cuts a long label to the length of any other reported text', async () => {
    const { byTestID, emit, heard } = await boot('ios');
    await emit(byTestID('long'), 'topButtonPress');
    assert.equal(heard[0]?.text, 'x'.repeat(100));
  });

  it('keeps working when an observer throws', async () => {
    registerPlatformComponents('ios');
    registerExpoUiViews('ios');
    const { fabric, instance } = await render(Component, {
      providers: [
        provideInteractionObserver(() => {
          throw new Error('broken observer');
        }),
      ],
    });
    await settle();
    const save = all(fabric.committed).find((n) => n.props['testID'] === 'save')!;
    const warn = console.warn;
    console.warn = () => {};
    try {
      fabric.emit(save, 'topButtonPress', {});
      fabric.emit(save, 'topButtonPress', {});
      await settle();
    } finally {
      console.warn = warn;
    }
    assert.deepEqual(instance.events, ['save', 'save']);
  });
});

describe('a date picker', () => {
  it('reports nothing for the date SwiftUI reports as it appears, which is not a pick', async () => {
    const { byTestID, emit, reports, instance } = await boot('ios');
    instance.events.length = 0;
    // An empty picker that has only just appeared describes itself.
    const node = byTestID('when');
    (instance as unknown as { when: WritableSignal<Date | null> }).when.set(null);
    await settle();
    await emit(node, 'topDateChange', { date: 0 });
    assert.deepEqual(reports(), []);
    await emit(node, 'topDateChange', { date: 86_400_000 });
    assert.deepEqual(reports(), [['click', 'ui-date-picker', 'when']]);
  });

  // Compose's picker sends its selected date as it is first drawn, whatever it holds.
  for (const platform of ['ios', 'android'] as const) {
    it(`reports nothing for the date it already holds on ${platform}, which is not a pick`, async () => {
      const { byTestID, emit, reports } = await boot(platform);
      const event = platform === 'android' ? 'topDateSelected' : 'topDateChange';
      await emit(byTestID('when'), event, { date: 0 });
      assert.deepEqual(reports(), []);
      await emit(byTestID('when'), event, { date: 86_400_000 });
      assert.deepEqual(reports(), [['click', 'ui-date-picker', 'when']]);
    });
  }
});

describe('a picker', () => {
  it('reports a pick on Android as the picker, not the segmented button it draws', async () => {
    const { byTestID, emit, reports, instance } = await boot('android');
    const picker = byTestID('room');
    const [, hall] = all(picker.children).filter((n) => /_SegmentedButtonView$/.test(n.viewName));
    await emit(hall!, 'topButtonPressed');
    assert.equal(instance.room(), 'hall');
    assert.deepEqual(reports(), [['click', 'ui-picker', 'room']]);
  });

  it('reports a pick from its dropdown on Android as the picker, not the menu item', async () => {
    const { byTestID, emit, reports, instance } = await boot('android');
    instance.pickerStyle.set('menu');
    await settle();
    const [, hall] = all(byTestID('room').children).filter((n) =>
      /_DropdownMenuItemView$/.test(n.viewName),
    );
    await emit(hall!, 'topItemPressed');
    assert.equal(instance.room(), 'hall');
    assert.deepEqual(reports(), [['click', 'ui-picker', 'room']]);
  });

  for (const platform of ['ios', 'android'] as const) {
    it(`reports nothing for a disabled picker on ${platform}`, async () => {
      const { byTestID, emit, reports, instance } = await boot(platform);
      instance.locked.set(true);
      await settle();
      if (platform === 'ios') {
        await emit(byTestID('room'), 'topSelectionChange', { selection: 'hall' });
      } else {
        const [, hall] = all(byTestID('room').children).filter((n) =>
          /_SegmentedButtonView$/.test(n.viewName),
        );
        await emit(hall!, 'topButtonPressed');
      }
      assert.equal(instance.room(), null);
      assert.deepEqual(reports(), []);
    });
  }
});

describe('controls left out', () => {
  it('reports nothing for typing in a text field', async () => {
    const { byTestID, emit, reports } = await boot('ios');
    await emit(byTestID('name'), 'topValueChanged', { value: 'Ada' });
    assert.deepEqual(reports(), []);
  });
});
