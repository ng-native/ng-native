---
title: Use NativeScript
summary: Call iOS and Android platform APIs and mount native views from TypeScript over JSI.
---

# Use NativeScript

Instead of writing Swift and Kotlin modules for each capability,
[`@nativescript/react-native`](https://www.npmjs.com/package/@nativescript/react-native) embeds the
NativeScript JSI runtime into Hermes. Every iOS SDK symbol (Objective-C classes, protocols, C
functions, structs and enums via `libffi`) and Android classpath package (`globalThis.android.*`,
`globalThis.java.*`, `globalThis.androidx.*` via JSI/JNI) is callable synchronously from TypeScript,
co-located with Angular signals.

<div
  class="my-6 overflow-hidden rounded-xl border border-border-subtle bg-surface-sunken aspect-video"
>
  <iframe
    class="h-full w-full border-0"
    src="https://www.youtube.com/embed/rDdpYMPRZ5E"
    title="Using NativeScript with Angular Native"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
    referrerpolicy="strict-origin-when-cross-origin"
    allowfullscreen
    loading="lazy"
  ></iframe>
</div>

The complete working project shown above is available at
[`nstudio/ng-native-with-ns`](https://github.com/nstudio/ng-native-with-ns). It drives a real-time
3D `SceneKit` Metal viewport and `UIKit` controls on iOS and an interactive 3D
`android.graphics.Canvas` viewport on Android from Angular signals.

| Approach                                            | Best when                                                                                                                                |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [Create Expo Module](/guide/native-modules)         | You want a small, self-contained Swift/Kotlin module with a fixed surface area, or you are packaging a reusable Expo module.             |
| **Use NativeScript** (`@nativescript/react-native`) | You want direct, synchronous access to arbitrary iOS and Android SDK APIs and native views from TypeScript without native glue rebuilds. |

## Install and configure

`@nativescript/react-native` links a native JSI runtime and generates platform metadata during the
native build, so it requires a development build (`npx expo run:ios` or `npx expo run:android`)
rather than Expo Go. This guide is written against `@nativescript/react-native` 9.1.0.

```sh
npm install @nativescript/react-native@^9.1.0 react-native-worklets
```

Add `@nativescript/react-native` beside `@ng-native/metro` in `app.json`:

```json
{
  "expo": {
    "plugins": ["@ng-native/metro", "@nativescript/react-native"]
  }
}
```

Add the NativeScript and Worklets Babel plugins in `babel.config.js`:

```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['@nativescript/react-native/babel-plugin', 'react-native-worklets/plugin'],
  };
};
```

To expose additional CocoaPods or system frameworks to the iOS metadata generator, add an optional
`nativescript.react-native.json` at the root of the project:

```json
{
  "reactNative": {
    "metadata": {
      "includePods": [],
      "includeSystemFrameworks": []
    }
  }
}
```

On Android, ensure the NativeScript metadata Gradle script is applied at the top of
`android/app/build.gradle` so the build generates classpath metadata (`treeNodeStream.dat`,
`treeStringsStream.dat` and `treeValueStream.dat`):

```text
apply plugin: "com.android.application"
apply plugin: "org.jetbrains.kotlin.android"
apply plugin: "com.facebook.react"

apply from: "../../node_modules/@nativescript/react-native/android/nativescript.gradle"
```

## Register the native view host

`@nativescript/react-native` ships a `NativeScriptUIView` Fabric component on iOS that mounts any
`UIView *` registered on the UI thread via its pointer handle (`0x...`). On Android, map the same
selector to a non-collapsable `RCTView` (`ReactViewGroup`) so its `nativeID` stays in the hierarchy
for `Drawable` and touch-listener attachment.

Create `src/nativescript/ns-uikit-view.ts` using `registerViewName` from
[`@ng-native/fabric`](/packages/fabric) and `ViewBase` from
[`@ng-native/components`](/packages/components):

```ts
import { Directive, input } from '@angular/core';
import { ViewBase } from '@ng-native/components';
import { registerViewName } from '@ng-native/fabric';

declare const require: ((id: string) => unknown) | undefined;

let registered = false;

function isAndroidPlatform(): boolean {
  try {
    const proc = (globalThis as Record<string, unknown>)['process'] as
      { env?: Record<string, string | undefined> } | undefined;
    if (proc?.env?.['VITEST'] || proc?.env?.['NODE_ENV'] === 'test') return false;
    if (typeof require === 'function') {
      const rn = require('react-native') as { Platform?: { OS?: string } };
      return rn?.Platform?.OS === 'android';
    }
  } catch {}
  return false;
}

export function registerNativeScriptViews(): void {
  if (registered) return;
  registered = true;
  const fabricComponentName = isAndroidPlatform() ? 'RCTView' : 'NativeScriptUIView';
  registerViewName('ns-uikit-view', fabricComponentName, { collapsable: false });
}

@Directive({
  selector: 'ns-uikit-view',
  host: {
    '[nativeViewHandle]': 'nativeViewHandle()',
    '[debugName]': 'debugName()',
  },
})
export class NsUIKitView extends ViewBase {
  readonly nativeViewHandle = input<string | undefined>();
  readonly debugName = input<string | undefined>();
}

registerNativeScriptViews();
```

## Call iOS APIs on the UI thread

On iOS, calling `NativeScript.installWorklets(require('react-native-worklets'))` and
`NativeScript.init()` installs Objective-C JSI bindings into both the main Hermes runtime and the UI
worklet runtime. Functions marked with `'worklet'` and passed to `NativeScript.runOnUI(...)` run
synchronously on `dispatch_get_main_queue()`.

> **Keep worklets on an object constant.** `@ng-native/metro` wraps top-level function declarations
> in `.ts` files with an HMR proxy (`cell.stays`), which hides the `__workletHash` property attached
> by `react-native-worklets/plugin`. Exporting worklets as methods on an object
> (`export const SceneWorklets = { ... }`) preserves `__workletHash` untouched while keeping full
> TypeScript type checking.

Create `src/nativescript/scene-worklets.ts`:

```ts
export const SceneWorklets = {
  buildSceneKitStudioWorklet: (initial: { wireframe: boolean }): { scnViewHandle: string } => {
    'worklet';
    const g = globalThis as Record<string, any>;

    // Dynamically load SceneKit.framework at runtime
    g.NSBundle?.bundleWithPath('/System/Library/Frameworks/SceneKit.framework')?.load?.();

    const { SCNView, SCNScene, SCNNode, SCNTorus, SCNMaterial, SCNAction, UIColor } = g;
    if (!SCNView || !SCNScene) return { scnViewHandle: '' };

    const scnView = SCNView.alloc().initWithFrame({
      origin: { x: 0, y: 0 },
      size: { width: 380, height: 290 },
    });
    const scene = SCNScene.scene();
    scnView.scene = scene;
    scnView.allowsCameraControl = true;
    scnView.antialiasingMode = 2; // SCNMultisampling4X
    scnView.backgroundColor = UIColor.colorWithRedGreenBlueAlpha(0.045, 0.043, 0.048, 1.0);

    const torus = SCNTorus.torusWithRingRadiusPipeRadius(1.38, 0.36);
    const material = SCNMaterial.material();
    material.lightingModelName = 'SCNLightingModelPhysicallyBased';
    material.fillMode = initial.wireframe ? 1 : 0;
    torus.materials = [material];

    const node = SCNNode.nodeWithGeometry(torus);
    node.runAction(SCNAction.repeatActionForever(SCNAction.rotateByXDuration(0.8, 1.2, 0.4, 2.4)));
    scene.rootNode.addChildNode(node);

    // Retain the view on globalThis so ARC/GC keeps it alive, and return its pointer ('0x...')
    g.__ngNativeSceneState = { scnView, scene, torus, material, node };
    return { scnViewHandle: g.interop?.handleof?.(scnView)?.toHexString?.() ?? '' };
  },
};
```

You can also subclass `NSObject` at runtime in TypeScript with `NSObject.extend` to register
Objective-C `@selector` target-actions on controls such as `UISegmentedControl`.

## Call Android APIs via JSI/JNI

On Android, calling `NativeScriptNativeApi.install('')` on the `NativeScriptNativeApi` TurboModule
attaches `libnativescript_rn.so` to React Native's `jsi::Runtime *`, exposing `globalThis.android`,
`globalThis.java`, `globalThis.androidx` and the app's own Java/Kotlin packages synchronously in
TypeScript.

```ts
declare const require: ((id: string) => unknown) | undefined;

export function ensureAndroidNativeScriptInstalled(): boolean {
  const g = globalThis as Record<string, any>;
  if (g.android && g.java) return true;

  const rn = typeof require === 'function' ? (require('react-native') as any) : null;
  const api =
    g.__turboModuleProxy?.('NativeScriptNativeApi') ??
    rn?.TurboModuleRegistry?.get?.('NativeScriptNativeApi');
  if (!api?.isInstalled?.()) {
    api?.install?.('');
  }

  return Boolean(g.android && g.java);
}
```

A top-level package whose name is already taken by a read-only global is exposed with a `$`
prefix instead, as a package named after a JavaScript keyword is. Expo owns `globalThis.expo`, so
the `expo.*` Java packages are at `globalThis.$expo` and Expo's own object is left untouched.

Once installed, instantiate Android SDK classes directly and attach a `BitmapDrawable` or
`View.OnTouchListener` to the Fabric view matching your `nativeID`:

```ts
const g = globalThis as Record<string, any>;
const { Bitmap, Canvas, Paint } = g.android.graphics;
const { BitmapDrawable } = g.android.graphics.drawable;

// Obtain the active Android Activity (e.g. via MainActivity or ActivityThread)
const activity = g.org?.nativescript?.ngnativewithns?.MainActivity?.getCurrentInstance?.();
if (activity) {
  const bitmap = Bitmap.createBitmap(680, 480, Bitmap.Config.ARGB_8888);
  const canvas = new Canvas(bitmap);
  const paint = new Paint(Paint.ANTI_ALIAS_FLAG);

  // Look up the mounted ReactViewGroup by its nativeID ("scn-viewport")
  const view = g.com.facebook.react.uimanager.util.ReactFindViewUtil.findView(
    activity.getWindow().getDecorView(),
    'scn-viewport',
  );
  view?.setBackground(new BitmapDrawable(activity.getResources(), bitmap));
}
```

## Wrap it in an Angular service

Expose the NativeScript runtime through an `InjectionToken` that requires
`@nativescript/react-native` lazily and answers `null` in Node so unit tests run without a
simulator. Create `src/nativescript/nativescript-lab.ts`:

```ts
import { InjectionToken, Service, inject, signal } from '@angular/core';
import { SceneWorklets } from './scene-worklets.ts';

declare const require: ((id: string) => unknown) | undefined;

export interface NativeScriptRuntime {
  installWorklets?(worklets: unknown): void;
  init?(): void;
  loadFramework?(name: string): void;
  runOnUI<TArgs extends unknown[], TResult>(
    worklet: (...args: TArgs) => TResult,
    ...args: TArgs
  ): Promise<TResult>;
}

const isNodeTest = (): boolean => {
  const proc = (globalThis as Record<string, unknown>)['process'] as
    { env?: Record<string, string | undefined> } | undefined;
  return Boolean(proc?.env?.['VITEST'] || proc?.env?.['NODE_ENV'] === 'test');
};

export const NATIVESCRIPT_API = new InjectionToken<NativeScriptRuntime | null>('NATIVESCRIPT_API', {
  providedIn: 'root',
  factory: () => {
    if (isNodeTest() || typeof require !== 'function') return null;
    try {
      const mod = require('@nativescript/react-native') as {
        default?: NativeScriptRuntime;
      } & NativeScriptRuntime;
      return mod.default ?? mod;
    } catch {
      return null;
    }
  },
});

@Service()
export class NativeScriptLab {
  private readonly ns = inject(NATIVESCRIPT_API);

  readonly scnViewHandle = signal('');
  readonly wireframe = signal(false);

  async initializeStudio(): Promise<void> {
    if (!this.ns || typeof this.ns.runOnUI !== 'function') return;

    if (typeof require === 'function' && !isNodeTest()) {
      this.ns.installWorklets?.(require('react-native-worklets'));
    }
    this.ns.init?.();
    this.ns.loadFramework?.('SceneKit');

    const studio = await this.ns.runOnUI(SceneWorklets.buildSceneKitStudioWorklet, {
      wireframe: this.wireframe(),
    });
    if (studio.scnViewHandle) {
      this.scnViewHandle.set(studio.scnViewHandle);
    }
  }
}
```

## Use in a component and test

Import `NsUIKitView` into your component and bind `[nativeViewHandle]` to the signal:

```ts
import { Component, OnInit, inject } from '@angular/core';
import { SafeAreaView, Text, View } from '@ng-native/components';
import { NsUIKitView } from '../nativescript/ns-uikit-view.ts';
import { NativeScriptLab } from '../nativescript/nativescript-lab.ts';

@Component({
  selector: 'app-root',
  imports: [SafeAreaView, View, Text, NsUIKitView],
  host: { style: 'flex: 1' },
  template: `
    <safe-area-view class="screen">
      <ns-uikit-view
        class="viewport"
        nativeID="scn-viewport"
        debugName="SceneKitMetalViewport"
        [nativeViewHandle]="lab.scnViewHandle()"
      />
    </safe-area-view>
  `,
})
export class App implements OnInit {
  protected readonly lab = inject(NativeScriptLab);

  ngOnInit(): void {
    void this.lab.initializeStudio();
  }
}
```

Because `NATIVESCRIPT_API` resolves to `null` under Vitest and `<ns-uikit-view>` is registered in
the Fabric view registry, `render(App)` from [`@ng-native/testing`](/packages/testing) mounts the
component tree and queries `screen.getByTestId('scn-viewport')` in Node with no simulator required.

For the full multi-axis 3D studio, `UISegmentedControl` target-action subclassing, Android `Canvas`
pipeline, hardware telemetry and JSI micro-benchmarks, see
[`nstudio/ng-native-with-ns`](https://github.com/nstudio/ng-native-with-ns).
