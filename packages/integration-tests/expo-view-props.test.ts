/**
 * The typed Expo views that forward props: `<expo-video>`, `<expo-blur>`, `<expo-gl>`,
 * `<expo-mesh-gradient>`, `<expo-live-photo>`, `<expo-camera>` and `<expo-maps-apple>` and
 * `<expo-maps-google>`. Each input reaches its view as the prop native reads, after what the
 * module's React component does to it first. A boolean written as a bare attribute commits true,
 * where on a plain element it would commit the empty string every platform drops for a boolean.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { registerExpoViews } from '@ng-native/expo';
import { mount } from '@ng-native/platform';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const all = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...all(node.children)]);

interface Fixture {
  player: { set(value: unknown): void };
  on: { set(value: unknown): void };
}

async function render() {
  const mod = await compileFixture('fixtures/expo-view-props.ts');
  registerExpoViews(
    'expo-video',
    'expo-blur',
    'expo-gl',
    'expo-mesh-gradient',
    'expo-live-photo',
    'expo-camera',
    'expo-maps-apple',
    'expo-maps-google',
  );
  const fabric = createFakeFabric();
  const app = mount(1, mod['ExpoViewPropsFixture'] as Type<unknown>, fabric, {
    // Marks what went through the engine's colour conversion, which is RN's `processColor`.
    processColor: (value) => `processed ${String(value)}`,
  });
  const fixture = app.componentRef.instance as Fixture;
  const props = (id: string) =>
    all(fabric.committed).find((node) => node.props['nativeID'] === id)!.props;
  const set = (signal: keyof Fixture, value: unknown) => {
    fixture[signal].set(value);
    app.applicationRef.tick();
  };
  return { app, props, set };
}

/** The props a view was committed with, less the ones every element carries. */
function own(props: Record<string, unknown>): Record<string, unknown> {
  const { nativeID: _id, style: _style, ...rest } = props;
  return rest;
}

