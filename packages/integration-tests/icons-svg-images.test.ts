/**
 * `SvgImages`: SVG markup drawn once into a PNG, for a place that takes an image and not a view,
 * such as a tab bar item. react-native-svg draws its own view into one, so the markup is drawn
 * as a view for as long as that takes, and the view goes.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import type { Type, ViewContainerRef } from '@angular/core';
import { registerPlatformComponents } from '@ng-native/fabric';
import { cleanup, render, settle, type FakeFabricNode } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture('fixtures/svg-images.ts');
});

afterEach(() => {
  cleanup();
  registerPlatformComponents('ios');
});

async function idle(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) await settle();
}

const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

interface Asked {
  readonly tag: number;
  readonly options: { width: number; height: number };
  answer(base64?: string): void;
}

interface Host {
  readonly at: ViewContainerRef;
  readonly images: { render(svg: string, size: number, at: ViewContainerRef): Promise<unknown> };
}

const HOUSE = '<svg viewBox="0 0 24 24"><path d="M3 10l9-7 9 7v11H3z"/></svg>';

async function start(native: boolean, platform: 'ios' | 'android' = 'ios') {
  registerPlatformComponents(platform);
  const asked: Asked[] = [];
  const Images = mod['SvgImages'] as { NATIVE: unknown };
  const app = await render(mod['DrawingHost'] as Type<unknown>, {
    providers: [
      {
        provide: Images.NATIVE,
        useValue: native
          ? {
              scale: 3,
              toDataURL: (tag: number, options: Asked['options'], callback: (b?: string) => void) =>
                asked.push({ tag, options, answer: (base64) => callback(base64) }),
            }
          : null,
      },
    ],
  });
  const host = app.instance as Host;
  const svgs = () => flatten(app.fabric.committed).filter((n) => n.viewName === 'RNSVGSvgView');
  return { ...app, host, asked, svgs };
}

describe('drawing SVG markup as an image', () => {
  it('draws the markup as a view, and asks native for that view as a PNG', async () => {
    const { host, asked, svgs } = await start(true);
    const image = host.images.render(HOUSE, 25, host.at);
    await idle();
    const [drawn] = svgs();
    assert.ok(drawn, 'the markup is a view while it is drawn');
    assert.equal(flatten([drawn]).filter((n) => n.viewName === 'RNSVGPath').length, 1);
    assert.equal(asked[0]?.tag, drawn.reactTag, 'native is asked for that view');
    assert.deepEqual(asked[0]?.options, { width: 25, height: 25 }, 'iOS draws in points');
    asked[0]!.answer('iVBOR');
    assert.deepEqual(await image, {
      uri: 'data:image/png;base64,iVBOR',
      scale: 3,
      width: 25,
      height: 25,
    });
  });

  it('takes the view away once it is drawn', async () => {
    const { host, asked, svgs } = await start(true);
    const image = host.images.render(HOUSE, 25, host.at);
    await idle();
    asked[0]!.answer('iVBOR');
    await image;
    await idle();
    assert.equal(svgs().length, 0);
  });

  it('keeps the view out of sight and out of the way while it is there', async () => {
    const { host, svgs, fabric } = await start(true);
    void host.images.render(HOUSE, 25, host.at);
    await idle();
    const svg = svgs()[0]!;
    const wrapper = flatten(fabric.committed).find((node) => node.children.includes(svg))!;
    assert.equal(wrapper.props['position'], 'absolute', 'taking no room from what is beside it');
    assert.equal(wrapper.props['opacity'], 0.01, 'drawn, which Android needs, but not seen');
    assert.equal(wrapper.props['pointerEvents'], 'none');
  });

  it('asks Android in pixels, which draws at the size it is given', async () => {
    const { host, asked } = await start(true, 'android');
    void host.images.render(HOUSE, 24, host.at);
    await idle();
    assert.deepEqual(asked[0]?.options, { width: 72, height: 72 });
  });

  it('answers null when native draws nothing', async () => {
    const { host, asked, svgs } = await start(true);
    const image = host.images.render(HOUSE, 25, host.at);
    await idle();
    asked[0]!.answer();
    assert.equal(await image, null);
    await idle();
    assert.equal(svgs().length, 0);
  });

  it('gives up on native that never answers, and takes the view away', async () => {
    // iOS logs and never calls back for a view it cannot find.
    const Images = mod['SvgImages'] as { answerWithinMs: number };
    const within = Images.answerWithinMs;
    Images.answerWithinMs = 20;
    try {
      const { host, svgs } = await start(true);
      assert.equal(await host.images.render(HOUSE, 25, host.at), null);
      await idle();
      assert.equal(svgs().length, 0);
    } finally {
      Images.answerWithinMs = within;
    }
  });

  it('reads react-native-svg and the screen scale, in the shape each platform gives it', async () => {
    const proxy = globalThis as { __turboModuleProxy?: (name: string) => unknown };
    const before = proxy.__turboModuleProxy;
    const Images = mod['SvgImages'] as { NATIVE: { ɵprov: { factory: () => { scale: number } } } };
    const constants = {
      // iOS has the window in points with its scale; Android has it in physical pixels.
      ios: { Dimensions: { window: { scale: 3 } } },
      android: { Dimensions: { windowPhysicalPixels: { scale: 2.625 } } },
    };
    try {
      for (const [platform, scale] of [
        ['ios', 3],
        ['android', 2.625],
      ] as const) {
        proxy.__turboModuleProxy = (name) =>
          name === 'DeviceInfo'
            ? { getConstants: () => constants[platform] }
            : name === 'RNSVGSvgViewModule'
              ? { toDataURL() {} }
              : undefined;
        assert.equal(Images.NATIVE.ɵprov.factory().scale, scale, platform);
      }
      proxy.__turboModuleProxy = (name) =>
        name === 'DeviceInfo' ? { getConstants: () => constants.ios } : undefined;
      assert.equal(Images.NATIVE.ɵprov.factory(), null, 'and nothing without react-native-svg');
    } finally {
      proxy.__turboModuleProxy = before;
    }
  });

  it('draws nothing where react-native-svg is not in the build', async () => {
    const { host, svgs } = await start(false);
    assert.equal(await host.images.render(HOUSE, 25, host.at), null);
    await idle();
    assert.equal(svgs().length, 0);
  });
});
