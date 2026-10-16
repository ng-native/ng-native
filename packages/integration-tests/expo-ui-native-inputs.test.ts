/**
 * Inputs of the typed `ui-*` components that `@expo/ui`'s native views do not take as props: each
 * reaches native as `@expo/ui`'s own JavaScript wrapper sends it, as a modifier or a slot, or not at
 * all where the view never reads it.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Type, WritableSignal } from '@angular/core';
import { registerPlatformComponents } from '@ng-native/fabric';
import { mount } from '@ng-native/platform';
import { registerExpoUiViews } from '@ng-native/expo';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const all = (n: readonly FakeFabricNode[]): FakeFabricNode[] =>
  n.flatMap((x) => [x, ...all(x.children)]);

let Inputs: Type<unknown>;
let Changing: Type<Changing>;

interface Changing {
  size: WritableSignal<number | undefined>;
  color: WritableSignal<string | undefined>;
  type: WritableSignal<string | undefined>;
  label: WritableSignal<string | undefined>;
}

/** SwiftUI's `foregroundStyle` in one colour, in the forms `@expo/ui` before and from 57.0.15 read. */
const foreground = (color: string) => ({
  $type: 'foregroundStyle',
  style: { type: 'color', color },
  styleType: 'color',
  color,
});

before(async () => {
  const mod = await compileFixture('fixtures/expo-ui-native-inputs.ts');
  Inputs = mod['ExpoUiNativeInputsFixture'] as Type<unknown>;
  Changing = mod['ExpoUiNativeInputsChangingFixture'] as Type<Changing>;
});

after(() => {
  registerPlatformComponents('ios');
  registerExpoUiViews('ios');
});

async function boot(platform: 'ios' | 'android') {
  registerPlatformComponents(platform);
  registerExpoUiViews(platform);
  const fabric = createFakeFabric();
  mount(1, Inputs, fabric);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return (pattern: RegExp) => all(fabric.committed).filter((n) => pattern.test(n.viewName));
}

/** The slots a node holds, by name, each with the views inside it. */
function slots(node: FakeFabricNode) {
  return Object.fromEntries(
    node.children
      .filter((child) => /ExpoUI_SlotView$/.test(child.viewName))
      .map((slot) => [slot.props['name'], slot.children]),
  );
}

describe('ui-image on iOS', () => {
  it('sends size as a font modifier and color as a foregroundStyle one, as @expo/ui does', async () => {
    const [sized] = (await boot('ios'))(/ExpoUI_ImageView$/);
    assert.deepEqual(sized!.props['modifiers'], [{ $type: 'font', size: 30 }, foreground('red')]);
    assert.equal('size' in sized!.props, false);
    assert.equal('color' in sized!.props, false);
  });

  it("keeps a font modifier of the app's own over size, and adds color after its modifiers", async () => {
    const [, ownFont, colored, plain] = (await boot('ios'))(/ExpoUI_ImageView$/);
    assert.deepEqual(ownFont!.props['modifiers'], [{ $type: 'font', size: 12 }]);
    assert.deepEqual(colored!.props['modifiers'], [
      { $type: 'opacity', value: 0.5 },
      foreground('blue'),
    ]);
    assert.equal('modifiers' in plain!.props, false, 'no size and no color adds nothing');
  });
});

describe('ui-gauge on iOS', () => {
  it('sends type as a gaugeStyle modifier, after the modifiers given', async () => {
    const [gauge, plain] = (await boot('ios'))(/ExpoUI_GaugeView$/);
    assert.deepEqual(gauge!.props['modifiers'], [
      { $type: 'opacity', value: 0.5 },
      { $type: 'gaugeStyle', style: 'circular' },
    ]);
    assert.equal('type' in gauge!.props, false);
    assert.equal('modifiers' in plain!.props, false);
  });

  it('draws each label as a text in the slot SwiftUI reads it from', async () => {
    const [gauge, plain] = (await boot('ios'))(/ExpoUI_GaugeView$/);
    const text = (views: FakeFabricNode[] | undefined) =>
      views?.map((v) => /ExpoUI_TextView$/.test(v.viewName) && v.props['text']);
    const named = slots(gauge!);
    assert.deepEqual(text(named['currentValue']), ['0.70']);
    assert.deepEqual(text(named['minimumValue']), ['0']);
    assert.deepEqual(text(named['maximumValue']), ['1']);
    for (const prop of ['currentValueLabel', 'minimumValueLabel', 'maximumValueLabel']) {
      assert.equal(prop in gauge!.props, false, prop);
    }
    assert.deepEqual(slots(plain!), {}, 'a gauge with no labels has no slots');
  });
});

