/**
 * Several windows from one Angular app: desktop windows on macOS and scenes on iPadOS.
 *
 * Every window is a root view on its own native surface, joined to the one app: root services, the
 * one Router and one change detection are shared, and each window has an element injector that
 * provides `CURRENT_WINDOW`. A route window renders a named outlet of the app's Router, which
 * `WINDOW_NAVIGATOR` navigates; a component window renders a component with its inputs.
 * `@ng-native/platform` mounts each through `WINDOW_MOUNTER`.
 *
 * On iPhone and Android `available()` is false and `open` resolves to null, as an inert call does.
 *
 * The host contract is `NativeWindows`, below: the host opens and closes surfaces when asked, and
 * reports what the user does to them. The rules (guards, the last window, a Dock reopen, quitting)
 * are here, so every OS that has windows follows the same ones.
 */
import {
  InjectionToken,
  Service,
  computed,
  inject,
  makeEnvironmentProviders,
  signal,
  type Binding,
  type EnvironmentProviders,
  type Provider,
  type Signal,
  type Type,
} from '@angular/core';
import { AppLifecycle } from './app-lifecycle.ts';
import { reactNative } from './react-native.ts';
import { WINDOW_NAVIGATOR } from './window-navigator.ts';
import { RESTORABLE_WINDOWS, WINDOW_RESTORE_STORE, type RestoredWindow } from './window-restore.ts';

export type TitleBar = 'default' | 'transparent' | 'hidden';

/** How a window opens. Sizes are in points; each left out is the host's default. */
export interface WindowOptions {
  readonly title?: string;
  readonly width?: number;
  readonly height?: number;
  readonly minWidth?: number;
  readonly minHeight?: number;
  readonly maxWidth?: number;
  readonly maxHeight?: number;
  readonly resizable?: boolean;
  /** `transparent` draws content under the title bar; `hidden` also hides the title. */
  readonly titleBar?: TitleBar;
  readonly fullScreen?: boolean;
  /**
   * Whether the window's frame is saved and restored on the next launch. On by default, keyed by
   * the route outlet, the `restoreKey`, or `main`; a component window without a `restoreKey` has
   * no key and is not saved.
   */
  readonly autosave?: boolean;
}

/** A window rendering a component. */
export interface ComponentWindowOptions extends WindowOptions {
  /** Set on the component before its first change detection. */
  readonly inputs?: Readonly<Record<string, unknown>>;
  /**
   * What the window is restored by, after a reload or a relaunch: on macOS it opens again with
   * the same `inputs`, which must then survive `JSON.stringify`, where `provideRestorableWindows`
   * names its component. Without one, a reload closes the window. One key is one window: opening
   * a key that is open brings that window to the front.
   */
  readonly restoreKey?: string;
}

/** A window rendering the named outlet `outlet` of the app's Router, at `path`. */
export interface RouteWindowOptions extends WindowOptions {
  readonly outlet: string;
  readonly path: string;
}

/** The main window's options, as `provideMainWindow` takes them. */
export interface MainWindowOptions extends WindowOptions {
  /**
   * Whether the main window opens at launch. True by default; false for an app that lives in the
   * menu bar or the tray, which opens it with `AppWindows.openMain()`.
   */
  readonly autoOpen?: boolean;
}

/** One open window. */
export interface AppWindow {
  /** The surface the window renders on. */
  readonly surface: number;
  /** `main`, the outlet's name for a route window, or the `restoreKey`; null otherwise. */
  readonly key: string | null;
  readonly title: Signal<string>;
  setTitle(title: string): void;
  /** Whether it is the key window. */
  readonly focused: Signal<boolean>;
  focus(): void;
  /** Close it, as the user would: every `canClose` guard is asked first. Resolves whether it closed. */
  close(): Promise<boolean>;
  /**
   * Ask `guard` before the window closes, by the user or by `close()`, and before the app quits.
   * Answers the function that removes it; a component removes its guard as it is destroyed.
   */
  canClose(guard: CloseGuard): () => void;
  /** Settles when the window has closed. */
  readonly closed: Promise<void>;
}

export type CloseGuard = () => boolean | Promise<boolean>;

/**
 * What the host is asked to open. `key` is what the frame autosaves under, or null for none.
 */
export interface NativeWindowRequest extends Omit<WindowOptions, 'title' | 'autosave'> {
  readonly key: string | null;
  readonly title: string;
}

