/**
 * The typed SwiftUI layering, shape, label and link views, which a widget layout draws with too:
 * each sends its props to the native view as `@expo/ui` names them.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Type } from '@angular/core';
import { registerExpoUiViews } from '@ng-native/expo';
import { registerPlatformComponents } from '@ng-native/fabric';
import { mount } from '@ng-native/platform';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

interface Fixture {
  alignment: { set(value: 'center' | 'topLeading' | 'bottomTrailing' | undefined): void };
}

const all = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...all(node.children)]);

let Shapes: Type<Fixture>;
before(async () => {
  const mod = await compileFixture(
    fileURLToPath(new URL('./fixtures/expo-ui-shapes.ts', import.meta.url)),
  );
  Shapes = mod['ExpoUiShapesFixture'] as Type<Fixture>;
});

after(() => {
  registerPlatformComponents('ios');
  registerExpoUiViews('ios');
});

async function boot(platform: 'ios' | 'android') {
  registerPlatformComponents(platform);
  registerExpoUiViews(platform);
  const fabric = createFakeFabric();
  const app = mount(1, Shapes, fabric);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const named = (view: string) =>
    all(fabric.committed).filter((node) => node.viewName.endsWith(`_${view}`));
  return { app, named, instance: app.componentRef.instance as Fixture };
}

describe('the typed SwiftUI shapes, label and link', () => {
  it('send the shapes their radii and style, as numbers where SwiftUI reads numbers', async () => {
    const { named } = await boot('ios');
    assert.equal(named('RectangleView').length, 1);
    assert.equal(named('RoundedRectangleView')[0]!.props['cornerRadius'], 12);
    const uneven = named('UnevenRoundedRectangleView')[0]!.props;
    assert.equal(uneven['topLeadingRadius'], 4);
    assert.equal(uneven['bottomTrailingRadius'], 8);
    assert.equal(uneven['topTrailingRadius'], undefined, 'an unset radius never reaches native');
    assert.equal(named('CapsuleView')[0]!.props['cornerStyle'], 'continuous');
    assert.equal(named('CircleView').length, 1);
    assert.equal(named('EllipseView').length, 1);
    assert.equal(named('AccessoryWidgetBackgroundView').length, 1);
  });

  it('send a label its title, symbol and colour, and a link its destination and label', async () => {
    const { named } = await boot('ios');
    const label = named('LabelView')[0]!.props;
    assert.equal(label['title'], 'Padel');
    assert.equal(label['systemImage'], 'tennisball.fill');
    assert.ok(label['color'], 'the colour reaches native');
    const [labelled, wrapping] = named('LinkView');
    assert.equal(labelled!.props['destination'], 'padel://score');
    assert.equal(labelled!.props['label'], 'Score');
    assert.equal(wrapping!.props['destination'], 'padel://match');
    assert.equal(all(wrapping!.children).filter((n) => n.viewName.endsWith('_TextView')).length, 1);
  });
});

describe('ui-zstack', () => {
  it('sends SwiftUI its alignment', async () => {
    const { app, named, instance } = await boot('ios');
    assert.equal(
      named('ZStackView')[0]!.props['alignment'],
      undefined,
      'SwiftUI centres by itself',
    );
    instance.alignment.set('topLeading');
    app.applicationRef.tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(named('ZStackView')[0]!.props['alignment'], 'topLeading');
  });

  it("is Compose's Box on Android, centred as SwiftUI's is unless alignment says otherwise", async () => {
    const { app, named, instance } = await boot('android');
    const box = () => named('BoxView')[0]!.props;
    assert.equal(box()['contentAlignment'], 'center');
    assert.equal(box()['alignment'], undefined, 'Compose has no alignment prop');
    instance.alignment.set('bottomTrailing');
    app.applicationRef.tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(box()['contentAlignment'], 'bottomEnd');
  });
});
