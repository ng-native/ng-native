import { Component } from '@angular/core';
import { Image } from '../../components/src/image.ts';

@Component({
  selector: 'x-rounded-image',
  imports: [Image],
  template: `<image nativeID="photo" [source]="{ uri: 'a.jpg' }" [style]="rounded" />`,
})
export class RoundedImage {
  protected readonly rounded = { width: 72, height: 72, borderRadius: 12 };
}

@Component({
  selector: 'x-listened-image',
  imports: [Image],
  template: `
    <image nativeID="listened" [source]="{ uri: 'a.jpg' }" (load)="loads = loads + 1" />
    <image nativeID="quiet" [source]="{ uri: 'b.jpg' }" />
  `,
})
export class ListenedImage {
  loads = 0;
}

@Component({
  selector: 'x-fitted-images',
  imports: [Image],
  styles: ['.contained { object-fit: contain }'],
  template: `
    <image nativeID="bare" [source]="{ uri: 'a.jpg' }" />
    <image nativeID="explicit" [source]="{ uri: 'b.jpg' }" resizeMode="stretch" />
    <image nativeID="css" class="contained" [source]="{ uri: 'c.jpg' }" />
  `,
})
export class FittedImages {}