/**
 * What the host tells the app. The host never closes a window or quits on its own: it sends
 * `closeRequest` for the close button and Cmd-W, and `quitRequest` for Cmd-Q, a logout or an
 * update's relaunch, and waits for `close` or `answerQuit`. `closed` reports a window the OS
 * closed itself (an iPadOS scene swiped away), which no guard can keep.
 */
export type NativeWindowEvent =
  | { readonly type: 'focus'; readonly surface: number | null }
  | {
      readonly type: 'resize';
      readonly surface: number;
      readonly width: number;
      readonly height: number;
      readonly scale?: number;
    }
  | { readonly type: 'closeRequest'; readonly surface: number }
  | { readonly type: 'closed'; readonly surface: number }
  /**
   * Cmd-Q, a logout or an update's relaunch. `terminate` is a SIGTERM: run only the `willQuit`
   * handlers, ask no `canClose` guard, and answer true. The host ends after two seconds anyway.
   */
  | { readonly type: 'quitRequest'; readonly terminate?: boolean }
  /** A Dock click, or the app opened again, with no window visible. */
  | { readonly type: 'reopen' };

/**
 * The host's windows: the desktop host on macOS, and on iPadOS the components pod, whose windows
 * are scenes. iPadOS asks no app before it closes a scene, so it sends `closed` and never
 * `closeRequest`, and it has no quitting, so never `quitRequest`. The module is
 * `NgNativeWindows`, whose constant `multipleWindows` says whether the OS has windows at all,
 * and whose events arrive as `ngNativeWindows` on `DeviceEventEmitter`.
 */
export interface NativeWindows {
  /**
   * Open a window with its own surface, shown when the surface's first frame commits so it never
   * shows at the wrong size. Resolves the surface's id, or null where the host would not.
   */
  open(request: NativeWindowRequest): Promise<number | null>;
  /** Close the window on `surface` and stop its surface. */
  close(surface: number): void;
  focus(surface: number): void;
  setTitle(surface: number, title: string): void;
  /** Start quitting, as Cmd-Q does: the host answers with a `quitRequest`. */
  quit(): void;
  /** Answer a `quitRequest`: true quits, after which the host tears the runtime down in order. */
  answerQuit(proceed: boolean): void;
  subscribe(listener: (event: NativeWindowEvent) => void): () => void;
}

interface WindowsTurboModule {
  getConstants?(): { multipleWindows?: boolean };
  open?(request: NativeWindowRequest): Promise<number | null>;
  close?(surface: number): void;
  focus?(surface: number): void;
  setTitle?(surface: number, title: string): void;
  quit?(): void;
  answerQuit?(proceed: boolean): void;
}

/**
 * The runnable each window's surface runs on an iPad, where the host makes the surface through
 * React Native's own host: it renders nothing, as the window's root is mounted from the app.
 */
const WINDOW_RUNNABLE = 'NgNativeWindow';

/**
 * The host's module, or null where the OS has one window: phones, Android, Expo Go, an older
 * host. Registers the windows' runnable where there is one.
 */
export function windowsSource(): NativeWindows | null {
  const native = reactNative();
  const module = native?.TurboModuleRegistry?.get?.('NgNativeWindows') as
    WindowsTurboModule | null | undefined;
  if (!module?.getConstants?.().multipleWindows) return null;
  native?.AppRegistry?.registerRunnable(WINDOW_RUNNABLE, () => {});
  return {
    open: async (request) => (await module.open?.(request)) ?? null,
    close: (surface) => module.close?.(surface),
    focus: (surface) => module.focus?.(surface),
    setTitle: (surface, title) => module.setTitle?.(surface, title),
    quit: () => module.quit?.(),
    answerQuit: (proceed) => module.answerQuit?.(proceed),
    subscribe: (listener) => {
      const subscription = native?.DeviceEventEmitter?.addListener('ngNativeWindows', (event) =>
        listener(event as NativeWindowEvent),
      );
      return () => subscription?.remove();
    },
  };
}

/** One window's mount, as `WINDOW_MOUNTER` answers it. */
export interface WindowMount {
  /** Tell the window's engine its new size, which its media queries resolve against. */
  resize(size: { width: number; height: number; scale?: number }): void;
  /** Destroy what the window renders, and stop its engine taking events. */
  destroy(): void;
}

/**
 * How a window's root is rendered on its surface. `@ng-native/platform` provides it: the
 * component is created in the app's environment injector, under an element injector with the
 * window's renderer, engine and `providers` (which hold `CURRENT_WINDOW`), and attached to the
 * app's one change detection. `main` is the app's root component, which the app's bootstrap
 * listeners (the Router's initial navigation) are told of the first time it mounts.
 */
