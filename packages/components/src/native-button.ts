import {
  Component,
  ErrorHandler,
  ViewContainerRef,
  computed,
  effect,
  forwardRef,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  isApplePlatform,
  nativePlatform,
  registerViewName,
  type HostNode,
} from '@ng-native/fabric';
import { SVG_ICON_RENDERER, type ControlSize } from '@ng-native/device';
import { Image, type ImageURISource } from './image.ts';
import { ControlBase, TouchableBase } from './pressable.ts';
import { svgIconMarkup } from './svg-icon.ts';

declare const ngDevMode: unknown;

/** Platforms already told that a button's SVG icon has nothing to draw it. */
const warnedNoRenderer = new Set<string>();

/**
 * The side of an SVG icon drawn for iOS, in points. The button sizes it to its title's font, so
 * it is drawn large enough for the largest text size to scale it down rather than up.
 */
const IOS_SVG_SIZE = 40;

/** The side of an Android button's icon, in points: Material's for an icon in a button. */
const ANDROID_ICON_SIZE = 18;

/**
 * What a button does in its window: on macOS, Return presses `default` and Escape presses `cancel`.
 * On iOS they are styles only.
 */
export type ButtonKind = 'default' | 'cancel' | 'destructive' | 'plain';

/**
 * A button's picture, as on `<native-tab>`: an SF Symbol on Apple's OSes, a drawable on Android, or
 * an icon's SVG markup, such as an `@ng-icons` set's. macOS and Linux draw the markup themselves,
 * and iOS and Android draw it through the renderer `SVG_ICON_RENDERER` provides. It is drawn in the
 * button's text colour, as a symbol is, and an SF Symbol given too wins on macOS.
 */
export type ButtonIcon =
  { readonly sfSymbol: string } | { readonly drawable: string } | { readonly svg: string };

/**
 * The button on Apple's OSes is the host's: NSButton on macOS and UIButton on iOS. Android has no
 * platform button React Native draws, so there it is a view this component makes pressable.
 */
registerViewName(
  'native-button',
  { ios: 'NgNativeButton', android: 'View', macos: 'NgNativeButton' },
  undefined,
  { textContent: 'title' },
);

/**
 * A platform button, its label the text inside it:
 *
 *   <native-button kind="default" (press)="save()">Save</native-button>
 *
 * On macOS it is an NSButton, on Linux a GtkButton and on iOS a UIButton, drawn by the host, which sends
 * `topButtonPress` when it is clicked, tapped, or pressed by Space, and on macOS by Return (a
 * `default` button) or Escape (a `cancel` one). On Android it is a view pressed through the responder, as a
 * `<pressable>` is, and takes `android_ripple` as one does. The web host draws an HTML `button`.
 * It is a button to assistive technology everywhere, and takes focus.
 */
@Component({
  selector: 'native-button',
  imports: [Image],
  template: `
    @if (androidPicture(); as source) {
      <image [source]="source" [tintColor]="tint()" style="width: 18px; height: 18px" />
    }
    <ng-content />
  `,
  providers: [{ provide: TouchableBase, useExisting: forwardRef(() => NativeButton) }],
  host: {
    '[kind]': 'kind()',
    '[controlSize]': 'controlSize()',
    '[sfSymbol]': 'symbol()',
    '[drawable]': 'android ? undefined : drawableResource()',
    '[svgIcon]': 'svgIcon()',
    '[iconImage]': 'iosPicture()?.uri',
    '[style.flexDirection]': 'androidPicture() ? "row" : undefined',
    '[style.alignItems]': 'androidPicture() ? "center" : undefined',
    '[style.gap]': 'androidPicture() ? "8px" : undefined',
    '[enabled]': '!pressDisabled()',
  },
})
export class NativeButton extends ControlBase {
  /**
   * What the button does in its window. In a desktop window `default` takes Return and `cancel`
   * takes Escape; elsewhere the kind is a style alone. Unset, it is a plain push button.
   */
  readonly kind = input<ButtonKind>();
  /** AppKit's control size on macOS, and UIKit's button size on iOS. Ignored elsewhere. */
  readonly controlSize = input<ControlSize>();
  /** An SF Symbol beside the label, on iOS and macOS. */
  readonly sfSymbol = input<string>();
  /** Android: a drawable resource beside the label. */
  readonly drawableName = input<string>(undefined, { alias: 'drawable' });
  /** The picture for each OS at once, as on `<native-tab>`. */
  readonly icon = input<ButtonIcon>();

  protected readonly symbol = computed(() => {
    const icon = this.icon();
    return this.sfSymbol() ?? (icon && 'sfSymbol' in icon ? icon.sfSymbol : undefined);
  });