describe('the typed Expo views', () => {
  let unmount: (() => void) | undefined;
  afterEach(() => {
    unmount?.();
    unmount = undefined;
  });

  it('commits a bare boolean attribute as true on every one of them', async () => {
    const { app, props } = await render();
    unmount = () => app.applicationRef.destroy();
    assert.equal(props('video')['requiresLinearPlayback'], true);
    assert.equal(props('gl')['enableExperimentalWorkletSupport'], true);
    assert.equal(props('mesh')['mask'], true);
    assert.equal(props('live')['isMuted'], true);
    assert.equal(props('camera')['enableTorch'], true);
    assert.equal(props('camera')['mirror'], true);
  });

  it('commits nothing for a prop left unset, so native keeps its own default', async () => {
    const { app, props } = await render();
    unmount = () => app.applicationRef.destroy();
    for (const id of ['video-plain', 'blur-plain', 'mesh-plain', 'live-plain', 'camera-plain']) {
      assert.deepEqual(own(props(id)), registered(id), id);
    }
  });

  it('forwards a bound boolean, and resets it when the binding goes to null or undefined', async () => {
    const { app, props, set } = await render();
    unmount = () => app.applicationRef.destroy();
    const bound = [
      ['video', 'nativeControls'],
      ['gl-plain', 'enableExperimentalWorkletSupport'],
      ['mesh', 'smoothsColors'],
      ['live', 'useDefaultGestureRecognizer'],
      ['camera', 'active'],
    ] as const;
    for (const [id, prop] of bound) assert.equal(props(id)[prop], false, `${id} ${prop}`);
    for (const off of [null, undefined]) {
      set('on', true);
      for (const [id, prop] of bound) assert.equal(props(id)[prop], true, `${id} ${prop}`);
      set('on', off);
      // Committed as null, or gone: either takes the native value back to its default, where
      // a stale true would stay on screen.
      for (const [id, prop] of bound) assert.equal(props(id)[prop] ?? null, null, `${id} ${prop}`);
    }
  });

  it("gives expo-video the player's id, as expo-video's VideoView does", async () => {
    const { app, props, set } = await render();
    unmount = () => app.applicationRef.destroy();
    assert.equal(props('video')['player'], 7, 'a player is committed as its id');
    assert.equal(props('video')['contentFit'], 'cover');
    assert.deepEqual(props('video')['fullscreenOptions'], { enable: true });
    set('player', 9);
    assert.equal(props('video')['player'], 9, 'an id is committed as it is');
    set('player', { id: 3 });
    set('player', { id: undefined });
    assert.equal(props('video')['player'] ?? null, null, 'a released player shows none');
    set('player', 9);
    set('player', null);
    assert.equal(props('video')['player'] ?? null, null, 'no player takes the old one away');
  });

  it("gives expo-gl iOS's 4 samples unless set, as expo-gl's GLView does, and none elsewhere", async () => {
    const host = globalThis as Record<string, unknown>;
    for (const os of ['ios', 'android'] as const) {
      host['require'] = (id: string) => {
        if (id !== 'react-native') throw new Error(`Cannot find module '${id}'`);
        return { Platform: { OS: os } };
      };
      try {
        const { app, props } = await render();
        try {
          assert.equal(props('gl-plain')['msaaSamples'], os === 'ios' ? 4 : undefined, os);
          assert.equal(props('gl')['msaaSamples'], 0, `${os}: a value set is kept`);
        } finally {
          app.applicationRef.destroy();
        }
      } finally {
        delete host['require'];
      }
    }
  });

  it("commits flash as off unless set, as expo-camera's CameraView does", async () => {
    // iOS's own default is auto, so leaving the prop out would fire the flash.
    const { app, props } = await render();
    unmount = () => app.applicationRef.destroy();
    assert.equal(props('camera-plain')['flashMode'], 'off');
  });

  it('passes expo-blur and expo-gl their props, numbers as numbers', async () => {
    const { app, props } = await render();
    unmount = () => app.applicationRef.destroy();
    assert.deepEqual(own(props('blur')), {
      tint: 'dark',
      intensity: 80,
      blurMethod: 'dimezisBlurViewSdk31Plus',
      blurReductionFactor: 2,
    });
    assert.equal(props('gl')['msaaSamples'], 0);
  });

  it("converts a mesh gradient's colours, as the engine does any colors list", async () => {
    const { app, props } = await render();
    unmount = () => app.applicationRef.destroy();
    const mesh = props('mesh');
    assert.equal(mesh['columns'], 2);
    assert.equal(mesh['rows'], 1);
    assert.deepEqual(mesh['points'], [
      [0, 0],
      [1, 0],
    ]);
    assert.deepEqual(mesh['colors'], ['processed red', 'processed #00ff00']);
  });

  it("passes a live photo's source and fit", async () => {
    const { app, props } = await render();
    unmount = () => app.applicationRef.destroy();
    assert.deepEqual(props('live')['source'], {
      photoUri: 'file:///p.heic',
      pairedVideoUri: 'file:///p.mov',
    });
    assert.equal(props('live')['contentFit'], 'cover');
  });

  it("names expo-camera's props as native does, as expo-camera's CameraView renames them", async () => {
    const { app, props } = await render();
    unmount = () => app.applicationRef.destroy();
    const camera = props('camera');
    assert.equal(camera['facing'], 'front');
    assert.equal(camera['flashMode'], 'on', 'flash is flashMode to native, and wins over it');
    assert.equal(camera['autoFocus'], 'on', 'autofocus is autoFocus to native, and wins over it');
    assert.equal(camera['zoom'], 0.5);
    assert.equal(camera['mode'], 'video');
    assert.equal(camera['videoQuality'], '720p');
    assert.equal(camera['videoBitrate'], 1000000);
    assert.deepEqual(camera['barcodeScannerSettings'], { barcodeTypes: ['qr'] });
  });

  it("keeps flashMode and autoFocus written under the native view's own names", async () => {
    const { app, props } = await render();
    unmount = () => app.applicationRef.destroy();
    assert.equal(props('camera-native-names')['flashMode'], 'on');
    assert.equal(props('camera-native-names')['autoFocus'], 'on');
  });

  it("types each platform's map element as <expo-map>, colours converted", async () => {
    const { app, props } = await render();
    unmount = () => app.applicationRef.destroy();
    assert.equal(props('apple-map')['colorScheme'], 'DARK');
    assert.deepEqual(props('apple-map')['markers'], [{ id: 'a' }]);
    const [circle] = props('google-map')['circles'] as { color: unknown; lineColor: unknown }[];
    assert.equal(circle!.color, 'processed red', 'a colour is converted, as on <expo-map>');
    // A number is a colour processColor already converted: converting it again changes it.
    assert.equal(circle!.lineColor, 0xff00ff00, 'a processed colour reaches native as it is');
    const [line] = props('google-map')['polylines'] as { color: unknown }[];
    assert.equal(line!.color, 0xff00ff00);
  });
});

/** The props a view is registered with, which an unset input leaves in place. */
function registered(id: string): Record<string, unknown> {
  if (id === 'blur-plain') return { intensity: 50, tint: 'default' };
  // expo-camera's CameraView sends flash as off unless set: iOS's own default is auto. It sends
  // barcodeScannerEnabled always, true only with an onBarcodeScanned handler.
  if (id === 'camera-plain') return { flashMode: 'off', barcodeScannerEnabled: false };
  return {};
}