export interface WindowMounter {
  mount(
    surface: number,
    component: Type<unknown>,
    options: {
      readonly inputs?: Readonly<Record<string, unknown>>;
      /** The main window's: what `mount` was given for the root component. */
      readonly bindings?: Binding[];
      readonly providers: Provider[];
      readonly main?: boolean;
    },
  ): WindowMount;
}

/** The platform's `WindowMounter`, or null where nothing can mount a window: a test with none. */
export const WINDOW_MOUNTER = new InjectionToken<WindowMounter | null>(
  'angular-native.windowMounter',
  { factory: () => null },
);

/** The window a component is rendered in, or null outside one: every app with one surface. */
export const CURRENT_WINDOW = new InjectionToken<AppWindow | null>('angular-native.currentWindow', {
  factory: () => null,
});

/** What `provideMainWindow` was given. */
export const MAIN_WINDOW_OPTIONS = new InjectionToken<MainWindowOptions>(
  'angular-native.mainWindowOptions',
  { factory: () => ({}) },
);

/**
 * Configure the main window, which renders the app's root component: its size and title bar, and
 * with `autoOpen: false` that the app starts with no window. Where the OS has one window, only
 * `autoOpen` is read, and it is ignored there: the app's one surface is its window.
 */
export function provideMainWindow(options: MainWindowOptions): EnvironmentProviders {
  return makeEnvironmentProviders([{ provide: MAIN_WINDOW_OPTIONS, useValue: options }]);
}

/** An open window and what it needs to close. */
interface Open {
  readonly handle: AppWindow;
  /** How it opens again after a reload, or null where it does not. */
  restore: RestoredWindow | null;
  readonly guards: Set<CloseGuard>;
  readonly outlet: string | null;
  readonly closedNow: () => void;
  mount: WindowMount | null;
  closing: boolean;
}

@Service()
export class AppWindows {
  /** Overridden in a test with a fake host. */
  static readonly SOURCE = new InjectionToken<NativeWindows | null>(
    'angular-native.windowsSource',
    { factory: windowsSource },
  );

  private readonly native = inject(AppWindows.SOURCE);
  private readonly mounter = inject(WINDOW_MOUNTER);
  private readonly navigator = inject(WINDOW_NAVIGATOR);
  private readonly lifecycle = inject(AppLifecycle);
  private readonly mainOptions = inject(MAIN_WINDOW_OPTIONS);
  private readonly store = inject(WINDOW_RESTORE_STORE);
  private readonly restorable = new Map(
    (inject(RESTORABLE_WINDOWS, { optional: true }) ?? []).flatMap((components) =>
      Object.entries(components),
    ),
  );

  /**
   * Whether the OS has windows the app can open: macOS, and iPadOS with the components pod and the
   * config plugin's `ios.multipleWindows`.
   */
  readonly available: Signal<boolean> = signal(this.native !== null).asReadonly();

  private readonly open$ = signal<readonly Open[]>([]);
  private readonly focusedSurface = signal<number | null>(null);

  /** Every open window, in the order they opened. */
  readonly windows: Signal<readonly AppWindow[]> = computed(() =>
    this.open$().map((open) => open.handle),
  );

  /** The key window, or null when none is: the app is in the background, or has no window. */
  readonly focused: Signal<AppWindow | null> = computed(
    () => this.windows().find((one) => one.surface === this.focusedSurface()) ?? null,
  );

  private main: {
    component: Type<unknown>;
    inputs?: Readonly<Record<string, unknown>>;
    bindings?: Binding[];
  } | null = null;

  /** The open in flight for each key, so a second open of the key waits for it. */
  private readonly opening = new Map<string, Promise<unknown>>();

  /**
   * The quit being decided or finished: `finishing` is set once its `willQuit` handlers run, by its
   * guards agreeing or by a SIGTERM that arrived while they decided.
   */
  private quitting: { finishing: Promise<void> | null } | null = null;

  private readonly unsubscribe = this.native?.subscribe((event) => this.hostSaid(event)) ?? null;

