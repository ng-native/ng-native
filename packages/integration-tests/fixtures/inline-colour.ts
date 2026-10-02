import { Component, signal } from '@angular/core';
import { Text } from '../../components/src/text.ts';
import { View } from '../../components/src/view.ts';

/** A colour bound on a view, inherited by the text inside, with no stylesheet at all. */
@Component({
  imports: [Text, View],
  selector: 'x-inline-colour',
  template: `<view [style.color]="colour()"><text nativeID="inside">a</text></view>`,
})
export class InlineColour {
  readonly colour = signal('rgb(255, 0, 0)');
}
