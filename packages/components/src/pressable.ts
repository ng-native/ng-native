/**
 * Press handling, built on the engine's responder system as RN's `Pressability` is.
 *
 * `onPress` is not a native event: RN synthesises it in JS from the touch primitives, with a
 * press rectangle, delays and a long-press timer around them. This is that machine, on the same
 * responder negotiation, so a button and an enclosing scroll view agree on who owns a drag.
 */
import {
  Directive,
  booleanAttribute,
  computed,
  forwardRef,
  input,
  numberAttribute,
  output,
  signal,
  type Signal,
} from '@angular/core';
import { nativePlatform, type NativeSyntheticEvent } from '@ng-native/fabric';
import type { Insets, TouchEvent } from './events.ts';
import { optionalBoolean } from './transforms.ts';
import { ViewBase } from './view-base.ts';

/** What a press handler receives: RN's `{nativeEvent}` shape, passed straight through. */
export type PressEvent = TouchEvent;

/**
 * Android's ripple, drawn natively. `foreground` paints it over the content rather than behind.
 */
export interface AndroidRipple {
  readonly color?: string | number;
  readonly borderless?: boolean;
  readonly radius?: number;
  readonly foreground?: boolean;
}

/**
 * How far outside its own bounds a control keeps a press: RN's `DEFAULT_PRESS_RECT_OFFSETS`.
 * More room below, because a thumb rolls downwards as it lifts.
 */
const DEFAULT_PRESS_RETENTION: Required<Insets> = { top: 20, left: 20, right: 20, bottom: 30 };
/** RN's `DEFAULT_LONG_PRESS_DELAY_MS`. */
const DEFAULT_LONG_PRESS_DELAY = 500;
/** RN's `DEFAULT_MIN_PRESS_DURATION`: the pressed look stays at least this long on a quick tap. */
const DEFAULT_MIN_PRESS_DURATION = 130;

/**
 * Used only until a control has been measured. RN measures the view and cancels when the touch
 * leaves its bounds plus the retention offset; before the first layout arrives there are no
 * bounds to compare against, so fall back to a small movement threshold rather than treating a
 * drag of any length as a tap.
 */
const PRESS_CANCEL_DISTANCE = 15;

const insets = (value: Insets | number | undefined, fallback: Required<Insets>) => {
  if (value === undefined) return fallback;
  if (typeof value === 'number') return { top: value, left: value, right: value, bottom: value };
  return {
    top: value.top ?? 0,
    left: value.left ?? 0,
    right: value.right ?? 0,
    bottom: value.bottom ?? 0,
  };
};

/** Page-space touch point, tolerating the several shapes a Fabric touch payload can take. */
function touchPoint(event: NativeSyntheticEvent): { x: number; y: number } {
  const native = (event.nativeEvent ?? {}) as {
    pageX?: number;
    pageY?: number;
    touches?: { pageX?: number; pageY?: number }[];
  };
  const touch = native.touches?.[0];
  return {
    x: native.pageX ?? touch?.pageX ?? 0,
    y: native.pageY ?? touch?.pageY ?? 0,
  };
}

/** What `rippleDrawable` builds: Android's `RippleAndroid` drawable description. */
interface RippleDrawable {
  readonly type: 'RippleAndroid';
  readonly color: unknown;
  readonly borderless: boolean;
  readonly rippleRadius: number | undefined;
}

const now = (): number => globalThis.performance?.now?.() ?? Date.now();

/**
 * The press machine, and the base of every primitive that takes a touch.
 *
 * It declares no host bindings of its own, because `Text` extends it and a host binding runs on
 * every element that carries it, on every pass. The controls bind theirs through `ControlBase`.
 */
@Directive()
export abstract class TouchableBase extends ViewBase {
  /**
   * Ignore touches entirely. Undefined until set, because React Native tells "not passed" from
   * "passed false": only a passed `disabled` wins over `aria-disabled` in what is announced.
   */
  readonly disabled = input(undefined, { transform: optionalBoolean });

