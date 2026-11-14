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
  // The rule is for templates an app ships, which are checked when they are compiled. The one use
  // here is the host a test's template string is compiled into: see `hostFor`.
  // eslint-disable-next-line no-restricted-syntax
  NO_ERRORS_SCHEMA,
  outputBinding,
  type ApplicationRef,
  type ComponentRef,
  type EnvironmentProviders,
  type Provider,
  type Type,
} from '@angular/core';
import { OS, OS_VERSION } from '@ng-native/device';
import {
  nativePlatform,
  registerPlatformComponents,
  type Conditions,
  type Engine,
  type EngineOptions,
} from '@ng-native/fabric';
import { mount } from '@ng-native/platform';
import { provideDesktopFakes } from './desktop-fakes.ts';
import { destroyServiceApps } from './inject-service.ts';
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
  /**
   * The OS to render as, for this render alone: the `OS`, `OS_VERSION`, `DESKTOP` and `APPLE`
   * tokens, the view names and the `platform-<os>` class, the `macos:` and `desktop:` variants,
   * and the hover and pointer media features (a Mac's `hover` and `fine`). On a desktop OS the
   * desktop host's menus, Dock, tray and processes are recording fakes (`provideDesktopFakes`),
   * which a provider of the test's own replaces; the component renders on the render's own
   * surface, as the main window. It does not change which
   * file a `.macos.ts` or `.ios.ts` import resolved to: that is the Vitest preset's `os`.
   */
  os?: TestOs;
  /** `OS_VERSION` for this render: the macOS major, the iOS major or the Android API level. */
  osVersion?: number | null;
}

/** The OSes a test renders as. */
export type TestOs = 'ios' | 'android' | 'macos' | 'web';

/** What a Mac's pointer answers to `(hover)`, `(pointer)` and their `any-` forms. */
const DESKTOP_POINTER = {
  hover: 'hover',
  pointer: 'fine',
  anyHover: 'hover',
  anyPointer: 'fine',
} as const;

/** The size a desktop render's window is, where the test gives no conditions of its own. */
const DESKTOP_WINDOW = { width: 1024, height: 768, colorScheme: 'light' } as const;

/** Render as `os` from here on. The platform to go back to, or null where there is no `os`. */
function renderAs(os: TestOs | undefined): string | null {
  if (!os) return null;
  const platform = nativePlatform();
  registerPlatformComponents(os);
  return platform;
}

/** The providers and conditions a render's `os` and `osVersion` stand for. */
function osOptions(
  os: TestOs | undefined,
  osVersion: number | null | undefined,
  conditions: Conditions | undefined,
): { providers: Provider[]; conditions: Conditions | undefined } {
  const providers: Provider[] = [];
  if (os === 'macos') providers.push(...provideDesktopFakes());
  if (os) providers.push({ provide: OS, useValue: os });
  if (os || osVersion !== undefined) {
    providers.push({ provide: OS_VERSION, useValue: osVersion ?? null });
  }
  const desktop = os === 'macos';
  return {
    providers,
    conditions: desktop ? { ...DESKTOP_WINDOW, ...DESKTOP_POINTER, ...conditions } : conditions,
  };
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
  /** The platform to go back to as this render goes, where it rendered as another OS. */
  platform: string | null;
}

const mounted: Mounted[] = [];

/** Expo's runtime global, as far as a render answers for it. */
const scope = globalThis as { expo?: object };
/** The `expo` global a render put in place, removed once nothing is rendered. */
let expoStandIn: object | undefined;

/**
 * The fake commits any view, so it stands for a build that has every one, and answers Expo's
 * `getViewConfig` for each as that build would: a component that asks the build whether it has a
 * view, as `ui-bottom-sheet` does for SwiftUI's toolbar, draws what a development build draws.
 * Only where there is no `expo` global already, so a test's own stays as the test set it.
 */
function standInForExpo(): void {
  if (scope.expo) return;
  scope.expo = expoStandIn = { getViewConfig: () => ({}) };
}

/** Removes the stand-in once nothing is rendered, unless something has replaced it since. */
function releaseExpo(): void {
  if (mounted.length === 0 && expoStandIn && scope.expo === expoStandIn) {
    delete scope.expo;
    expoStandIn = undefined;
  }
}
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

