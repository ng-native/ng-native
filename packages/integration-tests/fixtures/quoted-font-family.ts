import { Component } from '@angular/core';
import { Text } from '../../components/src/text.ts';

/**
 * A quoted family, named every way a template can name one. Each should commit the family that
 * a stylesheet rule with the same declaration commits, without its quotes.
 */
@Component({
  imports: [Text],
  selector: 'x-quoted-font-family',
  styles: [
    ".sheet { font-family: 'Inter-Bold'; }",
    ".sheet-stack { font-family: 'Inter Display', sans-serif; }",
    '.from-token { font-family: var(--family); }',
  ],
  template: `
    <text nativeID="sheet" class="sheet">a</text>
    <text nativeID="sheet-stack" class="sheet-stack">a</text>
    <text nativeID="static" style="font-family: 'Inter-Bold'">a</text>
    <text nativeID="static-double" style='font-family: "Inter-Bold"'>a</text>
    <text nativeID="static-stack" style="font-family: 'Inter Display', sans-serif">a</text>
    <text nativeID="bound-string" [style]="declaration">a</text>
    <text nativeID="single" [style.font-family]="family">a</text>
    <text nativeID="token" class="from-token" style="--family: 'Inter-Bold'">a</text>
  `,
})
export class QuotedFontFamily {
  protected readonly declaration = "font-family: 'Inter-Bold'";
  protected readonly family = "'Inter-Bold'";
}
