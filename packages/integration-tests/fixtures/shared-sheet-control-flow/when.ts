import { Component, signal } from '@angular/core';
import { Text } from '../../../components/src/text.ts';
import { View } from '../../../components/src/view.ts';

// One of two components sharing a stylesheet, with an aliased @if in its template.
@Component({
  imports: [Text, View],
  selector: 'app-when',
  template: '<view class="box">@if (count(); as n) { <text>count is {{ n }}</text> }</view>',
  styleUrl: './flow.css',
})
export class When {
  count = signal(1);

  inc(): void {
    this.count.update((c) => c + 1);
  }
}
