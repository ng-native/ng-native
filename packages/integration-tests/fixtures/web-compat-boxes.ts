/** Boxes a library writes as HTML, for `web-compat-element-defaults.test.ts` to lay out. */
import { Component } from '@angular/core';

@Component({
  selector: 'x-boxes',
  template: `
    <div nativeID="tall" style="padding-top: 100px; height: 100px"></div>
    <div nativeID="wide" style="width: 100px; padding: 10px; border-left: 5px solid"></div>
    <div nativeID="fills" style="padding: 10px">
      <div nativeID="inside" style="height: 20px"></div>
    </div>
    <button nativeID="button" style="width: 100px; height: 40px; padding: 10px"></button>
  `,
})
export class Boxes {}
