/**
 * SVG markup drawn once into a PNG, for a place that takes an image and not a view: a tab bar
 * item, which neither platform lets hold a view. `withSvgIcons(SvgImages)` from
 * `@ng-native/router` uses it for `<native-tab [icon]="{ svg }">`.
 *
 * react-native-svg draws one of its own views into a PNG, so the markup is drawn as an `ng-icon`
 * for as long as that takes, nearly transparent and out of the way, and then taken away. Android
 * draws nothing that is off screen, so the view goes where the caller says, which is on screen.
 */
import {
  Component,
  ElementRef,
  Injectable,
  InjectionToken,
  afterNextRender,
  inject,
  input,
  viewChild,
  type ViewContainerRef,
} from '@angular/core';
import { Engine, type EngineNode, nativePlatform } from '@ng-native/fabric';
import { NgIcon } from './ng-icon.ts';

/** What of react-native-svg's native module this needs, and the screen's scale. */
export interface SvgImagesNative {
  /** `RNSVGSvgViewModule.toDataURL`: the view drawn as a base64 PNG, or nothing. */
  toDataURL(
    tag: number,
    options: { width: number; height: number },
    done: (b64?: string) => void,
  ): void;
  /** Pixels to a point. */
  readonly scale: number;
}

/** The markup, drawn where it is seen by nobody: a hundredth opaque, above the rest. */
@Component({
  selector: 'ng-icon-drawing',
  imports: [NgIcon],
  template: '<ng-icon #icon [svg]="svg()" [size]="size()" />',
  host: { style: 'position: absolute; opacity: 0.01', pointerEvents: 'none' },
})
class SvgDrawing {
  readonly svg = input.required<string>();
  readonly size = input.required<number>();
  readonly icon = viewChild.required('icon', { read: ElementRef });
}

@Injectable({ providedIn: 'root' })
export class SvgImages {
  /**
   * react-native-svg's module and the screen's scale, or null where react-native-svg is not in
   * the build. Overridden in a test.
   */
  static readonly NATIVE = new InjectionToken<SvgImagesNative | null>('angular-native.svgImages', {
    factory: () => {
      const host = globalThis as {
        __turboModuleProxy?: (name: string) => unknown;
        nativeModuleProxy?: Record<string, unknown>;
      };
      const find = (name: string) =>
        (host.__turboModuleProxy?.(name) ?? host.nativeModuleProxy?.[name]) as
          Record<string, unknown> | undefined;
      const svg = find('RNSVGSvgViewModule') as Pick<SvgImagesNative, 'toDataURL'> | undefined;
      if (!svg?.toDataURL) return null;
      // iOS gives the window in points with its scale, Android in physical pixels with its.
      type Window = { scale?: number };
      const info = find('DeviceInfo') as
        | {
            getConstants?(): {
              Dimensions?: { window?: Window; windowPhysicalPixels?: Window };
            };
          }
        | undefined;
      const dimensions = info?.getConstants?.().Dimensions;
      const scale = dimensions?.window?.scale ?? dimensions?.windowPhysicalPixels?.scale ?? 1;
      return { toDataURL: (...args) => svg.toDataURL(...args), scale };
    },
  });

  /** How long native has to answer: iOS logs and never calls back for a view it cannot find. */
  static answerWithinMs = 3000;

  private readonly native = inject(SvgImages.NATIVE);
  private readonly engine = inject(Engine, { optional: true });

  /**
   * `svg` drawn `size` points square, as an image source: a PNG data URI with its scale. Null
   * when it could not be drawn. The view it is drawn in goes in `at`, which has to be on screen.
   */
  render(svg: string, size: number, at: ViewContainerRef): Promise<unknown> {
    const native = this.native;
    if (!native) return Promise.resolve(null);
    const drawing = at.createComponent(SvgDrawing);
    drawing.setInput('svg', svg);
    drawing.setInput('size', size);
    // iOS draws at the screen's scale and is asked in points; Android is asked in pixels.
    const asked = nativePlatform() === 'android' ? Math.round(size * native.scale) : size;
    return new Promise<unknown>((resolve) => {
      const finish = (base64?: string) => {
        clearTimeout(timer);
        if (!drawing.hostView.destroyed) drawing.destroy();
        resolve(
          base64
            ? {
                uri: `data:image/png;base64,${base64}`,
                scale: native.scale,
                width: size,
                height: size,
              }
            : null,
        );
      };
      const timer = setTimeout(finish, SvgImages.answerWithinMs);
      afterNextRender(
        () => {
          const tag = this.engine?.tagOf(drawing.instance.icon().nativeElement as EngineNode);
          if (tag == null) return finish();
          native.toDataURL(tag, { width: asked, height: asked }, finish);
        },
        { injector: drawing.injector },
      );
    });
  }
}
