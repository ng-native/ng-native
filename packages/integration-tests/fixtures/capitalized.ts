import { Component } from '@angular/core';

// Deliberately wrong: `<View>` matches no component and renders as an empty box. Guard fixture.
@Component({
  selector: 'app-bad',
  template: `<View>never renders</View>`,
})
export class Capitalized {}
