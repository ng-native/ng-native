/**
 * `<dom-component>`: an Angular component rendered by a browser - DOM, CSS, anything a browser
 * runs - in a web view inside a native screen, with its inputs and outputs bound from the app's
 * template. Expo calls this a DOM component; it is not the Web Components standard.
 *
 * ```ts
 * // web/note.ts: an ordinary Angular component for the browser, in the app's own source
 * 'use dom';
 * @Component({ selector: 'app-note', template: '<textarea ...></textarea>', styles: [...] })
 * export class Note {
 *   readonly label = input('');
 *   readonly sent = output<string>();
 * }
 * export default mountInWebView(Note); // from '@ng-native/web/web-view'
 *
 * // a native screen
 * import note from './web/note.ts';
 * <dom-component [src]="note" class="flex-1"
 *   [inputs]="{ label: title() }" [outputs]="{ sent: save }" />
 * ```
 *
 * The component runs in Expo's own web view (`@expo/dom-webview`, which `expo` already installs),
 * so it is a separate JavaScript runtime from the app and only JSON crosses. It is shipped the way
 * Expo ships its `'use dom'` components: the import is a reference to a page that Expo's dev server
 * serves in development and `expo export:embed` bundles into the app for a release build (see
 * `@ng-native/metro`'s `dom-component.cjs`), and the page is found where Expo finds its own.
 * On macOS the desktop host draws the same view in WebKit, speaking the same protocol, and the
 * page is found where the running bundle came from: the dev server, or the `www.bundle` beside a
 * packaged app's bundle.
 *
 * - **`inputs`** go into the page before it loads, and a changed value is sent to it afterwards
 *   without reloading. Anything sent before the page is ready is sent again once it is.
 * - **`outputs`** map the component's outputs, by public name, to handlers. A name the component
 *   has no output for is an error naming the ones it does have, as `<ng-native-island>`'s is.
 * - **Errors** the page throws reach the app's `ErrorHandler`.
 * - **Only its own page is heard.** A message from any other page the web view shows, after a link
 *   in the content, say, is ignored, as is one that is not JSON, and a changed input is sent to
 *   its own page alone. The inputs given before the page loads are the web view's to hand out,
 *   though, and it hands them to whatever page it is showing, so they are no place for a secret.
 */
