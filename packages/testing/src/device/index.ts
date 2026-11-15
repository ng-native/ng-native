/**
 * Component tests on a simulator or emulator: what a test file imports.
 *
 * The same shape as `@ng-native/testing`, and its queries, but the component renders through the
 * running app's engine onto real native views, so layout, text measurement and native modules are
 * the platform's own. Runs only inside the device test host; see the README.
 */
import {
  createEnvironmentInjector,
  ɵINJECTOR_SCOPE as INJECTOR_SCOPE,
  type ComponentRef,
  type EnvironmentInjector,
  type EnvironmentProviders,
  type Provider,
  type Type,
} from '@angular/core';
import { nextFrame } from '@ng-native/fabric';
import { bindQueries, describeTree, type BoundQueries } from '../queries.ts';
import type { FakeFabricNode } from '../test-utils.ts';
import { harness } from './harness.ts';

export interface RenderOptions {
  /** Inputs to set before the first change detection, as `componentRef.setInput` takes them. */
  inputs?: Record<string, unknown>;
  /** Providers for this render, as `@ng-native/testing`'s `render` takes them. */
  providers?: (Provider | EnvironmentProviders)[];
}

export interface RenderResult<T> {
  componentRef: ComponentRef<T>;
  instance: T;
  /** Run change detection and wait for native to commit and lay out what changed. */
  settle(): Promise<void>;
}

/** A frame in the window, in points, as native laid it out. */
export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What each render made, destroyed with it by `cleanup()`. */
const injectors: EnvironmentInjector[] = [];

const tree = (): FakeFabricNode[] => harness().recorder.committed() as unknown as FakeFabricNode[];

/** `@ng-native/testing`'s queries, over what the app on the device committed. */
export const screen: BoundQueries = bindQueries(
  tree,
  () => describeTree(tree()),
  () => {},
);

/** Change detection, then a frame, so native has the commit and its layout. */
export async function settle(): Promise<void> {
  harness().app.applicationRef.tick();
  await nextFrame();
}

/** Render a component into the test host on the device. */
export async function render<T>(
  component: Type<T>,
  options: RenderOptions = {},
): Promise<RenderResult<T>> {
  // Each render is a root of its own: a `providedIn: 'root'` service is made afresh for it and goes
  // with it, as when a unit test mounts an app per render, rather than living on in the host app.
  const environmentInjector = createEnvironmentInjector(
    [{ provide: INJECTOR_SCOPE, useValue: 'root' }, ...(options.providers ?? [])],
    harness().app.applicationRef.injector,
  );
  injectors.push(environmentInjector);
  const componentRef = harness().slot().createComponent(component, { environmentInjector });
  for (const [name, value] of Object.entries(options.inputs ?? {})) {
    componentRef.setInput(name, value);
  }
  await settle();
  return { componentRef, instance: componentRef.instance, settle };
}

/** Destroy what the test rendered. The host does this after every test. */
export function cleanup(): void {
  harness().slot().clear();
  for (const injector of injectors.splice(0)) injector.destroy();
  harness().app.applicationRef.tick();
}

/** Where native laid a node out, or null when it is gone or has no layout. */
export function measure(node: FakeFabricNode): Frame | null {
  return harness().recorder.measure(node.reactTag);
}

/**
 * Press a node as a finger would reach the engine: a touch's start and end, through the engine's
 * own event handler. The touch does not come from the screen, so the platform's own gesture
 * recognisers are not involved; what JavaScript does with it is the app's real code.
 */
export async function press(node: FakeFabricNode): Promise<void> {
  const { recorder } = harness();
  const point = {
    identifier: 0,
    target: node.reactTag,
    pageX: 0,
    pageY: 0,
    locationX: 0,
    locationY: 0,
    timestamp: Date.now(),
  };
  recorder.emit(node.reactTag, 'topTouchStart', {
    ...point,
    touches: [point],
    changedTouches: [point],
  });
  recorder.emit(node.reactTag, 'topTouchEnd', { ...point, touches: [], changedTouches: [point] });
  await settle();
}
