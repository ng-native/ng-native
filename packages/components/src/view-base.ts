/**
 * The props every native view accepts, as typed inputs forwarded to the host node.
 *
 * Each input is mirrored by a host binding of the same name, which is what carries the value to
 * the renderer: once a directive declares an input, Angular routes the binding to the directive
 * rather than the element. An unset input stays `undefined` and never reaches native, so a view
 * that mentions none of these sends none of them.
 *
 * Web-style `aria-*` names are accepted as aliases and land on the `accessibility*` props React
 * Native's own `View.js` maps them to. `id` maps to `nativeID` and `tabIndex` to `focusable` the
 * same way.
 *
 * Events are element events, typed in `events.ts`: `(layout)`, `(touchStart)`,
 * `(accessibilityAction)` and so on. They are deliberately not outputs; see that file.
 */
import { Directive, ElementRef, type SimpleChanges, inject, input } from '@angular/core';
import { HostEngine, claimHost, declareNativeProps, type HostNode } from '@ng-native/fabric';
import type { Insets } from './events.ts';
import { optionalBoolean, optionalNumber } from './transforms.ts';
import { WRITTEN_PROPS } from './written-props.ts';

/** The roles assistive technologies understand. `Role` is the web spelling of the same set. */
export type AccessibilityRole =
  | 'none'
  | 'button'
  | 'togglebutton'
  | 'link'
  | 'search'
  | 'image'
  | 'keyboardkey'
  | 'text'
  | 'adjustable'
  | 'imagebutton'
  | 'header'
  | 'summary'
  | 'alert'
  | 'checkbox'
  | 'combobox'
  | 'menu'
  | 'menubar'
  | 'menuitem'
  | 'progressbar'
  | 'radio'
  | 'radiogroup'
  | 'scrollbar'
  | 'spinbutton'
  | 'switch'
  | 'tab'
  | 'tabbar'
  | 'tablist'
  | 'timer'
  | 'list'
  | 'toolbar'
  | 'grid'
  | 'pager'
  | 'scrollview'
  | 'horizontalscrollview'
  | 'viewgroup'
  | 'webview'
  | 'drawerlayout'
  | 'slidingdrawer'
  | 'iconmenu';

export interface AccessibilityState {
  readonly disabled?: boolean;
  readonly selected?: boolean;
  readonly checked?: boolean | 'mixed';
  readonly busy?: boolean;
  readonly expanded?: boolean;
}

export interface AccessibilityValue {
  readonly min?: number;
  readonly max?: number;
  readonly now?: number;
  readonly text?: string;
}

export interface AccessibilityAction {
  readonly name: string;
  readonly label?: string;
}

/** Android's `nativeBackgroundAndroid` and `nativeForegroundAndroid`. */
export type AndroidDrawable =
  | {
      readonly type: 'RippleAndroid';
      readonly color?: string | number;
      readonly borderless?: boolean;
      readonly rippleRadius?: number;
    }
  | { readonly type: 'ThemeAttrAndroid'; readonly attribute: string };

export type PointerEvents = 'box-none' | 'none' | 'box-only' | 'auto';
export type ImportantForAccessibility = 'auto' | 'yes' | 'no' | 'no-hide-descendants';
export type AccessibilityLiveRegion = 'none' | 'polite' | 'assertive';

/**
 * Angular writes a static attribute to the element as well as feeding it to the input of the
 * same name, so `<switch thumbColor="#fff">` leaves a stray `thumbColor` prop on the node next to
 * the `thumbTintColor` the input produces. The inputs of the directive are what consumed them,
 * so those names come off the node; a host binding puts back any that native does read.
 *
 * Walking the *node's* props rather than the directive's inputs is not a detail. This runs for
 * every element on screen, a primitive declares some forty-five inputs, and at this point the node
 * usually has no props at all - bindings have not run yet, so only static attributes are there.
 * The other way round it was forty-five `delete`s per element on an object that had none of them,
 * which is both wasted work and the way to push an object into dictionary mode.
 */
