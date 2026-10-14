import { Component, ViewContainerRef, inject, viewChild } from '@angular/core';
import { SvgImages } from '../../icons/src/svg-images.ts';

export { SvgImages };

/** A place to draw into, beside a view, as the tabs outlet is one. */
@Component({
  selector: 'x-drawing-host',
  template: '<view><view testID="beside" /><ng-container #at /></view>',
})
export class DrawingHost {
  private readonly anchor = viewChild.required('at', { read: ViewContainerRef });
  readonly images = inject(SvgImages);
  get at(): ViewContainerRef {
    return this.anchor();
  }
}