  /**
   * How far outside the hit area a touch may wander before the press is cancelled. Native's
   * `hitSlop` grows the area a touch can start in; this grows the area it may move within.
   */
  readonly pressRetentionOffset = input<Insets | number>();
  /** Milliseconds a touch must be held before `(longPress)` fires. */
  readonly delayLongPress = input(DEFAULT_LONG_PRESS_DELAY, { transform: numberAttribute });
  /** Milliseconds between the touch landing and `(pressIn)`, so a scroll can start first. */
  readonly delayPressIn = input(0, { transform: numberAttribute });
  /** Milliseconds between the touch lifting and `(pressOut)`. */
  readonly delayPressOut = input(0, { transform: numberAttribute });
  /** The pressed state lasts at least this long, so a quick tap still shows it. */
  readonly minPressDuration = input(DEFAULT_MIN_PRESS_DURATION, { transform: numberAttribute });
  /** Whether a scrolling ancestor may take the gesture away mid-press. */
  readonly cancelable = input(true, { transform: booleanAttribute });
  /** Android: a native ripple on press. */
  readonly androidRipple = input<AndroidRipple>(undefined, { alias: 'android_ripple' });

  /** The touch lifted inside the press area. Not fired after a `(longPress)` that has a listener. */
  readonly press = output<PressEvent>();
  readonly pressIn = output<PressEvent>();
  readonly pressOut = output<PressEvent>();
  /**
   * The touch has been held for `delayLongPress`. With no listener there is no long press, as in
   * React Native, so a slow tap is still a `press`.
   */
  readonly longPress = output<PressEvent>();

  /** Whether a press is in progress, for the pressed look. */
  readonly pressed = signal(false);

  /**
   * Whether a pointer is over the control, which on this platform means an iPad with a trackpad
   * or a mouse. Always false on a phone, because a phone never sends a pointer event.
   *
   * Opted into by exactly the elements that opt into being measured, which is the same question
   * asked twice: is this a control, or is it a piece of text that merely inherits the machinery.
   * Registering on everything was the first attempt and put two props on every paragraph on
   * screen, which is the most numerous node in an app paying for a state a label cannot use.
   */
  readonly hovered = signal(false);

  /*
   * Methods rather than `computed()`s, because nearly every instance has no ripple and a computed
   * is an allocation per element whether or not it ever holds anything. The drawable is kept for as
   * long as the ripple it came from, which is the memo the computed was there to provide: a fresh
   * object on every pass would re-send the prop on every pass.
   */
  protected rippleBackground(): RippleDrawable | undefined {
    const ripple = this.androidRipple();
    return ripple && !ripple.foreground ? this.drawable(ripple) : undefined;
  }

  protected rippleForeground(): RippleDrawable | undefined {
    const ripple = this.androidRipple();
    return ripple?.foreground ? this.drawable(ripple) : undefined;
  }

  private drawn: { ripple: AndroidRipple; drawable: RippleDrawable } | null = null;

  private drawable(ripple: AndroidRipple): RippleDrawable {
    if (this.drawn?.ripple !== ripple)
      this.drawn = { ripple, drawable: this.rippleDrawable(ripple) };
    return this.drawn.drawable;
  }

  /**
   * The drawable description Android's `ReactDrawableHelper` reads.
   *
   * `color` goes through the engine the way every other colour prop does, and has to: the helper
   * switches on the value's runtime type and takes a number or a platform-colour map, and anything
   * else - a `'#ff0000'` written at the call site, say - falls through to `null` and the ripple
   * draws in the theme's own `colorControlHighlight` instead. Nothing is logged and nothing throws,
   * so the ripple appears and is simply the wrong colour. RN's own `TouchableNativeFeedback.Ripple`
   * calls `processColor` here for the same reason.
   */
  private rippleDrawable(ripple: AndroidRipple): RippleDrawable {
    return {
      type: 'RippleAndroid' as const,
      color: this.engine.color(ripple.color),
      borderless: ripple.borderless ?? false,
      rippleRadius: ripple.radius,
    };
  }

