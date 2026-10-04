/**
 * SVG markup to a tree, for the one kind of SVG an icon set ships.
 *
 * This is not a general XML parser and does not want to be. An icon is a build-time constant from
 * a package like `@ng-icons/heroicons`: no namespaces to resolve, no entities, no CDATA, no
 * external references, and across heroicons, lucide and bootstrap-icons - some five thousand
 * icons - the entire tag surface is `svg`, `path`, `circle`, `rect`, `line`, `ellipse`,
 * `polyline`, `polygon` and `g`.
 *
 * ponytail: a scanner rather than a parser. It ignores anything it does not recognise, which for
 * a trusted constant is the right trade; the failure mode for markup outside that surface is a
 * missing shape rather than a wrong one. An icon with a `<style>` block or a CSS class would need
 * a real parser, and no set in ng-icons ships one.
 */

export interface SvgNode {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: SvgNode[];
  /** The characters of a `#text` node, which only a `text` or a `tspan` has. */
  readonly text?: string;
}

/** The elements whose characters are drawn. Between any others they are indentation. */
const TEXT_CONTAINERS: ReadonlySet<string> = new Set(['text', 'tspan']);

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Characters as SVG draws them by default: runs of white space as one space, entities read. */
const characters = (raw: string): string =>
  raw.replace(/\s+/g, ' ').replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => ENTITIES[name]!);

/** `<tag`, `/>`, `</tag>` and the attribute soup between them. */
const TAG = /<\s*(\/)?\s*([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)(\/)?>/g;
const ATTRIBUTE = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
/** Comments and processing instructions, which carry nothing a renderer needs. */
const IGNORED = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>/g;

function attributesOf(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  ATTRIBUTE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTRIBUTE.exec(source)) !== null) {
    attrs[match[1]!] = match[2] ?? match[3] ?? '';
  }
  return attrs;
}

/**
 * The root element, or null when there is nothing renderable.
 *
 * Only elements are kept, and the characters inside a `text` or a `tspan`: an icon's other text
 * nodes are whitespace, and a `<title>` is a label a screen reader on the web would read, which
 * here is `accessibilityLabel` on the host.
 */
export function parseSvg(markup: string): SvgNode | null {
  const source = markup.replace(IGNORED, '');
  const stack: SvgNode[] = [];
  let root: SvgNode | null = null;

  TAG.lastIndex = 0;
  let match: RegExpExecArray | null;
  let from = 0;
  while ((match = TAG.exec(source)) !== null) {
    const [, closing, tag, attributes, selfClosing] = match;
    const parent = stack[stack.length - 1];
    const text = characters(source.slice(from, match.index));
    from = TAG.lastIndex;
    if (parent && TEXT_CONTAINERS.has(parent.tag) && text.trim()) {
      parent.children.push({ tag: '#text', attrs: {}, children: [], text });
    }

    if (closing) {
      stack.pop();
      continue;
    }

    const node: SvgNode = { tag: tag!, attrs: attributesOf(attributes ?? ''), children: [] };
    stack[stack.length - 1]?.children.push(node);
    root ??= node;
    // The attribute run is greedy and swallows the `/` of `<path/>`, so the closing slash is
    // recognised at either end of it. Miss this and every sibling nests inside the one before it,
    // which draws the same icon and inherits paint that was never meant for it.
    if (!selfClosing && !/\/\s*$/.test(attributes ?? '')) stack.push(node);
  }

  return root;
}
