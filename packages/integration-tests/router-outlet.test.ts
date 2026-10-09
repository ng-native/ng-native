/**
 * The native stack outlet, driven through `RouterOutletContract` directly.
 *
 * The contract is what the router calls, so exercising it by hand tests the same paths a real
 * navigation takes without standing up a `Router` and a route config.
 */
import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it } from 'node:test';
import { EnvironmentInjector, inject, type ComponentRef, type Type } from '@angular/core';
import { PlatformLocation } from '@angular/common';
import {
  ChildrenOutletContexts,
  DefaultUrlSerializer,
  Router,
  UrlSegment,
  type ActivatedRoute,
  type UrlTree,
} from '@angular/router';
import { HardwareBack } from '@ng-native/device';
import { mount, type MountResult } from '@ng-native/platform';
import { NativePlatformLocation } from '../router/src/native-platform-location.ts';
import { registerScreenComponents } from '../router/src/screens.ts';
import { NATIVE_INTENT, type NativeIntent } from '../router/src/native-navigation.ts';
import { isScreenRoute } from '../router/src/tab-routes.ts';
import {
  cleanup,
  createFakeFabric,
  render,
  type FakeFabric,
  type FakeFabricNode,
} from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function flatten(nodes: FakeFabricNode[]): FakeFabricNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

const screens = (fabric: FakeFabric) =>
  flatten(fabric.committed).filter((node) => node.viewName === 'RNSScreen');

const labels = (fabric: FakeFabric) =>
  flatten(fabric.committed)
    .map((node) => node.props['text'])
    .filter((text): text is string => typeof text === 'string');

/** The router only ever hands the outlet these two things. */
function routeFor(component: Type<unknown>, url: string): ActivatedRoute {
  return {
    component,
    snapshot: { data: {}, url, component },
  } as unknown as ActivatedRoute;
}

/**
 * A route whose snapshot sits in a tree, as the router's do, so the url it was shown at can be
 * rebuilt from it. `path` is the whole url, one level per segment.
 */
function routeAt(component: Type<unknown>, path: string): ActivatedRoute {
  const root = { url: [], outlet: 'primary', children: [] as unknown[], root: null as unknown };
  root.root = root;
  let parent: { children: unknown[] } = root;
  let leaf: Record<string, unknown> = root;
  for (const segment of path.split('/').filter(Boolean)) {
    leaf = { url: [new UrlSegment(segment, {})], outlet: 'primary', children: [], root };
    parent.children.push(leaf);
    parent = leaf as { children: unknown[] };
  }
  Object.assign(leaf, { data: {}, component, queryParams: {}, fragment: null });
  return { component, snapshot: leaf, children: [] } as unknown as ActivatedRoute;
}

/** Enough of an `ActivatedRoute` for the input binding: three observables that emit once. */
function routeWithParams(
  component: Type<unknown>,
  params: Record<string, unknown>,
): ActivatedRoute {
  const emits = (value: unknown) => ({
    subscribe: (next: (value: unknown) => void) => (next(value), { unsubscribe: () => {} }),
  });
  return {
    component,
    snapshot: { data: {}, url: '/titled', component },
    params: emits(params),
    queryParams: emits({}),
    data: emits({}),
  } as unknown as ActivatedRoute;
}

interface Outlet {
  activateWith(route: ActivatedRoute, injector: EnvironmentInjector): void;
  deactivate(): void;
  detach(): ComponentRef<unknown>;
  attach(ref: ComponentRef<unknown>, route: ActivatedRoute): void;
  readonly depth: number;
  readonly isActivated: boolean;
  readonly component: Object | null;
}