  /** Where the touch started, so a drag can be told apart from a tap. */
  private origin: { x: number; y: number } | null = null;
  /** The control's own size, from its last layout. Null until it has been measured once. */
  private size: { width: number; height: number } | null = null;
  private cancelled = false;
  private longPressed = false;
  /** How many `(longPress)` listeners there are; the long-press clock only runs with one. */
  private longPressListeners = 0;
  private pressedAt = 0;
  private pressInTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private pressOutTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super();
    // output() has to be a member's own initializer for the compiler to see it, so its listeners
    // are counted here, through its public subscribe.
    const subscribe = this.longPress.subscribe.bind(this.longPress);
    this.longPress.subscribe = (callback) => {
      this.longPressListeners++;
      const subscription = subscribe(callback);
      let open = true;
      return {
        unsubscribe: () => {
          if (open) this.longPressListeners--;
          open = false;
          subscription.unsubscribe();
        },
      };
    };
  }

  /** Called as a press starts and ends, for a subclass that shows it natively. `Text` does. */
  protected pressedChanged(_pressed: boolean): void {}

  /** Whether a touch starting on this node should be claimed. `Text` narrows it. */
  protected claims(): boolean {
    return !this.pressDisabled();
  }

  /**
   * Whether presses are refused. `Pressable.js` gives Pressability `disabled` alone, so here
   * `aria-disabled` and `accessibilityState.disabled` change what is announced and nothing else.
   * `TouchableOpacity` and `Text` widen it.
   */
  protected pressDisabled(): boolean {
    return !!this.disabled();
  }

  /**
   * `TouchableOpacity.js` and `Text.js`: `disabled ?? aria-disabled ?? accessibilityState.disabled`,
   * which is the merged announced state whenever `disabled` is unset.
   */
  protected disabledByAnyState(): boolean {
    return (this.disabled() ?? this.accessibilityStateProp()?.disabled) === true;
  }

  /**
   * Whether the control's size should be tracked. Native only measures a view that asks, so
   * this must not be true for every `<text>`: a pressable text opts in, a label never does.
   */
  protected measures(): boolean {
    return true;
  }

  /**
   * Whether a touch this far from where it started is still on the control.
   *
   * Distance from the origin is the wrong question on anything large: a thumb tap on a full-width
   * button easily travels twenty points without ever leaving it, and cancelling there reads as
   * "the button doesn't work", intermittently and only for some people. What matters is whether
   * the finger is still within the control plus its hit slop, plus the slop RN allows.
   *
   * The touch began somewhere inside the control but we do not know where, so the bound is the
   * full extent rather than half of it. That errs towards keeping the press, which is the right
   * way to be wrong: a press that survives a drag the user meant as a scroll is a smaller sin
   * than a tap that does nothing.
   */
  private stillOnControl(dx: number, dy: number): boolean {
    if (!this.size) return Math.hypot(dx, dy) <= PRESS_CANCEL_DISTANCE;
    const slop = insets(this.hitSlop(), { top: 0, left: 0, right: 0, bottom: 0 });
    const keep = insets(this.pressRetentionOffset(), DEFAULT_PRESS_RETENTION);
    const horizontal = dx < 0 ? slop.left + keep.left : slop.right + keep.right;
    const vertical = dy < 0 ? slop.top + keep.top : slop.bottom + keep.bottom;
    return (
      Math.abs(dx) <= this.size.width + horizontal && Math.abs(dy) <= this.size.height + vertical
    );
  }

  /**
   * A lifecycle hook rather than `inject(DestroyRef).onDestroy`: Angular registers a hook once per
   * directive type, where the callback was a closure and a lookup for every instance - and every
   * `<text>` on screen is one.
   */
  ngOnDestroy(): void {
    this.clearTimers();
    this.stopResponding?.();
    this.stopLayout?.();
    this.stopHover?.();
    this.stopClick?.();
  }

  private stopResponding: (() => void) | null = null;
  private stopLayout: (() => void) | null = null;
  private stopHover: (() => void) | null = null;
  private stopClick: (() => void) | null = null;

  override ngOnInit(): void {
    super.ngOnInit();
    this.respondIfNeeded();
    this.measureIfNeeded();
    this.hoverIfNeeded();
    this.clickIfNeeded();
  }

  override ngOnChanges(): void {
    super.ngOnChanges();
    this.respondIfNeeded();
    this.measureIfNeeded();
    this.hoverIfNeeded();
    this.clickIfNeeded();
  }

  /**
   * A press with no touch: Android's `performClick()`, which is what Enter, the D-pad centre and
   * TalkBack's double-tap do to a focused view, and which reaches us as `topClick` alone.
   *
   * `Pressability.js` answers it in `onClick`: `onPress` and nothing around it, not while disabled,
   * and not for a click carrying a `pointerType`, which is the pointer event a touch already
   * pressed through. It presses only the view that was clicked: a touchable the click only bubbled
   * through stops it there, so neither it nor anything above it acts on a click meant for a
   * focusable view inside it.
   *
   * Android only. iOS sends a click only as a pointer event, and the web host binds `topClick` to
   * the DOM's own click, which a mouse press already reached through the responder.
   */
  private clickIfNeeded(): void {
    if (this.stopClick || !this.measures() || nativePlatform() !== 'android') return;
    this.stopClick = this.engine.setEventListener(this.node, 'topClick', (event) => {
      const click = event as PressEvent;
      if (!this.measures() || Object.hasOwn(click.nativeEvent ?? {}, 'pointerType')) return;
      if (click.target !== this.node) {
        click.stopPropagation();
        return;
      }
      if (this.claims()) this.press.emit(click);
    });
  }

  /**
   * Join the responder negotiation, once this is something a touch can press.
   *
   * Behind `measures()` for the same reason as layout and hover: a `<text>` is the commonest node
   * on screen and almost never a control, and registering every one cost a handler object, six
   * closures and a responder entry apiece for a touch it would have refused anyway.
   */
  private respondIfNeeded(): void {
    if (this.stopResponding || !this.measures()) return;
    this.stopResponding = this.engine.setResponder(this.node, {
      // Claim the gesture on touch down unless disabled. Because this goes through the
      // negotiation, an ancestor can pre-empt us in the capture pass and a nested pressable
      // wins over us in the bubble pass, neither of which raw touch listeners could express.
      onStartShouldSetResponder: () => this.claims(),
      onResponderGrant: (event) => this.onGrant(event),
      onResponderMove: (event) => this.onMove(event),
      onResponderRelease: (event) => this.onRelease(event),
      onResponderTerminate: (event) => this.onTerminate(event),
      // Yield to an enclosing scroll view when it takes over the drag, unless told not to.
      onResponderTerminationRequest: () => this.cancelable(),
    });
  }

  /**
   * `onLayout` is opted into by the engine as soon as something listens for it, which is the only
   * way the native side reports a view's size at all, and the reason it is only asked for once
   * `measures()` says so - a `<text>` answers that from an input, and most of them say no.
   *
   * Called from the lifecycle rather than watched by an effect. An effect per element is an
   * allocation and a scheduler entry for every pressable and every piece of text on screen, to
   * notice a change these two hooks already see.
   */
  /**
   * Hover, on the same terms and behind the same question.
   *
   * Fabric will not dispatch a pointer event to a view whose props have not asked for one, and
   * the engine writes those props when something listens - so listening is the whole opt-in. The
   * gate is `measures()`, which is not what its name is about but is the right question underneath
   * it: is this an actual control, or a piece of text that merely inherits the machinery. A label
   * says no, and two props on every paragraph on screen is not a cost worth paying for a hover
   * state a label has no use for.
   *
   * Never true on a phone, which sends no pointer events at all. This is the one thing an iPad
   * with a trackpad has that a phone does not.
   */
  private hoverIfNeeded(): void {
    if (this.stopHover || !this.measures()) return;
    const enter = this.engine.setEventListener(this.node, 'topPointerEnter', () =>
      this.hovered.set(true),
    );
    const leave = this.engine.setEventListener(this.node, 'topPointerLeave', () =>
      this.hovered.set(false),
    );
    this.stopHover = () => {
      enter();
      leave();
    };
  }

  private measureIfNeeded(): void {
    if (this.stopLayout || !this.measures()) return;
    this.stopLayout = this.engine.setEventListener(this.node, 'topLayout', (event) => {
      const layout = (event as NativeSyntheticEvent<{ layout?: { width: number; height: number } }>)
        .nativeEvent?.layout;
      if (layout) this.size = { width: layout.width, height: layout.height };
    });
  }

  private onGrant(event: PressEvent): void {
    this.origin = touchPoint(event);
    this.cancelled = false;
    this.longPressed = false;
    this.clearTimers();
    if (this.androidRipple()) {
      const { x, y } = this.origin;
      this.engine.dispatchCommand(this.node, 'hotspotUpdate', [x, y]);
      this.engine.dispatchCommand(this.node, 'setPressed', [true]);
    }
    const delay = this.delayPressIn();
    if (delay > 0) this.pressInTimer = setTimeout(() => this.activate(event), delay);
    else this.activate(event);
  }

  /** `pressIn`, and the long-press clock starts from here. */
  private activate(event: PressEvent): void {
    this.pressInTimer = null;
    this.pressedAt = now();
    this.pressed.set(true);
    this.pressedChanged(true);
    this.pressIn.emit(event);
    if (!this.longPressListeners) return;
    this.longPressTimer = setTimeout(() => {
      this.longPressTimer = null;
      this.longPressed = true;
      this.longPress.emit(event);
    }, this.delayLongPress());
  }

  private onMove(event: PressEvent): void {
    if (this.cancelled || !this.origin) return;
    const point = touchPoint(event);
    if (this.stillOnControl(point.x - this.origin.x, point.y - this.origin.y)) return;
    // The finger has wandered: this is a drag, not a tap. Give up the press but stay the
    // responder, so a scroll view underneath still gets its gesture.
    this.cancelled = true;
    this.deactivate(event);
  }

  private onRelease(event: PressEvent): void {
    if (this.androidRipple()) this.engine.dispatchCommand(this.node, 'setPressed', [false]);
    if (this.cancelled) return;
    // Lifted before the press-in delay ran out: RN still reports a full press.
    if (this.pressInTimer) {
      clearTimeout(this.pressInTimer);
      this.activate(event);
    }
    const longPressed = this.longPressed;
    this.deactivate(event);
    if (!longPressed) this.press.emit(event);
  }

  private onTerminate(event: PressEvent): void {
    if (this.androidRipple()) this.engine.dispatchCommand(this.node, 'setPressed', [false]);
    if (this.cancelled) return;
    this.cancelled = true;
    this.deactivate(event);
  }

  /** `pressOut`, no sooner than `minPressDuration` after `pressIn` and after `delayPressOut`. */
  private deactivate(event: PressEvent): void {
    if (this.pressInTimer) {
      clearTimeout(this.pressInTimer);
      this.pressInTimer = null;
      return;
    }
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
    if (!this.pressed()) return;
    const held = now() - this.pressedAt;
    const delay = Math.max(this.delayPressOut(), this.minPressDuration() - held);
    const out = () => {
      this.pressOutTimer = null;
      this.pressed.set(false);
      this.pressedChanged(false);
      this.pressOut.emit(event);
    };
    if (delay > 0) this.pressOutTimer = setTimeout(out, delay);
    else out();
  }

  private clearTimers(): void {
    // Every touchable is destroyed through here, and nearly all of them were never pressed.
    if (!this.pressInTimer && !this.longPressTimer && !this.pressOutTimer) return;
    for (const timer of [this.pressInTimer, this.longPressTimer, this.pressOutTimer]) {
      if (timer) clearTimeout(timer);
    }
    this.pressInTimer = this.longPressTimer = this.pressOutTimer = null;
  }
}

