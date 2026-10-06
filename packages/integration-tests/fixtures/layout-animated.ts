import { Component, effect, inject, signal, untracked } from '@angular/core';
import { View } from '../../components/src/view.ts';
import { LayoutAnimation } from '../../device/src/layout-animation.ts';

/**
 * A bar whose width changes through `LayoutAnimation`, beside a view the engine animates from
 * JavaScript, a commit a frame: a width is nothing native can interpolate.
 */
@Component({
  selector: 'x-layout-animated',
  imports: [View],
  template: `
    <view class="busy" nativeID="busy"></view>
    <view nativeID="bar" [style.width]="wide() ? 300 : 40" [style.height]="24"></view>
  `,
  styles: `
    @keyframes grow {
      from {
        width: 10px;
      }
      to {
        width: 200px;
      }
    }
    .busy {
      height: 10px;
      animation: grow 10s linear infinite;
    }
  `,
})
export class LayoutAnimated {
  private readonly layout = inject(LayoutAnimation);
  readonly wide = signal(false);

  /** As a press handler calls it: outside change detection. */
  toggle(change: () => void = () => this.wide.update((wide) => !wide)): Promise<void> {
    return this.layout.animate(change, { duration: 20 });
  }

  private readonly asked = signal(0);

  constructor() {
    // As a component's effect calls it: inside a change-detection pass.
    effect(() => {
      if (this.asked() > 0) untracked(() => void this.toggle());
    });
  }

  toggleInPass(): void {
    this.asked.update((asked) => asked + 1);
  }
}