/** Shallow equality, so a re-merged state that says the same thing keeps its identity. */
function sameState(a: AccessibilityState, b: AccessibilityState): boolean {
  const keys = Object.keys(a) as (keyof AccessibilityState)[];
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

/** The host primitives whose props have been declared to the engine. */
const declared = new WeakSet<object>();

/**
 * Tell the engine the props this primitive's native view takes, once per component class: its
 * inputs by their public names, and `WRITTEN_PROPS`. What its check for a misspelt prop reads.
 */
function declareProps(ctor: unknown, node: HostNode): void {
  if (declared.has(ctor as object)) return;
  declared.add(ctor as object);
  const def =
    (ctor as { ɵcmp?: { inputs?: object }; ɵdir?: { inputs?: object } }).ɵcmp ??
    (ctor as { ɵdir?: { inputs?: object } }).ɵdir;
  const name = (node as { name?: string }).name;
  if (!name || !def?.inputs) return;
  declareNativeProps(name, [...Object.keys(def.inputs), ...WRITTEN_PROPS]);
}

function stripConsumedAttributes(ctor: unknown, node: HostNode): void {
  // A directive with no selector is only ever a `hostDirectives` entry, which exposes the inputs
  // it lists and no others, so an attribute of the same name as the rest was not consumed.
  type Def = { inputs?: Record<string, unknown>; selectors?: readonly unknown[] };
  const { ɵcmp, ɵdir } = ctor as { ɵcmp?: Def; ɵdir?: Def };
  const def = ɵcmp ?? (ɵdir?.selectors?.length ? ɵdir : undefined);
  const inputs = def?.inputs;
  if (!inputs) return;
  // A host that has not put a bag on the node yet has no attributes to take off it. Read
  // unconditionally, this threw `Cannot convert undefined or null to object` on the first
  // component a browser host ever mounted, before anything rendered - which is a hard crash
  // standing between this package and a second platform, for a loop with nothing to do.
  const props = node.props as Record<string, unknown> | undefined;
  if (!props) return;
  for (const name of Object.keys(props)) {
    if (name in inputs) delete props[name];
  }
}

/**
 * What a directive on the same node says this view *is*, for a screen reader.
 *
 * A host primitive knows it is a view; only the thing composed onto it knows it is a button, a
 * checkbox or an accordion trigger. Without this seam that knowledge has nowhere to go: the role
 * and the state are written here, from this class's own inputs, and a later `ngOnChanges` would
 * overwrite anything a directive had set behind its back.
 *
 * Registered on the element with `contributeAccessibility`, and several primitives may contribute
 * to one element - a trigger that is also a button.
 */
export interface AccessibilityContribution {
  /** The role, if this directive implies one. An explicit `role` on the element still wins. */
  readonly role?: AccessibilityRole;
  /**
   * State to merge in, read on every write so it may be a signal read.
   *
   * Spelled in full because `state` is what a primitive calls the thing it publishes for a
   * stylesheet - `data-state="checked"` - and the two are not the same thing.
   */
  readonly accessibilityState?: () => AccessibilityState | undefined;
}

/** Where an element's contributions are kept: on the node, and only on a node that has some. */
const CONTRIBUTIONS = Symbol('angular-native.accessibilityContributions');
type Contributed = HostNode & { [CONTRIBUTIONS]?: AccessibilityContribution[] };
const NO_CONTRIBUTIONS: readonly AccessibilityContribution[] = [];

/**
 * Tell the primitive on this element what it is, for a screen reader: a role, and state to merge
 * into what it announces. Call it from a directive's field initialiser or constructor, on the
 * element the primitive is on:
 *
 *     private readonly contribution = contributeAccessibility({ role: 'button' });
 *     private readonly contribution = contributeAccessibility(this);
 *
 * Kept on the node rather than provided through DI, because asking the injector costs every
 * element on screen a lookup to learn that nothing contributes - about a tenth of creating a list.
 * Reading a property that is not there costs nothing.
 */
export function contributeAccessibility<T extends AccessibilityContribution>(contribution: T): T {
  const node = inject(ElementRef).nativeElement as Contributed;
  (node[CONTRIBUTIONS] ??= []).push(contribution);
  return contribution;
}

@Directive()
export abstract class ViewBase {
  /** The retained node this directive sits on. */
  protected readonly node = inject(ElementRef).nativeElement as HostNode;

  /**
   * The engine, because the props these inputs carry are written straight onto the node. Read
   * off the node where the host put it there, which is one property read against an injector
   * lookup that walks every ancestor element, for every element on screen.
   */
  protected readonly engine: HostEngine = this.node.host ?? inject(HostEngine);

  /**
   * See `contributeAccessibility`. Empty for every element nothing is composed onto. Read, never
   * cached, from `ngOnInit` onwards: by then every directive on the node has been constructed and
   * registered what it has to say.
   */
  private get contributions(): readonly AccessibilityContribution[] {
    return (this.node as Contributed)[CONTRIBUTIONS] ?? NO_CONTRIBUTIONS;
  }

  constructor() {
    claimHost(this.node);
    stripConsumedAttributes(this.constructor, this.node);
    declareProps(this.constructor, this.node);
    this.engine.settle(this);
  }

  /** Whether `ngOnInit` has run, which is what writes the props every element starts with. */
  private initialised = false;

  /**
   * Write what the inputs say, for an element whose view has not been checked by the time the
   * host commits it. Nothing for one that has.
   *
   * The props are written from `ngOnChanges` and `ngOnInit`, which Angular runs in the parent
   * view's update pass. A component that detaches itself before its first check never gets one,
   * and on the web that pattern still works, because a listener and an attribute are there from
   * creation. So the host calls this before the commit that first mounts the element, by when its
   * static inputs are set: the press handling, the role and the `testID` are there, and the view
   * behaves as written once something calls `detectChanges()`.
   */
  settleProps(): void {
    if (this.initialised) return;
    this.ngOnChanges({});
    this.ngOnInit();
  }

  // --- accessibility ---------------------------------------------------------------------

  /** Whether the view is an accessibility element. Defaults to false for a plain view. */
  readonly accessible = input<boolean>(undefined, { transform: optionalBoolean });
  /** What a screen reader announces for the view. */
  readonly accessibilityLabel = input<string>();
  /** `aria-label`: web spelling of `accessibilityLabel`. */
  readonly ariaLabel = input<string>(undefined, { alias: 'aria-label' });
  /** Android: `nativeID`s of the views that label this one. */
  readonly accessibilityLabelledBy = input<string | readonly string[]>();
  /** `aria-labelledby`: web spelling of `accessibilityLabelledBy`. */
  readonly ariaLabelledBy = input<string | readonly string[]>(undefined, {
    alias: 'aria-labelledby',
  });
  /** What happens when the user acts on the view, when the label alone does not say. */
  readonly accessibilityHint = input<string>();
  /** The kind of control this is, for assistive technologies. */
  readonly accessibilityRole = input<AccessibilityRole>();
  /** `role`: the web spelling of `accessibilityRole`. */
  readonly role = input<AccessibilityRole>();
  /** Disabled, selected, checked, busy and expanded, as one object. */
  readonly accessibilityState = input<AccessibilityState>();
  /** `aria-busy`. */
  readonly ariaBusy = input<boolean>(undefined, { alias: 'aria-busy', transform: optionalBoolean });
  /** `aria-checked`. */
  readonly ariaChecked = input<boolean | 'mixed'>(undefined, { alias: 'aria-checked' });
  /** `aria-disabled`. */
  readonly ariaDisabled = input<boolean>(undefined, {
    alias: 'aria-disabled',
    transform: optionalBoolean,
  });
  /** `aria-expanded`. */
  readonly ariaExpanded = input<boolean>(undefined, {
    alias: 'aria-expanded',
    transform: optionalBoolean,
  });
  /** `aria-selected`. */
  readonly ariaSelected = input<boolean>(undefined, {
    alias: 'aria-selected',
    transform: optionalBoolean,
  });
  /** The current value of an adjustable control, for a screen reader. */
  readonly accessibilityValue = input<AccessibilityValue>();
  /** `aria-valuemin`. */
  readonly ariaValueMin = input<number>(undefined, {
    alias: 'aria-valuemin',
    transform: optionalNumber,
  });
  /** `aria-valuemax`. */
  readonly ariaValueMax = input<number>(undefined, {
    alias: 'aria-valuemax',
    transform: optionalNumber,
  });
  /** `aria-valuenow`. */
  readonly ariaValueNow = input<number>(undefined, {
    alias: 'aria-valuenow',
    transform: optionalNumber,
  });
  /** `aria-valuetext`. */
  readonly ariaValueText = input<string>(undefined, { alias: 'aria-valuetext' });
  /** Custom actions a screen reader can invoke; each arrives as `(accessibilityAction)`. */
  readonly accessibilityActions = input<readonly AccessibilityAction[]>();
  /** Android: announce changes to this view's content without focus moving to it. */
  readonly accessibilityLiveRegion = input<AccessibilityLiveRegion>();
  /** `aria-live`. */
  readonly ariaLive = input<AccessibilityLiveRegion>(undefined, { alias: 'aria-live' });
  /** iOS: hide this view and its children from assistive technologies. */
  readonly accessibilityElementsHidden = input<boolean>(undefined, { transform: optionalBoolean });
  /** `aria-hidden`: `accessibilityElementsHidden` on iOS, `no-hide-descendants` on Android. */
  readonly ariaHidden = input<boolean>(undefined, {
    alias: 'aria-hidden',
    transform: optionalBoolean,
  });
  /** Android: whether this view is exposed to accessibility, and whether its children are. */
  readonly importantForAccessibility = input<ImportantForAccessibility>();
  /** iOS: VoiceOver ignores every sibling while this view is shown, as a modal expects. */
  readonly accessibilityViewIsModal = input<boolean>(undefined, { transform: optionalBoolean });
  /** `aria-modal`. */
  readonly ariaModal = input<boolean>(undefined, {
    alias: 'aria-modal',
    transform: optionalBoolean,
  });
  /** iOS: keep the view's colours when the Invert Colors setting is on; images want this. */
  readonly accessibilityIgnoresInvertColors = input<boolean>(undefined, {
    transform: optionalBoolean,
  });
  /** iOS: the language VoiceOver reads the label in, as a BCP 47 tag. */
  readonly accessibilityLanguage = input<string>();
  /** iOS: the title shown by the Large Content Viewer on a long press with large text on. */
  readonly accessibilityLargeContentTitle = input<string>();
  /** iOS: opt this view into the Large Content Viewer. */
  readonly accessibilityShowsLargeContentViewer = input<boolean>(undefined, {
    transform: optionalBoolean,
  });
  /** iOS: tell VoiceOver the view responds to a tap even without a role that implies it. */
  readonly accessibilityRespondsToUserInteraction = input<boolean>(undefined, {
    transform: optionalBoolean,
  });

  // --- identity and hit testing ----------------------------------------------------------

  /** A handle native code can find the view by; also what `:id` selectors match. */
  readonly nativeID = input<string>();
  /** `id`: the web spelling of `nativeID`. */
  readonly id = input<string>();
  /** A handle for end-to-end test tooling. */
  readonly testID = input<string>();
  /** Extend the touchable area beyond the view's bounds, without moving anything visible. */
  readonly hitSlop = input<Insets | number>();
  /** Whether this view, its children, or neither can be the target of a touch. */
  readonly pointerEvents = input<PointerEvents>();
  /** Set to false to keep a layout-only view alive; Fabric otherwise removes it from the tree. */
  readonly collapsable = input<boolean>(undefined, { transform: optionalBoolean });
  /** Set to false to keep this view's layout-only children from being flattened. */
  readonly collapsableChildren = input<boolean>(undefined, { transform: optionalBoolean });
  /** Detach children that are outside the visible bounds. A scroll view optimisation. */
  readonly removeClippedSubviews = input<boolean>(undefined, { transform: optionalBoolean });
  /** Composite the view offscreen so a translucent view with children blends correctly. */
  readonly needsOffscreenAlphaCompositing = input<boolean>(undefined, {
    transform: optionalBoolean,
  });
  /** Android: whether the view takes keyboard or TV focus. RN's `tabIndex` is this. */
  readonly focusable = input<boolean>(undefined, { transform: optionalBoolean });
  /** iOS: render the view to a bitmap once and reuse it; for a static view that animates. */
  readonly shouldRasterizeIOS = input<boolean>(undefined, { transform: optionalBoolean });
  /** Android: cache the view in a hardware texture; the same trade as `shouldRasterizeIOS`. */
  readonly renderToHardwareTextureAndroid = input<boolean>(undefined, {
    transform: optionalBoolean,
  });
  /** Android: a ripple or theme drawable painted behind the view's content. */
  readonly nativeBackgroundAndroid = input<AndroidDrawable>();
  /** Android: a ripple or theme drawable painted over the view's content. */
  readonly nativeForegroundAndroid = input<AndroidDrawable>();

  // --- merged views of the aliases ------------------------------------------------------

  /**
   * What React Native's own JavaScript wrapper would have defaulted, per component.
   *
   * Driving the native views directly skips those wrappers, and what is lost is invisible: the
   * app looks identical and is unusable with a screen reader, because nothing on it is an
   * accessibility element. Each hook is overridden by the component whose wrapper sets it, and
   * cites the file it came from.
   */

  /** True for anything that behaves like a control. `Pressable.js`: `accessible !== false`. */
  protected accessibleByDefault(): boolean {
    return false;
  }

  /** Whether the platform's focus order should include this. `Pressable.js` again. */
  protected focusableByDefault(): boolean {
    return false;
  }

  /**
   * A role the component itself implies. `Switch.js`: `accessibilityRole ?? 'switch'`. Below an
   * explicit role and a contributed one, which is what a wrapper passing `accessibilityRole` is.
   */
  protected roleByDefault(): AccessibilityRole | undefined {
    return undefined;
  }

  /**
   * The component's own `disabled`, for the state a screen reader announces: undefined when not
   * passed.
   *
   * It wins over `aria-disabled` and `accessibilityState.disabled`, as it does in `Pressable.js`,
   * `TouchableOpacity.js`, `Switch.js` and `Text.js`. True is always merged; false only overrides
   * something else that says disabled, so a control that is not disabled says nothing rather than
   * saying so on every node.
   */
  protected disabledForAccessibility(): boolean | undefined {
    return undefined;
  }

  /**
   * The component's own `checked`, for a control whose checked state is not an accessibility
   * input at all - `Switch`'s `checked` is a `model()`, not one of this class's inputs, so it
   * cannot reach `ngOnChanges` here any more than `disabled` can.
   */
  protected checkedForAccessibility(): boolean | 'mixed' | undefined {
    return undefined;
  }

  /**
   * Write what the inputs say onto the node.
   *
   * This is what thirty host bindings used to do, and it is here rather than there for a reason
   * that was measured: a host binding costs every element that carries it, on every pass, whether
   * or not the app ever set the prop, and mounting four hundred rows spent a third of its time on
   * the accessibility surface alone. Angular calls this once with everything that changed instead.
   *
   * It works with signal inputs, which is easy to assume it does not: `ngOnChanges` fires for
   * them as it does for any other input, because `ngOnChangesSetInput` records a `SimpleChange`
   * before writing the signal. `signal-onchanges.test.ts` is there to keep that fact honest.
   *
   * What remains is the allocation - a signal input builds its node whether or not anything binds
   * to it, and there are forty-six here. Moving prop groups into directives selected by the props
   * they carry (`[accessibilityLabel], [aria-label], ...`) is how that goes away: an element that
   * binds none of them would allocate nothing. Measured on a 400-row mount it is worth about 40ms,
   * at the price of an import per group.
   */
  ngOnChanges(_changes?: SimpleChanges): void {
    this.writeAccessibility();
    this.writeIdentity();
  }

  private writeAccessibility(): void {
    const write = this.writer();
    write(
      'accessible',
      this.accessibleByDefault() ? (this.accessible() ?? true) : this.accessible(),
    );
    write(
      'accessibilityLabel',
      this.accessibilityLabel() ?? this.ariaLabel() ?? this.labelByDefault(),
    );
    write('accessibilityLabelledBy', this.accessibilityLabelledBy() ?? this.ariaLabelledBy());
    write('accessibilityHint', this.accessibilityHint());
    write('accessibilityRole', this.accessibilityRole() ?? this.role() ?? this.impliedRole());
    write('accessibilityState', this.mergedAccessibilityState());
    write('accessibilityValue', this.mergedAccessibilityValue());
    write('accessibilityActions', this.accessibilityActions());
    this.writeVisibility();
    this.publishAriaState(write);
  }

  /**
   * The aria states Tailwind has variants for, put back on the node as the attributes they came
   * in as. The inputs consume them, so `[aria-disabled="true"]` and every `aria-*:` utility had
   * nothing to match. Hyphenated, so the engine keeps them for selectors and never sends them.
   */
  private publishAriaState(write: (key: string, value: unknown) => void): void {
    const attribute = (value: unknown) => (value === undefined ? undefined : String(value));
    write('aria-busy', attribute(this.ariaBusy()));
    write('aria-checked', attribute(this.ariaChecked()));
    write('aria-disabled', attribute(this.ariaDisabled()));
    write('aria-expanded', attribute(this.ariaExpanded()));
    write('aria-hidden', attribute(this.ariaHidden()));
    write('aria-selected', attribute(this.ariaSelected()));
  }

  /** The half of accessibility that is about what assistive technology may see, and in which language. */
  private writeVisibility(): void {
    const write = (key: string, value: unknown) => this.engine.setProp(this.node, key, value);
    write('accessibilityLiveRegion', this.accessibilityLiveRegion() ?? this.ariaLive());
    write('accessibilityElementsHidden', this.accessibilityElementsHidden() ?? this.ariaHidden());
    write(
      'importantForAccessibility',
      this.importantForAccessibility() ?? (this.ariaHidden() ? 'no-hide-descendants' : undefined),
    );
    write('accessibilityViewIsModal', this.accessibilityViewIsModal() ?? this.ariaModal());
    write('accessibilityIgnoresInvertColors', this.accessibilityIgnoresInvertColors());
    write('accessibilityLanguage', this.accessibilityLanguage());
    write('accessibilityLargeContentTitle', this.accessibilityLargeContentTitle());
    write('accessibilityShowsLargeContentViewer', this.accessibilityShowsLargeContentViewer());
    write('accessibilityRespondsToUserInteraction', this.accessibilityRespondsToUserInteraction());
  }

  /**
   * Writes a prop, and says nothing when it has nothing to say.
   *
   * The `undefined` guard is the whole of it. These two methods rewrite roughly forty props from
   * this class's own inputs on every `ngOnChanges`, so without the guard, anything that reached
   * the node by another route would be overwritten the first time any input changed. Two routes
   * reach the node without going through an input of this class:
   *
   * - A host binding on a component that composes this class in, such as `[accessible]` or
   *   `[accessibilityLabel]` set from the composing component's own `host` object.
   * - An element property binding beside a `hostDirectives` entry. A component whose
   *   `hostDirectives` entry lists one input (say `disabled`) but not another (say `nativeID`)
   *   leaves `[nativeID]` to be applied as a plain property; a bound `[disabled]` beside it would
   *   then clobber the id on the next change unless the identity inputs are also listed through
   *   explicitly.
   *
   * An input that goes back to `undefined` clears the prop only when this is what set it, so a
   * binding such as `[pointerEvents]="busy() ? 'none' : undefined"` still switches off, and a
   * prop that arrived by one of those other routes is still never touched. Clearing a *class*
   * clears the style it brought, because that goes through the cascade rather than through here.
   */
  private writer(): (key: string, value: unknown) => void {
    return (key, value) => {
      if (value === undefined) {
        // Cleared only if this wrote it: `[pointerEvents]="busy() ? 'none' : undefined"` has to
        // give the view its touches back, and a prop another route set is still left alone.
        if (this.written?.delete(key)) this.engine.setProp(this.node, key, null);
        return;
      }
      (this.written ??= new Set()).add(key);
      this.engine.setProp(this.node, key, value);
    };
  }

  /** The props `writer` has set from an input, so it can clear one when its input is unset. */
  private written: Set<string> | null = null;

  private writeIdentity(): void {
    const write = this.writer();
    write('nativeID', this.nativeID() ?? this.id());
    write('testID', this.testID());
    write('hitSlop', this.hitSlop());
    write('pointerEvents', this.pointerEvents());
    write('collapsable', this.collapsable());
    write('collapsableChildren', this.collapsableChildren());
    write('removeClippedSubviews', this.removeClippedSubviews());
    write('needsOffscreenAlphaCompositing', this.needsOffscreenAlphaCompositing());
    write('focusable', this.focusableByDefault() ? (this.focusable() ?? true) : this.focusable());
    write('shouldRasterizeIOS', this.shouldRasterizeIOS());
    write('renderToHardwareTextureAndroid', this.renderToHardwareTextureAndroid());
    write('nativeBackgroundAndroid', this.nativeBackgroundAndroid());
    write('nativeForegroundAndroid', this.nativeForegroundAndroid());
  }

  /**
   * The defaults a React Native wrapper would have applied, written once when the element is
   * created. `ngOnChanges` writes them again whenever an input changes, so an app that later
   * clears a prop falls back to the default rather than to nothing.
   */
  /**
   * The defaults a React Native wrapper would have applied, for an element nothing was bound on.
   *
   * In `ngOnInit` rather than the constructor because a hook like `accessibleByDefault` is
   * answered from the subclass's own inputs - `Text` asks whether it is pressable - and those
   * fields do not exist yet while the base constructor runs. Each is guarded on its input being
   * unset, because `ngOnChanges` has already run by now and its answer, which merges the default
   * in, is the better one.
   */
  ngOnInit(): void {
    this.initialised = true;
    // A directive with nothing bound to it never sees `ngOnChanges`, so an element that carries a
    // primitive and no bindings would never have its role or state written at all. Cheap to ask,
    // and the answer is no for every element in an app that uses none.
    if (this.contributions.length > 0) this.writeAccessibility();
    if (this.accessible() === undefined && this.accessibleByDefault()) {
      this.engine.setProp(this.node, 'accessible', true);
    }
    if (this.focusable() === undefined && this.focusableByDefault()) {
      this.engine.setProp(this.node, 'focusable', true);
    }
    if (this.accessibilityRole() === undefined && this.role() === undefined) {
      const role = this.impliedRole();
      if (role) this.engine.setProp(this.node, 'accessibilityRole', role);
    }
    if (this.accessibilityLabel() === undefined && this.ariaLabel() === undefined) {
      const label = this.labelByDefault();
      if (label !== undefined) this.engine.setProp(this.node, 'accessibilityLabel', label);
    }
  }

  /** The role when none is set: one a directive contributes, or else the component's own. */
  private impliedRole(): AccessibilityRole | undefined {
    return this.contributedRole() ?? this.roleByDefault();
  }

  /** The first role any directive on this node claims. Two claiming different ones is a bug. */
  private contributedRole(): AccessibilityRole | undefined {
    for (const contribution of this.contributions) {
      if (contribution.role) return contribution.role;
    }
    return undefined;
  }

  /** A label the component itself can supply, as `Image` does from `alt`. */
  protected labelByDefault(): string | undefined {
    return undefined;
  }

  /**
   * The merged state, for a component whose own inputs feed it - `disabled` on a pressable or a
   * switch, which is a signal of theirs and so cannot reach `ngOnChanges` here.
   *
   * Those components bind this from their host. It returns the *same object* when nothing has
   * changed, which is what keeps a host binding from marking the node dirty on every pass.
   */
  protected accessibilityStateProp(): AccessibilityState | undefined {
    return this.mergedAccessibilityState();
  }

  private lastAccessibilityState: AccessibilityState | undefined;

  /** Whether anything could put state on this node. For nearly every node on screen, no. */
  private hasState(): boolean {
    return (
      this.accessibilityState() !== undefined ||
      this.ariaBusy() !== undefined ||
      this.ariaChecked() !== undefined ||
      this.ariaDisabled() !== undefined ||
      this.ariaExpanded() !== undefined ||
      this.ariaSelected() !== undefined ||
      !!this.disabledForAccessibility() ||
      this.checkedForAccessibility() !== undefined ||
      this.contributions.length > 0
    );
  }

  private mergedAccessibilityState(): AccessibilityState | undefined {
    // Answered without allocating in the common case: this runs from a host binding on every
    // control, on every pass, and most of them have no state to announce.
    if (!this.hasState()) return (this.lastAccessibilityState = undefined);
    const explicit = this.accessibilityState();
    const merged: Record<string, unknown> = { ...explicit };
    const set = (key: keyof AccessibilityState, value: unknown) => {
      if (value !== undefined) merged[key] = value;
    };
    set('checked', this.checkedForAccessibility());
    set('busy', this.ariaBusy());
    set('checked', this.ariaChecked());
    set('disabled', this.ariaDisabled());
    set('disabled', this.disabledOver(merged['disabled']));
    set('expanded', this.ariaExpanded());
    set('selected', this.ariaSelected());
    for (const contribution of this.contributions) {
      const state = contribution.accessibilityState?.();
      for (const key of Object.keys(state ?? {})) {
        set(key as keyof AccessibilityState, (state as Record<string, unknown>)[key]);
      }
    }
    const state = Object.keys(merged).length ? (merged as AccessibilityState) : explicit;
    const last = this.lastAccessibilityState;
    if (last && state && sameState(last, state)) return last;
    return (this.lastAccessibilityState = state);
  }

  /** `disabled` over what else said: true always, false only when something said otherwise. */
  private disabledOver(other: unknown): boolean | undefined {
    const own = this.disabledForAccessibility();
    return own || (own === false && other !== undefined) ? own : undefined;
  }

  private mergedAccessibilityValue(): AccessibilityValue | undefined {
    const explicit = this.accessibilityValue();
    const merged: Record<string, unknown> = { ...explicit };
    const set = (key: keyof AccessibilityValue, value: unknown) => {
      if (value !== undefined) merged[key] = value;
    };
    set('min', this.ariaValueMin());
    set('max', this.ariaValueMax());
    set('now', this.ariaValueNow());
    set('text', this.ariaValueText());
    return Object.keys(merged).length ? (merged as AccessibilityValue) : explicit;
  }
}

/**
 * `ViewBase` on its own, for a component whose host is a plain view.
 *
 * No selector: this is only ever a `hostDirectives` entry, and it is the counterpart to
 * `PressBehavior` for the parts of a control that do not take a touch. A radio group is the case
 * that asked for it - it announces itself as a group and holds a value, but pressing it means
 * nothing, and without a `ViewBase` on the node there is nothing to write that role.
 */
@Directive({})
export class ViewBehavior extends ViewBase {}
