import { Component } from '@angular/core';
import { Text } from '../../components/src/text.ts';
import { View } from '../../components/src/view.ts';

/** Paragraphs in registered families, one inheriting its family and one in no family at all. */
@Component({
  selector: 'x-late-fonts',
  imports: [Text, View],
  template: `
    <text class="title">Title</text>
    <text class="mono">code line</text>
    <text>Plain</text>
    <text>Some <text class="title">emphasis</text></text>
    <view class="mono"><text>Inherited</text></view>
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
