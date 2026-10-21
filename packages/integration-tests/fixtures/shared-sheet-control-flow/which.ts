import { Component, signal } from '@angular/core';
import { Text } from '../../../components/src/text.ts';
import { View } from '../../../components/src/view.ts';

// The other component sharing the stylesheet, with a @switch in its template.
@Component({
  imports: [Text, View],
  selector: 'app-which',
  template:
    '<view class="box">@switch (count()) { @case (1) { <text>one</text> } @default { <text>more</text> } }</view>',
  styleUrl: './flow.css',
})
export class Which {
  count = signal(1);
}
