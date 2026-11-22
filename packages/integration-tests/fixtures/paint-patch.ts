import { Component, ElementRef, signal, viewChild } from '@angular/core';
import { View } from '../../components/src/view.ts';

/** Views whose bound paint changes alone, and beside what else can change with it. */
@Component({
  imports: [View],
  selector: 'x-paint-patch',
  styles: `
    .lit {
      background-color: #ff0000;
      width: 40px;
    }
    .pinned {
      opacity: 0.25 !important;
    }
    .turned {
      transform: rotate(45deg);
    }
  `,
  template: `
    <view
      #plain
      nativeID="plain"
      [style.opacity]="opacity()"
      [style.transform]="transform()"
      [style.backgroundColor]="colour()"
      [class.lit]="lit()"
    ></view>
    <view nativeID="pinned" class="pinned" [style.opacity]="opacity()"></view>
    <view nativeID="turned" class="turned" [style.transform]="transform()"></view>
  `,
})
export class PaintPatch {
  readonly opacity = signal<number | null>(1);
  readonly transform = signal<string | null>('translateX(1px)');
  readonly colour = signal<string | null>('#0000ff');
  readonly lit = signal(false);
  /** The engine's element for the first view. */
  readonly plain = viewChild.required('plain', { read: ElementRef });
}

/**
 * A view a transition eases the bound opacity of. Alone: a transition anywhere has the engine ease,
 * and merge every view in full.
 */
@Component({
  imports: [View],
  selector: 'x-paint-eased',
  styles: `
    .fading {
      transition: opacity 1s linear;
    }
  `,
  template: `<view #fading class="fading" [style.opacity]="opacity()"></view>`,
})
export class PaintEased {
  readonly opacity = signal(1);
  /** The engine's element for the view. */
  readonly fading = viewChild.required('fading', { read: ElementRef });
}
