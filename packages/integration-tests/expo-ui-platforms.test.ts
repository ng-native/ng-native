import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Type } from '@angular/core';
import { registerPlatformComponents } from '@ng-native/fabric';
import { mount } from '@ng-native/platform';
import { registerExpoUiViews } from '@ng-native/expo';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

interface Fixture {
  on(): boolean;
  level(): number;
  presses(): number;
}

const all = (n: readonly FakeFabricNode[]): FakeFabricNode[] =>
  n.flatMap((x) => [x, ...all(x.children)]);

interface DefaultsFixture {
  bubbled(): number;
  on(): boolean;
}

let Platforms: Type<Fixture>;
let Defaults: Type<DefaultsFixture>;

before(async () => {
  const mod = await compileFixture(
    fileURLToPath(new URL('./fixtures/expo-ui-platforms.ts', import.meta.url)),
  );
  Platforms = mod['ExpoUiPlatformsFixture'] as Type<Fixture>;
  Defaults = mod['ExpoUiPlatformDefaultsFixture'] as Type<DefaultsFixture>;
});

after(() => {
  registerPlatformComponents('ios');
  registerExpoUiViews('ios');
});

async function boot<T = Fixture>(
  platform: 'ios' | 'android',
  fixture: Type<T> = Platforms as Type<T>,
) {
  registerPlatformComponents(platform);
  registerExpoUiViews(platform);
  const fabric = createFakeFabric();
  const app = mount(1, fixture, fabric);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const every = (pattern: RegExp) => all(fabric.committed).filter((n) => pattern.test(n.viewName));
  const named = (pattern: RegExp) => every(pattern)[0]!;
  const instance = app.componentRef.instance as T;
  return { fabric, app, named, every, instance };
}

describe('the typed SwiftUI controls on iOS', () => {
  it('sends the slider its steps as the step size SwiftUI reads', async () => {
    const { named } = await boot('ios');
    const slider = named(/ExpoUI_SliderView$/);
    assert.equal(slider.props['step'], 0.25);
    assert.equal('steps' in slider.props, false);
  });

  it('keeps SwiftUI names for the toggle, progress, stacks and slot', async () => {
    const { named } = await boot('ios');
    assert.equal(named(/ExpoUI_ToggleView$/).props['isOn'], true);
    assert.equal(named(/ExpoUI_ProgressView$/).props['value'], 0.4);
    assert.equal(named(/ExpoUI_VStackView$/).props['spacing'], 8);
    assert.equal(named(/ExpoUI_VStackView$/).props['alignment'], 'leading');
    assert.equal(named(/ExpoUI_SlotView$/).props['name'], 'label');
  });
});

describe('the same controls on Android, as Compose reads them', () => {
  it("sends each control's props under Compose's names", async () => {
    const { named } = await boot('android');
    const toggle = named(/ExpoUI_SwitchView$/);
    assert.equal(toggle.props['value'], true);
    assert.equal('isOn' in toggle.props, false);

    const slider = named(/ExpoUI_SliderView$/);
    assert.equal(slider.props['steps'], 3, 'four steps are three points between the ends');
    assert.equal('step' in slider.props, false);

    assert.equal(named(/ExpoUI_LinearProgressIndicatorView$/).props['progress'], 0.4);
    assert.ok(named(/ExpoUI_HorizontalDividerView$/));

    const column = named(/ExpoUI_ColumnView$/);
    assert.deepEqual(column.props['verticalArrangement'], { spacedBy: 8 });
    assert.equal(column.props['horizontalAlignment'], 'start');
    const row = named(/ExpoUI_RowView$/);
    assert.deepEqual(row.props['horizontalArrangement'], { spacedBy: 4 });
    assert.equal(row.props['verticalAlignment'], 'top');

    assert.equal(named(/ExpoUI_SlotView$/).props['slotName'], 'label');
  });

  it('gives the button its label as the text Compose draws inside it', async () => {
    const { named } = await boot('android');
    const button = named(/ExpoUI_Button$/);
    assert.ok(
      all(button.children).some(
        (n) => /ExpoUI_TextView$/.test(n.viewName) && n.props['text'] === 'Save',
      ),
    );
  });

  it("delivers Compose's events to the same outputs as SwiftUI's", async () => {
    const { fabric, app, named, instance } = await boot('android');

    fabric.emit(named(/ExpoUI_SwitchView$/), 'topCheckedChange', { value: false });
    fabric.emit(named(/ExpoUI_SliderView$/), 'topValueChange', { value: 0.75 });
    fabric.emit(named(/ExpoUI_Button$/), 'topButtonPressed', {});
    app.applicationRef.tick();

    assert.equal(instance.on(), false);
    assert.equal(instance.level(), 0.75);
    assert.equal(instance.presses(), 1);
  });
});

describe('what a template leaves unset, the same on both', () => {
  it('centres a stack without an alignment, as SwiftUI does', async () => {
    const { named } = await boot('android', Defaults);
    assert.equal(named(/ExpoUI_ColumnView$/).props['horizontalAlignment'], 'center');
    assert.equal(named(/ExpoUI_RowView$/).props['verticalAlignment'], 'center');
  });

  it('switches a toggle with no isOn on Android, as SwiftUI does', async () => {
    const { fabric, app, every, instance } = await boot('android', Defaults);
    const toggle = every(/ExpoUI_SwitchView$/)[1]!;
    fabric.emit(toggle, 'topCheckedChange', { value: true });
    app.applicationRef.tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(instance.on(), true);
    assert.equal(every(/ExpoUI_SwitchView$/)[1]!.props['value'], true, 'and the switch shows it');
  });

  it("stops a Compose toggle's change where the template stops it", async () => {
    const { fabric, app, every, instance } = await boot('android', Defaults);
    fabric.emit(every(/ExpoUI_SwitchView$/)[0]!, 'topCheckedChange', { value: false });
    app.applicationRef.tick();
    assert.equal(instance.bubbled(), 0);
  });

  it('divides the range SwiftUI draws into the steps asked for', async () => {
    const { every } = await boot('ios', Defaults);
    const [minOnly, fractional] = every(/ExpoUI_SliderView$/);
    assert.equal(minOnly!.props['step'], 0.5, 'SwiftUI draws 0 to 1 without both ends');
    assert.equal(fractional!.props['step'], 1 / 3);
  });

  it('sends Compose a whole number of steps', async () => {
    const { every } = await boot('android', Defaults);
    assert.equal(every(/ExpoUI_SliderView$/)[1]!.props['steps'], 2);
  });
});