import {
  Component,
  ElementRef,
  InjectionToken,
  computed,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';
import { Engine, type EngineNode, type NativeSyntheticEvent } from '@ng-native/fabric';
import { currentPlatform, isDesktopPlatform, optional } from './native.ts';
import { registerExpoView } from './register-expo-view.ts';

/** The element is this package's, so it needs no `registerExpoViews` call of its own. */
registerExpoView('dom-component', 'ExpoDomWebViewModule');

/** A handler for one of the DOM component's outputs. */
export type DomComponentOutputHandler = (value: never) => void;

/** The functions Expo's web view defines on its view, called with the view's tag as `this`. */
export interface WebViewFunctions {
  injectJavaScript(this: { nativeTag: number }, script: string): Promise<void>;
}

/** Where the pages are, and how to reach the view once it is on screen. */
export interface DomComponentSource {
  /** Where Expo keeps DOM components' pages: the dev server, `www.bundle`, or an update. */
  readonly baseUrl: string | null;
  readonly functions: WebViewFunctions | null;
  /**
   * Whether the view takes `injectJavaScript` as a view command, as the desktop host's does,
   * rather than as one of the functions Expo defines on it.
   */
  readonly commands?: boolean;
}

/** What native code gets for `import note from './web/note.ts'`. */
export interface DomComponentReference {
  readonly domComponent: string;
}

type PageMessage =
  | { type: 'ready'; outputs: string[] }
  | { type: 'output'; name: string; value: unknown }
  | { type: 'error'; message: string };

@Component({
  selector: 'dom-component',
  template: '',
  host: {
    '[source]': 'source()',
    '[injectedJavaScriptObject]': 'page()',
    '[webviewDebuggingEnabled]': 'debuggable',
    '(message)': 'receive($event)',
  },
})
export class DomComponent {
  /** Overridden in a test to load pages without a dev server. */
  static readonly SOURCE = new InjectionToken<DomComponentSource>(
    'angular-native.domComponentSource',
    {
      factory: () => {
        if (isDesktopPlatform(currentPlatform())) return desktopSource();
        // Expo's own resolution, so a page is found wherever Expo would look for a DOM
        // component's: the dev server, the app's `www.bundle`, or a downloaded update.
        const base = optional(() => require('expo/src/dom/base') as { getBaseURL(): string });
        const core = optional(
          () => require('expo-modules-core') as typeof import('expo-modules-core'),
        );
        const module = core?.requireOptionalNativeModule<{
          ViewPrototypes?: Record<string, WebViewFunctions>;
        }>('ExpoDomWebViewModule');
        return {
          baseUrl: optional(() => base?.getBaseURL() ?? null),
          functions: module?.ViewPrototypes?.['ExpoDomWebViewModule'] ?? null,
        };
      },
    },
  );

  private readonly native = inject(DomComponent.SOURCE);
  private readonly engine = inject(Engine);
  private readonly node = inject<ElementRef<EngineNode>>(ElementRef).nativeElement;
  private ready = false;

  /** The DOM component, as imported: `import note from './web/note.ts'`. */
  readonly src = input.required<DomComponentReference>();
  /** Its inputs, by public name. JSON only: this crosses into another runtime. */
  readonly inputs = input<Readonly<Record<string, unknown>>>({});
  /** Handlers for its outputs, by public name. */
  readonly outputs = input<Readonly<Record<string, DomComponentOutputHandler>>>({});

  protected readonly debuggable = typeof __DEV__ === 'undefined' || __DEV__;

  protected readonly source = computed(() => {
    const { domComponent } = this.src();
    return this.native.baseUrl === null ? null : { uri: `${this.native.baseUrl}/${domComponent}` };
  });

  /** The file's name for an error message: the dev page names it, a release page is a hash. */
  private readonly name = computed(() => this.src().domComponent.split('?')[0]!);

  /**
   * What the page reads before it loads. The inputs are read untracked: a change to this prop
   * reloads the page, so a changed input is sent to the running page instead.
   */
  protected readonly page = computed(() => {
    this.src();
    return JSON.stringify({ inputs: untracked(this.inputs) });
  });

  constructor() {
    effect(() => {
      const inputs = this.inputs();
      if (this.ready) untracked(() => this.send(inputs));
    });
  }

  protected receive(event: NativeSyntheticEvent<{ data: string; url?: string }>): void {
    const { data, url } = event.nativeEvent;
    const source = this.source();
    if (!source || !isOwnPage(url, source.uri)) {
      if (this.debuggable) {
        console.warn(
          `[angular-native] <dom-component> ${this.name()}: ignored a message from ` +
            `${url || 'an unnamed page'}, which is not its own page.`,
        );
      }
      return;
    }
    const message = parse(data);
    if (!message) {
      if (this.debuggable) {
        console.warn(
          `[angular-native] <dom-component> ${this.name()}: dropped a message that is not JSON.`,
        );
      }
      return;
    }
    if (message.type === 'ready') {
      this.checkOutputs(message.outputs);
      this.ready = true;
      this.send(this.inputs());
    } else if (message.type === 'output') {
      const outputs = this.outputs();
      if (Object.hasOwn(outputs, message.name)) outputs[message.name]!(message.value as never);
    } else if (message.type === 'error') {
      throw new Error(`[angular-native] <dom-component> ${this.name()}: ${message.message}`);
    }
  }

  private checkOutputs(declared: readonly string[]): void {
    for (const name of Object.keys(this.outputs())) {
      if (!declared.includes(name)) {
        throw new Error(
          `[angular-native] <dom-component>: ${this.name()} has no output '${name}' ` +
            `(its outputs: ${declared.join(', ') || 'none'}).`,
        );
      }
    }
  }

  private send(inputs: Readonly<Record<string, unknown>>): void {
    const source = this.source();
    if (!source) return;
    const message = JSON.stringify({ type: 'inputs', inputs });
    const script = inOwnPage(
      source.uri,
      `window.__ngNative && window.__ngNative.receive(${message});`,
    );
    if (this.native.commands) {
      this.engine.dispatchCommand(this.node, 'injectJavaScript', [script]);
      return;
    }
    const nativeTag = this.engine.tagOf(this.node);
    if (!this.native.functions || nativeTag === null) return;
    void this.native.functions.injectJavaScript.call({ nativeTag }, script);
  }
}

/**
 * Whether the page a message came from is the one the component loaded, so a page the web view
 * was taken to (by a link in the content, say) cannot fire the app's outputs or ask for its inputs.
 *
 * The web view names the page it is showing, not the frame that posted, so this tells pages apart
 * and not an iframe from the page that holds it. Every message is named on both platforms, from
 * the web view's own URL; one with no URL cannot be placed, so it is not trusted either.
 *
 * - **Served by the dev server**, the page is trusted by origin: that server serves the app itself.
 * - **Loaded from a file** in a release build or an update, the page is trusted by file name. The
 *   web view reports the file as the native side resolved it, which differs from the source URI
 *   before the name (on iOS the source is `www.bundle/...`, relative to the app), so the page must
 *   be a `file:` URL whose file name is the source's, a hash of the component's path.
 */
function isOwnPage(url: string | undefined, source: string): boolean {
  if (!url) return false;
  const served = servedFrom(source);
  if (served) return url.toLowerCase().startsWith(`${served}/`);
  return /^file:/i.test(url) && fileName(url) === fileName(source);
}

/**
 * A script that runs `call` only where the web view shows the component's own page, by
 * `isOwnPage`'s rule, as the page itself reads its address. The web view runs what it is given
 * in whatever page it is showing, and one a link took it to may define `__ngNative` to be handed
 * the app's inputs, and may replace any method of a string or a pattern to pass a check made with
 * one. So the check reads only what such a page cannot change: `location`'s own properties, a
 * string's length and characters, and `===`.
 */
function inOwnPage(source: string, call: string): string {
  const served = servedFrom(source);
  const own = served
    ? `location.origin === ${JSON.stringify(served)}`
    : `location.protocol === 'file:' && (function (path, end) {
        var from = path.length - end.length;
        for (var at = 0; at < end.length; at++) if (path[from + at] !== end[at]) return false;
        return true;
      })(location.pathname, ${JSON.stringify(`/${fileName(source)}`)})`;
  return `if (${own}) { ${call} } true;`;
}

/** The origin of the dev server that serves the page, lowercased, as `location.origin` has it. */
function servedFrom(source: string): string | undefined {
  return /^https?:\/\/[^/?#]+/i.exec(source)?.[0]?.toLowerCase();
}

function fileName(url: string): string {
  return url.split(/[?#]/)[0]!.split('/').at(-1)!;
}

/**
 * The desktop host's source: its own web view, which takes `injectJavaScript` as a view command,
 * with the pages where the running bundle came from (see `desktopPagesUrl`). Expo's packages are
 * not in a desktop app, so Expo's own resolution is not there to ask.
 */
function desktopSource(): DomComponentSource {
  const { TurboModuleRegistry } = require('react-native') as typeof import('react-native');
  const sourceCode = TurboModuleRegistry.get<
    { getConstants(): { scriptURL?: string } } & import('react-native').TurboModule
  >('SourceCode');
  return {
    baseUrl: desktopPagesUrl(optional(() => sourceCode?.getConstants().scriptURL)),
    functions: null,
    commands: true,
  };
}

/**
 * Where the desktop host finds DOM components' pages, from the URL of the bundle it runs: Expo's
 * dev server route (`/_expo/@dom`) on the server a bundle came from, and the `www.bundle` that
 * `expo export:embed` writes beside a bundle on disk, as in a packaged app's `Resources`. Null for
 * a bundle it cannot place.
 */
export function desktopPagesUrl(scriptURL: string | null | undefined): string | null {
  if (!scriptURL) return null;
  const served = servedFrom(scriptURL);
  if (served) return `${served}/_expo/@dom`;
  if (!/^file:/i.test(scriptURL)) return null;
  return `${scriptURL.slice(0, scriptURL.lastIndexOf('/'))}/www.bundle`;
}

function parse(data: string): PageMessage | undefined {
  try {
    const message: unknown = JSON.parse(data);
    return typeof message === 'object' && message !== null ? (message as PageMessage) : undefined;
  } catch {
    return undefined;
  }
}

declare const __DEV__: boolean | undefined;
