/**
 * The native tabs outlet, driven through `RouterOutletContract` directly.
 *
 * A tab bar is not a stack: every tab exists from the first frame, only one is in front, and the
 * ones behind stay mounted. These exercise that, plus the half that has no equivalent in the
 * stack - native holds the selection, so a tap arrives as an event and has to become a
 * navigation rather than a change of local state.
 */
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import {
  EnvironmentInjector,
  ErrorHandler,
  inject,
  type ComponentRef,
  type Type,
} from '@angular/core';
import {
  ActivatedRoute,
  ChildrenOutletContexts,
  NavigationEnd,
  Router,
  type Route,
  type ActivatedRouteSnapshot,
} from '@angular/router';
import { NativeStackReuseStrategy } from '../router/src/native-stack-reuse-strategy.ts';
import { registerScreenComponents } from '../router/src/screens.ts';
import { registerPlatformComponents } from '@ng-native/fabric';
import { markTabRoute } from '../router/src/tab-routes.ts';
import { tabIconProps } from '../router/src/native-tab.ts';
import {
  cleanup,
  fireEvent,
  render,
  settle,
  type FakeFabric,
  type FakeFabricNode,
} from '@ng-native/testing';
import { compileFixture } from './compile.ts';

function flatten(nodes: FakeFabricNode[]): FakeFabricNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

const tabScreens = (fabric: FakeFabric) =>
  flatten(fabric.committed).filter((node) => node.viewName === 'RNSTabsScreenIOS');

const labels = (fabric: FakeFabric) =>
  flatten(fabric.committed)
    .map((node) => node.props['text'])
    .filter((text): text is string => typeof text === 'string');

interface Outlet {
  activateWith(route: ActivatedRoute, injector: EnvironmentInjector): void;
  deactivate(): void;
  detach(): ComponentRef<unknown>;
  attach(ref: ComponentRef<unknown>, route: ActivatedRoute): void;
  readonly tabKeys: string[];
  readonly selectedKey: string | null;
  readonly component: Object | null;
  readonly isActivated: boolean;
  readonly activatedComponentRef: ComponentRef<unknown> | null;
}

