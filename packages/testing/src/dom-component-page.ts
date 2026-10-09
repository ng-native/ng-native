'use dom';
/**
 * Fixture for the `dom-component` tests: a DOM component's file, with a `mountInWebView` that
 * throws where the real one reads `window`. A test imports a reference to the page, never this.
 */
function mountInWebView(component: unknown): { domComponent: string } {
  throw new Error(`The page was loaded in a test: ${String(component)}`);
}

export default mountInWebView(class Chart {});