describe('ui-label on iOS', () => {
  it('draws color as the colour of its symbol, in the icon slot', async () => {
    const [starred, plain] = (await boot('ios'))(/ExpoUI_LabelView$/);
    const [icon, ...rest] = slots(starred!)['icon'] ?? [];
    assert.equal(rest.length, 0);
    assert.match(icon!.viewName, /ExpoUI_ImageView$/);
    assert.equal(icon!.props['systemName'], 'star');
    assert.deepEqual(icon!.props['modifiers'], [foreground('orange')]);
    assert.equal('color' in starred!.props, false);
    assert.equal(starred!.props['systemImage'], 'star');
    assert.deepEqual(slots(plain!), {}, 'no color, no icon slot');
  });
});

describe('an accessibilityLabel on iOS', () => {
  it("is the date picker's accessibilityLabel modifier, beside disabled", async () => {
    const [labelled, plain] = (await boot('ios'))(/ExpoUI_DatePickerView$/);
    assert.deepEqual(labelled!.props['modifiers'], [
      { $type: 'disabled', disabled: true },
      { $type: 'accessibilityLabel', label: 'Arrival' },
    ]);
    assert.equal('accessibilityLabel' in labelled!.props, false);
    assert.equal('modifiers' in plain!.props, false);
  });

  it("is the menu's accessibilityLabel modifier", async () => {
    const [menu] = (await boot('ios'))(/ExpoUI_MenuView$/);
    assert.deepEqual(menu!.props['modifiers'], [
      { $type: 'accessibilityLabel', label: 'More actions' },
    ]);
    assert.equal('accessibilityLabel' in menu!.props, false);
  });
});

describe('props no native view reads', () => {
  it("leaves a button's target to widget layouts, on both platforms", async () => {
    for (const platform of ['ios', 'android'] as const) {
      const undo = (await boot(platform))(/ExpoUI_Button$/).at(-1)!;
      assert.equal('target' in undo.props, false, platform);
    }
  });

  it("sends a view host's modifiers to Compose only, as SwiftUI's view host has none", async () => {
    const [ios] = (await boot('ios'))(/ExpoUI_RNHostView$/);
    assert.equal('modifiers' in ios!.props, false);
    const [android] = (await boot('android'))(/ExpoUI_RNHostView$/);
    assert.deepEqual(android!.props['modifiers'], [{ $type: 'opacity', value: 0.5 }]);
  });
});

describe('an input that changes, and goes away', () => {
  it('changes its modifier or slot, and takes it out with the input', async () => {
    registerPlatformComponents('ios');
    registerExpoUiViews('ios');
    const fabric = createFakeFabric();
    const app = mount(1, Changing, fabric);
    const instance = app.componentRef.instance as Changing;
    const settle = async () => {
      app.applicationRef.tick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    await settle();
    const one = (pattern: RegExp) => all(fabric.committed).find((n) => pattern.test(n.viewName))!;

    instance.size.set(20);
    instance.color.set('green');
    instance.type.set('linear');
    instance.label.set('0.60');
    await settle();
    assert.deepEqual(one(/ExpoUI_ImageView$/).props['modifiers'], [
      { $type: 'font', size: 20 },
      foreground('green'),
    ]);
    assert.deepEqual(one(/ExpoUI_GaugeView$/).props['modifiers'], [
      { $type: 'gaugeStyle', style: 'linear' },
    ]);
    const current = slots(one(/ExpoUI_GaugeView$/))['currentValue'];
    assert.equal(current?.[0]?.props['text'], '0.60');

    instance.size.set(undefined);
    instance.color.set(undefined);
    instance.type.set(undefined);
    instance.label.set(undefined);
    await settle();
    // Taken out as null: JSI drops an undefined, and native would keep the last modifiers.
    assert.equal(one(/ExpoUI_ImageView$/).props['modifiers'], null);
    assert.equal(one(/ExpoUI_GaugeView$/).props['modifiers'], null);
    assert.deepEqual(slots(one(/ExpoUI_GaugeView$/)), {});
    assert.deepEqual(slots(one(/ExpoUI_LabelView$/)), {});
  });
});