describe('native tabs outlet', () => {
  let mod: Record<string, unknown>;
  let fabric: FakeFabric;
  let instance: { outlet(): Outlet };
  let componentRef: ComponentRef<unknown>;
  let outlet: Outlet;
  let env: EnvironmentInjector;
  let navigated: string[];
  /** What the next navigation resolves to: false is a guard saying no. */
  let navigationResult: boolean;
  /** What the next navigation fails with, as a tab whose page throws while it is built does. */
  let navigationError: unknown;
  /** What reached the app's ErrorHandler. */
  let reported: unknown[];
  /** Whether the app asked for `withComponentInputBinding()`, as `Router` reports it. */
  let inputBinding: boolean;
  /** Just enough of `Router.events` for the outlet to follow navigations. */
  let routerEvents: {
    next(event: unknown): void;
    subscribe(listener: (event: unknown) => void): { unsubscribe(): void };
  };
  let library: Route;
  let alternateLibrary: Route;
  let search: Route;

  /** The route the outlet itself lives on: the one whose children are the tabs. */
  function shellRoute(children: Route[]): ActivatedRoute {
    return {
      routeConfig: { path: 'tabs', children },
      snapshot: { pathFromRoot: [{ url: [{ path: 'tabs' }] }] },
    } as unknown as ActivatedRoute;
  }

  const routeFor = (config: Route): ActivatedRoute =>
    ({
      routeConfig: config,
      component: config.component,
      snapshot: { data: {}, routeConfig: config, component: config.component },
    }) as unknown as ActivatedRoute;

  /** The library tab, filled by a page with an input rather than the plain one. */
  const titled = (): Route => {
    library.component = mod['TabTitled'] as Type<unknown>;
    return library;
  };

  /** Enough of the three observables the input binding reads, each emitting once. */
  const withParams = (route: ActivatedRoute, params: Record<string, unknown>): ActivatedRoute => {
    const emits = (value: unknown) => ({
      subscribe: (next: (value: unknown) => void) => (next(value), { unsubscribe: () => {} }),
    });
    return Object.assign(route, { params: emits(params), queryParams: emits({}), data: emits({}) });
  };

  before(async () => {
    registerScreenComponents();
    mod = await compileFixture('fixtures/tabs.ts');
  });

  beforeEach(async () => {
    navigated = [];
    navigationResult = true;
    navigationError = undefined;
    reported = [];
    inputBinding = true;
    const listeners = new Set<(event: unknown) => void>();
    routerEvents = {
      next: (event) => listeners.forEach((listener) => listener(event)),
      subscribe: (listener) => (
        listeners.add(listener),
        { unsubscribe: () => listeners.delete(listener) }
      ),
    };
    // Plain routes: what makes them tabs is a `<native-tab path="...">` in the fixture's
    // template, not anything written here.
    library = { path: 'library', component: mod['TabLibrary'] as Type<unknown> };
    alternateLibrary = { path: 'library', component: mod['TabLibrary'] as Type<unknown> };
    search = { path: 'search', component: mod['TabSearch'] as Type<unknown> };

    const app = await render(mod['TabsHost'] as Type<unknown>, {
      // The two host conversions a real app supplies, so the nested colours and the icon asset
      // can be told apart from what was written in the template.
      processColor: (value) => `processed:${String(value)}`,
      resolveAssetSource: (value) => ({ uri: String(value) }),
      providers: [
        {
          provide: ChildrenOutletContexts,
          useFactory: () => new ChildrenOutletContexts(inject(EnvironmentInjector)),
        },
        { provide: ActivatedRoute, useValue: shellRoute([alternateLibrary, library, search]) },
        {
          provide: Router,
          useValue: {
            url: '/tabs/library',
            get componentInputBindingEnabled() {
              return inputBinding;
            },
            events: routerEvents,
            getCurrentNavigation: () => null,
            navigateByUrl: (url: string) => (
              navigated.push(url),
              navigationError === undefined
                ? Promise.resolve(navigationResult)
                : Promise.reject(navigationError)
            ),
          },
        },
        {
          provide: ErrorHandler,
          useValue: { handleError: (error: unknown) => reported.push(error) },
        },
      ],
    });
    fabric = app.fabric;
    instance = app.instance as { outlet(): Outlet };
    componentRef = app.componentRef;
    outlet = instance.outlet();
    env = componentRef.injector.get(EnvironmentInjector);
  });

  afterEach(() => cleanup());

  it('commits the outlet host as the native tabs host', () => {
    const host = flatten(fabric.committed).find((node) => node.viewName === 'RNSTabsHostIOS');
    assert.ok(host, 'the outlet host is the tabs host itself, not a wrapper');
  });

  it('builds the whole bar from the template, before anything is navigated to', () => {
    assert.deepEqual(outlet.tabKeys, ['library', 'search']);
    const screens = tabScreens(fabric);
    assert.equal(screens.length, 2, 'both tabs exist from the first frame');
    assert.equal(screens[0]?.props['title'], 'Library');
    assert.equal(screens[0]?.props['iconResourceName'], 'books.vertical.fill');
    assert.equal(screens[0]?.props['iconType'], 'sfSymbol');
    assert.equal(screens[0]?.props['badgeValue'], '3', 'and a badge that is a bound signal');
    assert.equal(screens[1]?.props['title'], 'Search');
  });

  it('marks every route variant for a tab path, including the later phone route', () => {
    const strategy = new NativeStackReuseStrategy();
    for (const config of [alternateLibrary, library]) {
      assert.equal(
        strategy.shouldDetach({
          component: config.component,
          routeConfig: config,
          children: [{}],
        } as ActivatedRouteSnapshot),
        true,
        'a matched tab route with children must detach rather than destroy its native screen',
      );
    }
  });

  it('turns an image icon into the props native reads it through', () => {
    const search = tabScreens(fabric)[1]!;
    assert.equal(search.props['iconType'], 'template', 'drawn as a mask and tinted');
    assert.deepEqual(search.props['iconImageSource'], { uri: '42' }, 'the asset was resolved');
    assert.deepEqual(search.props['selectedIconImageSource'], { uri: '43' });
  });

  it('refuses an icon pair native cannot express, rather than dropping half of it', () => {
    // One `iconType` serves both states, so native keeps the unselected icon and says nothing.
    assert.throws(
      () => tabIconProps({ iconType: 'template' }, { iconType: 'sfSymbol' }),
      /same kind/,
    );
    assert.throws(() => tabIconProps({}, { iconType: 'sfSymbol' }), /no icon to select from/);
    assert.doesNotThrow(() => tabIconProps({ iconType: 'sfSymbol' }, {}));
  });

  it('processes the colours nested inside an appearance, which the commit walk cannot see', () => {
    const appearance = tabScreens(fabric)[1]!.props['standardAppearance'] as {
      tabBarBackgroundColor: unknown;
      stacked: {
        selected: { tabBarItemTitleFontColor: unknown; tabBarItemTitleFontWeight: unknown };
      };
    };
    assert.equal(appearance.tabBarBackgroundColor, 'processed:blue');
    assert.equal(appearance.stacked.selected.tabBarItemTitleFontColor, 'processed:red');
    assert.equal(
      appearance.stacked.selected.tabBarItemTitleFontWeight,
      '600',
      'native declares the weight as a string',
    );
  });

  it('tells native a title is present, which is not the default', () => {
    assert.equal(
      tabScreens(fabric)[0]?.props['isTitleUndefined'],
      false,
      'left at its default the item renders a gap where the label belongs',
    );
  });

  it('asks for the first tab before any navigation, because nothing selected is not a state', () => {
    const host = flatten(fabric.committed).find((node) => node.viewName === 'RNSTabsHostIOS');
    assert.deepEqual(host?.props['navStateRequest'], {
      selectedScreenKey: 'library',
      baseProvenance: 0,
    });
  });

  it('creates an activated tab inside its own screen', async () => {
    outlet.activateWith(routeFor(library), env);
    await settle();

    assert.deepEqual(labels(fabric), ['library']);
    assert.equal(outlet.selectedKey, 'library');
    const screen = tabScreens(fabric)[0]!;
    assert.ok(
      flatten([screen]).some((node) => node.props['text'] === 'library'),
      "the tab's component lives in that tab's screen, not the host",
    );
  });

  it('binds route params to a tab component input when the app asked for it', async () => {
    outlet.activateWith(withParams(routeFor(titled()), { title: 'from the route' }), env);
    await settle();
    assert.deepEqual(labels(fabric), ['from the route']);
  });

  it('leaves a tab component input alone when the app did not ask for binding', async () => {
    inputBinding = false;
    const config = titled();
    outlet.activateWith(withParams(routeFor(config), { title: 'from the route' }), env);
    await settle();
    assert.deepEqual(labels(fabric), ['untitled']);

    const ref = outlet.detach();
    outlet.attach(ref, withParams(routeFor(config), { title: 'from the route' }));
    await settle();
    assert.deepEqual(labels(fabric), ['untitled'], 'nor when the tab comes back');
  });

  it('keeps a tab mounted while another is in front', async () => {
    outlet.activateWith(routeFor(library), env);
    await settle();
    const inst = outlet.component;

    // Switching tabs, as the router does it with a detaching reuse strategy.
    const ref = outlet.detach();
    outlet.activateWith(routeFor(search), env);
    await settle();

    assert.deepEqual(labels(fabric).sort(), ['library', 'search'], 'both are still rendered');
    assert.equal(ref.instance, inst, 'and the first tab is the same live component');
    assert.equal(outlet.selectedKey, 'search');
  });

  it('keeps every bar item while route components are deactivated and replaced', async () => {
    outlet.activateWith(routeFor(library), env);
    await settle();

    outlet.deactivate();
    outlet.activateWith(routeFor(search), env);
    outlet.deactivate();
    outlet.activateWith(routeFor(library), env);
    await settle();

    assert.equal(tabScreens(fabric).length, 2);
    assert.equal(outlet.selectedKey, 'library');
    assert.deepEqual(
      tabScreens(fabric).map((screen) => screen.props['title']),
      ['Library', 'Search'],
    );
  });

  it('puts a re-attached tab back in its own screen', async () => {
    outlet.activateWith(routeFor(library), env);
    const ref = outlet.detach();
    outlet.activateWith(routeFor(search), env);
    await settle();

    outlet.detach();
    outlet.attach(ref, routeFor(library));
    await settle();

    assert.equal(outlet.selectedKey, 'library');
    assert.equal(tabScreens(fabric).length, 2, 'no screen was rebuilt');
    assert.deepEqual(labels(fabric).sort(), ['library', 'search']);
  });

  it('navigates when native reports a tap, rather than switching on its own', async () => {
    outlet.activateWith(routeFor(library), env);
    await settle();

    const host = flatten(fabric.committed).find((node) => node.viewName === 'RNSTabsHostIOS')!;
    await fireEvent(host, 'tabSelected', { selectedScreenKey: 'search', provenance: 1 });

    assert.deepEqual(navigated, ['/tabs/search'], 'a tap becomes a navigation, not local state');
  });

  it('returns a tab to the url it was last on', async () => {
    const router = componentRef.injector.get(Router) as unknown as { url: string };
    const host = flatten(fabric.committed).find((node) => node.viewName === 'RNSTabsHostIOS')!;

    outlet.activateWith(routeFor(library), env);
    await settle();

    // Tapping search navigates, and the navigation is what activates the tab.
    await fireEvent(host, 'tabSelected', { selectedScreenKey: 'search', provenance: 1 });
    outlet.detach();
    router.url = '/tabs/search';
    outlet.activateWith(routeFor(search), env);
    // The search tab goes somewhere while it is in front.
    router.url = '/tabs/search/9';
    outlet.activateWith(routeFor(search), env);
    await settle();

    await fireEvent(host, 'tabSelected', { selectedScreenKey: 'library', provenance: 2 });
    assert.equal(navigated.at(-1), '/tabs/library', 'the library tab was left at its root');
    outlet.detach();
    router.url = '/tabs/library';
    outlet.activateWith(routeFor(library), env);
    await settle();

    navigated.length = 0;
    await fireEvent(host, 'tabSelected', { selectedScreenKey: 'search', provenance: 3 });
    assert.deepEqual(navigated, ['/tabs/search/9'], 'back to where the user left it');
  });

  it('returns a tab to a screen pushed inside its own stack', async () => {
    const router = componentRef.injector.get(Router) as unknown as { url: string };
    const host = flatten(fabric.committed).find((node) => node.viewName === 'RNSTabsHostIOS')!;

    outlet.activateWith(routeFor(library), env);
    await settle();
    // A push inside the tab's own stack reuses the tab's route, so this outlet is never
    // activated for it. The router's navigation is all it hears.
    router.url = '/tabs/library/7';
    routerEvents.next(new NavigationEnd(1, '/tabs/library/7', '/tabs/library/7'));

    await fireEvent(host, 'tabSelected', { selectedScreenKey: 'search', provenance: 1 });
    outlet.detach();
    router.url = '/tabs/search';
    outlet.activateWith(routeFor(search), env);
    routerEvents.next(new NavigationEnd(2, '/tabs/search', '/tabs/search'));
    await settle();

    navigated.length = 0;
    await fireEvent(host, 'tabSelected', { selectedScreenKey: 'library', provenance: 2 });
    assert.deepEqual(navigated, ['/tabs/library/7'], 'back to the pushed screen, not the root');
  });

  it('puts native back on the tab in front when a guard refuses the tap', async () => {
    outlet.activateWith(routeFor(library), env);
    await settle();

    const host = () =>
      flatten(fabric.committed).find((node) => node.viewName === 'RNSTabsHostIOS')!;
    navigationResult = false;
    await fireEvent(host(), 'tabSelected', { selectedScreenKey: 'search', provenance: 4 });
    // Outside change detection, so it reaches native on the next frame rather than this tick.
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.deepEqual(navigated, ['/tabs/search']);
    assert.equal(outlet.selectedKey, 'library', 'the router never left the library');
    assert.deepEqual(
      host().props['navStateRequest'],
      { selectedScreenKey: 'library', baseProvenance: 4 },
      'native already switched, so it has to be asked back or the bar shows a tab nobody is on',
    );
  });

  it('reports a tap whose navigation fails, and puts native back on the tab in front', async () => {
    outlet.activateWith(routeFor(library), env);
    await settle();

    const host = () =>
      flatten(fabric.committed).find((node) => node.viewName === 'RNSTabsHostIOS')!;
    navigationError = new Error('the search page threw while it was built');
    await fireEvent(host(), 'tabSelected', { selectedScreenKey: 'search', provenance: 4 });
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.deepEqual(reported, [navigationError], 'a tab that will not open says why');
    assert.equal(outlet.selectedKey, 'library');
    assert.deepEqual(host().props['navStateRequest'], {
      selectedScreenKey: 'library',
      baseProvenance: 4,
    });
  });

  it('reports a page that throws while it is built once, not again when the navigation fails', async () => {
    outlet.activateWith(routeFor(library), env);
    await settle();

    let thrown: unknown;
    try {
      outlet.activateWith(
        routeFor({ path: 'search', component: mod['TabBroken'] as Type<unknown> }),
        env,
      );
    } catch (error) {
      thrown = error;
    }
    assert.ok(thrown instanceof Error);
    // The router fails the navigation with what activation threw, and the tap sees that failure.
    navigationError = thrown;
    const host = flatten(fabric.committed).find((node) => node.viewName === 'RNSTabsHostIOS')!;
    await fireEvent(host, 'tabSelected', { selectedScreenKey: 'search', provenance: 4 });
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.deepEqual(reported, [thrown]);
  });

  it('carries the provenance it last acknowledged, so native can spot a stale request', async () => {
    const host = flatten(fabric.committed).find((node) => node.viewName === 'RNSTabsHostIOS')!;
    await fireEvent(host, 'tabSelected', { selectedScreenKey: 'search', provenance: 7 });

    outlet.activateWith(routeFor(search), env);
    await settle();

    const request = flatten(fabric.committed).find((node) => node.viewName === 'RNSTabsHostIOS')
      ?.props['navStateRequest'] as { baseProvenance: number };
    assert.equal(request.baseProvenance, 7);
  });

  it('is not activated once its tab is detached, nor after it is deactivated', async () => {
    outlet.activateWith(routeFor(library), env);
    await settle();
    outlet.detach();
    assert.equal(outlet.isActivated, false, 'detached, which is the router putting it away');
    assert.equal(outlet.component, null);

    outlet.attach(outlet.activatedComponentRef!, routeFor(library));
    outlet.deactivate();
    assert.equal(outlet.isActivated, false);
    assert.equal(outlet.activatedComponentRef, null, 'nothing left to reattach');
  });

  it('binds a reattached tab to the route it comes back on', async () => {
    outlet.activateWith(withParams(routeFor(titled()), { title: 'first' }), env);
    await settle();
    const ref = outlet.detach();
    outlet.attach(ref, withParams(routeFor(library), { title: 'second' }));
    await settle();
    assert.deepEqual(labels(fabric), ['second']);
  });

  it('puts the tab in front back when the next one fails to be created', async () => {
    outlet.activateWith(routeFor(library), env);
    await settle();
    outlet.detach();
    class NotAComponent {}
    const original = console.error;
    console.error = () => {};
    try {
      assert.throws(() =>
        outlet.activateWith(routeFor({ path: 'search', component: NotAComponent }), env),
      );
    } finally {
      console.error = original;
    }
    assert.equal(outlet.isActivated, true, 'the library tab is live again');
  });

  it('does nothing when native reports the tab already in front', async () => {
    outlet.activateWith(routeFor(library), env);
    await settle();
    const host = flatten(fabric.committed).find((node) => node.viewName === 'RNSTabsHostIOS')!;
    await fireEvent(host, 'tabSelected', { selectedScreenKey: 'library', provenance: 1 });
    assert.deepEqual(navigated, []);
  });

  it('remembers a url inside its own tab, and not one that only starts with its path', async () => {
    const router = componentRef.injector.get(Router) as unknown as { url: string };
    const host = flatten(fabric.committed).find((node) => node.viewName === 'RNSTabsHostIOS')!;
    outlet.activateWith(routeFor(library), env);
    await settle();
    routerEvents.next(new NavigationEnd(1, '/tabs/library-archive', '/tabs/library-archive'));

    await fireEvent(host, 'tabSelected', { selectedScreenKey: 'search', provenance: 1 });
    outlet.detach();
    router.url = '/tabs/search';
    outlet.activateWith(routeFor(search), env);
    await settle();

    navigated.length = 0;
    await fireEvent(host, 'tabSelected', { selectedScreenKey: 'library', provenance: 2 });
    assert.deepEqual(navigated, ['/tabs/library']);
  });

  it('asks native back to the tab in front when the navigation fails outright', async () => {
    outlet.activateWith(routeFor(library), env);
    await settle();
    const router = componentRef.injector.get(Router) as unknown as {
      navigateByUrl(url: string): Promise<boolean>;
    };
    router.navigateByUrl = () => Promise.reject(new Error('offline'));
    const host = () =>
      flatten(fabric.committed).find((node) => node.viewName === 'RNSTabsHostIOS')!;
    await fireEvent(host(), 'tabSelected', { selectedScreenKey: 'search', provenance: 5 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(host().props['navStateRequest'], {
      selectedScreenKey: 'library',
      baseProvenance: 5,
    });
  });

  it('leaves native alone while another navigation is still running', async () => {
    outlet.activateWith(routeFor(library), env);
    await settle();
    const router = componentRef.injector.get(Router) as unknown as {
      getCurrentNavigation(): unknown;
    };
    router.getCurrentNavigation = () => ({ id: 2 });
    navigationResult = false;
    const host = () =>
      flatten(fabric.committed).find((node) => node.viewName === 'RNSTabsHostIOS')!;
    await fireEvent(host(), 'tabSelected', { selectedScreenKey: 'search', provenance: 6 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(
      host().props['navStateRequest'],
      { selectedScreenKey: 'library', baseProvenance: 0 },
      'the running navigation decides where the bar ends up',
    );
  });

  it('builds a tab path with no double slash when the outlet sits at the root', async () => {
    const shell = componentRef.injector.get(ActivatedRoute) as unknown as {
      snapshot: { pathFromRoot: unknown[] };
    };
    shell.snapshot.pathFromRoot = [{ url: [] }];
    outlet.activateWith(routeFor(library), env);
    await settle();
    const host = flatten(fabric.committed).find((node) => node.viewName === 'RNSTabsHostIOS')!;
    await fireEvent(host, 'tabSelected', { selectedScreenKey: 'search', provenance: 1 });
    assert.deepEqual(navigated, ['/search']);
  });
});

describe('the reuse strategy and tabs', () => {
  const strategy = new NativeStackReuseStrategy();
  const snapshot = (config: Route, children: unknown[]): ActivatedRouteSnapshot =>
    ({
      component: config.component ?? null,
      routeConfig: config,
      children,
    }) as ActivatedRouteSnapshot;

  it('detaches a tab even though it has children, so its stack survives a switch', () => {
    const tab = { path: 'library', component: class {} };
    assert.equal(strategy.shouldDetach(snapshot(tab, [{}])), false, 'not a tab until marked');

    // The outlet marks the config it matched a `<native-tab>` to, because the strategy is handed
    // routes and tabs are declared in a template.
    markTabRoute(tab);
    assert.equal(strategy.shouldDetach(snapshot(tab, [{}])), true);
  });

  it('still leaves a parent that is only layout alone', () => {
    const shell = { path: 'tabs', component: class {} };
    assert.equal(strategy.shouldDetach(snapshot(shell, [{}])), false);
  });
});

describe('tabs and a header written the less usual ways', () => {
  let mod: Record<string, unknown>;

  before(async () => {
    registerScreenComponents();
    mod = await compileFixture('fixtures/tab-variants.ts');
  });

  afterEach(() => cleanup());

  async function show(name: string) {
    const outletRoute = {
      routeConfig: { path: 'tabs', children: [] },
      snapshot: { pathFromRoot: [{ url: [{ path: 'tabs' }] }] },
    } as unknown as ActivatedRoute;
    const app = await render(mod[name] as Type<unknown>, {
      processColor: (value) => `processed:${String(value)}`,
      resolveAssetSource: (value) => ({ uri: String(value) }),
      providers: [
        {
          provide: ChildrenOutletContexts,
          useFactory: () => new ChildrenOutletContexts(inject(EnvironmentInjector)),
        },
        { provide: ActivatedRoute, useValue: outletRoute },
        {
          provide: Router,
          useValue: {
            url: '/tabs',
            componentInputBindingEnabled: false,
            events: { subscribe: () => ({ unsubscribe: () => {} }) },
            getCurrentNavigation: () => null,
            navigateByUrl: () => Promise.resolve(true),
          },
        },
      ],
    });
    return app.fabric;
  }

  it('tells native an untitled tab has no title, and names an asset-catalogue icon as one', async () => {
    const [untitled] = tabScreens(await show('TabVariants'));
    assert.equal(untitled!.props['isTitleUndefined'], true);
    assert.equal(untitled!.props['iconType'], 'xcasset');
    assert.equal(untitled!.props['iconResourceName'], 'Inbox');
  });

  it('prefers the icon input over the sfSymbol shorthand when both are given', async () => {
    const [, both] = tabScreens(await show('TabVariants'));
    assert.equal(both!.props['iconResourceName'], 'heart');
  });

  it('draws the SF Symbol of a tab that names a drawable for Android as well', async () => {
    const [, , , shared] = tabScreens(await show('TabVariants'));
    assert.equal(shared!.props['iconType'], 'sfSymbol');
    assert.equal(shared!.props['iconResourceName'], 'person.2');
  });

  describe('a tab with an icon for one platform only', () => {
    const warnings = async (run: () => Promise<unknown>) => {
      const seen: string[] = [];
      const warn = console.warn;
      console.warn = (message: unknown) => void seen.push(String(message));
      try {
        await run();
      } finally {
        console.warn = warn;
      }
      return seen;
    };

    it('warns on iOS for a drawable-only tab, naming its path, once, and not for its own icon', async () => {
      const seen = await warnings(async () => {
        await show('TabOnePlatform');
        cleanup();
        await show('TabOnePlatform');
      });
      assert.equal(seen.length, 1, seen.join('\n'));
      assert.match(seen[0]!, /path="files".*no icon on iOS.*sfSymbol/);
    });

    it('is quiet for a tab with both, or with an icon of its own', async () => {
      assert.deepEqual(await warnings(() => show('TabVariants')), []);
    });

    describe('on Android', () => {
      before(() => {
        registerPlatformComponents('android');
        registerScreenComponents();
      });
      after(() => {
        registerPlatformComponents('ios');
        registerScreenComponents();
      });

      it('warns for an sfSymbol-only tab, and not for a drawable-only one', async () => {
        const seen = await warnings(() => show('TabOnePlatform'));
        assert.equal(seen.length, 1, seen.join('\n'));
        assert.match(seen[0]!, /path="people".*no icon on Android.*drawable/);
      });

      it('is quiet for a tab with both, or with an icon of its own', async () => {
        assert.deepEqual(await warnings(() => show('TabVariants')), []);
      });
    });
  });

  it("processes an icon colour inside an appearance's item states", async () => {
    const [, , image] = tabScreens(await show('TabVariants'));
    const appearance = image!.props['standardAppearance'] as {
      stacked: { normal: { tabBarItemIconColor: unknown } };
    };
    assert.equal(appearance.stacked.normal.tabBarItemIconColor, 'processed:grey');
  });

  describe('on Android', () => {
    before(() => {
      registerPlatformComponents('android');
      registerScreenComponents();
    });
    after(() => {
      registerPlatformComponents('ios');
      registerScreenComponents();
    });

    it("commits Android's tab views, with an image icon as the resource Android reads", async () => {
      const fabric = await show('TabVariants');
      assert.ok(flatten(fabric.committed).some((node) => node.viewName === 'RNSTabsHostAndroid'));
      const [, , image] = flatten(fabric.committed).filter(
        (node) => node.viewName === 'RNSTabsScreenAndroid',
      );
      assert.deepEqual(image!.props['imageIconResource'], { uri: '7' });
    });

    it('draws the drawable of a tab that names an SF Symbol for iOS as well', async () => {
      const [, , , shared] = flatten((await show('TabVariants')).committed).filter(
        (node) => node.viewName === 'RNSTabsScreenAndroid',
      );
      assert.equal(shared!.props['drawableIconResourceName'], 'ic_people');
    });

    it('lets a header take the top inset by default, as Android lays it out', async () => {
      const fabric = await show('HeaderAlone');
      const header = flatten(fabric.committed).find(
        (node) => node.viewName === 'RNSScreenStackHeaderConfig',
      );
      assert.equal(header?.props['consumeTopInset'], true);
    });
  });
});
