import {
  Component,
  DestroyRef,
  Directive,
  ElementRef,
  EnvironmentInjector,
  InjectionToken,
  afterRenderEffect,
  computed,
  contentChild,
  effect,
  inject,
  input,
  signal,
  untracked,
  type Provider,
} from '@angular/core';
import { KEYBOARD_MOTION, Keyboard, SCREEN_IN_FRONT, SafeArea } from '@ng-native/device';
import {
  claimHost,
  nativePlatform,
  registerViewName,
  type HostNode,
  type ScrollDrive,
  type ScrollRange,
} from '@ng-native/fabric';
import { TemplateSlot } from './template-slot.ts';
import { TextInput } from './text-input.ts';
import { View } from './view.ts';
import { ViewBase } from './view-base.ts';

/**
 * Whether react-native-keyboard-controller is installed, which is what lets a `<keyboard-dock>`
 * on iOS follow the keyboard frame by frame. See `provideKeyboardController`.
 */
export const KEYBOARD_CONTROLLER = new InjectionToken<boolean>('KEYBOARD_CONTROLLER', {
  providedIn: 'root',
  factory: () => false,
});

/**
 * Say that react-native-keyboard-controller is installed, for `<keyboard-dock>` to use on iOS.
 * Nothing is imported from it: the dock drives its native views directly.
 */
export function provideKeyboardController(): Provider {
  return { provide: KEYBOARD_CONTROLLER, useValue: true };
}

/** What carries the keyboard's height, frame by frame, in react-native-keyboard-controller. */
const KEYBOARD_FEED = {
  events: ['onKeyboardMove', 'onKeyboardMoveInteractive', 'onKeyboardMoveEnd'],
  path: ['height'],
};

/** Far enough that no keyboard is taller; native interpolation takes numbers, not infinity. */
const FAR = 10_000;

/** A native view the dock renders for itself, out of the way of the layout. */
const OUT_OF_FLOW = { position: 'absolute', width: 0, height: 0 };

/** Over the dock, out of the way of the layout, so its bottom edge is the dock's. */
const OVER_DOCK = { position: 'absolute', top: 0, bottom: 0, left: 0, width: 0 };

type KeyboardMoveEvent = { nativeEvent?: { height?: number } };

/** react-native-keyboard-controller's view that reports the keyboard. See `KeyboardDock`. */
@Directive({
  selector: 'keyboard-controller-view',
  host: { '[enabled]': 'true' },
})
export class KeyboardControllerView {
  constructor() {
    registerViewName('keyboard-controller-view', 'KeyboardControllerView');
    claimHost(inject(ElementRef).nativeElement as HostNode);
  }
}

/**
 * The native view `KEYBOARD_MOTION` names, which reports how far the keyboard covers the dock at
 * every frame of its motion. See `KeyboardDock`.
 */
@Directive({ selector: 'keyboard-motion-view' })
export class KeyboardMotionView {
  constructor() {
    const motion = inject(KEYBOARD_MOTION);
    if (motion) registerViewName('keyboard-motion-view', motion.viewName);
    claimHost(inject(ElementRef).nativeElement as HostNode);
  }
}

/**
 * react-native-keyboard-controller's drag area. On iOS it registers `offset` for the field with
 * `textInputNativeID`, so an interactive dismissal takes the keyboard from that far above it.
 */
@Directive({
  selector: 'keyboard-gesture-area',
  host: { '[offset]': 'offset()', '[textInputNativeID]': 'textInputNativeID()' },
})
export class KeyboardGestureArea {
  readonly offset = input<number>();
  readonly textInputNativeID = input<string>();

  constructor() {
    registerViewName('keyboard-gesture-area', 'KeyboardGestureArea');
    claimHost(inject(ElementRef).nativeElement as HostNode);
  }
}

/**
 * A bar that sits on the keyboard: a chat's composer, a comment box, a row of formatting keys.
 * At the bottom of its parent, clear of the home indicator or navigation bar, while the keyboard
 * is down; on top of it while it is up.
 *
 * On iOS with react-native-keyboard-controller (`provideKeyboardController()`), the bar is moved
 * by the keyboard's height on the native side, frame by frame, the way UIKit carries an input
 * accessory: as the keyboard rises and falls, and while a finger drags it down through a scroll
 * view with `keyboardDismissMode="interactive"`, where iOS reports no keyboard frames to
 * JavaScript at all. The drag takes the keyboard from the top of the bar rather than the top of
 * the keyboard, as Messages does, and a short one springs it back up. `keyboardLift` moves
 * content above with it.
 *
 * On Android with `@ng-native/expo`'s `provideNativeKeyboard()`, the bar is moved the same way, by
 * a view of that package's that reports how far the keyboard covers the dock at every frame. It is
 * measured on screen, so a dock that is not at the bottom of the window, or is in a form sheet
 * react-native-screens raises with the keyboard, rises only as far as it still must. Android does
 * not use react-native-keyboard-controller: its view adds the navigation bar as margins around the
 * whole app's content, which an app drawn edge to edge does not want.
 *
 * Otherwise the bar is padded by as much of the keyboard as covers it, which it learns as the
 * keyboard starts to move; on Android it jumps into place then, rather than moving with the
 * keyboard. A window the system resized for the keyboard already puts it clear, and then it is not
 * padded at all.
 *
 * `covered()` is how much of the bottom of the screen the keyboard covers beyond the dock's own
 * place, for content above that keeps clear of it with padding or an inset rather than moving.
 */