describe('native stack outlet', () => {
  let mod: Record<string, unknown>;
  let fabric: FakeFabric;
  let app: MountResult;
  let outlet: Outlet;
  let env: EnvironmentInjector;
  /** What `Router.getCurrentNavigation()` reports; the intent the outlet reads at activation. */
  let intent: NativeIntent | null;
  /** Android's back button, as the app would provide it. */
  let pressBack: () => boolean;
  /** What the outlet asked the router for directly, rather than through history. */
  let navigated: { url: string; extras: Record<string, unknown> }[];
  /** Whether the app asked for `withComponentInputBinding()`, as `Router` reports it. */
  let inputBinding: boolean;
  /** The routes the router's current state holds, under its root. */
  let showing: ActivatedRoute[];
  let location: NativePlatformLocation;
  let ScreenA: Type<unknown>;
  let ScreenB: Type<unknown>;
  let ScreenStyled: Type<unknown>;
  let ScreenPositioned: Type<unknown>;
  let ScreenHeaded: Type<unknown>;
  let ScreenTitled: Type<unknown>;
  let ScreenRequired: Type<unknown>;
  let ScreenBound: Type<unknown>;

  before(async () => {
    registerScreenComponents();
    mod = await compileFixture('fixtures/stack.ts');
    ScreenA = mod['ScreenA'] as Type<unknown>;
    ScreenB = mod['ScreenB'] as Type<unknown>;
    ScreenStyled = mod['ScreenStyled'] as Type<unknown>;
    ScreenPositioned = mod['ScreenPositioned'] as Type<unknown>;
    ScreenHeaded = mod['ScreenHeaded'] as Type<unknown>;
    ScreenTitled = mod['ScreenTitled'] as Type<unknown>;
    ScreenRequired = mod['ScreenRequired'] as Type<unknown>;
    ScreenBound = mod['ScreenBound'] as Type<unknown>;
  });

  beforeEach(async () => {
    intent = null;
    pressBack = () => false;
    navigated = [];
    inputBinding = true;
    showing = [];
    location = new NativePlatformLocation();
    fabric = createFakeFabric();
    // Angular's own packages ship partial-compiled, and `node --test` imports them raw, so any
    // injectable resolved through its `ɵprov` throws "needs to be compiled using the JIT
    // compiler". Metro links them; Node does not. Constructing them here sidesteps the metadata
    // entirely, which is enough to exercise the outlet.
    app = mount(1, mod['StackHost'] as Type<unknown>, fabric, {
      providers: [
        {
          provide: ChildrenOutletContexts,
          useFactory: () => new ChildrenOutletContexts(inject(EnvironmentInjector)),
        },
        { provide: PlatformLocation, useValue: location },
        {
          provide: HardwareBack.SOURCE,
          useValue: {
            subscribe: (listener: () => boolean) => {
              pressBack = listener;
              return () => {};
            },
          },
        },
        {
          provide: Router,
          useValue: {
            get componentInputBindingEnabled() {
              return inputBinding;
            },
            get routerState() {
              return { root: { children: showing } };
            },
            getCurrentNavigation: () =>
              intent ? { extras: { state: { [NATIVE_INTENT]: intent } } } : null,
            serializeUrl: (tree: UrlTree) => new DefaultUrlSerializer().serialize(tree),
            parseUrl: (url: string) => new DefaultUrlSerializer().parse(url),
            navigateByUrl: (url: string, extras: Record<string, unknown> = {}) => {
              navigated.push({ url, extras });
              return Promise.resolve(true);
            },
          },
        },
      ],
    });
    await settle();
    const host = app.componentRef.instance as { outlet(): Outlet };
    outlet = host.outlet();
    env = app.componentRef.injector.get(EnvironmentInjector);
  });

  it('creates a page with its bindings already applied, not a frame later', async () => {
    // Creating a page's nodes dirties the tree, which schedules a commit of its own. Without the
    // page being checked first, that commit captures elements whose bindings have not run - and
    // on Android the decision whether a view exists at all is made from the props it was created
    // with, so a content wrapper arriving without its `collapsable: false` is flattened for good.
    const created: Record<string, unknown>[] = [];
    const create = fabric.createNode.bind(fabric);
    fabric.createNode = (tag, viewName, rootTag, props, handle) => {
      created.push({ viewName, ...(props as Record<string, unknown>) });
      return create(tag, viewName, rootTag, props, handle);
    };

    outlet.activateWith(routeFor(ScreenBound, '/bound'), env);
    // The commit that creating the nodes scheduled, arriving before Angular's own pass - which
    // is the order the device showed and the one Node would otherwise not reproduce.
    app.engine.commit();

    const view = created.find((node) => node['viewName'] === 'View');
    assert.equal(view?.['padding'], 7, 'the bound style was there when the node was created');
  });

  it('binds route params to component inputs, which it advertises support for', async () => {
    // `supportsBindingToComponentInputs` is a promise to the router, and Angular keeps it in
    // `RouterOutlet` alone: the binder is behind a token the router does not export.
    outlet.activateWith(routeWithParams(ScreenTitled, { title: 'from the route' }), env);
    await settle();
    assert.deepEqual(labels(fabric), ['from the route']);
  });

  it('leaves inputs alone when the app did not ask for input binding', async () => {
    // Angular's own outlet binds only under `withComponentInputBinding()`. Without it, a page's
    // input keeps its own default rather than being written over with a route key it never had.
    inputBinding = false;
    outlet.activateWith(routeWithParams(ScreenTitled, { title: 'from the route' }), env);
    await settle();
    assert.deepEqual(labels(fabric), ['untitled']);

    const ref = outlet.detach();
    outlet.attach(ref, routeWithParams(ScreenTitled, { title: 'from the route' }));
    await settle();
    assert.deepEqual(labels(fabric), ['untitled'], 'nor when the screen comes back');
  });

  it('binds a required input before the page first renders', async () => {
    // Bound after the page's first change detection, a required input read in the template
    // threw NG0950 and the pushed screen came up empty: `trip/:id` into a page reading `id()`.
    outlet.activateWith(routeWithParams(ScreenRequired, { id: 'lisbon' }), env);
    await settle();
    assert.deepEqual(labels(fabric), ['lisbon']);
  });

  it('commits the outlet host as a native screen stack', () => {
    const stack = flatten(fabric.committed).find((n) => n.viewName === 'RNSScreenStack');
    assert.ok(stack, 'the outlet host is the RNSScreenStack itself, not a wrapper');
  });

  it('pushes a screen per activation and keeps the ones below mounted', async () => {
    outlet.activateWith(routeFor(ScreenA, '/a'), env);
    await settle();
    assert.equal(screens(fabric).length, 1);
    assert.deepEqual(labels(fabric), ['screen a']);

    outlet.detach();
    outlet.activateWith(routeFor(ScreenB, '/b'), env);
    await settle();

    assert.equal(screens(fabric).length, 2, 'the pushed-away screen is still in the stack');
    assert.deepEqual(labels(fabric), ['screen a', 'screen b'], 'and still rendered');
  });

  it('marks every screen active, never lowering activityState', async () => {
    outlet.activateWith(routeFor(ScreenA, '/a'), env);
    outlet.detach();
    outlet.activateWith(routeFor(ScreenB, '/b'), env);
    await settle();

    // Screen.tsx throws on any decrease while isNativeStack: a native stack decides visibility
    // from child order, not from this flag.
    assert.deepEqual(
      screens(fabric).map((screen) => screen.props['activityState']),
      [2, 2],
    );
  });

  it('keeps the detached component instance alive rather than destroying it', async () => {
    outlet.activateWith(routeFor(ScreenA, '/a'), env);
    await settle();
    const instance = outlet.component;

    const ref = outlet.detach();
    await settle();

    assert.equal(ref.instance, instance, 'the same live component comes back');
    assert.equal(screens(fabric).length, 1, 'its screen stays mounted');
  });

  it('pops everything above the re-attached screen', async () => {
    const routeA = routeFor(ScreenA, '/a');
    outlet.activateWith(routeA, env);
    const refA = outlet.detach();
    outlet.activateWith(routeFor(ScreenB, '/b'), env);
    await settle();
    assert.equal(outlet.depth, 2);

    // Going back: the router detaches the top and re-attaches the ref it stored earlier.
    outlet.detach();
    outlet.attach(refA, routeA);
    await settle();

    assert.equal(outlet.depth, 1, 'screen b is gone');
    assert.deepEqual(labels(fabric), ['screen a']);
    assert.equal(outlet.isActivated, true);
  });

  it('destroys the screen on deactivate', async () => {
    outlet.activateWith(routeFor(ScreenA, '/a'), env);
    await settle();

    outlet.deactivate();
    await settle();

    assert.equal(screens(fabric).length, 0);
    assert.deepEqual(labels(fabric), []);
    assert.equal(outlet.isActivated, false);
  });
  /**
   * The outlet's host, the `view` it wraps each route's component in, and the `screen` it
   * pushes are all registered element names, but none of them is a primitive anyone imports:
   * the outlet creates them. Without a claim they read as "used without its component" and a
   * routed app opens on three errors it can do nothing about.
   */
  it('reports nothing about the elements the outlet creates', async () => {
    const reports: string[] = [];
    const original = console.error;
    const devFabric = createFakeFabric();
    try {
      console.error = (message: string) => reports.push(message);
      const dev = mount(1, mod['StackHost'] as Type<unknown>, devFabric, {
        dev: true,
        providers: [
          {
            provide: ChildrenOutletContexts,
            useFactory: () => new ChildrenOutletContexts(inject(EnvironmentInjector)),
          },
          { provide: PlatformLocation, useValue: new NativePlatformLocation() },
          { provide: Router, useValue: { getCurrentNavigation: () => null } },
        ],
      });
      await settle();
      const devOutlet = (dev.componentRef.instance as { outlet(): Outlet }).outlet();
      devOutlet.activateWith(
        routeFor(ScreenA, '/a'),
        dev.componentRef.injector.get(EnvironmentInjector),
      );
      await settle();
    } finally {
      console.error = original;
    }
    assert.deepEqual(reports, []);
  });
  /**
   * ADR 0004. `findHeaderConfig` in `RNSScreen.mm` scans the screen's direct `reactSubviews`
   * only, with no recursion, so anything a page declares has to be a direct child of the screen
   * or a header written in a page template can never be found.
   */
  it('creates the page on the screen itself, with no wrapper in between', async () => {
    outlet.activateWith(routeFor(ScreenA, '/a'), env);
    await settle();

    const screen = screens(fabric)[0]!;
    assert.equal(screen.children.length, 1, 'the page host is the screen, not a view inside it');
    const root = screen.children[0]!;
    assert.equal(root.viewName, 'View', "the page template's own root");
    assert.equal(root.children[0]?.viewName, 'Paragraph', 'and its text one level below that');
  });

  /**
   * The cost of ADR 0004: a page's host bindings now land on the screen. Styles merge key by
   * key, so a page can style itself without losing the absolute fill the stack lays out with.
   */
  it('keeps the stack layout when a page styles its own host', async () => {
    outlet.activateWith(routeFor(ScreenStyled, '/styled'), env);
    await settle();

    // Style is flattened into the node's props by the time it reaches Fabric.
    const props = screens(fabric)[0]!.props;
    assert.equal(props['position'], 'absolute', 'the screen still fills the stack');
    assert.equal(props['backgroundColor'], 'red', "and the page's own style applied");
    assert.equal(props['flex'], 1);
  });

  /**
   * The merge in the previous test only helps when the page's own keys are different from the
   * stack's. A page that names `position` or an edge inset itself - a header offset, typically -
   * writes over the exact keys the screen needs for its absolute fill, which would otherwise
   * leave a gap or float the page off the stack entirely.
   */
  it("keeps the stack's own position and insets when a page sets them on itself too", async () => {
    outlet.activateWith(routeFor(ScreenPositioned, '/positioned'), env);
    await settle();

    const props = screens(fabric)[0]!.props;
    assert.equal(props['position'], 'absolute', "the outlet's positioning wins");
    assert.equal(props['top'], 0);
    assert.equal(props['left'], 0);
    assert.equal(props['right'], 0);
    assert.equal(props['bottom'], 0);
    // What the page set that does not collide with the stack's own keys still applies.
    assert.equal(props['backgroundColor'], 'blue');
  });
  /**
   * The point of ADR 0004: a header written in a page's own template is a direct `reactSubview`
   * of the screen, which is the only place `findHeaderConfig` looks.
   */
  it('finds a header declared in a page template as a direct child of the screen', async () => {
    outlet.activateWith(routeFor(ScreenHeaded, '/headed'), env);
    await settle();

    const screen = screens(fabric)[0]!;
    const header = screen.children.find((n) => n.viewName === 'RNSScreenStackHeaderConfig');
    assert.ok(header, 'the header config is a direct child, not nested inside the page body');
    // Written first, as a page writes it, but committed after the body: UIKit collapses a large
    // title against the scroll view down the screen's first subviews, and RNS says the config
    // must never be its first child.
    assert.notEqual(screen.children[0], header);
    assert.equal(header.props['title'], 'Settings');
    assert.equal(header.props['hideShadow'], true);
    assert.equal(header.props['titleFontSize'], 18);
    assert.equal(header.props['largeTitle'], undefined, 'an unset input sends nothing');
    // RNS styles the config view in JS, and without it the header joins the screen's flex
    // layout and pushes every page down by the height of the navigation bar.
    assert.equal(header.props['position'], 'absolute');
    assert.equal(header.props['width'], '100%');

    const item = header.children[0]!;
    assert.equal(item.viewName, 'RNSScreenStackHeaderSubview');
    assert.equal(item.props['type'], 'right');
    assert.equal(item.props['flexDirection'], 'row', 'header items lay their content out in a row');
    assert.equal(item.children[0]?.viewName, 'Paragraph', 'and it renders whatever it contains');
  });

  /**
   * `findHeaderConfig` does not recurse, so a header left where a page wrote it, inside its safe
   * area, is never found: no title, no back button, and no error. The engine commits it beside
   * the page's content instead, after the child it was written in, so the scroll view still
   * comes first for the large title to follow.
   */
  it('commits a header written inside a safe-area-view as a direct child of the screen', async () => {
    outlet.activateWith(routeFor(mod['ScreenHeaderInSafeArea'] as Type<unknown>, '/nested'), env);
    await settle();

    const screen = screens(fabric)[0]!;
    assert.deepEqual(
      screen.children.map((node) => node.viewName),
      ['RNCSafeAreaView', 'RNSScreenStackHeaderConfig'],
    );
    assert.equal(screen.children[1]!.props['title'], 'Nested');
    const safeArea = screen.children[0]!;
    assert.deepEqual(
      safeArea.children.map((node) => node.viewName),
      ['ScrollView'],
      'and it is not committed a second time where it was written',
    );
  });

  it('follows a header projected through a component and behind an @if', async () => {
    outlet.activateWith(
      routeFor(mod['ScreenHeaderConditional'] as Type<unknown>, '/conditional'),
      env,
    );
    await settle();
    const page = outlet.component as {
      headed: { set(value: boolean): void };
      title: { set(value: string): void };
    };
    const headers = () =>
      screens(fabric)[0]!.children.filter((n) => n.viewName === 'RNSScreenStackHeaderConfig');
    const everywhere = () =>
      flatten(fabric.committed).filter((n) => n.viewName === 'RNSScreenStackHeaderConfig');

    assert.equal(headers().length, 1, 'hoisted out of the frame component and its view');
    assert.equal(headers()[0]!.props['title'], 'Draft');
    assert.equal(headers()[0]!.children[0]?.viewName, 'RNSScreenStackHeaderSubview');
    assert.equal(everywhere().length, 1);

    page.title.set('Final');
    app.applicationRef.tick();
    await settle();
    assert.equal(headers()[0]!.props['title'], 'Final', 'a binding still reaches it');

    // `RNSScreen` only hides its bar when a header config it holds says so: taking the config out
    // leaves the last one it applied on screen. So the one native config stays, told to hide.
    const tag = headers()[0]!.reactTag;
    page.headed.set(false);
    app.applicationRef.tick();
    await settle();
    assert.equal(everywhere().length, 1, 'the screen keeps its one header config');
    assert.equal(headers()[0]!.reactTag, tag, 'the same native view, updated rather than removed');
    assert.equal(headers()[0]!.props['hidden'], true, 'and it hides the bar');
    assert.equal(
      headers()[0]!.props['title'] ?? undefined,
      undefined,
      'with nothing of the old one',
    );
    assert.equal(headers()[0]!.children.length, 0, 'and none of its items');

    page.headed.set(true);
    app.applicationRef.tick();
    await settle();
    assert.equal(headers().length, 1, 'and comes back with it');
    assert.equal(headers()[0]!.reactTag, tag, 'into the view the screen already has');
    assert.equal(headers()[0]!.props['title'], 'Final');
    assert.equal(headers()[0]!.props['hidden'] ?? undefined, undefined, 'shown again');
    assert.equal(headers()[0]!.children[0]?.viewName, 'RNSScreenStackHeaderSubview');
  });

  it('adopts the header config a screen already has, whichever element brings it', async () => {
    outlet.activateWith(
      routeFor(mod['ScreenHeaderConditional'] as Type<unknown>, '/conditional'),
      env,
    );
    await settle();
    const page = outlet.component as { headed: { set(value: boolean): void } };
    const headers = () =>
      screens(fabric)[0]!.children.filter((n) => n.viewName === 'RNSScreenStackHeaderConfig');
    const tag = headers()[0]!.reactTag;

    // Off and on inside one pass: the old element is destroyed and a new one created.
    page.headed.set(false);
    app.applicationRef.tick();
    page.headed.set(true);
    app.applicationRef.tick();
    await settle();
    assert.equal(headers().length, 1);
    assert.equal(headers()[0]!.reactTag, tag);
    assert.equal(headers()[0]!.props['title'], 'Draft');
  });

  it('keeps the header config of a header written directly in the page', async () => {
    outlet.activateWith(routeFor(mod['ScreenHeaderDirect'] as Type<unknown>, '/direct'), env);
    await settle();
    const page = outlet.component as { headed: { set(value: boolean): void } };
    const headers = () =>
      screens(fabric)[0]!.children.filter((n) => n.viewName === 'RNSScreenStackHeaderConfig');
    const tag = headers()[0]!.reactTag;

    page.headed.set(false);
    app.applicationRef.tick();
    await settle();
    assert.deepEqual(
      headers().map((n) => [n.reactTag, n.props['hidden']]),
      [[tag, true]],
    );

    page.headed.set(true);
    app.applicationRef.tick();
    await settle();
    assert.deepEqual(
      headers().map((n) => [n.reactTag, n.props['title']]),
      [[tag, 'Direct']],
    );
  });

  it('gives a screen that never had a header no header config at all', async () => {
    outlet.activateWith(routeFor(ScreenA, '/a'), env);
    await settle();
    const configs = screens(fabric)[0]!.children.filter(
      (n) => n.viewName === 'RNSScreenStackHeaderConfig',
    );
    assert.equal(configs.length, 0);
  });

  /**
   * ADR 0003: mobile presentation rides in `NavigationExtras.state` rather than in a navigation
   * service of our own, and the outlet reads it at the moment it builds the screen.
   */
  it('presents a screen the way the navigation asked for', async () => {
    intent = {
      stack: 'push',
      presentation: {
        stackPresentation: 'formSheet',
        sheetAllowedDetents: [0.5, 1],
        gestureEnabled: false,
      },
    };
    outlet.activateWith(routeFor(ScreenA, '/a'), env);
    await settle();

    const props = screens(fabric)[0]!.props;
    assert.equal(props['stackPresentation'], 'formSheet');
    assert.deepEqual(props['sheetAllowedDetents'], [0.5, 1]);
    assert.equal(props['gestureEnabled'], false);
  });

  it('marks the route it puts on screen, so the reuse strategy keeps it when covered', async () => {
    const route = routeFor(ScreenA, '/a');
    const config = { path: 'a' };
    (route.snapshot as { routeConfig?: unknown }).routeConfig = config;
    outlet.activateWith(route, env);
    await settle();
    assert.equal(isScreenRoute(config), true);
  });

  it('leaves the screen alone when a navigation carries no intent', async () => {
    outlet.activateWith(routeFor(ScreenA, '/a'), env);
    await settle();
    assert.equal(screens(fabric)[0]!.props['stackPresentation'], undefined);
  });

  /**
   * A replace supersedes the screen it navigated from, so that screen is destroyed rather than
   * left below the new one. Without this the stack grows on every replace while history does
   * not, and the two disagree about how far back is back.
   */
  it('drops the screen a replace supersedes', async () => {
    outlet.activateWith(routeFor(ScreenA, '/a'), env);
    await settle();
    outlet.detach();

    intent = { stack: 'replace' };
    outlet.activateWith(routeFor(ScreenB, '/b'), env);
    await settle();

    assert.equal(outlet.depth, 1);
    assert.deepEqual(labels(fabric), ['screen b'], 'a is gone, not stacked under b');
  });

  it('empties the stack on a reset', async () => {
    outlet.activateWith(routeFor(ScreenA, '/a'), env);
    outlet.detach();
    outlet.activateWith(routeFor(ScreenB, '/b'), env);
    await settle();
    outlet.detach();

    intent = { stack: 'reset' };
    outlet.activateWith(routeFor(ScreenA, '/home'), env);
    await settle();

    assert.equal(outlet.depth, 1, 'nothing left to go back to');
    assert.deepEqual(labels(fabric), ['screen a']);
  });
  /**
   * Android's back button is a platform capability the app provides, because the router package
   * imports nothing from React Native. Returning false at the bottom of the stack is what lets
   * the platform background the app rather than the app swallowing the press.
   */
  /** The screen a native pop took away: swipe back, the bar's back button, a sheet dragged down. */
  const dismiss = async (index: number, dismissCount = 1) => {
    const screen = screens(fabric)[index]!;
    fabric.emit(screen, 'topDismissed', { target: screen.reactTag, dismissCount });
    await settle();
  };

  it('follows a native pop back through history when the entry behind is the screen below', async () => {
    location.replaceState(null, '', '/a');
    outlet.activateWith(routeAt(ScreenA, '/a'), env);
    outlet.detach();
    location.pushState(null, '', '/b');
    outlet.activateWith(routeAt(ScreenB, '/b'), env);
    await settle();

    await dismiss(1);

    assert.equal(location.pathname, '/a');
    assert.deepEqual(navigated, [], 'history already had it');
  });

  it('pops to the screen below even when history went somewhere else in between', async () => {
    // A stack inside a tab: /tabs/library, then an album on top, then a trip to another tab and
    // back. History now reads album, other tab, album - so going back one entry from the album is
    // the other tab, while the screen the native pop revealed is the list.
    location.replaceState(null, '', '/tabs/library');
    outlet.activateWith(routeAt(ScreenA, '/tabs/library'), env);
    outlet.detach();
    location.pushState(null, '', '/tabs/library/7');
    outlet.activateWith(routeAt(ScreenB, '/tabs/library/7'), env);
    location.pushState(null, '', '/tabs/search');
    location.pushState(null, '', '/tabs/library/7');
    await settle();

    await dismiss(1);

    assert.deepEqual(navigated, [{ url: '/tabs/library', extras: { replaceUrl: true } }]);
    assert.equal(
      location.pathname,
      '/tabs/library/7',
      'not back through history to the search tab',
    );
  });

  /** Two screens, /a under /b, with history agreeing. */
  const pushTwo = async () => {
    location.replaceState(null, '', '/a');
    const a = routeAt(ScreenA, '/a');
    outlet.activateWith(a, env);
    showing = [a];
    await settle();
    assert.equal(pressBack(), false, 'nothing to go back to yet');

    outlet.detach();
    location.pushState(null, '', '/b');
    const b = routeAt(ScreenB, '/b');
    outlet.activateWith(b, env);
    showing = [b];
    await settle();
  };

  it('pops the stack on the Android back button, and declines at the bottom', async () => {
    await pushTwo();

    const popped: unknown[] = [];
    location.onPopState((event) => popped.push(event));
    assert.equal(pressBack(), true, 'consumed, because there is a screen below');
    assert.equal(popped.length, 1, 'and it went back through history, so the router follows');
  });

  it('declines the Android back button while the router is showing something else', async () => {
    // A stack in a tab behind the one in front, or under a screen pushed over the tab bar: its
    // screens are all detached, and the stack the user is looking at is somebody else's.
    await pushTwo();
    showing = [];

    assert.equal(pressBack(), false);
    assert.equal(location.pathname, '/b', 'history left alone');
    assert.deepEqual(navigated, []);
  });
});

describe('a named native stack outlet', () => {
  afterEach(() => cleanup());

  it('registers under its name, for routes with that outlet', async () => {
    registerScreenComponents();
    const mod = await compileFixture('fixtures/stack.ts');
    const app = await render(mod['NamedStackHost'] as Type<unknown>, {
      providers: [
        {
          provide: ChildrenOutletContexts,
          useFactory: () => new ChildrenOutletContexts(inject(EnvironmentInjector)),
        },
        { provide: PlatformLocation, useValue: new NativePlatformLocation() },
        { provide: HardwareBack.SOURCE, useValue: { subscribe: () => () => {} } },
        { provide: Router, useValue: { getCurrentNavigation: () => null } },
      ],
    });
    const outlet = (app.instance as { outlet(): Outlet }).outlet();
    const contexts = app.componentRef.injector.get(ChildrenOutletContexts);
    assert.equal(contexts.getContext('list')?.outlet, outlet);
    assert.equal(contexts.getContext('primary')?.outlet ?? null, null, 'not the primary outlet');
    const stack = app.fabric.find('RNSScreenStack');
    assert.equal('name' in stack!.props, false, 'and the name stays off the native view');
  });
});