/** The render a call with no node acts on: the most recent one. */
export function lastRender(): Mounted {
  return latest();
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

/** The part of a component or directive definition that says what can be bound on its host. */
interface Bindable {
  readonly inputs?: Readonly<Record<string, unknown>>;
  readonly hostDirectives?: readonly (HostDirective | (() => HostDirective))[] | null;
}
interface HostDirective {
  readonly inputs?: Readonly<Record<string, string>>;
}

/**
 * The names a template can bind as inputs on `type`: its own, by alias where one has one, and
 * those its host directives forward, by the name each is forwarded under. Null where the
 * definition cannot be read, and nothing is checked.
 */
function inputNames(type: Type<unknown>): string[] | null {
  const def = (type as { ɵcmp?: Bindable }).ɵcmp;
  if (!def?.inputs) return null;
  const forwarded = (def.hostDirectives ?? []).flatMap((entry) =>
    Object.values((typeof entry === 'function' ? entry() : entry).inputs ?? {}),
  );
  return [...Object.keys(def.inputs), ...forwarded];
}

/**
 * Throws for a name in `inputs` that is no input of `type`. Angular only logs one, and renders the
 * component with its defaults. Checked before any input is set, so a refused batch changes nothing
 * and a required input left unset by a misspelling is named for what it is.
 */
function refuseUnknownInputs(type: Type<unknown>, inputs: Record<string, unknown> = {}): void {
  const known = inputNames(type);
  if (!known) return;
  const unknown = Object.keys(inputs).filter((name) => !known.includes(name));
  if (!unknown.length) return;
  throw new Error(
    `[angular-native] ${type.name} has no input named ` +
      `${unknown.map((name) => `'${name}'`).join(', ')}. ` +
      (known.length ? `Its inputs are ${known.join(', ')}.` : 'It has no inputs.'),
  );
}

/**
 * The template form, compiled just in time.
 *
 * ponytail: this needs `@angular/compiler` at runtime, the one place anything here does - the
 * class form is AOT like the app. An AOT compile of the string would mean evaluating generated
 * code that imports the caller's own classes by name; do that if JIT ever disagrees with AOT.
 */
/** Wrappers built so far: each takes the next as a host attribute, so no two share an ID. */
let wrappers = 0;

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
    // Angular derives a component's ID from its metadata, not its template's text, so wrappers
    // alike in shape collided (NG0912) without it.
    host: { 'data-wrapper': String(++wrappers) },
    template,
    imports: (options.imports ?? []) as Type<unknown>[],
    // A component's own host bindings are checked against the schemas of the template it is used
    // in, and only where that template was compiled just in time: the app's, compiled ahead, has
    // no such check. Without this every native prop a component binds on its host logs NG0303.
    // eslint-disable-next-line no-restricted-syntax -- as above
    schemas: [NO_ERRORS_SCHEMA],
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
  const {
    inputs,
    on,
    providers,
    imports: _,
    componentProperties,
    os,
    osVersion,
    ...engine
  } = options;
  const isTemplate = typeof component === 'string';
  const type = isTemplate ? await hostFor(component, options) : component;
  const fabric = createFakeFabric();
  if (!isTemplate) refuseUnknownInputs(type, inputs);
  standInForExpo();
  const forOs = osOptions(os, osVersion, engine.conditions);
  const platform = renderAs(os);
  let app: ReturnType<typeof mount>;
  try {
    app = mount(1, type, fabric, {
      ...engine,
      conditions: forOs.conditions,
      // The test's own come last, so a fake of its own replaces the one the OS brings.
      providers: [...forOs.providers, ...(providers ?? [])],
      inputs: isTemplate ? {} : inputs,
      // As a template would bind them, so an output a host directive forwards is heard, by the
      // name it is forwarded under, and a name that is no output is refused by Angular, by name.
      bindings: Object.entries(on ?? {}).map(([name, handler]) =>
        outputBinding(name, handler as (value: unknown) => void),
      ),
    });
  } catch (error) {
    // Never mounted, so no unmount will take the stand-in away.
    releaseExpo();
    if (platform !== null) registerPlatformComponents(platform);
    throw error;
  }
  const self: Mounted = {
    fabric,
    engine: app.engine,
    applicationRef: app.applicationRef,
    componentRef: app.componentRef,
    platform,
  };
  mounted.push(self);

  const componentRef = app.componentRef as ComponentRef<T>;
  const instance = componentRef.instance as T & Record<string, unknown>;

  const detectChanges = async (): Promise<void> => {
    // The component's own view, not the host's: `componentRef.changeDetectorRef` marks the host
    // and upwards, which leaves an OnPush component with a changed field exactly as it was.
    componentRef.injector.get(ChangeDetectorRef).markForCheck();
    app.applicationRef.tick();
    await settle();
  };
  const rerender: RenderResult<T>['rerender'] = async (changes = {}) => {
    refuseUnknownInputs(type, changes.inputs);
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
  try {
    target.applicationRef.destroy();
  } finally {
    releaseExpo();
    if (target.platform !== null) registerPlatformComponents(target.platform);
  }
}

/**
 * Unmount everything rendered so far, and destroy every app `injectService` created. Registered
 * as an `afterEach` where one is global.
 */
export function cleanup(): void {
  for (const target of [...mounted]) unmount(target);
  destroyServiceApps();
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