  /**
   * Start the app on an OS with windows: `component` is the app's root, which the main window
   * renders, and which opens now unless `provideMainWindow({ autoOpen: false })`. What
   * `@ng-native/platform`'s `mount` calls in place of rendering the root on the app's surface,
   * with the `inputs` and `bindings` it was given for the root.
   */
  launch(
    component: Type<unknown>,
    inputs?: Readonly<Record<string, unknown>>,
    bindings?: Binding[],
  ): void {
    this.main = { component, ...(inputs && { inputs }), ...(bindings && { bindings }) };
    const restoring = this.store?.read() ?? [];
    const autoOpen = this.mainOptions.autoOpen !== false;
    if (autoOpen) void this.openMain();
    // The main window opens anyway where it opens by itself.
    void this.reopen(restoring.filter((window) => !autoOpen || window.kind !== 'main'));
  }

  /**
   * Open again the windows the app had open when it last stopped: the host keeps them through a
   * reload until their keys are opened again, and closes them otherwise.
   */
  private async reopen(windows: readonly RestoredWindow[]): Promise<void> {
    for (const window of windows) {
      try {
        if (window.kind === 'main') {
          await this.openMain();
        } else if (window.kind === 'route') {
          await this.open({ ...window.options, outlet: window.outlet, path: window.path });
        } else {
          const component = this.restorable.get(window.component);
          if (!component) continue;
          await this.open(component, {
            ...window.options,
            restoreKey: window.key,
            ...(window.inputs && { inputs: window.inputs }),
          });
        }
      } catch (error) {
        console.error('[angular-native] A window could not open again after a reload:', error);
      }
    }
  }

  /** Write down which windows open again, in the order they opened. */
  private remember(): void {
    this.store?.write(this.open$().flatMap((open) => (open.restore ? [open.restore] : [])));
  }

  /** How a component window opens again, or null where it cannot: no name, or inputs JSON drops. */
  private restoreFor(
    component: Type<unknown>,
    key: string,
    inputs: Readonly<Record<string, unknown>> | undefined,
    options: WindowOptions,
  ): RestoredWindow | null {
    const name = [...this.restorable].find(([, one]) => one === component)?.[0];
    if (name === undefined) {
      console.warn(
        `[angular-native] The window '${key}' will not open again after a reload: name its ` +
          'component with provideRestorableWindows({ ... }).',
      );
      return null;
    }
    let copied: Readonly<Record<string, unknown>> | undefined;
    try {
      copied = inputs && (JSON.parse(JSON.stringify(inputs)) as Record<string, unknown>);
    } catch {
      console.warn(
        `[angular-native] The window '${key}' will not open again after a reload: its inputs ` +
          'cannot be written as JSON.',
      );
      return null;
    }
    return { kind: 'component', key, component: name, ...(copied && { inputs: copied }), options };
  }

  /**
   * Open the main window, or bring it to the front where it is open. Null where the OS has no
   * windows, or before the app has launched.
   */
  openMain(): Promise<AppWindow | null> {
    return this.reserve('main', async () => {
      const existing = this.byKey('main');
      if (existing) return this.front(existing);
      if (!this.main) return null;
      const { autoOpen: _autoOpen, ...options } = this.mainOptions;
      return this.openWindow(this.main.component, {
        ...options,
        key: 'main',
        inputs: this.main.inputs,
        ...(this.main.bindings && { bindings: this.main.bindings }),
        main: true,
        restore: () => ({ kind: 'main' }),
      });
    });
  }

  /**
   * Run `opening` once every open of `key` already in flight has settled, so that it finds the
   * window they opened rather than opening a second one for the key.
   */
  private async reserve<T>(key: string, opening: () => Promise<T>): Promise<T> {
    for (let pending = this.opening.get(key); pending; pending = this.opening.get(key)) {
      await pending.catch(() => undefined);
    }
    const running = opening();
    this.opening.set(key, running);
    try {
      return await running;
    } finally {
      if (this.opening.get(key) === running) this.opening.delete(key);
    }
  }

