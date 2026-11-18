/**
 * How much of the screen belongs to the system: the notch, the status bar, the home indicator,
 * a rounded corner, and on Android the display cutout and the navigation bar.
 *
 * Unlike everything else here, this has no React Native module behind it. Insets are a property
 * of a *view*, not of the device, and the only thing that can report them is a native view inside
 * the window - `<safe-area-provider>` in `@ng-native/components`, which pushes what it
 * measures in here. That is also why the values start at zero: nothing is known until a view has
 * been laid out, which is one frame after the app mounts.
 *
 * Most layouts should not read this at all. A `<safe-area-view>` applies the insets natively,
 * without a round trip through JavaScript, and a screen in a native stack has its header do it.
 * This is for the cases neither covers: a floating button that must clear the home indicator, a
 * scroll view whose content inset is computed, a sheet drawing its own chrome.
 */
import { Service, computed, signal, type Signal } from '@angular/core';

export interface Insets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface Frame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const NOTHING: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

@Service()
export class SafeArea {
  /** Whether the service is here: on every OS, where it answers what the OS reports. */
  readonly available: Signal<boolean> = signal(true).asReadonly();

  private readonly current = signal<Insets>(NOTHING);
  private readonly measured = signal<Frame | null>(null);
  private readonly controls = signal(0);
  private readonly trailingControls = signal(0);
  /** What each provider still up last reported, the latest last. */
  private readonly reports = new Map<
    object,
    { insets: Insets; frame: Frame; titlebarLeading: number; titlebarTrailing: number }
  >();
  private reporter: object | null = null;

  /** What the system occupies on each edge, in points. */
  readonly insets: Signal<Insets> = this.current.asReadonly();

  /**
   * The provider's own frame: the area it was handed to lay out in.
   *
   * On Android 15 that includes the system bars, because the app draws behind them - which is why
   * `Screen.window` reads this rather than `Dimensions`. Null until the provider has laid out,
   * one frame after the app mounts, and again once every provider that reported is destroyed.
   */
  readonly frame: Signal<Frame | null> = this.measured.asReadonly();

  /**
   * On macOS, how far the window's close, minimise and zoom buttons reach into the reporting
   * pane from its leading edge: what `--safe-area-inset-titlebar-leading` holds. Their width in a
   * window with no sidebar and in the sidebar pane under them; zero in the content pane beside a
   * sidebar, which they do not reach. On Linux, the reach of the window controls on the leading
   * side, in a window whose content runs under its header bar; zero on every other OS. One value
   * for the app: the latest report's, not one per pane.
   */
  readonly titlebarLeading: Signal<number> = this.controls.asReadonly();

  /**
   * How far a desktop window's title bar controls reach into the reporting pane from its trailing
   * edge: what `--safe-area-inset-titlebar-trailing` holds. Zero on macOS, whose controls are on
   * the leading side, on Linux in a window whose content stays below its header bar (the default
   * title bar), and on every OS with no title bar. One value for the app, as `titlebarLeading` is.
   */
  readonly titlebarTrailing: Signal<number> = this.trailingControls.asReadonly();

  /** Whether anything has reported yet, for a layout that would rather wait than jump. */
  readonly known = computed(() => this.measured() !== null);

  /**
   * Called by `<safe-area-provider>` when native reports. Not for apps: an inset written from
   * anywhere else is a number that stops matching the screen the moment the device rotates.
   */
  report(
    insets: Insets,
    frame: Frame,
    from?: object,
    titlebarLeading = 0,
    titlebarTrailing = 0,
  ): void {
    this.current.set(insets);
    this.measured.set(frame);
    this.controls.set(titlebarLeading);
    this.trailingControls.set(titlebarTrailing);
    this.reporter = from ?? null;
    if (!from) return;
    this.reports.delete(from);
    this.reports.set(from, { insets, frame, titlebarLeading, titlebarTrailing });
  }

  /**
   * Called by `<safe-area-provider>` as it goes: forgets its report. When that report was the
   * latest, what a provider still up last reported takes its place, or nothing when none is.
   * True when the values changed.
   */
  withdraw(from: object): boolean {
    this.reports.delete(from);
    if (this.reporter !== from) return false;
    const [previous] = [...this.reports].slice(-1);
    this.reporter = previous?.[0] ?? null;
    this.current.set(previous?.[1].insets ?? NOTHING);
    this.measured.set(previous?.[1].frame ?? null);
    this.controls.set(previous?.[1].titlebarLeading ?? 0);
    this.trailingControls.set(previous?.[1].titlebarTrailing ?? 0);
    return true;
  }
}
