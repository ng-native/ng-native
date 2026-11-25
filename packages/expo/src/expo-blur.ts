/**
 * `<expo-blur>`, typed: `expo-blur`'s view, registered with `registerExpoViews('expo-blur')`,
 * with its props as inputs so a template is checked against them. Each goes straight to the view.
 * The registration sets `intensity` to 50 and `tint` to `default`, as `expo-blur`'s React
 * component does, and an input left unset keeps them.
 *
 * ```html
 * <expo-blur class="absolute inset-0" tint="dark" intensity="80" />
 * ```
 *
 * On Android the view on its own draws its tint, not a blur: `expo-blur` blurs there only the
 * content of an `<expo-blur-target>` given as `[blurTarget]`, with a `blurMethod` other than `none`.
 */
import {
  Component,
  Injector,
  afterEveryRender,
  effect,
  inject,
  input,
  signal,
  untracked,
  type AfterRenderRef,
} from '@angular/core';
import { Engine, type EngineNode } from '@ng-native/fabric';
import type { ExpoBlurTarget } from './expo-blur-target.ts';
import { optionalNumber } from './transforms.ts';

/** The tints `expo-blur` takes. Each but `default` adds a translucent colour over the blur. */
export type BlurTint =
  | 'light'
  | 'dark'
  | 'default'
  | 'extraLight'
  | 'regular'
  | 'prominent'
  | 'systemUltraThinMaterial'
  | 'systemThinMaterial'
  | 'systemMaterial'
  | 'systemThickMaterial'
  | 'systemChromeMaterial'
  | 'systemUltraThinMaterialLight'
  | 'systemThinMaterialLight'
  | 'systemMaterialLight'
  | 'systemThickMaterialLight'
  | 'systemChromeMaterialLight'
  | 'systemUltraThinMaterialDark'
  | 'systemThinMaterialDark'
  | 'systemMaterialDark'
  | 'systemThickMaterialDark'
  | 'systemChromeMaterialDark';

/** How Android draws the blur. `none`, its default, draws a translucent view instead. */
export type BlurMethod = 'none' | 'dimezisBlurView' | 'dimezisBlurViewSdk31Plus';

@Component({
  selector: 'expo-blur',
  template: '<ng-content />',
  host: {
    '[tint]': 'tint()',
    '[intensity]': 'intensity()',
    '[blurReductionFactor]': 'blurReductionFactor()',
    '[blurMethod]': 'blurMethod()',
    '[blurTargetId]': 'targetTag()',
  },
})
export class ExpoBlur {
  readonly tint = input<BlurTint>();
  /** From 1 to 100. */
  readonly intensity = input<number>(undefined, { transform: optionalNumber });
  /** What Android divides the intensity by, to match iOS more closely. Android only. */
  readonly blurReductionFactor = input<number>(undefined, { transform: optionalNumber });
  /** Android only. */
  readonly blurMethod = input<BlurMethod>();
  /** The `<expo-blur-target>` whose content the blur samples. Android only, where it is needed. */
  readonly blurTarget = input<ExpoBlurTarget | null>();

  private readonly engine = inject(Engine);
  private readonly injector = inject(Injector);
  /** The target's view tag, committed as `blurTargetId` as `BlurView` does, or null with none. */
  protected readonly targetTag = signal<number | null>(null);

  constructor() {
    effect(() => this.follow(this.blurTarget()?.node ?? null));
  }

  /** Reading the target's tag after each render, while it has none. */
  private waiting: AfterRenderRef | undefined;

  /**
   * The target's tag. A view not yet committed has none, and one hidden with `display: none` has
   * none until it is shown, so it is read after each render until it has one.
   */
  private follow(node: EngineNode | null): void {
    this.waiting?.destroy();
    this.waiting = undefined;
    const tag = node && this.engine.tagOf(node);
    this.targetTag.set(tag ?? null);
    if (!node || tag !== null) return;
    // Out of the effect that calls this, which may not register a render hook itself.
    const waiting = untracked(() =>
      afterEveryRender(
        () => {
          const found = this.engine.tagOf(node);
          if (found === null) return;
          waiting.destroy();
          this.targetTag.set(found);
        },
        { injector: this.injector },
      ),
    );
    this.waiting = waiting;
  }
}
