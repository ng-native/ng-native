/**
 * Text filled with a gradient, or with any background: the background is drawn through the shapes
 * of the letters.
 *
 * ```html
 * <gradient-text class="brand">Week</gradient-text>
 * ```
 *
 * ```css
 * .brand {
 *   background-image: linear-gradient(to bottom, #437dfc, #4ad0ef);
 *   background-clip: text;
 *   color: transparent;
 *   font-size: 34px;
 *   font-weight: 700;
 * }
 * ```
 *
 * The rule is the one a web page writes. `background-clip: text` is what this element does, so a
 * rule that has it applies to `<gradient-text>` and to nothing else: on a `<text>` it would leave
 * transparent letters on a block of colour. The `color` is not used, since the letters are the
 * mask and are drawn in full.
 *
 * It is text like any other: it wraps, follows the device's text size, takes `<text>` spans
 * inside it with their own weight or style, and is sized by its letters. What a span cannot have
 * here is a colour of its own, because the fill is the one background behind all of it.
 *
 * The app must have `@react-native-masked-view/masked-view` installed, which is where the native
 * view comes from (`npx expo install @react-native-masked-view/masked-view`); none of its
 * JavaScript is imported. The view masks what is inside it by its first child, so the letters are
 * that child and the background is painted on a view behind them.
 */
import {
  Component,
  ElementRef,
  viewChild,
  type AfterContentChecked,
  type AfterViewInit,
} from '@angular/core';
import { registerViewName, type Engine, type EngineNode } from '@ng-native/fabric';
import { Text } from './text.ts';
import { View } from './view.ts';
import { ViewBase } from './view-base.ts';

/** The characters under a node, in order. */
const textOf = (node: EngineNode): string =>
  node.kind === 'text' ? node.text : node.children.map(textOf).join('');

let registered = false;

/** Teach the engine the element, once, before its first commit. */
function registerGradientText(): void {
  if (registered) return;
  registered = true;
  registerViewName('gradient-text', 'RNCMaskedView');
}

@Component({
  selector: 'gradient-text',
  imports: [Text, View],
  template: `
    <text #letters class="letters"><ng-content /></text>
    <view #fill class="fill" pointerEvents="none"></view>
  `,
  styles: `
    .letters {
      color: black;
    }
    .fill {
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      left: 0;
    }
  `,
})
export class GradientText extends ViewBase implements AfterViewInit, AfterContentChecked {
  private readonly fill = viewChild.required('fill', { read: ElementRef });
  private readonly letters = viewChild('letters', { read: ElementRef });
  /** The label last written from the letters, to write it again only when they change. */
  private spoken: string | undefined;

  constructor() {
    super();
    registerGradientText();
    // One element to a screen reader, as a text is. An input of the same name is written after.
    this.engine.setProp(this.node, 'accessible', true);
    this.engine.setProp(this.node, 'accessibilityRole', 'text');
  }

  ngAfterViewInit(): void {
    this.paintOnFill();
    this.labelFromLetters();
  }

  ngAfterContentChecked(): void {
    this.labelFromLetters();
  }

  /**
   * Say the letters. iOS takes the mask out of the view hierarchy, so there is no text under the
   * element for VoiceOver to read, and an element with nothing to say is not found at all. A
   * label the app gave is left as it is.
   */
  private labelFromLetters(): void {
    const letters = this.letters()?.nativeElement as EngineNode | undefined;
    const given = this.accessibilityLabel() ?? this.ariaLabel();
    if (!letters || given !== undefined) return;
    const label = textOf(letters).replace(/\s+/g, ' ').trim();
    if (label === this.spoken) return;
    this.spoken = label;
    this.engine.setProp(this.node, 'accessibilityLabel', label || null);
  }

  /**
   * The host's background is the fill's to paint: the view masks its children and not itself.
   * Before the first commit, so the background is never drawn unmasked.
   */
  private paintOnFill(): void {
    const engine = this.engine as Partial<Pick<Engine, 'paintOn'>>;
    engine.paintOn?.(this.node as EngineNode, this.fill().nativeElement as EngineNode);
  }
}
