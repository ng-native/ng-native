import { Component } from '@angular/core';
import { Text } from '@ng-native/components';

// A template arrow that reads its own parameter: @oxc-angular/vite through 0.0.40 read it as ctx.n.
@Component({
  selector: 'app-arrows',
  imports: [Text],
  template: `<text>{{ list.map((n) => n * 2).join(',') }}</text>`,
})
export class Arrows {
  list = [1, 2];
}
