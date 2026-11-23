/**
 * An icon, from the same `@ng-icons` packages a web app uses.
 *
 * An app imports `NgIcon`, provides the icons it uses with ng-icons' own `provideIcons`, and
 * writes `<ng-icon name="heroBookOpen" [size]="28" color="#ff9f0a" />`. The imports are the same
 * ones a web app writes:
 *
 * ```ts
 * import { NgIcon } from '@ng-native/icons';
 * import { provideIcons } from '@ng-icons/core';
 * import { heroBookOpen } from '@ng-icons/heroicons/outline';
 * ```
 *
 * The icon *packages* are the reusable part: each set ships its icons as plain strings of SVG
 * markup, and `provideIcons` is ordinary dependency injection. What cannot be reused is
 * `@ng-icons/core`'s own `NgIcon`, which inserts that markup with `innerHTML` and sizes it with
 * CSS custom properties. This is the same component against react-native-svg's native views: the
 * markup is parsed, translated, and committed as real shapes.
 *
 * The two things ng-icons expresses in CSS become inputs here. `color` is set on the host, which
 * is what native paints a `currentColor` brush from - so a bound colour changes every stroke in
 * the icon without re-parsing it. `strokeWidth` fills in `var(--ng-icon__stroke-width, 1.5)`,
 * which is how the heroicons outline set carries its weight. `provideNgIconsConfig` sets the
 * defaults of both and of `size`, and `provideNgIconLoader` is asked for a name no `provideIcons`
 * has, as on the web.
 */
import {
  Component,
  ElementRef,
  ErrorHandler,
  HostAttributeToken,
  Injector,
  Renderer2,
  computed,
  effect,
  inject,
  input,
  numberAttribute,
  reflectComponentType,
  runInInjectionContext,
  signal,
  untracked,
  type Signal,
} from '@angular/core';
import { claimHost, type Engine, type EngineNode, HostEngine } from '@ng-native/fabric';
import {
  NgIconCacheToken,
  NgIconConfigToken,
  NgIconLoaderToken,
  NgIconsToken,
  type NgIconLoader,
} from '@ng-icons/core';
import { parseSvg, type SvgNode } from './parse-svg.ts';
import { registerSvgComponents } from './svg-elements.ts';
import {
  PAINT,
  PRESENTATION,
  SVG_ELEMENTS,
  UNDRAWN,
  gradientProps,
  isGradient,
  isTokenPaint,
  nativeProps,
  own,
  stopColor,
  styleAttributes,
  textProps,
  viewBoxProps,
} from './svg-props.ts';

/** The tags already reported as not drawn, so a list of icons says it once. */
const reported = new Set<string>();

/** What an icon draws from its markup, worked out once for every icon that draws the same. */
interface Drawing {
  readonly root: SvgNode;
  /**
   * Whether its shapes need nothing from the cascade: no text to take a font from it, and no
   * paint from a token. Native paints a `currentColor` shape from the drawing it is in, so a
   * shape of one of these is left out of it, and a colour or a size bound on the icon restyles
   * the icon's own view and none of its shapes.
   */
  readonly selfContained: boolean;
  /**
   * The root's paint, where each child can take it as its own and no group has to carry it:
   * nothing on the root that a group would draw differently, an opacity or a mask, and children
   * that are shapes and groups. A view fewer per icon, which is a fifth of an outline set's.
   */
  readonly paint: SvgNode | null;
  /** The view's `viewBox` props, which a drawing with none leaves unset. */
  readonly viewBox: Readonly<Record<string, unknown>>;
}

/** The props `viewBoxProps` sets, each written on every draw so a drawing with none clears them. */
const VIEW_BOX = ['minX', 'minY', 'vbWidth', 'vbHeight', 'align', 'meetOrSlice'] as const;

/** The root attributes a child takes as its own when the group carrying them goes. */
const HANDED_DOWN: ReadonlySet<string> = new Set([
  ...['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-opacity', 'stroke-width'],
  ...['stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset'],
  'stroke-miterlimit',
]);

/** What a root's group draws that its children would draw differently, one by one. */
const GROUP_ONLY: ReadonlySet<string> = new Set(['id', 'mask', 'clip-path', 'transform']);

