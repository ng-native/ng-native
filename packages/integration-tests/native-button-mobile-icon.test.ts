/**
 * A `<native-button>` icon on iOS and Android. An icon's SVG markup, `{ svg }`, is drawn once by
 * the renderer the app provides (`SvgImages` from `@ng-native/icons`, through `withSvgIcons` or
 * `SVG_ICON_RENDERER`), as a tab's is. iOS commits the image as `iconImage`, which the UIButton
 * draws as a template image before the title, tinted as a symbol is. Android's button is a view,
 * so the picture is an `<image>` before the label, tinted in the label's colour: the drawn SVG, or
 * the drawable `drawable` or `{ drawable }` names.
 */
import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it } from 'node:test';
import type { Type, ViewContainerRef, WritableSignal } from '@angular/core';
import { registerPlatformComponents } from '@ng-native/fabric';
import { cleanup, render, settle, type FakeFabricNode } from '@ng-native/testing';
import type { ButtonIcon } from '@ng-native/components';
import { SVG_ICON_RENDERER } from '@ng-native/device';
import { withSvgIcons } from '@ng-native/router';
import { compileFixture } from './compile.ts';

type Fixture = {
  icon: WritableSignal<ButtonIcon | undefined>;
  colour: WritableSignal<string | undefined>;
};
let Fixture: Type<Fixture>;
let plus: string;

before(async () => {
  const mod = await compileFixture('fixtures/native-button-mobile-icon.ts');
  Fixture = mod['NativeButtonMobileIconFixture'] as Type<Fixture>;
  plus = mod['plus'] as string;
});

async function idle(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) await settle();
}

/** One call to the renderer, which the test answers when it chooses. */
interface Drawing {
  readonly svg: string;
  readonly size: number;
  readonly at: ViewContainerRef;
  answer(source: unknown): Promise<void>;
}

let drawings: Drawing[] = [];

/** A renderer that draws nothing and answers when a test says so, as a device does later. */
class FakeSvgRenderer {
  render(svg: string, size: number, at: ViewContainerRef): Promise<unknown> {
    return new Promise((resolve) => {
      drawings.push({
        svg,
        size,
        at,
        answer: async (source) => {
          resolve(source);
          await idle();
        },
      });
    });
  }
}

const drawn = { uri: 'data:image/png;base64,AAAA', scale: 3, width: 40, height: 40 };

async function start(renderer = true) {
  const app = await render(Fixture, {
    providers: renderer ? [{ provide: SVG_ICON_RENDERER, useClass: FakeSvgRenderer }] : [],
  });
  await idle();
  return app;
}

let warned: string[] = [];
const warn = console.warn;
beforeEach(() => {
  drawings = [];
  warned = [];
  console.warn = (message: unknown) => void warned.push(String(message));
});
afterEach(() => {
  console.warn = warn;
  cleanup();
  registerPlatformComponents('ios');
});

it("is the renderer the router's withSvgIcons provides, so one provider draws tabs and buttons", () => {
  const feature = withSvgIcons(FakeSvgRenderer) as unknown as {
    ɵnativeRouter: { providers: { provide: unknown }[] };
  };
  assert.equal(feature.ɵnativeRouter.providers[0]!.provide, SVG_ICON_RENDERER);
});

