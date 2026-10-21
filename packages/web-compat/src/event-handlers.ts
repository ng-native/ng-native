/**
 * An element's event handlers as properties, `onclick` to `onwheel`: a function written to one is
 * called for each event of its type, after the listeners added before it, with the element as
 * `this`, and an answer of `false` cancels the event. `null` until one is written, and written
 * `null` again, or anything that is no function or object, it is taken off.
 *
 * ponytail: the property only. A handler written as an attribute's text is not compiled, which a
 * release build could not do, and a window's and a document's are not among these.
 */

const TYPES = (
  'abort auxclick beforeinput beforematch beforetoggle blur cancel canplay canplaythrough ' +
  'change click close contextlost contextmenu contextrestored copy cuechange cut dblclick drag ' +
  'dragend dragenter dragleave dragover dragstart drop durationchange emptied ended error focus ' +
  'formdata input invalid keydown keypress keyup load loadeddata loadedmetadata loadstart ' +
  'mousedown mouseenter mouseleave mousemove mouseout mouseover mouseup paste pause play playing ' +
  'progress ratechange reset resize scroll scrollend securitypolicyviolation seeked seeking ' +
  'select slotchange stalled submit suspend timeupdate toggle volumechange waiting wheel ' +
  'animationstart animationiteration animationend animationcancel transitionrun ' +
  'transitionstart transitionend transitioncancel gotpointercapture lostpointercapture ' +
  'pointerdown pointermove pointerrawupdate pointerup pointercancel pointerover pointerout ' +
  'pointerenter pointerleave selectstart selectionchange'
).split(' ');

type Handler = ((this: unknown, event: unknown) => unknown) | { handleEvent?: unknown };

interface Target {
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
}

interface Written {
  handler: Handler;
  readonly listener: (event: { preventDefault(): void }) => void;
}

/** The handler written to each type of each element, with the listener that calls it. */
const handlers = new WeakMap<object, Map<string, Written>>();

function write(target: Target, type: string, value: unknown): void {
  const own = handlers.get(target) ?? new Map<string, Written>();
  handlers.set(target, own);
  const written = own.get(type);
  const handler =
    typeof value === 'function' || (value && typeof value === 'object') ? value : null;
  if (!handler) {
    if (written) target.removeEventListener(type, written.listener as never);
    own.delete(type);
    return;
  }
  if (written) {
    written.handler = handler as Handler;
    return;
  }
  const entry: Written = {
    handler: handler as Handler,
    listener(event) {
      const current = entry.handler;
      // An object is no handler that can be called: it is kept, and does nothing.
      if (typeof current !== 'function') return;
      if (current.call(target, event) === false) event.preventDefault();
    },
  };
  own.set(type, entry);
  target.addEventListener(type, entry.listener as never);
}

/** The members, for every node: an element answers each, and a text or a comment none. */
export const eventHandlerMembers: PropertyDescriptorMap = Object.fromEntries(
  TYPES.map((type) => [
    `on${type}`,
    {
      get(this: Target & { nodeKind?: unknown }) {
        if (this.nodeKind !== 'element') return undefined;
        return handlers.get(this)?.get(type)?.handler ?? null;
      },
      set(this: Target & { nodeKind?: unknown }, value: unknown) {
        if (this.nodeKind === 'element') return write(this, type, value);
        // A text's or a comment's is a property of its own, as on any object.
        Object.defineProperty(this, `on${type}`, {
          value,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      },
      configurable: true,
    },
  ]),
);