/** The children that take a paint as their own as they would inherit it. */
const SHAPES: ReadonlySet<string> = new Set([
  ...['path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'g'],
]);

/**
 * ponytail: cleared whole when it fills, the bound on markup an app binds from a server. The icon
 * sets an app provides are a few hundred names at most.
 */
const drawings = new Map<string, Drawing | null>();
const MAX_DRAWINGS = 500;

/** An element's attributes, with what its root hands down, and the native props they make. */
interface Translation {
  readonly engine: unknown;
  readonly strokeWidth: unknown;
  readonly attrs: Readonly<Record<string, string>>;
  readonly props: Readonly<Record<string, unknown>>;
}

/**
 * The last translation of each element, which a list of icons drawing the same few names reuses.
 * An element belongs to one drawing, so what its root hands it is the same each time. Kept with
 * its own drawing, and for one stroke width and engine at a time.
 */
const translations = new WeakMap<SvgNode, Translation>();

function drawingOf(markup: string): Drawing | null {
  let drawing = drawings.get(markup);
  if (drawing !== undefined) return drawing;
  const root = parseSvg(markup);
  drawing = root && {
    root,
    selfContained: selfContained(root),
    paint: paintOf(root),
    viewBox: viewBoxProps(root.attrs['viewBox']),
  };
  if (drawings.size >= MAX_DRAWINGS) drawings.clear();
  drawings.set(markup, drawing);
  return drawing;
}

/** An element's attributes with those its `style` sets, which win, before any `var()` is read. */
const written = (node: SvgNode): Record<string, string> => ({
  ...node.attrs,
  ...styleAttributes(node.attrs['style'] ?? '', {}),
});

function selfContained(node: SvgNode): boolean {
  if (node.tag === 'text' || node.tag === 'tspan') return false;
  const attrs = written(node);
  for (const paint of PAINT) if (isTokenPaint(attrs[paint])) return false;
  return node.children.every(selfContained);
}

/** The root's attributes as a child of it would inherit them, or null where a group has to stay. */
function paintOf(root: SvgNode): SvgNode | null {
  if (!root.children.every((child) => SHAPES.has(child.tag) || UNDRAWN.has(child.tag))) return null;
  const names = [...Object.keys(root.attrs), ...Object.keys(written(root))];
  const drawn = (name: string) => GROUP_ONLY.has(name) || own(PRESENTATION, name) !== undefined;
  if (names.some((name) => drawn(name) && !HANDED_DOWN.has(name))) return null;
  // A token is settled by the cascade on the element that names it: it stays on the group.
  const attrs = written(root);
  for (const paint of PAINT) if (isTokenPaint(attrs[paint])) return null;
  const paint: Record<string, string> = {};
  for (const [name, value] of Object.entries(root.attrs)) {
    if (HANDED_DOWN.has(name)) paint[name] = value;
  }
  // Only the paint in it: a `width` there sizes the drawing, and a `rect` with none of its own would take it.
  const style = (root.attrs['style'] ?? '')
    .split(';')
    .filter((declaration) => HANDED_DOWN.has(declaration.split(':')[0]!.trim()))
    .join(';');
  if (style) paint['style'] = style;
  return { tag: 'svg', attrs: paint, children: [] };
}

/** The inputs Angular writes on the host from a static attribute, named as the template does. */
let inputNames: readonly string[] | undefined;

/** ng-icons stores icons under a camel-cased key, so `hero-book-open` finds `heroBookOpen`. */
function toPropertyName(name: string): string {
  return name
    .replace(/([^a-zA-Z0-9])+(.)?/g, (_, __, character: string | undefined) =>
      character ? character.toUpperCase() : '',
    )
    .replace(/[^a-zA-Z\d]/g, '')
    .replace(/^([A-Z])/, (match) => match.toLowerCase());
}

/**
 * A size in points: a number, a number as a string, or one with the unit a web app writes it
 * with, `18px` or `1.5rem`. One in `em` is kept as written, for the engine to measure against the
 * font size in scope. Anything else is no size, and the icon is as big as the text around it.
 */
function pointsOf(value: number | string | undefined): number | string | undefined {
  if (value === undefined || value === '') return undefined;
  const text = typeof value === 'string' ? value.trim() : '';
  if (/^\d*\.?\d+em$/i.test(text)) return text;
  const rem = /^([\d.]+)rem$/.exec(text);
  const px = /^([\d.]+)px$/.exec(text);
  // `..rem` fits the pattern and is no number: NaN either way, and so no size.
  const points = rem ? Number(rem[1]) * 16 : numberAttribute(px ? px[1] : value, Number.NaN);
  return Number.isNaN(points) ? undefined : points;
}

/** A loader's answer as a promise: it may be a string, a promise or an observable. */
function settled(result: unknown): Promise<string | undefined> {
  if (typeof result === 'string') return Promise.resolve(result);
  const observable = result as { subscribe?: unknown } | null;
  if (typeof observable?.subscribe !== 'function')
    return Promise.resolve(result as Promise<string>);
  // The last value once it completes, which is what ng-icons' `toPromise()` waits for.
  return new Promise((resolve, reject) => {
    let last: string | undefined;
    (result as { subscribe(observer: object): void }).subscribe({
      next: (value: string) => (last = value),
      error: reject,
      complete: () => resolve(last),
    });
  });
}

@Component({
  selector: 'ng-icon',
  template: '',
  /*
   * With no size it is as big as the text around it, which is what an icon is on the web:
   * `@ng-icons/core` sizes one `1em`, and a library sizes its icons with a font size. An
   * `<ng-icon-stack size>` sets `--ng-icon__size` for the icons in it. A `size` is an inline
   * style, which beats both.
   */
  styles: `
    :host {
      width: var(--ng-icon__size, 1em);
      height: var(--ng-icon__size, 1em);
    }
  `,
  host: {
    '[style]': 'style()',
    '[style.color]': 'color()',
    '[bbWidth]': 'box()',
    '[bbHeight]': 'box()',
    '[accessible]': 'label() !== undefined',
    '[accessibilityRole]': "label() === undefined ? undefined : 'image'",
    '[accessibilityLabel]': 'label()',
  },
})
export class NgIcon {
  private readonly host = inject(ElementRef).nativeElement as EngineNode;
  private readonly renderer = inject(Renderer2);
  private readonly engine = inject(HostEngine);
  /** Every `provideIcons` in scope, innermost last, which is how ng-icons layers them. */
  private readonly icons = inject(NgIconsToken, { optional: true }) ?? [];
  /** `provideNgIconsConfig`: the size, colour and stroke width an icon has without its own. */
  private readonly config = inject(NgIconConfigToken, { optional: true }) ?? {};
  /** `provideNgIconLoader`: where an icon no `provideIcons` has comes from. */
  private readonly loader = inject(NgIconLoaderToken, { optional: true });
  private readonly injector = inject(Injector);
  private readonly errors = inject(ErrorHandler);
  /** A static `aria-label`, which labels the icon as `accessibilityLabel` does. */
  private readonly ariaLabel = inject(new HostAttributeToken('aria-label'), { optional: true });

  /** The key the icon was provided under: `heroBookOpen`, or `hero-book-open`. */
  readonly name = input<string>();
  /** Markup, for an icon that comes from somewhere other than a provider. */
  readonly svg = input<string>();
  /**
   * Points, square. Icons are drawn from a `viewBox`, so this is the size on screen. A static
   * `size="32"` is read as the number it spells, and `size="2em"` against the font size in scope,
   * as on the web. With none, the icon is `1em`: as big as the text around it, and sized by a
   * `font-size` on it or above it, or by a width and height.
   */
  readonly size = input(pointsOf(this.config.size), {
    transform: (value: number | string | undefined) => pointsOf(value),
  });
  /**
   * What a `currentColor` stroke or fill paints as. It is the host's `color` style, so a `var()`
   * resolves against the tokens in scope, and native paints it, so binding is cheap.
   */
  readonly color = input<string | undefined>(this.config.color);
  /** Fills in `var(--ng-icon__stroke-width, …)`, which is how an outline set carries its weight. */
  readonly strokeWidth = input<number | string | undefined>(this.config.strokeWidth);
  /** Absent leaves the icon out of the accessibility tree, which is right for a decorative one. */
  readonly accessibilityLabel = input<string>();

  /** The label a screen reader reads: the input, or a static `aria-label`. */
  protected readonly label = computed(
    () => this.accessibilityLabel() ?? this.ariaLabel ?? undefined,
  );
  /** How many times the icon has asked the loader, so only the newest answer is drawn. */
  private asks = 0;
  /** The markup the loader answered with, and the name it was asked for. */
  private readonly loaded = signal<{ name: string; svg: string | undefined } | undefined>(
    undefined,
  );

  /** The size as an inline style, or nothing for the stylesheet's size to stand. */
  protected readonly style = computed(() => {
    const size = this.size();
    return size === undefined ? {} : { width: size, height: size };
  });
  /** What the view scales its drawing to: the size, or the whole of the box it is laid out as. */
  protected readonly box = computed(() => {
    const size = this.size();
    return typeof size === 'number' ? size : '100%';
  });

  private readonly markup: Signal<string | undefined> = computed(() => {
    const svg = this.svg();
    if (svg !== undefined) return svg;
    const name = this.name();
    if (name === undefined) return undefined;

    const provided = this.provided(name);
    if (provided) return provided;
    const loaded = this.loaded();
    if (loaded?.name === name && loaded.svg) return loaded.svg;
    // Still loading: the warning waits for the loader's answer.
    if (this.loader && loaded?.name !== name) return undefined;
    this.reportMissing(name);
    return undefined;
  });

  private readonly drawing = computed(() => {
    const markup = this.markup();
    return markup === undefined ? null : drawingOf(markup);
  });

  constructor() {
    // Before the first shape is created, which is before this component's own commit.
    registerSvgComponents();
    // Claimed, and stripped of the attributes Angular wrote from static inputs: `name` is one of
    // ours *and* one of react-native-svg's, so leaving it there hands native an element name.
    claimHost(this.host);
    inputNames ??= (reflectComponentType(NgIcon)?.inputs ?? []).map((input) => input.templateName);
    for (const name of inputNames) delete this.host.props[name];
    // The shapes are created rather than templated: an icon's tree is data, and a template that
    // could express it would be a component per tag with a recursive switch between them.
    effect(() => this.draw());
    // The loader is fixed for the icon's life: with none, an icon has nothing to ask.
    if (this.loader) effect(() => this.load());
  }

  /** The icon `provideIcons` has under this name, the nearest one first. */
  private provided(name: string): string | undefined {
    const key = toPropertyName(name);
    // Reversed, because a nearer `provideIcons` should win over one further up the tree.
    for (const set of [...this.icons].reverse()) {
      const markup = own(set, key);
      if (markup) return markup;
    }
    return undefined;
  }

  /** Asks the loader for an icon no `provideIcons` has, as `@ng-icons/core` does. */
  private load(): void {
    const name = this.name();
    const ask = ++this.asks;
    if (!this.loader || this.svg() !== undefined || name === undefined) return;
    if (this.provided(name)) return;
    this.request(this.loader, name).then(
      (svg) => {
        // The icon asked again while the loader was answering, so this answer is out of date.
        if (ask === this.asks) this.loaded.set({ name, svg });
      },
      (error: unknown) => this.errors.handleError(error),
    );
  }

  /** The loader's answer for a name, through the `withCaching()` cache when there is one. */
  private async request(loader: NgIconLoader, name: string): Promise<string | undefined> {
    // `withCaching()`: what the loader already answered, so it is asked once per name. Looked up
    // here, so an icon with no loader does not pay for it.
    const cache = this.injector.get(NgIconCacheToken, null);
    const cached = cache?.get(name);
    if (cached !== undefined) return cached;
    // Untracked, so a signal the loader reads does not ask it again when that signal changes.
    const answer = settled(
      untracked(() => runInInjectionContext(this.injector, () => loader(name))),
    );
    cache?.set(name, answer as Promise<string>);
    try {
      const svg = await answer;
      if (svg !== undefined) cache?.set(name, svg);
      return svg;
    } catch (error) {
      // Not kept, so the next icon with this name asks again.
      cache?.delete(name);
      throw error;
    }
  }

  private reportMissing(name: string): void {
    if (typeof ngDevMode === 'undefined' || !ngDevMode) return;
    console.warn(
      `[angular-native] no icon named ${name}. Pass it to provideIcons() from the set it ` +
        `belongs to, the same way you would on the web, or load it with provideNgIconLoader().`,
    );
  }

  private draw(): void {
    const drawing = this.drawing();
    for (const child of [...this.host.childList]) this.renderer.removeChild(this.host, child);
    // Here rather than as six host bindings: they change only with the drawing.
    for (const prop of VIEW_BOX) this.renderer.setProperty(this.host, prop, drawing?.viewBox[prop]);
    if (!drawing) return;
    const { root, paint, selfContained } = drawing;

    // The svg view itself holds no paint, so a root that says `stroke="currentColor"` needs its
    // children to have it: as their own where they take it as they would inherit it, and
    // otherwise on a group they inherit it from, which is how react-native-svg's own `Svg` does it.
    if (paint) {
      const inherited = this.attributes(paint);
      for (const child of root.children) this.append(this.host, child, selfContained, inherited);
      return;
    }
    const group = this.create('svg-g', root, selfContained);
    for (const child of root.children) this.append(group, child, selfContained);
    this.renderer.appendChild(this.host, group);
  }

  private append(
    parent: unknown,
    node: SvgNode,
    selfContained: boolean,
    inherited?: Record<string, string>,
  ): void {
    const element = own(SVG_ELEMENTS, node.tag);
    if (!element) return this.reportUndrawn(node.tag);
    const shape = this.create(element, node, selfContained, inherited);
    for (const child of node.children) this.append(shape, child, selfContained);
    this.renderer.appendChild(parent, shape);
  }

  /** An element's attributes with what its `style` sets, which ng-icons puts the stroke width in. */
  private attributes(node: SvgNode): Record<string, string> {
    return {
      ...node.attrs,
      ...styleAttributes(node.attrs['style'] ?? '', {
        '--ng-icon__stroke-width': this.strokeWidth(),
      }),
    };
  }

  /**
   * A `currentColor` stop is settled here from the `color` input, where a `currentColor` brush is
   * painted by native from the colour the cascade gives the icon. With no input it is black.
   */
  private reportUntintedStop(gradient: SvgNode): void {
    if (typeof ngDevMode === 'undefined' || !ngDevMode) return;
    if (this.color() !== undefined || reported.has('currentColor')) return;
    if (!gradient.children.some((stop) => stopColor(stop.attrs) === 'currentColor')) return;
    reported.add('currentColor');
    console.warn(
      '[angular-native] <ng-icon> paints a gradient stop written as currentColor from its ' +
        '`color` input, and this icon has none, so the stop is black. Set `color` on the icon.',
    );
  }

  /** An incomplete drawing with no message is the hardest failure to track down. */
  private reportUndrawn(tag: string): void {
    if (typeof ngDevMode === 'undefined' || !ngDevMode) return;
    if (UNDRAWN.has(tag) || reported.has(tag)) return;
    reported.add(tag);
    const drawn = ['svg', ...Object.keys(SVG_ELEMENTS), 'stop'].filter((name) => name !== '#text');
    console.warn(
      `[angular-native] <ng-icon> does not draw <${tag}>, so it is left out of the icon. ` +
        `It draws ${drawn.slice(0, -1).join(', ')} and ${drawn.at(-1)}.`,
    );
  }

  /** The native props of one element: a gradient's, a text's, or a shape's. */
  private propsOf(node: SvgNode, attrs: Record<string, string>): Record<string, unknown> {
    const context = { color: (value: string) => this.engine.color(value) };
    if (isGradient(node.tag)) {
      this.reportUntintedStop(node);
      return gradientProps(node, context, this.color());
    }
    const props = nativeProps(node.tag, attrs, context);
    if (node.tag === '#text') return { ...props, content: node.text };
    return node.tag === 'text' || node.tag === 'tspan' ? { ...props, ...textProps(attrs) } : props;
  }

  /**
   * What the root hands down, under what the element says itself, and the props that makes. A
   * gradient reads the `color` input, so it is translated each time.
   */
  private translate(node: SvgNode, inherited?: Record<string, string>): Translation {
    const strokeWidth = this.strokeWidth();
    const last = translations.get(node);
    if (last?.engine === this.engine && last.strokeWidth === strokeWidth) return last;
    const attrs = { ...inherited, ...this.attributes(node) };
    const translation = {
      engine: this.engine,
      strokeWidth,
      attrs,
      props: this.propsOf(node, attrs),
    };
    if (!isGradient(node.tag)) translations.set(node, translation);
    return translation;
  }

  private create(
    element: string,
    node: SvgNode,
    selfContained: boolean,
    inherited?: Record<string, string>,
  ): unknown {
    const shape = this.renderer.createElement(element) as EngineNode;
    // Created here rather than by a template, so nothing else will account for it: without this
    // the engine reports every shape as an element whose component was forgotten.
    claimHost(shape);
    if (selfContained) shape.outsideCascade = true;
    const { attrs, props } = this.translate(node, inherited);
    // A paint that reads a custom property is settled by the cascade, with the tokens in scope
    // for the shape, and follows them. It stays in `propList`, which says the shape has one.
    const cascade = this.engine as Partial<Pick<Engine, 'setBoundStyle'>>;
    let bound: Set<string> | undefined;
    for (const paint of PAINT) {
      if (isTokenPaint(attrs[paint]) && cascade.setBoundStyle?.(shape, paint, attrs[paint]))
        (bound ??= new Set()).add(paint);
    }
    for (const [prop, value] of Object.entries(props)) {
      if (!bound?.has(prop)) this.renderer.setProperty(shape, prop, value);
    }
    return shape;
  }
}
