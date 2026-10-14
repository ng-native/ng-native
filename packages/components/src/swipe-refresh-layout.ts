import type { Engine, EngineNode } from '@ng-native/fabric';

/**
 * RN's `splitLayoutProps`: the style keys that size and place a view, rather than paint it. On
 * Android these move from the scroll view to the swipe layout that wraps it.
 */
const OUTER = new Set([
  'margin',
  'marginHorizontal',
  'marginVertical',
  'marginBottom',
  'marginTop',
  'marginLeft',
  'marginRight',
  'flex',
  'flexGrow',
  'flexShrink',
  'flexBasis',
  'alignSelf',
  'height',
  'minHeight',
  'maxHeight',
  'width',
  'minWidth',
  'maxWidth',
  'position',
  'left',
  'right',
  'bottom',
  'top',
  'transform',
  'transformOrigin',
  'rowGap',
  'columnGap',
  'gap',
]);

/** The element names whose host is a native scroll view a refresh control can belong to. */
const SCROLL_HOSTS = new Set(['scroll-view', 'virtual-list']);

type Style = Record<string, unknown>;

/**
 * The Android half of `<refresh-control>`: make its swipe layout the scroll view's parent.
 *
 * `ScrollView.js` does it with `cloneElement(refreshControl, {style: outer}, <NativeScrollView
 * style={inner}>)`. `AndroidSwipeRefreshLayout` is a `ViewGroup` that pulls on its one child;
 * committed inside the scroll view instead, it has no child to pull on and a pull does nothing.
 *
 * The templates cannot say it, because the refresh control is content of the scroll view, so the
 * engine nodes are moved instead: the swipe layout goes where the scroll view was, the scroll view
 * goes inside it, and an anchor, which never reaches Fabric, marks the spot to put it back.
 *
 * `sync` is idempotent and cheap when nothing moved, so it runs after every pass. That is also
 * what repairs the shape when Angular moves the scroll view itself, say in a reordered `@for`:
 * Angular re-inserts the node it knows about, and the next pass wraps it again where it landed.
 *
 * The style is split the same way RN splits it. The inline style Angular writes to the scroll view
 * is read, the layout keys go to the swipe layout over the scroll view's base style, and the
 * scroll view keeps the rest. A moved key is left on the scroll view as `null`, or as its base
 * value for `flexGrow` and `flexShrink`, rather than deleted: Angular only removes a style key
 * that is still there, so a deleted one could never be taken off the swipe layout again.
 *
 * ponytail: only inline style is split. Layout that reaches the scroll view from a class stays on
 * the scroll view inside the swipe layout, which fills it anyway.
 */
export class SwipeRefreshLayout {
  private readonly engine: Engine;
  private readonly layout: EngineNode;
  private scroll: EngineNode | null = null;
  private readonly anchor: EngineNode;
  /** The style object last written to the scroll view, to tell Angular's writes from ours. */
  private written: Style | undefined;
  /** What was written in place of each moved key. */
  private placeholders: Style = {};
  /** The caller's own values for the moved keys. */
  private outer: Style = {};
  /** Whether `nestedScrollEnabled` was ours to set, so that unwrapping can take it back. */
  private nested = false;

  constructor(engine: Engine, layout: EngineNode) {
    this.engine = engine;
    this.layout = layout;
    this.anchor = engine.createAnchor();
  }

  sync(): void {
    const scroll = (this.scroll ??= this.findScroll());
    const parent = scroll?.parent;
    if (!scroll || !parent) return;

    if (parent !== this.layout) {
      this.engine.insertBefore(parent, this.anchor, scroll);
      this.engine.insertBefore(parent, this.layout, scroll);
      this.engine.appendChild(this.layout, scroll);
    }
    // RN's `nestedScrollEnabled ?? true`. `<scroll-view>` and `<virtual-list>` bind it themselves
    // when they can see the control; this covers one they cannot, projected through another
    // component such as `<section-list>`.
    if (scroll.props['nestedScrollEnabled'] === undefined) {
      this.engine.setProp(scroll, 'nestedScrollEnabled', true);
      this.nested = true;
    }
    const style = scroll.props['style'] as Style | undefined;
    if (style !== this.written || this.layout.props['style'] === undefined) this.split(scroll);
  }

  /** Put the scroll view back where the swipe layout is, with its whole style. */
  unwrap(): void {
    const scroll = this.scroll;
    if (scroll) {
      const home = this.anchor.parent;
      if (scroll.parent === this.layout && home)
        this.engine.insertBefore(home, scroll, this.anchor);
      const style = scroll.props['style'] as Style | undefined;
      if (style === this.written) this.engine.setProp(scroll, 'style', this.callerStyle(style));
      if (this.nested) this.engine.setProp(scroll, 'nestedScrollEnabled', undefined);
    }
    this.engine.removeChild(null, this.layout);
    this.engine.removeChild(null, this.anchor);
  }

  /**
   * The scroll view this control is content of: the nearest ancestor that is one. Looked up once,
   * before the first wrap moves the control out from under it.
   */
  private findScroll(): EngineNode | null {
    for (let node = this.layout.parent; node; node = node.parent) {
      if (SCROLL_HOSTS.has(node.tag)) return node;
    }
    return null;
  }

  /** The style as the caller wrote it: the placeholders swapped back for the values they hide. */
  private callerStyle(style: Style | undefined): Style {
    const caller: Style = {};
    for (const [key, value] of Object.entries(style ?? {})) {
      const hidden = key in this.placeholders && value === this.placeholders[key];
      caller[key] = hidden ? this.outer[key] : value;
    }
    return caller;
  }

  private split(scroll: EngineNode): void {
    const outer: Style = {};
    const inner: Style = {};
    const placeholders: Style = {};
    for (const [key, value] of Object.entries(this.callerStyle(scroll.props['style'] as Style))) {
      if (!OUTER.has(key)) {
        inner[key] = value;
        continue;
      }
      outer[key] = value;
      placeholders[key] = key === 'flexGrow' || key === 'flexShrink' ? 1 : null;
    }
    this.outer = outer;
    this.placeholders = placeholders;
    this.written = { ...inner, ...placeholders };
    this.engine.setProp(scroll, 'style', this.written);
    // RN's `compose(baseStyle, outer)`; the direction is the one the scroll view was given.
    this.engine.setProp(this.layout, 'style', {
      flexGrow: 1,
      flexShrink: 1,
      flexDirection: scroll.props['flexDirection'] ?? 'column',
      overflow: 'scroll',
      ...outer,
    });
  }
}
