/**
 * `render()`, `screen` and `within()`, shaped like Angular Testing Library's and running on the
 * fake Fabric instead of TestBed and a DOM.
 *
 * A render is a real `mount()` - the same bootstrap an app runs, with the same renderer and engine
 * - onto a `createFakeFabric()`, so what a query reads is what native would have been handed.
 */
import {
  ChangeDetectorRef,
  Component,
  type ApplicationRef,
  type ComponentRef,
  type EnvironmentProviders,
  type Provider,
  type Type,
} from '@angular/core';
import type { Engine, EngineOptions } from '@ng-native/fabric';
import { mount } from '@ng-native/platform';
import { bindQueries, describeTree, flatten, type BoundQueries } from './queries.ts';
import { createFakeFabric, type FakeFabric, type FakeFabricNode } from './test-utils.ts';
import { waitFor, type WaitForOptions } from './wait-for.ts';

/**
 * What `render()` takes: Angular Testing Library's options, plus the engine's own.
 *
 * The engine options (`globalStyles`, `conditions`, `tokens` and the rest) are what `mount()`
 * takes on a device, so a test styles a component with the same compiled sheet an app would.
 */
export interface RenderOptions<T> extends EngineOptions {
  /** The component's inputs, set before its first change detection, so `required` ones work. */
  inputs?: Record<string, unknown>;
  /** Output handlers, by output name. */
  on?: Record<string, (value: never) => void>;
  /** Environment providers for the app the component is mounted in. */
  providers?: (Provider | EnvironmentProviders)[];
  /** The template form only: what the template may use. */
  imports?: unknown[];
  /** Fields set on the instance: the template form's host, or the component itself. */
  componentProperties?: Partial<T> & Record<string, unknown>;
}

/**
 * What `render()` resolves to: every query, bound to this render, and the handles to drive it.
 *
 * The queries here stay on this render even after a later one; `screen` moves to the latest.
 */
export interface RenderResult<T> extends BoundQueries {
  fabric: FakeFabric;
  componentRef: ComponentRef<T>;
  instance: T;
  /** `ComponentFixture`'s shape, for tests written against it. */
  fixture: {
    componentRef: ComponentRef<T>;
    componentInstance: T;
    detectChanges(): Promise<void>;
  };
  /** Set inputs and properties again, then let the result commit. */
  rerender(changes?: {
    inputs?: Record<string, unknown>;
    componentProperties?: Record<string, unknown>;
  }): Promise<void>;
  /** Run change detection and wait for the commit. */
  detectChanges(): Promise<void>;
  /** Print the committed tree, or one node's subtree. */
  debug(node?: FakeFabricNode): void;
  unmount(): void;
}

interface Mounted {
  fabric: FakeFabric;
  engine: Engine;
  applicationRef: ApplicationRef;
  componentRef: ComponentRef<unknown>;
}

const mounted: Mounted[] = [];
/** Which render a node a query returned belongs to, so an event on it reaches the right fake. */
const owners = new WeakMap<FakeFabricNode, Mounted>();

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Let zoneless change detection run and commit.
 *
 * One macrotask is enough for a change Angular sees: it schedules its pass on `setTimeout(0)`
 * (racing an animation frame), so a timeout queued after the change runs after the pass. A change
 * the engine sees outside change detection, such as a modal's reported dismissal with no
 * `(dismiss)` listener, commits on the platform's next frame instead, 16ms away in Node, so this
 * waits for that frame while a commit is owed.
 */
export async function settle(): Promise<void> {
  await sleep(0);
  for (let frames = 0; frames < 3 && mounted.some((m) => m.engine.pending); frames++) {
    await sleep(16);
  }
}

function latest(): Mounted {
  const current = mounted.at(-1);
  if (!current) throw new Error('Nothing is rendered: call render() first.');
  return current;
}

export function ownerOf(node: FakeFabricNode): Mounted {
  return owners.get(node) ?? latest();
}

/** The node as it is in the most recent commit, found by its tag, or null once it is gone. */
export function currentOf(node: FakeFabricNode): FakeFabricNode | null {
  const hit = flatten(ownerOf(node).fabric.committed).find((n) => n.reactTag === node.reactTag);
  if (hit) owners.set(hit, ownerOf(node));
  return hit ?? null;
}

const tree = (nodes: readonly FakeFabricNode[]): string => describeTree(nodes) || '(nothing)';

function queriesFor(roots: () => readonly FakeFabricNode[], owner: () => Mounted): BoundQueries {
  return bindQueries(
    roots,
    () => tree(roots()),
    (node) => owners.set(node, owner()),
  );
}

/**
 * The template form, compiled just in time.
 *
 * ponytail: this needs `@angular/compiler` at runtime, the one place anything here does - the
 * class form is AOT like the app. An AOT compile of the string would mean evaluating generated
 * code that imports the caller's own classes by name; do that if JIT ever disagrees with AOT.
 */
