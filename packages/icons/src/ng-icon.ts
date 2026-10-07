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
 * which is how the heroicons outline set carries its weight.
 */
import {
  Component,
  ElementRef,
  Renderer2,
  computed,
  effect,
  inject,
  input,
  numberAttribute,
  type Signal,
} from '@angular/core';
import { claimHost, type Engine, type EngineNode, HostEngine } from '@ng-native/fabric';
import { NgIconsToken } from '@ng-icons/core';
import { parseSvg, type SvgNode } from './parse-svg.ts';
import { registerSvgComponents } from './svg-elements.ts';
import {
  PAINT,
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
 * with, `18px` or `1.5rem`. Anything else is no size, and the icon is as big as the text around it.
 */
function pointsOf(value: number | string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const text = typeof value === 'string' ? value.trim() : '';
  const rem = /^([\d.]+)rem$/.exec(text);
  const px = /^([\d.]+)px$/.exec(text);
  // `..rem` fits the pattern and is no number: NaN either way, and so no size.
  const points = rem ? Number(rem[1]) * 16 : numberAttribute(px ? px[1] : value, Number.NaN);
  return Number.isNaN(points) ? undefined : points;
}

@Component({
  selector: 'ng-icon',
  template: '',
  /*
   * With no size it is as big as the text around it, which is what an icon is on the web:
   * `@ng-icons/core` sizes one `1em`, and a library sizes its icons with a font size. A `size`
   * is an inline style, which beats this.
   */
  styles: `
    :host {
      width: 1em;
      height: 1em;
    }
  `,
  host: {
    '[style]': 'style()',
    '[color]': 'color()',
    '[bbWidth]': 'box()',
    '[bbHeight]': 'box()',
    '[minX]': 'viewBox().minX',
    '[minY]': 'viewBox().minY',
    '[vbWidth]': 'viewBox().vbWidth',
    '[vbHeight]': 'viewBox().vbHeight',
    '[align]': 'viewBox().align',
    '[meetOrSlice]': 'viewBox().meetOrSlice',
    '[accessible]': 'accessibilityLabel() !== undefined',
    '[accessibilityRole]': "accessibilityLabel() === undefined ? undefined : 'image'",
    '[accessibilityLabel]': 'accessibilityLabel()',
  },
})
export class NgIcon {
  private readonly host = inject(ElementRef).nativeElement as EngineNode;
  private readonly renderer = inject(Renderer2);
  private readonly engine = inject(HostEngine);
  /** Every `provideIcons` in scope, innermost last, which is how ng-icons layers them. */
  private readonly icons = inject(NgIconsToken, { optional: true }) ?? [];

  /** The key the icon was provided under: `heroBookOpen`, or `hero-book-open`. */
  readonly name = input<string>();
  /** Markup, for an icon that comes from somewhere other than a provider. */
  readonly svg = input<string>();
  /**
   * Points, square. Icons are drawn from a `viewBox`, so this is the size on screen. A static
   * `size="32"` is read as the number it spells. With none, the icon is `1em`: as big as the
   * text around it, and sized by a `font-size` on it or above it, or by a width and height.
   */
  readonly size = input(undefined, {
    transform: (value: number | string | undefined) => pointsOf(value),
  });
  /** What a `currentColor` stroke or fill paints as. Native resolves it, so binding is cheap. */
  readonly color = input<string>();
  /** Fills in `var(--ng-icon__stroke-width, …)`, which is how an outline set carries its weight. */
  readonly strokeWidth = input<number | string>();
  /** Absent leaves the icon out of the accessibility tree, which is right for a decorative one. */
  readonly accessibilityLabel = input<string>();

  /** The size as an inline style, or nothing for the stylesheet's `1em` to stand. */
  protected readonly style = computed(() => {
    const size = this.size();
    return size === undefined ? {} : { width: size, height: size };
  });
  /** What the view scales its drawing to: the size, or the whole of the box it is laid out as. */
  protected readonly box = computed(() => this.size() ?? '100%');

  private readonly markup: Signal<string | undefined> = computed(() => {
    const svg = this.svg();
    if (svg !== undefined) return svg;
    const name = this.name();
    if (name === undefined) return undefined;

    const key = toPropertyName(name);
    // Reversed, because a nearer `provideIcons` should win over one further up the tree.
    for (const set of [...this.icons].reverse()) {
      const markup = own(set, key);
      if (markup) return markup;
    }
    if (typeof ngDevMode !== 'undefined' && ngDevMode) {
      console.warn(
        `[angular-native] no icon named ${name}. Pass it to provideIcons() from the set it ` +
          `belongs to, the same way you would on the web.`,
      );
    }
    return undefined;
  });

  private readonly root = computed(() => {
    const markup = this.markup();
    return markup === undefined ? null : parseSvg(markup);
  });

  protected readonly viewBox = computed(() => viewBoxProps(this.root()?.attrs['viewBox']));

  constructor() {
    // Before the first shape is created, which is before this component's own commit.
    registerSvgComponents();
    // Claimed, and stripped of the attributes Angular wrote from static inputs: `name` is one of
    // ours *and* one of react-native-svg's, so leaving it there hands native an element name.
    claimHost(this.host);
    for (const input of Object.keys(
      (NgIcon as { ɵcmp?: { inputs?: object } }).ɵcmp?.inputs ?? {},
    )) {
      delete this.host.props[input];
    }
    // The shapes are created rather than templated: an icon's tree is data, and a template that
    // could express it would be a component per tag with a recursive switch between them.
    effect(() => this.draw());
  }

  private draw(): void {
    const root = this.root();
    for (const child of [...this.host.children]) this.renderer.removeChild(this.host, child);
    if (!root) return;

    // Everything hangs off one group carrying the root's presentation attributes, which is how
    // react-native-svg's own `Svg` does it: the svg view itself holds no paint, so a root that
    // says `stroke="currentColor"` needs a group for its children to inherit from.
    const group = this.create('svg-g', root);
    for (const child of root.children) this.append(group, child);
    this.renderer.appendChild(this.host, group);
  }

  private append(parent: unknown, node: SvgNode): void {
    const element = own(SVG_ELEMENTS, node.tag);
    if (!element) return this.reportUndrawn(node.tag);
    const shape = this.create(element, node);
    for (const child of node.children) this.append(shape, child);
    this.renderer.appendChild(parent, shape);
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

  private create(element: string, node: SvgNode): unknown {
    const shape = this.renderer.createElement(element) as EngineNode;
    // Created here rather than by a template, so nothing else will account for it: without this
    // the engine reports every shape as an element whose component was forgotten.
    claimHost(shape);
    const attrs = {
      ...node.attrs,
      // A `style` attribute is where ng-icons puts the stroke width, as a custom property.
      ...styleAttributes(node.attrs['style'] ?? '', {
        '--ng-icon__stroke-width': this.strokeWidth(),
      }),
    };
    const props = this.propsOf(node, attrs);
    // A paint that reads a custom property is settled by the cascade, with the tokens in scope
    // for the shape, and follows them. It stays in `propList`, which says the shape has one.
    const cascade = this.engine as Partial<Pick<Engine, 'setBoundStyle'>>;
    for (const paint of PAINT) {
      if (!isTokenPaint(attrs[paint]) || !cascade.setBoundStyle?.(shape, paint, attrs[paint]))
        continue;
      delete props[paint];
    }
    for (const [prop, value] of Object.entries(props)) {
      this.renderer.setProperty(shape, prop, value);
    }
    return shape;
  }
}