/**
 * A touchable that is a control: `Pressable`, `TouchableOpacity` and `PressBehavior`.
 *
 * The host bindings every control needs live here rather than on `TouchableBase`, which `Text`
 * extends: the state that follows `disabled`, and the Android ripple. Controls are few enough on
 * a screen to pay for a binding on every pass; texts are not.
 */
@Directive({
  host: {
    // `disabled` is an input of ours, so it cannot reach `ngOnChanges` on the base; this is
    // the one binding that keeps the announced state in step with it.
    '[accessibilityState]': 'accessibilityStateProp()',
    // Nor is it left on the node for `:disabled` to read, so this is what a stylesheet matches.
    '[attr.data-disabled]': "pressDisabled() ? '' : null",
    '[nativeBackgroundAndroid]': 'rippleBackground()',
    '[nativeForegroundAndroid]': 'rippleForeground()',
  },
})
export abstract class ControlBase extends TouchableBase {}

/**
 * The press machine on its own, for a component that wants to be pressable rather than to
 * contain something that is.
 *
 * No selector: this is only ever a `hostDirectives` entry. A component listing it gets the whole
 * of `TouchableBase` on its own host node - the responder negotiation, the press rectangle, the
 * delays and the long-press timer - instead of wrapping a `<pressable>` and paying for a second
 * native view.
 *
 * It provides `TouchableBase`, so a primitive on the same node can `inject(TouchableBase)` and
 * read `pressed` without caring whether it landed on this or on a real `<pressable>`.
 */