  protected readonly drawableResource = computed(() => {
    const icon = this.icon();
    return this.drawableName() ?? (icon && 'drawable' in icon ? icon.drawable : undefined);
  });

  private readonly svgRenderer = inject(SVG_ICON_RENDERER);
  private readonly svgHost = inject(ViewContainerRef);
  private readonly errors = inject(ErrorHandler);
  protected readonly android = nativePlatform() === 'android';
  /** Where the markup is drawn here, by the app's renderer, as an image. */
  private readonly drawsSvg = this.android || nativePlatform() === 'ios';

  protected readonly svgIcon = computed(() =>
    svgIconMarkup(this.icon(), 'native-button', !this.drawsSvg, 'macOS, Linux, iOS and Android'),
  );

  /** The markup drawn as an image, on iOS and Android, once the renderer has answered. */
  private readonly drawnSvg = this.drawSvg();

  /** The image iOS draws before the title, tinted as a symbol is. */
  protected readonly iosPicture = computed(() =>
    this.android ? undefined : (this.drawnSvg() as ImageURISource | undefined),
  );

  /** Android: the image before the label, a drawable's or the drawn markup. */
  protected readonly androidPicture = computed((): ImageURISource | undefined => {
    if (!this.android) return undefined;
    const drawable = this.drawableResource();
    if (drawable) return { uri: drawable };
    return this.drawnSvg() as ImageURISource | undefined;
  });

  /** The label's colour, which an Android icon is tinted in: black, as text is, where none is set. */
  protected readonly tint = signal<string | undefined>(undefined);

  constructor() {
    super();
    // Only a button with an icon follows its colour: a watch is a look at every commit.
    effect((onCleanup) => {
      if (!this.androidPicture()) return;
      const follow = (colour: unknown) => this.tint.set((colour as string | undefined) ?? 'black');
      follow(this.engine.colour(this.node));
      onCleanup(this.engine.watchColour(this.node, follow));
    });
  }

  /**
   * The markup drawn once by the app's renderer, where the platform draws no SVG itself. An answer
   * for an icon the button no longer has is dropped.
   */
  private drawSvg() {
    const drawn = signal<unknown>(undefined);
    if (!this.drawsSvg) return drawn;
    effect((onCleanup) => {
      const markup = this.svgIcon();
      drawn.set(undefined);
      if (!markup) return;
      if (!this.svgRenderer) return warnNoRenderer();
      let current = true;
      onCleanup(() => (current = false));
      const size = this.android ? ANDROID_ICON_SIZE : IOS_SVG_SIZE;
      this.svgRenderer.render(markup, size, this.svgHost).then(
        (source) => current && drawn.set(source ?? undefined),
        (error: unknown) => this.errors.handleError(error),
      );
    });
    return drawn;
  }

  /**
   * Where the host draws the button (AppKit, UIKit, GTK), it presses it: the responder would press
   * it twice.
   */
  private readonly drawnByHost = isApplePlatform() || nativePlatform() === 'linux';
  private stopPress: (() => void) | null = null;

  protected override roleByDefault(): 'button' {
    return 'button';
  }

  protected override accessibleByDefault(): boolean {
    return true;
  }

  protected override focusableByDefault(): boolean {
    return true;
  }

  protected override disabledForAccessibility(): boolean | undefined {
    return this.disabled();
  }

  protected override claims(): boolean {
    return !this.drawnByHost && super.claims();
  }

  override ngOnInit(): void {
    super.ngOnInit();
    if (!this.drawnByHost || this.stopPress) return;
    this.stopPress = this.engine.setEventListener(
      this.node as HostNode,
      'topButtonPress',
      (event) => {
        if (this.pressDisabled()) return;
        this.emitReported(this.press, 'click', event as never, 'click');
      },
    );
  }

  override ngOnDestroy(): void {
    super.ngOnDestroy();
    this.stopPress?.();
  }
}

/** Says once, in development, that a button's SVG icon has nothing to draw it, so it shows none. */
function warnNoRenderer(): void {
  const os = nativePlatform();
  if ((typeof ngDevMode !== 'undefined' && !ngDevMode) || warnedNoRenderer.has(os)) return;
  warnedNoRenderer.add(os);
  console.warn(
    `[angular-native] <native-button> has an SVG icon and nothing to draw it on ${os}, so it ` +
      `shows none. Add withSvgIcons(SvgImages) to provideNativeRouter (withSvgIcons from ` +
      `@ng-native/router, SvgImages from @ng-native/icons), or provide SVG_ICON_RENDERER.`,
  );
}
