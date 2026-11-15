/**
 * The Babel plugin a `macos` bundle is transformed with, ahead of `babel-preset-expo`'s own.
 *
 * Expo SDK 58 resolves React Native's `.ios.js` files for `macos`, and the desktop host implements
 * the iOS-named native modules, so React Native's JavaScript has to take its iOS branches there
 * too. Two things stop it:
 *
 * - React Native's `Platform.OS === 'ios'` checks, which are false on a Mac. In a release build the
 *   preset inlines `Platform.OS` as `'macos'` and the minifier deletes every iOS branch, so
 *   `Alert.alert` shipped with an empty body. Inside React Native's own `Libraries` and `src`, each
 *   comparison with `'ios'` is made to match `'macos'` as well, before the preset inlines anything.
 *   App code is left alone and sees `'macos'`.
 * - `Platform.select`, which the preset inlines in a release build with no `macos` key in mind:
 *   `Platform.select({ ios: 1 })` came out `undefined`. A select whose keys are all written out is
 *   answered here from `macos`, then `ios`, then `native`, then `default`, in every file, in dev and
 *   release alike. `Platform.macos.js` answers the same way at run time for the rest.
 *
 * Babel runs plugins before presets, so the transformer passes this as a plugin: see
 * `withMacosPlugins` in `macos.cjs`.
 */

/** React Native's own JavaScript, whose iOS branches a Mac takes. */
const REACT_NATIVE = /[\\/]node_modules[\\/]react-native[\\/](Libraries|src)[\\/]/;

/** The keys a `macos` bundle reads a `Platform.select` by, in order. */
const SELECT_ORDER = ['macos', 'ios', 'native', 'default'];

/** @param {{ types: any }} babel Babel's API, as it hands a plugin */
module.exports = function macosPlatformPlugin({ types: t }) {
  /** The comparisons this plugin wrote, which it must not rewrite again. */
  const written = new WeakSet();

  /** `<anything>.OS`. */
  const isOS = (node) =>
    t.isMemberExpression(node) &&
    (node.computed
      ? t.isStringLiteral(node.property, { value: 'OS' })
      : t.isIdentifier(node.property, { name: 'OS' }));

  const isIos = (node) => t.isStringLiteral(node, { value: 'ios' });

  /** The value a key names in an object literal, or null when it names none. */
  function property(object, key) {
    for (const prop of object.properties) {
      const named =
        t.isIdentifier(prop.key, { name: key }) || t.isStringLiteral(prop.key, { value: key });
      if (!named) continue;
      if (t.isObjectProperty(prop)) return prop.value;
      if (t.isObjectMethod(prop)) return t.toExpression(prop);
    }
    return null;
  }

  /** Every key written out, so none can be added at run time: as the preset's own check. */
  const isStatic = (object) =>
    object.properties.every(
      (prop) =>
        !t.isSpreadElement(prop) &&
        !prop.computed &&
        (!t.isObjectMethod(prop) || prop.kind === 'method') &&
        (t.isIdentifier(prop.key) || t.isStringLiteral(prop.key)),
    );

  const isPlatformSelect = (node) =>
    t.isMemberExpression(node.callee) &&
    t.isIdentifier(node.callee.object, { name: 'Platform' }) &&
    t.isIdentifier(node.callee.property, { name: 'select' }) &&
    t.isObjectExpression(node.arguments[0]);

  return {
    name: 'ng-native-macos-platform',
    visitor: {
      BinaryExpression(path, state) {
        const { node } = path;
        if (written.has(node) || !REACT_NATIVE.test(state.filename ?? '')) return;
        if (!['===', '==', '!==', '!='].includes(node.operator)) return;
        const os = isOS(node.left) && isIos(node.right) ? node.left : null;
        const reversed = isOS(node.right) && isIos(node.left) ? node.right : null;
        const read = os ?? reversed;
        if (!read) return;
        written.add(node);
        const macos = t.binaryExpression(
          node.operator,
          t.cloneNode(read),
          t.stringLiteral('macos'),
        );
        written.add(macos);
        const negated = node.operator.startsWith('!');
        path.replaceWith(t.logicalExpression(negated ? '&&' : '||', node, macos));
      },
      CallExpression(path) {
        const { node } = path;
        if (!isPlatformSelect(node)) return;
        const spec = node.arguments[0];
        if (!isStatic(spec)) return;
        for (const key of SELECT_ORDER) {
          const value = property(spec, key);
          if (value) return void path.replaceWith(value);
        }
        path.replaceWith(t.identifier('undefined'));
      },
    },
  };
};
