import { Component } from '@angular/core';
import { NativeStackOutlet } from '@ng-native/router';

/**
 * The layout of the pages in `products/`: a native stack of their own. The home page presents it
 * as a sheet, which has no navigation bar of its own, so this stack is what gives the list a
 * header, and a product opened from the list is pushed inside the sheet with a back button.
 */
@Component({
  imports: [NativeStackOutlet],
  template: `<native-stack-outlet />`,
  styles: `
    :host {
      flex: 1;
    }
  `,
})
export default class ProductsLayout {}