@Directive({
  providers: [{ provide: TouchableBase, useExisting: forwardRef(() => PressBehavior) }],
})
export class PressBehavior extends ControlBase {
  /** The conditions the composing component gave, any of which disables the control. */
  private readonly conditions = signal<readonly Signal<boolean>[]>([]);
  private readonly held = computed(() => this.conditions().some((condition) => condition()));

  /**
   * Disable the control while `condition` is true, from the component that composes this: a
   * button that is loading, which its caller's `disabled` knows nothing of. Either one disables
   * it, as `disabled={loading || disabled}` does on React Native's `Pressable`: presses are
   * refused, a stylesheet sees `[data-disabled]`, and a screen reader is told.
   *
   *     constructor() {
   *       inject(PressBehavior).disableWhile(this.loading);
   *     }
   */
  disableWhile(condition: Signal<boolean>): void {
    this.conditions.update((conditions) => [...conditions, condition]);
  }

  protected override accessibleByDefault(): boolean {
    return true;
  }

  protected override focusableByDefault(): boolean {
    return true;
  }

  protected override pressDisabled(): boolean {
    return this.held() || super.pressDisabled();
  }

  protected override disabledForAccessibility(): boolean | undefined {
    return this.held() ? true : this.disabled();
  }
}

/**
 * A view that responds to presses. RN's `Pressable`, with the same configuration: hit slop,
 * retention offset, press-in and press-out delays, long press, and an Android ripple.
 *
 * `pressed` is a public signal, so a template can style from it through a template reference:
 * `<pressable #p [style.opacity]="p.pressed() ? 0.5 : 1">`.
 */
@Directive({
  selector: 'pressable',
  exportAs: 'pressable',
  providers: [{ provide: TouchableBase, useExisting: forwardRef(() => Pressable) }],
})
export class Pressable extends ControlBase {
  /** `Pressable.js`: a control is an accessibility element, and focusable, unless refused. */
  protected override accessibleByDefault(): boolean {
    return true;
  }

  protected override focusableByDefault(): boolean {
    return true;
  }

  protected override disabledForAccessibility(): boolean | undefined {
    return this.disabled();
  }
}
