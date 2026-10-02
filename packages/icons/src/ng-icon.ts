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
import { claimHost, type EngineNode, HostEngine } from '@ng-native/fabric';
import { NgIconsToken } from '@ng-icons/core';
import { parseSvg, type SvgNode } from './parse-svg.ts';
import { registerSvgComponents } from './svg-elements.ts';
import { SVG_ELEMENTS, nativeProps, own, styleAttributes, viewBoxProps } from './svg-props.ts';

/** ng-icons stores icons under a camel-cased key, so `hero-book-open` finds `heroBookOpen`. */
function toPropertyName(name: string): string {
  return name
    .replace(/([^a-zA-Z0-9])+(.)?/g, (_, __, character: string | undefined) =>
      character ? character.toUpperCase() : '',
    )
    .replace(/[^a-zA-Z\d]/g, '')
    .replace(/^([A-Z])/, (match) => match.toLowerCase());
}

@Component({
  selector: 'ng-icon',
  template: '',
  host: {
    '[style]': 'style()',
    '[color]': 'color()',
    '[bbWidth]': 'size()',
    '[bbHeight]': 'size()',
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
   * `size="32"` is read as the number it spells.
   */
  readonly size = input(24, { transform: (value: number | string) => numberAttribute(value, 24) });
  /** What a `currentColor` stroke or fill paints as. Native resolves it, so binding is cheap. */
  readonly color = input<string>();
  /** Fills in `var(--ng-icon__stroke-width, …)`, which is how an outline set carries its weight. */
  readonly strokeWidth = input<number | string>();
  /** Absent leaves the icon out of the accessibility tree, which is right for a decorative one. */
  readonly accessibilityLabel = input<string>();

  protected readonly style = computed(() => ({ width: this.size(), height: this.size() }));

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
    if (!element) return;
    const shape = this.create(element, node);
    for (const child of node.children) this.append(shape, child);
    this.renderer.appendChild(parent, shape);
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
    const props = nativeProps(node.tag, attrs, { color: (value) => this.engine.color(value) });
    for (const [prop, value] of Object.entries(props)) {
      this.renderer.setProperty(shape, prop, value);
    }
    return shape;
  }
}