@Component({
  selector: 'keyboard-dock',
  exportAs: 'keyboardDock',
  imports: [KeyboardControllerView, KeyboardGestureArea, KeyboardMotionView, TemplateSlot, View],
  // One slot, stamped in whichever branch applies: two `<ng-content>`s of the same selector would
  // be given the content at compile time, whichever branch renders.
  template: `
    <ng-template #content><ng-content /></ng-template>
    @if (lifts) {
      @if (motion) {
        <keyboard-motion-view
          [style]="overDock"
          (keyboardMoveStart)="onKeyboardMove($event)"
          (keyboardMoveEnd)="onKeyboardMove($event)"
        />
      } @else {
        <keyboard-controller-view
          [style]="outOfFlow"
          (keyboardMoveStart)="onKeyboardMove($event)"
          (keyboardMoveEnd)="onKeyboardMove($event)"
        />
        <keyboard-gesture-area
          [style]="outOfFlow"
          [offset]="barHeight()"
          [textInputNativeID]="inputID()"
        />
      }
      <view
        collapsable="false"
        [style.backgroundColor]="backgroundColor()"
        (layout)="onBarLayout($event)"
        ><ng-container [templateSlot]="content" [templateSlotContext]="none"
      /></view>
    } @else {
      <ng-container [templateSlot]="content" [templateSlotContext]="none" />
    }
  `,
  host: {
    '[style.paddingBottom]': 'padding()',
    '[style.backgroundColor]': 'backgroundColor()',
    '(layout)': 'onLayout()',
  },
})
export class KeyboardDock extends ViewBase {
  /** The bar's background, under the inset it sits above as well as the bar itself. */
  readonly backgroundColor = input<string>();

  private readonly keyboard = inject(Keyboard);
  private readonly safeArea = inject(SafeArea);
  protected readonly none = {};
  protected readonly outOfFlow = OUT_OF_FLOW;
  protected readonly overDock = OVER_DOCK;

  /** On Android, the view that reports the keyboard's motion, where the build has one. */
  protected readonly motion = nativePlatform() === 'android' ? inject(KEYBOARD_MOTION) : null;

  /**
   * Native moves the bar: on iOS with the controller, on Android with the motion view. Read once:
   * neither changes under an app.
   */
  protected readonly lifts =
    this.motion !== null || (nativePlatform() === 'ios' && inject(KEYBOARD_CONTROLLER));

  private readonly field = contentChild(TextInput, { descendants: true, read: ElementRef });
  private readonly fieldInput = contentChild(TextInput, { descendants: true });

  /** Where the dock's bottom edge is in the window, which the keyboard is compared to. */
  private readonly bottomEdge = signal<number | null>(null);
  /** The bar's own height, measured, which the drag that lowers the keyboard starts above. */
  protected readonly barHeight = signal(0);
  /**
   * The keyboard's height over the dock as native last reported it: the controller's keyboard
   * height, excluding the drag area, or the motion view's cover of the dock.
   */
  private readonly controlled = signal(0);

  /** The inset under the bar while the keyboard is down: the home indicator or navigation bar. */
  private readonly inset = computed(() => this.safeArea.insets().bottom);

  readonly covered = computed(() =>
    this.lifts ? Math.max(0, this.controlled() - this.inset()) : 0,
  );

  protected readonly padding = computed(() => {
    if (this.lifts) return this.inset();
    const { height, screenY } = this.keyboard.metrics();
    if (height === 0) return this.inset();
    const edge = this.bottomEdge();
    if (edge === null || screenY === undefined) return height;
    // The edge is in the window, and on Android that can start below the status bar.
    return Math.max(0, edge - (screenY - this.keyboard.windowTop));
  });

