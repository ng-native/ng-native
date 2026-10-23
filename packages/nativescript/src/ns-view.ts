/**
 * `<ns-view>`: a native view built in TypeScript, a UIView or an `android.view.View`, laid out by the
 * template like any other view.
 *
 * ```ts
 * const badge = nsView<{ title: string }, UILabel>({
 *   create(props) {
 *     'worklet';
 *     const label = UILabel.new();
 *     label.text = props.title;
 *     return label;
 *   },
 *   update(label, props) {
 *     'worklet';
 *     label.text = props.title;
 *   },
 * });
 *
 * @Component({
 *   imports: [NsView],
 *   template: `<ns-view class="h-12" [view]="badge" [props]="{ title: title() }" />`,
 * })
 * ```
 *
 * `@nativescript/react-native` ships a Fabric view, `NativeScriptUIView`, on both platforms, that
 * shows the view whose handle it is given as `nativeViewHandle`. The element commits as that view;
 * `create` runs on the main thread, the view it returns is kept there under the element's id, and
 * its handle comes back to be bound. `update` runs there too, each time `props` changes. The
 * package's own `defineUIKitView` does the same for React, and is a React component, so it cannot be
 * used here.
 */
import { Component, DestroyRef, ErrorHandler, effect, inject, input, signal } from '@angular/core';
import { registerViewName } from '@ng-native/fabric';
import { NativeScript } from './native-script.ts';

/** How to build a native view and keep it in step with its props. Both functions are worklets. */
export interface NsViewSpec<P, V> {
  create(props: P): V;
  update?(view: V, props: P): void;
}

/**
 * Declare a native view. An identity function, there to infer `P` and `V` across both functions;
 * written as an object so the HMR transform, which wraps a module's top-level functions and with
 * them a worklet's `__workletHash`, leaves the worklets alone.
 */
export function nsView<P, V>(spec: NsViewSpec<P, V>): NsViewSpec<P, V> {
  return spec;
}

registerViewName('ns-view', 'NativeScriptUIView', { collapsable: false });

/** The views built so far, on the main thread's runtime, keyed by element. Holding one keeps it alive. */
const VIEWS = '__ngNsViews';

/** Runs on the main thread. One object so none of these is a top-level function: see `nsView`. */
const ui = {
  mount(
    id: string,
    create: (props: unknown) => unknown,
    props: unknown,
    handleOf: (view: unknown) => string,
  ): string {
    'worklet';
    const g = globalThis as Record<string, any>;
    const views: Map<string, unknown> = (g[VIEWS] ??= new Map());
    // The view this element showed goes first, so a create that fails leaves it empty.
    views.delete(id);
    const view = create(props) as { isKindOfClass?(of: unknown): boolean } | null;
    // iOS takes any NSObject's pointer, a controller's too, and shows nothing for one that is not
    // a UIView, so that is checked here; Android's handle refuses what is not a View itself.
    const notAView = g['UIView'] && view?.isKindOfClass?.(g['UIView']) !== true;
    let handle: string | undefined;
    try {
      if (!notAView && view != null) handle = handleOf(view);
    } catch {
      // Reported below, as the value it was.
    }
    if (handle === undefined) {
      throw new Error(
        `[angular-native] An nsView's create returned ${String(view)}, where it returns a view.`,
      );
    }
    views.set(id, view);
    return handle;
  },
  update(id: string, update: (view: unknown, props: unknown) => void, props: unknown): void {
    'worklet';
    const view = (globalThis as Record<string, any>)[VIEWS]?.get(id);
    if (view) update(view, props);
  },
  unmount(id: string): void {
    'worklet';
    (globalThis as Record<string, any>)[VIEWS]?.delete(id);
  },
};

let nextId = 0;

@Component({
  selector: 'ns-view',
  template: '',
  host: { '[nativeViewHandle]': 'handle()' },
})
export class NsView<P = unknown> {
  private readonly native = inject(NativeScript);
  private readonly errors = inject(ErrorHandler);

  /** What to build. A different spec builds a new view in place of the old one. */
  readonly view = input.required<NsViewSpec<P, any>>();
  /** Passed to `create`, then to `update` each time it changes. Copied to iOS's UI runtime. */
  readonly props = input.required<P>();

  /** The view's pointer; `null` once it is gone, since a prop set to `undefined` is not removed. */
  protected readonly handle = signal<string | null | undefined>(undefined);

  constructor() {
    const id = `ns-view-${nextId++}`;
    const report = (error: unknown) => this.errors.handleError(error);
    let built: NsViewSpec<P, any> | undefined;

    effect(() => {
      const spec = this.view();
      const props = this.props();
      if (!this.native.platform) return;
      if (spec !== built) {
        built = spec;
        const create = spec.create as (props: unknown) => unknown;
        this.native.runOnUI(ui.mount, id, create, props, this.native.nativeViewHandle).then(
          (handle) => built === spec && this.handle.set(handle),
          (error: unknown) => {
            if (built === spec) this.handle.set(null);
            report(error);
          },
        );
      } else if (spec.update) {
        this.native
          .runOnUI(ui.update, id, spec.update as (view: unknown, props: unknown) => void, props)
          .catch(report);
      }
    });

    inject(DestroyRef).onDestroy(() => {
      if (built) this.native.runOnUI(ui.unmount, id).catch(report);
    });
  }
}