  /**
   * Open a window. With a component, a window rendering it, as many as are asked for. With a
   * route, the window for that outlet, navigated to `path`; the outlet's window is brought to the
   * front and navigated where it is open already, since a route window is one of a kind
   * (Preferences). Resolves null where the OS has no windows, or the host would not open one.
   */
  open(component: Type<unknown>, options?: ComponentWindowOptions): Promise<AppWindow | null>;
  open(route: RouteWindowOptions): Promise<AppWindow | null>;
  async open(
    target: Type<unknown> | RouteWindowOptions,
    options: ComponentWindowOptions = {},
  ): Promise<AppWindow | null> {
    if (typeof target === 'function') {
      const { inputs, restoreKey, ...rest } = options;
      const opening = () =>
        this.openWindow(target, {
          ...rest,
          key: restoreKey ?? null,
          ...(inputs && { inputs }),
          restore: () =>
            restoreKey === undefined ? null : this.restoreFor(target, restoreKey, inputs, rest),
        });
      if (restoreKey === undefined) return opening();
      return this.reserve(restoreKey, async () => {
        const existing = this.byKey(restoreKey);
        return existing ? this.front(existing) : opening();
      });
    }
    const { outlet, path, ...rest } = target;
    const navigator = this.navigator;
    if (!navigator) {
      console.error(
        `[angular-native] A route window for '${outlet}' needs the native router: ` +
          'provideNativeRouter() provides what navigates its outlet.',
      );
      return null;
    }
    const restore: RestoredWindow = { kind: 'route', outlet, path, options: rest };
    return this.reserve(outlet, async () => {
      const existing = this.byKey(outlet);
      if (existing) {
        await navigator.navigate(outlet, path);
        const open = this.find(existing.surface);
        if (open) open.restore = restore;
        this.remember();
        return this.front(existing);
      }
      const window = navigator.window(outlet);
      const opened = await this.openWindow(window.component, {
        ...rest,
        key: outlet,
        outlet,
        providers: window.providers,
        restore: () => restore,
      });
      if (opened) await navigator.navigate(outlet, path);
      return opened;
    });
  }

  /**
   * Start quitting the app, as Cmd-Q does: every window's `canClose` guard, then the `willQuit`
   * handlers, then the app quits. One guard that says no keeps the app running. Does nothing where
   * the OS has no windows, since iOS and Android end an app themselves.
   */
  quit(): void {
    this.native?.quit();
  }

  private async openWindow(
    component: Type<unknown>,
    options: WindowOptions & {
      key: string | null;
      inputs?: Readonly<Record<string, unknown>> | undefined;
      bindings?: Binding[];
      outlet?: string;
      providers?: Provider[];
      main?: boolean;
      /** How the window opens again after a reload, worked out once it has opened. */
      restore?: () => RestoredWindow | null;
    },
  ): Promise<AppWindow | null> {
    const native = this.native;
    const mounter = this.mounter;
    if (!native || !mounter) return null;
    const {
      key,
      inputs,
      bindings,
      outlet,
      providers,
      main,
      autosave,
      title = '',
      restore,
      ...frame
    } = options;
    const surface = await native.open({
      ...frame,
      key: autosave === false ? null : key,
      title,
    });
    if (surface === null) return null;
    const open = this.track(surface, key, outlet ?? null, title);
    open.restore = restore?.() ?? null;
    this.remember();
    this.mountIn(open, mounter, component, { inputs, bindings, providers, main });
    return open.handle;
  }

  /**
   * Render `component` in the window. Where it throws, the mounter has taken down what it made,
   * and the window goes too, forgotten for a reload, before the error goes on.
   */
  private mountIn(
    open: Open,
    mounter: WindowMounter,
    component: Type<unknown>,
    options: {
      inputs?: Readonly<Record<string, unknown>> | undefined;
      bindings?: Binding[] | undefined;
      providers?: Provider[] | undefined;
      main?: boolean | undefined;
    },
  ): void {
    const { inputs, bindings, providers = [], main } = options;
    try {
      open.mount = mounter.mount(open.handle.surface, component, {
        ...(inputs && { inputs }),
        ...(bindings && { bindings }),
        providers: [{ provide: CURRENT_WINDOW, useValue: open.handle }, ...providers],
        ...(main && { main }),
      });
    } catch (error) {
      this.closeNow(open.handle.surface, true);
      throw error;
    }
  }

  /** Make the handle for a window that has opened on `surface`, and list it. */
  private track(surface: number, key: string | null, outlet: string | null, title: string): Open {
    const native = this.native!;
    const guards = new Set<CloseGuard>();
    const titleSignal = signal(title);
    let closedNow!: () => void;
    const closed = new Promise<void>((resolve) => (closedNow = resolve));
    const handle: AppWindow = {
      surface,
      key,
      title: titleSignal.asReadonly(),
      setTitle: (next) => {
        titleSignal.set(next);
        native.setTitle(surface, next);
      },
      focused: computed(() => this.focusedSurface() === surface),
      focus: () => native.focus(surface),
      close: () => this.closeAsked(surface),
      canClose: (guard) => {
        guards.add(guard);
        return () => void guards.delete(guard);
      },
      closed,
    };
    const open: Open = {
      handle,
      restore: null,
      guards,
      outlet,
      closedNow,
      mount: null,
      closing: false,
    };
    this.open$.update((all) => [...all, open]);
    return open;
  }

