/**
 * In development, says once when a scrolling element with content stays at zero size along its
 * axis: the usual sign of a component host without `flex: 1`, which renders nothing and says
 * nothing. A second's grace, so a container that is collapsed or animating open is not reported.
 */
export class ZeroSizeWarning {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private warned = false;

  private readonly element: () => string;
  private readonly horizontal: () => boolean;

  /**
   * `element` names the element as written: `<scroll-view class="feed">`. `horizontal` says
   * whether it scrolls along x, so its size is a width.
   */
  constructor(element: () => string, horizontal: () => boolean) {
    this.element = element;
    this.horizontal = horizontal;
  }

  /**
   * A layout, or new content: its size along the scroll axis, and whether there is anything to
   * show. Still zero with content keeps the deadline already running rather than starting over.
   */
  laidOut(size: number, hasContent: boolean): void {
    if (this.warned) return;
    if (size > 0 || !hasContent) {
      clearTimeout(this.timer);
      this.timer = undefined;
    } else {
      this.timer ??= setTimeout(() => this.warn(), 1000);
    }
  }

  stop(): void {
    clearTimeout(this.timer);
  }

  private warn(): void {
    this.warned = true;
    const [size, big] = this.horizontal() ? ['width', 'wide'] : ['height', 'tall'];
    console.warn(
      `[angular-native] ${this.element()} has content but is laid out at zero ${size}, so it ` +
        `shows nothing. A component's host is a flex item that is as ${big} as its content: give ` +
        `the host, or the element, flex: 1 or a ${size}. See ` +
        `https://ng-native.com/packages/components/layout#a-components-host-is-a-flex-item`,
    );
  }
}

declare const ngDevMode: unknown;

/** Whether this is a development build, where the check runs. A release build folds it away. */
export const checksZeroSize = (): boolean => typeof ngDevMode !== 'undefined' && !!ngDevMode;

/**
 * An element as written in a template, with its classes: `<virtual-list class="feed">`. A node is
 * the engine's on a device, and a DOM element on the web host.
 */
export function written(node: unknown): string {
  const { name, localName, classes, classList } = node as {
    name?: string;
    localName?: string;
    classes?: Iterable<string> | null;
    classList?: Iterable<string>;
  };
  // An engine node has a `classList` too, for Angular's renderer, but its classes are `classes`.
  const names = [...((classes === undefined ? classList : classes) ?? [])];
  return `<${name ?? localName}${names.length ? ` class="${names.join(' ')}"` : ''}>`;
}
