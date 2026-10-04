/**
 * What the engine evaluates media queries against, kept in step with the device.
 *
 * Not a service, because the engine is not injectable and has no reason to be: it is handed to
 * `mount` and handed back, and this connects the two. An app that wants `@media` to keep working
 * after a rotation or a theme change calls `watchConditions` once and never thinks about it again.
 *
 * A rotation changes no component and no binding, so nothing would be dirty and nothing would
 * re-render. The engine re-resolves and commits on its own when the conditions change.
 */
import type { Conditions, TokenValue } from '@ng-native/fabric';
import { accessibilitySource } from './accessibility.ts';
import { colorSchemeSource } from './color-scheme.ts';
import { directionSource } from './direction.ts';
import { screenSource } from './screen.ts';
import { reactNative } from './react-native.ts';

/** Just enough of the engine to be told. */
interface Resolves<Node = unknown> {
  readonly root: Node;
  updateConditions(conditions: Conditions): void;
  addClass(node: Node, name: string): void;
  removeClass(node: Node, name: string): void;
  /** Measure every text again, after the system text size changed. */
  remeasureText?(): void;
}

/** The system text size, as a multiplier. One off a device. */
function fontScale(): number {
  return reactNative()?.PixelRatio.getFontScale() ?? 1;
}

export interface WatchOptions {
  /**
   * Keep a `dark` class on the root in step with the system scheme, which is what
   * `@ng-native/tailwind`'s `dark:` variant matches. On by default; an app with its own theme
   * switch turns it off and puts `dark` on its own root view instead.
   */
  readonly darkClass?: boolean;
}

export function currentConditions(): Conditions {
  const { window } = screenSource().current();
  return {
    width: window.width,
    height: window.height,
    colorScheme: colorSchemeSource().current(),
    // Asynchronous on both platforms, so the first paint says no preference and `watchConditions`
    // corrects it. Reduced motion is a preference about what happens next, not about the frame
    // already on screen, so nothing is lost by learning it a tick late.
    reducedMotion: false,
    fontScale: fontScale(),
    // Settled while the native side starts up, and fixed until the app restarts.
    direction: directionSource().current(),
  };
}

/**
 * Custom properties the device settles before the first frame, for `mount`'s `tokens` option.
 *
 * Only the hairline so far: the thinnest line the screen can draw, which is a third of a point on
 * a 3x phone and half of one on a 2x. `1px` is what a browser would give and is a visibly fat
 * divider on a modern screen, so a native-looking rule has to ask. React Native works the number
 * out from the pixel ratio; off a device there is no answer, and inventing one would be a line of
 * the wrong weight in every test that draws one.
 *
 * Not watched, unlike the conditions: the pixel density of a screen does not change while an app
 * is open. The safe-area insets are the opposite case and arrive through `updateTokens`.
 */
export function deviceTokens(): Record<string, TokenValue> {
  const native = reactNative();
  return native ? { '--hairline': { length: native.StyleSheet.hairlineWidth } } : {};
}

/**
 * Keep the engine's conditions current. Returns an unsubscribe, though an app that calls this at
 * bootstrap will never use it.
 */
export function watchConditions<Node>(
  engine: Resolves<Node>,
  options: WatchOptions = {},
): () => void {
  const screen = screenSource();
  const colors = colorSchemeSource();
  const accessibility = accessibilitySource();

  let conditions = currentConditions();
  const push = (change: Partial<Conditions>) => {
    conditions = { ...conditions, ...change };
    if (options.darkClass !== false) {
      if (conditions.colorScheme === 'dark') engine.addClass(engine.root, 'dark');
      else engine.removeClass(engine.root, 'dark');
    }
    engine.updateConditions(conditions);
  };
  // The class for the scheme the app started in, committed at once. Light needs nothing: an app
  // starting light is exactly what it already rendered.
  if (options.darkClass !== false && conditions.colorScheme === 'dark') push({});

  // The system text size. Every text on screen was measured at the old one, and keeps that box
  // until it is measured again, so a change goes into the conditions and then re-measures them
  // all. A change arrives as a `Dimensions` change on both platforms; the app coming back to the
  // foreground is checked as well, and the same change reported by both is re-measured once.
  let scale = conditions.fontScale ?? 1;
  const resize = (change: Partial<Conditions>, next: number) => {
    const rescaled = next !== scale;
    scale = next;
    push({ ...change, fontScale: next });
    if (rescaled) engine.remeasureText?.();
  };

  const sizes = screen.subscribe(({ window }) =>
    resize({ width: window.width, height: window.height }, fontScale()),
  );
  const scheme = colors.subscribe((colorScheme) => push({ colorScheme }));
  const settings = accessibility.subscribe((change) => {
    if (change.fontScale !== undefined && change.fontScale !== scale) resize({}, change.fontScale);
    if (change.reduceMotion !== undefined) push({ reducedMotion: change.reduceMotion });
  });
  void accessibility
    .current()
    .then(({ reduceMotion }) => reduceMotion && push({ reducedMotion: true }));

  return () => {
    sizes();
    scheme();
    settings();
  };
}
