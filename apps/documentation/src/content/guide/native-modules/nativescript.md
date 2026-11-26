---
title: Use NativeScript
summary: Call iOS and Android platform APIs, and build native views, from TypeScript over JSI.
---

# Use NativeScript

Instead of writing Swift and Kotlin modules for each capability,
[`@nativescript/react-native`](https://www.npmjs.com/package/@nativescript/react-native) embeds the
NativeScript JSI runtime into Hermes. Every iOS SDK symbol (Objective-C classes, protocols, C
functions, structs and enums via `libffi`) and Android classpath package (`android.*`, `java.*`,
`androidx.*` via JSI/JNI) is callable synchronously from TypeScript, beside Angular signals.
[`@ng-native/nativescript`](/packages/nativescript) installs it and gives a component a service to
call it through and an element to show a UIView in.

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

[`examples/nativescript`](https://github.com/coralogix/ng-native/tree/main/examples/nativescript) is
a small app using everything on this page.
[`nstudio/ng-native-with-ns`](https://github.com/nstudio/ng-native-with-ns) is a complete project on
the same runtime: a real-time 3D `SceneKit` viewport and `UIKit` controls on iOS, and an interactive
`android.graphics.Canvas` on Android, driven from Angular signals.

| Approach                                    | Best when                                                                                                                                |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [Create Expo Module](/guide/native-modules) | You want a small, self-contained Swift/Kotlin module with a fixed surface area, or you are packaging a reusable Expo module.             |
| **Use NativeScript**                        | You want direct, synchronous access to arbitrary iOS and Android SDK APIs and native views from TypeScript without native glue rebuilds. |

## Set it up

NativeScript needs a development build (`npx expo run:ios` or `npx expo run:android`), not Expo Go.
In an Nx workspace, `nx g @ng-native/nx:nativescript <app>` does the setup. Anywhere else, install
`@ng-native/nativescript`, add its config plugin and the SDKs' types, and provide it in `mount()`,
as [Setup](/packages/nativescript#setup) shows.

## Call an API

`call()` runs the function for the platform the app is on, synchronously, on the JavaScript thread:
see the [example](/packages/nativescript) on the package page.

## Touch the UI

UIKit runs only on the main thread, and the component's JavaScript runs on React Native's
JavaScript thread. `runOnUI()` runs a worklet on the main thread instead:

```ts
protected async tint(): Promise<void> {
  await this.native.runOnUI(() => {
    'worklet';
    UIApplication.sharedApplication.keyWindow!.tintColor = UIColor.systemPinkColor;
  });
}
```

On Android, `runOnUI()` runs the function on the main thread too, in the same runtime.
[Calling native APIs](/packages/nativescript/calling-apis) covers what a worklet can read, how it
answers later, and what runs where on each platform.

## Show a native view

`<ns-view>` shows a view built in a worklet, sized by the template like any other element. On iOS
it is a UIView:

```ts
import { Component, signal } from '@angular/core';
import { NsView, nsView } from '@ng-native/nativescript';

const torus = nsView<{ wireframe: boolean }, SCNView>({
  create(props) {
    'worklet';
    const view = SCNView.alloc().initWithFrame(CGRectZero);
    view.scene = SCNScene.scene();
    view.allowsCameraControl = true;
    const geometry = SCNTorus.torusWithRingRadiusPipeRadius(1.4, 0.4);
    geometry.firstMaterial!.fillMode = props.wireframe ? SCNFillMode.Lines : SCNFillMode.Fill;
    view.scene!.rootNode.addChildNode(SCNNode.nodeWithGeometry(geometry));
    return view;
  },
  update(view, props) {
    'worklet';
    const geometry = view.scene!.rootNode.childNodes.objectAtIndex(0).geometry!;
    geometry.firstMaterial!.fillMode = props.wireframe ? SCNFillMode.Lines : SCNFillMode.Fill;
  },
});

@Component({
  selector: 'app-studio',
  imports: [NsView],
  template: `<ns-view class="h-72" [view]="torus" [props]="{ wireframe: wireframe() }" />`,
})
export class Studio {
  protected readonly torus = torus;
  protected readonly wireframe = signal(false);
}
```

SceneKit is not linked by default, so the route that shows it loads it:
`provideNativeScript({ frameworks: ['SceneKit'] })`. [Native views](/packages/nativescript/views)
covers props, lifetime, sizing, and the same on Android with an `android.view.View`.

## Test it

In Node there is no NativeScript, so a component using it renders and is tested without a
simulator. See [In a test](/packages/nativescript#in-a-test).
