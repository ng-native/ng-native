import { Component } from '@angular/core';
import { Pressable } from '@ng-native/components';

@Component({
  imports: [Pressable],
  template: `
    <pressable #press="pressable" testID="press" />
    <text testID="state">{{ press.hovered() }}</text>
  `,
})
export class Hover {}