describe('on iOS', () => {
  beforeEach(() => registerPlatformComponents('ios'));

  it('draws the markup once and commits the image as iconImage', async () => {
    const { getByTestId } = await start();
    assert.equal(drawings.length, 1);
    assert.equal(drawings[0]!.svg, plus);
    assert.equal(drawings[0]!.size, 40);
    assert.equal(getByTestId('add').props['iconImage'], undefined, 'nothing until it is drawn');

    await drawings[0]!.answer(drawn);
    assert.equal(getByTestId('add').props['iconImage'], drawn.uri);
    assert.deepEqual(warned, []);
  });

  it('takes the image away for a symbol, and keeps no answer that comes after a change', async () => {
    const { instance, getByTestId, rerender } = await start();
    await drawings[0]!.answer(drawn);
    instance.icon.set({ sfSymbol: 'star' });
    await rerender();
    await idle();
    assert.equal(getByTestId('add').props['iconImage'], null, 'removed, not left as it was');
    assert.equal(getByTestId('add').props['sfSymbol'], 'star');

    instance.icon.set({ svg: plus });
    await rerender();
    await idle();
    instance.icon.set({ svg: '<svg id="other"/>' });
    await rerender();
    await idle();
    assert.equal(drawings.length, 3);
    await drawings[1]!.answer(drawn);
    assert.equal(getByTestId('add').props['iconImage'], null, 'the answer for the old icon');
    await drawings[2]!.answer({ ...drawn, uri: 'data:image/png;base64,BBBB' });
    assert.equal(getByTestId('add').props['iconImage'], 'data:image/png;base64,BBBB');
  });

  it('says once, naming withSvgIcons, when nothing draws the markup', async () => {
    const { getByTestId } = await start(false);
    assert.equal(getByTestId('add').props['iconImage'], undefined);
    const said = warned.filter((message) => message.includes('<native-button>'));
    assert.equal(said.length, 1, warned.join('\n'));
    assert.match(said[0]!, /withSvgIcons\(SvgImages\)/);
  });
});

describe('on Android', () => {
  beforeEach(() => registerPlatformComponents('android'));

  const image = (button: FakeFabricNode) =>
    button.children.find((child) => child.props['source'] !== undefined);

  it('draws a drawable as an image before the label, in a row, tinted in the label colour', async () => {
    const { getByTestId } = await start();
    const button = getByTestId('drawn');
    const picture = image(button);
    assert.ok(picture, 'an image in the button');
    assert.equal(button.children.indexOf(picture), 0, 'before the label');
    assert.deepEqual(picture.props['source'], [{ uri: 'ic_star' }]);
    assert.equal(picture.props['width'], 18);
    assert.equal(picture.props['height'], 18);
    assert.equal(picture.props['tintColor'], 'black', 'as the label draws with no colour set');
    assert.equal(button.props['flexDirection'], 'row');
    assert.equal(button.props['alignItems'], 'center');
    assert.equal(button.props['drawable'], undefined, 'no prop a view ignores');
  });

  it('draws nothing more in a button with no picture', async () => {
    const { getByTestId } = await start();
    const button = getByTestId('plain');
    assert.equal(image(button), undefined);
    assert.equal(button.props['flexDirection'], undefined);
  });

  it('draws the markup as an image 18 points square, tinted in the colour the button sets', async () => {
    const { instance, getByTestId, rerender } = await start();
    assert.equal(drawings.length, 1);
    assert.equal(drawings[0]!.size, 18);
    assert.equal(image(getByTestId('add')), undefined, 'nothing until it is drawn');

    await drawings[0]!.answer(drawn);
    assert.deepEqual(image(getByTestId('add'))!.props['source'], [drawn]);
    assert.equal(
      getByTestId('add').props['iconImage'],
      undefined,
      "iOS's prop, which a view ignores",
    );
    const black = image(getByTestId('add'))!.props['tintColor'];
    assert.notEqual(black, undefined, 'black, as the label draws, where nothing sets a colour');

    instance.colour.set('red');
    await rerender();
    await idle();
    const red = image(getByTestId('add'))!.props['tintColor'];
    assert.notEqual(red, black);
    assert.equal(red, getByTestId('add').children[1]!.props['color'], "the label's colour");
    assert.deepEqual(warned, []);
  });

  it('takes the image away for an icon Android has none of', async () => {
    const { instance, getByTestId, rerender } = await start();
    await drawings[0]!.answer(drawn);
    instance.icon.set({ sfSymbol: 'star' });
    await rerender();
    await idle();
    assert.equal(image(getByTestId('add')), undefined);
    assert.equal(getByTestId('add').props['flexDirection'], null);

    instance.icon.set({ drawable: 'ic_add' });
    await rerender();
    await idle();
    assert.deepEqual(image(getByTestId('add'))!.props['source'], [{ uri: 'ic_add' }]);
  });
});
