import { Component } from '@angular/core';
import { Text } from '../../components/src/text.ts';
import { TextInput } from '../../components/src/text-input.ts';
import { View } from '../../components/src/view.ts';

/**
 * Paragraphs in registered families, one inheriting its family and one in no family at all, and
 * text inputs, whose font reaches native another way.
 */
@Component({
  selector: 'x-late-fonts',
  imports: [Text, TextInput, View],
  template: `
    <text class="title">Title</text>
    <text class="mono">code line</text>
    <text>Plain</text>
    <text>Some <text class="title">emphasis</text></text>
    <view class="mono"><text>Inherited</text></view>
    <text-input class="title" placeholder="Name" />
    <text-input class="mono" multiline placeholder="Notes" />
    <text-input placeholder="Plain field" />
  `,
  styles: `
    .title {
      font-family: Inter-600;
    }
    .mono {
      font-family: 'JetBrains Mono';
    }
  `,
})
export class LateFonts {}
