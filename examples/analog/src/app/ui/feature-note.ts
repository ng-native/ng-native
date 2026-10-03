import { Component, input } from '@angular/core';
import { Text, View } from '@ng-native/components';
import { nativePlatform } from '@ng-native/fabric';

/** The top of every feature page: the file that made it, and what the feature does. */
@Component({
  selector: 'app-feature-note',
  imports: [Text, View],
  template: `
    <view class="card note">
      <text class="file" [style.fontFamily]="monospace">{{ file() }}</text>
      <text class="lead">{{ explanation() }}</text>
    </view>
  `,
  styleUrls: ['./page.css', './feature-note.css'],
})
export class FeatureNote {
  /** The page's path under `src/app/pages`. */
  readonly file = input.required<string>();
  readonly explanation = input.required<string>();

  protected readonly monospace = nativePlatform() === 'ios' ? 'Menlo' : 'monospace';
}