  /**
   * The field the drag area belongs to, by `nativeID`, which the controller finds it by. A field
   * without one is given one.
   */
  protected readonly inputID = computed(() => {
    const input = this.fieldInput();
    const node = this.field()?.nativeElement as HostNode | undefined;
    if (!input || !node) return undefined;
    const own = input.nativeID() ?? input.id();
    if (own) return own;
    const id = `keyboard-dock-${++docks}`;
    untracked(() => this.engine.setProp(node, 'nativeID', id));
    return id;
  });

  /** The bar, and anything `keyboardLift` moves, rises by the keyboard less the inset under it. */
  readonly liftRange = computed<ScrollRange>(() => {
    const inset = this.inset();
    return { input: [inset, inset + FAR], output: [0, -FAR] };
  });

  private source: HostNode | null = null;

  private readonly inFront = inject(SCREEN_IN_FRONT);

  constructor() {
    super();
    if (this.lifts) this.liftBar();
    // A root effect, because a covered screen's views are detached from change detection, and a
    // view's own effects wait for it.
    const front = effect(
      () => {
        const inFront = this.inFront();
        untracked(() => {
          if (!inFront && this.keyboard.height() > 0) this.keyboard.dismiss();
        });
      },
      { injector: inject(EnvironmentInjector), manualCleanup: true },
    );
    inject(DestroyRef).onDestroy(() => front.destroy());
  }

  /**
   * Move a view with the keyboard on the native side, as the bar is moved: content above the bar
   * that should rise with it. Null when native does not move the bar. See `keyboardLift`.
   */
  lift(view: HostNode, shift: number | null = null): ScrollDrive | null {
    if (!this.lifts) return null;
    const source = this.controllerView();
    const range = this.liftRange();
    return this.engine.driveByEvent(view, source, KEYBOARD_FEED, 'translateY', range, [], shift);
  }

  private liftBar(): void {
    let drive: ScrollDrive | null = null;
    afterRenderEffect(() => {
      const range = this.liftRange();
      untracked(() => {
        if (drive) return drive.update(range);
        const bar = this.barView();
        if (bar) drive = this.lift(bar);
      });
    });
    inject(DestroyRef).onDestroy(() => drive?.stop());
  }

  /** The controller's or the motion view, the one whose events carry the keyboard. */
  private controllerView(): HostNode {
    this.source ??= this.node.childList.find((child) => child.nodeKind === 'element') ?? this.node;
    return this.source;
  }

  /** The view holding the content, the last of the dock's own. */
  private barView(): HostNode | undefined {
    return this.node.childList.filter((child) => child.nodeKind === 'element').at(-1);
  }

  protected onKeyboardMove(event: unknown): void {
    const height = (event as KeyboardMoveEvent).nativeEvent?.height;
    if (height !== undefined) this.controlled.set(height);
  }

  protected onBarLayout(event: { nativeEvent?: { layout?: { height?: number } } }): void {
    const height = event.nativeEvent?.layout?.height;
    if (height !== undefined) this.barHeight.set(height);
  }

  protected onLayout(): void {
    if (this.lifts) return;
    this.engine.measure(this.node, (frame) => this.bottomEdge.set(frame.y + frame.height));
  }
}

let docks = 0;

/**
 * Moves its view with a `<keyboard-dock>`'s bar: `<view [keyboardLift]="dock">` around a chat's
 * transcript keeps the newest message on top of the bar as the keyboard rises, falls and is
 * dragged. Put it inside a view that clips, so what rises past the top is hidden rather than
 * drawn over what is above. Does nothing where native does not move the bar.
 *
 * Once the keyboard has moved, the view is padded by as much of it as covers the view, and moved
 * back down by the same amount, which leaves it where it was on screen: since iOS 26 a scroll view
 * the keyboard overlaps in layout draws a frosted edge effect over the part it thinks is covered,
 * and a transform does not change what it thinks.
 */
@Directive({
  selector: '[keyboardLift]',
  host: { '[style.paddingBottom]': 'padding()' },
})
export class KeyboardLift {
  readonly dock = input.required<KeyboardDock>({ alias: 'keyboardLift' });

  protected readonly padding = computed(() => {
    const covered = this.dock().covered();
    return covered > 0 ? covered : undefined;
  });

  constructor() {
    const view = inject(ElementRef).nativeElement as HostNode;
    let drive: ScrollDrive | null = null;
    afterRenderEffect(() => {
      const dock = this.dock();
      const range = dock.liftRange();
      const covered = dock.covered();
      untracked(() => {
        if (!drive) drive = dock.lift(view, covered);
        drive?.update(range);
        drive?.shift(covered);
      });
    });
    inject(DestroyRef).onDestroy(() => drive?.stop());
  }
}