  private byKey(key: string): AppWindow | null {
    return this.open$().find((open) => open.handle.key === key)?.handle ?? null;
  }

  private front(window: AppWindow): AppWindow {
    window.focus();
    return window;
  }

  private find(surface: number): Open | undefined {
    return this.open$().find((open) => open.handle.surface === surface);
  }

  private hostSaid(event: NativeWindowEvent): void {
    switch (event.type) {
      case 'focus':
        this.focusedSurface.set(event.surface);
        return;
      case 'resize':
        this.find(event.surface)?.mount?.resize(event);
        return;
      case 'closeRequest':
        void this.closeAsked(event.surface);
        return;
      case 'closed':
        this.closeNow(event.surface, false);
        return;
      case 'quitRequest':
        void this.quitAsked(event.terminate === true);
        return;
      case 'reopen':
        if (!this.open$().length) void this.openMain();
        return;
    }
  }

  /** Ask a window's guards, and close it if every one agrees. */
  private async closeAsked(surface: number): Promise<boolean> {
    const open = this.find(surface);
    if (!open || open.closing) return false;
    open.closing = true;
    const allowed = await this.guardsAgree(open);
    open.closing = false;
    if (!allowed || !this.find(surface)) return false;
    this.closeNow(surface, true);
    return true;
  }

  private async guardsAgree(open: Open): Promise<boolean> {
    for (const guard of [...open.guards]) {
      try {
        if (!(await guard())) return false;
      } catch (error) {
        // A guard that fails keeps the window, rather than losing what it was guarding.
        console.error('[angular-native] A canClose guard failed:', error);
        return false;
      }
    }
    return true;
  }

  /**
   * Take a window down: what it renders, its outlet, the host's window where the app is closing
   * it, then the app itself where that was the last window and the app quits with it.
   */
  private closeNow(surface: number, tellHost: boolean): void {
    const open = this.find(surface);
    if (!open) return;
    this.open$.update((all) => all.filter((one) => one !== open));
    if (open.restore) this.remember();
    if (this.focusedSurface() === surface) this.focusedSurface.set(null);
    open.mount?.destroy();
    open.mount = null;
    if (open.outlet) void this.navigator?.clear(open.outlet);
    if (tellHost) this.native?.close(surface);
    open.closedNow();
    if (!this.open$().length && this.lifecycle.quitWhenLastWindowCloses) this.native?.quit();
  }

  /**
   * The host asks to quit: every window's guards, in the order the windows opened, then the
   * `willQuit` handlers, then the answer. One guard that says no keeps the app, and every window.
   * A SIGTERM (`terminate`) skips the guards, and one that arrives while a quit's guards decide
   * finishes that quit, whatever they answer.
   */
  private async quitAsked(terminate: boolean): Promise<void> {
    const current = this.quitting;
    if (current) {
      // One quit at a time: its answer is the host's. A SIGTERM no longer waits for its guards.
      if (terminate) current.finishing ??= this.finishQuit();
      return;
    }
    const quit: { finishing: Promise<void> | null } = { finishing: null };
    this.quitting = quit;
    try {
      // A SIGTERM is no one's choice to veto: no guard is asked, so a dialog cannot hold it.
      const agreed = terminate || (await this.everyWindowAgrees());
      if (!agreed && !quit.finishing) {
        this.native?.answerQuit(false);
        return;
      }
      quit.finishing ??= this.finishQuit();
      await quit.finishing;
    } finally {
      this.quitting = null;
    }
  }

  /**
   * Ask each window's guards in turn, including a window that opened while an earlier one's guard
   * decided. False at the first that says no.
   */
  private async everyWindowAgrees(): Promise<boolean> {
    const asked = new Set<Open>();
    for (let open = this.unasked(asked); open; open = this.unasked(asked)) {
      asked.add(open);
      if (!(await this.guardsAgree(open))) return false;
    }
    return true;
  }

  private unasked(asked: ReadonlySet<Open>): Open | undefined {
    return this.open$().find((open) => !asked.has(open));
  }

  private async finishQuit(): Promise<void> {
    await this.lifecycle.runWillQuit();
    this.native?.answerQuit(true);
  }

  /** Stop listening to the host: for a test that makes the service more than once. */
  ngOnDestroy(): void {
    this.unsubscribe?.();
  }
}