async function hostFor<T>(template: string, options: RenderOptions<T>): Promise<Type<unknown>> {
  await import('@angular/compiler' as string);
  const properties = options.componentProperties ?? {};
  class WrapperComponent {
    constructor() {
      Object.assign(this, properties);
    }
  }
  return Component({
    selector: 'ng-native-wrapper',
    template,
    imports: (options.imports ?? []) as Type<unknown>[],
  })(WrapperComponent);
}

/**
 * Mount a component, or a template string, onto a fresh fake Fabric and wait for the first commit.
 *
 * The same `mount()` an app boots with, so what the queries read is exactly what native would
 * have been sent. A string is compiled as a host component's template, with `imports` and
 * `componentProperties` for what it uses; a class is rendered as-is, with `inputs` set before its
 * first change detection so `input.required()` works.
 */
export async function render<T>(
  component: Type<T> | string,
  options: RenderOptions<T> = {},
): Promise<RenderResult<T>> {
  const { inputs, on, providers, imports: _, componentProperties, ...engine } = options;
  const isTemplate = typeof component === 'string';
  const type = isTemplate ? await hostFor(component, options) : component;
  const fabric = createFakeFabric();
  const app = mount(1, type, fabric, {
    ...engine,
    providers,
    inputs: isTemplate ? {} : inputs,
  });
  const self: Mounted = {
    fabric,
    engine: app.engine,
    applicationRef: app.applicationRef,
    componentRef: app.componentRef,
  };
  mounted.push(self);

  const componentRef = app.componentRef as ComponentRef<T>;
  const instance = componentRef.instance as T & Record<string, unknown>;
  for (const [name, handler] of Object.entries(on ?? {})) {
    (instance[name] as { subscribe(fn: (value: never) => void): void }).subscribe(handler);
  }

  const detectChanges = async (): Promise<void> => {
    // The component's own view, not the host's: `componentRef.changeDetectorRef` marks the host
    // and upwards, which leaves an OnPush component with a changed field exactly as it was.
    componentRef.injector.get(ChangeDetectorRef).markForCheck();
    app.applicationRef.tick();
    await settle();
  };
  const rerender: RenderResult<T>['rerender'] = async (changes = {}) => {
    for (const [name, value] of Object.entries(changes.inputs ?? {})) {
      componentRef.setInput(name, value);
    }
    Object.assign(instance, changes.componentProperties);
    await detectChanges();
  };

  if (!isTemplate && componentProperties) await rerender({ componentProperties });
  else await settle();

  return {
    ...queriesFor(
      () => fabric.committed,
      () => self,
    ),
    fabric,
    componentRef,
    instance,
    fixture: { componentRef, componentInstance: instance, detectChanges },
    rerender,
    detectChanges,
    debug: (node) => console.log(tree(node ? [currentOf(node) ?? node] : fabric.committed)),
    unmount: () => unmount(self),
  };
}

function unmount(target: Mounted): void {
  const at = mounted.indexOf(target);
  if (at === -1) return;
  mounted.splice(at, 1);
  target.applicationRef.destroy();
}

/** Unmount everything rendered so far. Registered as an `afterEach` where one is global. */
export function cleanup(): void {
  for (const target of [...mounted]) unmount(target);
}

/** Queries over whatever was rendered most recently, as Testing Library's `screen` is. */
export const screen: BoundQueries & { debug(node?: FakeFabricNode): void } = {
  ...queriesFor(() => latest().fabric.committed, latest),
  debug: (node) => console.log(tree(node ? [currentOf(node) ?? node] : latest().fabric.committed)),
};

/** Queries scoped to one node and what is under it, in whichever commit is current. */
export function within(node: FakeFabricNode): BoundQueries {
  const owner = ownerOf(node);
  return queriesFor(
    () => {
      const current = currentOf(node);
      return current ? [current] : [];
    },
    () => owner,
  );
}

type Present = FakeFabricNode | readonly FakeFabricNode[] | null | undefined;

/** Wait for a node, or whatever a callback finds, to leave the committed tree. */
export async function waitForElementToBeRemoved(
  target: FakeFabricNode | readonly FakeFabricNode[] | (() => Present),
  options?: WaitForOptions,
): Promise<void> {
  const present = (): boolean => {
    let found: Present;
    try {
      found = typeof target === 'function' ? target() : target;
    } catch {
      return false;
    }
    const nodes = found ? ([] as FakeFabricNode[]).concat(found) : [];
    return nodes.some((node) => currentOf(node) !== null);
  };
  if (!present()) {
    throw new Error(
      'waitForElementToBeRemoved needs the node to be there when it starts; it already is not.',
    );
  }
  await waitFor(() => {
    if (present())
      throw new Error(`Still rendered after the timeout.\n\n${tree(latest().fabric.committed)}`);
  }, options);
}

// Testing Library's own convention: clean up after every test when the runner exposes `afterEach`
// globally (Vitest with `globals: true`, Jest). Otherwise each `render()` stands alone.
const globalAfterEach = (globalThis as { afterEach?: (fn: () => void) => void }).afterEach;
if (typeof globalAfterEach === 'function') globalAfterEach(cleanup);
