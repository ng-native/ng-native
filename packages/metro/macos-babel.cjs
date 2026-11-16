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
 *   release alike, where `Platform` is React Native's and the options it drops do nothing when
 *   read. `Platform.macos.js` answers the same way at run time for the rest.
 *
 * Babel runs plugins before presets, so the transformer passes this as a plugin: see
 * `withMacosPlugins` in `macos.cjs`.
 */

/** React Native's own JavaScript, whose iOS branches a Mac takes. */
const REACT_NATIVE = /[\\/]node_modules[\\/]react-native[\\/](Libraries|src)[\\/]/;

/** React Native's `Platform` module, as its own files import it by path. */
const PLATFORM_MODULE = /(^|[\\/])Utilities[\\/]Platform(\.js)?$/;

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

  /** The module `require('...')` names, or null for anything else. */
  const required = (node) =>
    t.isCallExpression(node) &&
    t.isIdentifier(node.callee, { name: 'require' }) &&
    t.isStringLiteral(node.arguments[0])
      ? node.arguments[0].value
      : null;

  /** Whether `key` is an object key or member property named `name`. */
  const named = (key, name) =>
    t.isIdentifier(key, { name }) || t.isStringLiteral(key, { value: name });

  /**
   * Whether `init` is React Native's `Platform` as a `require` reads it: `require('react-native')`'s
   * `Platform`, or the `Platform` module or its `default`.
   */
  function requiresPlatform(init) {
    if (PLATFORM_MODULE.test(required(init) ?? '')) return true;
    if (!t.isMemberExpression(init) || init.computed) return false;
    const from = required(init.object);
    if (from === 'react-native') return named(init.property, 'Platform');
    return PLATFORM_MODULE.test(from ?? '') && named(init.property, 'default');
  }

  /**
   * Whether the identifier `name` is bound, where `path` reads it, to React Native's `Platform`:
   * imported from `react-native` or from its `Platform` module, or required from either. A local
   * object, a parameter or another module's `Platform` is the app's own, and is left to run.
   */
  function isReactNativePlatform(path, name) {
    const binding = path.scope.getBinding(name);
    if (!binding) return false;
    const declaration = binding.path;
    if (declaration.isImportSpecifier() || declaration.isImportDefaultSpecifier()) {
      const from = declaration.parent.source.value;
      if (declaration.isImportDefaultSpecifier()) return PLATFORM_MODULE.test(from);
      return from === 'react-native' && named(declaration.node.imported, 'Platform');
    }
    if (!declaration.isVariableDeclarator() || binding.kind !== 'const') return false;
    const { id, init } = declaration.node;
    if (t.isIdentifier(id)) return requiresPlatform(init);
    if (!t.isObjectPattern(id) || required(init) !== 'react-native') return false;
    return id.properties.some(
      (prop) =>
        t.isObjectProperty(prop) &&
        !prop.computed &&
        named(prop.key, 'Platform') &&
        t.isIdentifier(prop.value, { name }),
    );
  }

  const isPlatformSelect = (path) => {
    const { node } = path;
    return (
      t.isMemberExpression(node.callee) &&
      !node.callee.computed &&
      t.isIdentifier(node.callee.object) &&
      t.isIdentifier(node.callee.property, { name: 'select' }) &&
      t.isObjectExpression(node.arguments[0]) &&
      isReactNativePlatform(path, node.callee.object.name)
    );
  };

  /**
   * Whether evaluating `node` does nothing but make its value: a literal, a name, a function, or an
   * object or array of those. An option `select` does not pick is dropped only when it is one.
   */
  function isInert(node) {
    // A substitution or a numeric conversion of anything but a literal can run its valueOf or
    // toString; `!`, `typeof` and `void` never do.
    if (t.isTemplateLiteral(node)) return node.expressions.length === 0;
    if (t.isLiteral(node) || t.isIdentifier(node) || t.isFunction(node)) return true;
    if (t.isUnaryExpression(node)) {
      if (['!', 'typeof', 'void'].includes(node.operator)) return isInert(node.argument);
      return node.operator !== 'delete' && t.isLiteral(node.argument);
    }
    if (t.isArrayExpression(node))
      return node.elements.every((one) => one !== null && isInert(one));
    if (!t.isObjectExpression(node)) return false;
    return node.properties.every(
      (prop) =>
        t.isObjectMethod(prop) ||
        (t.isObjectProperty(prop) && !prop.computed && isInert(prop.value)),
    );
  }

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
        if (!isPlatformSelect(path)) return;
        const spec = path.node.arguments[0];
        if (!isStatic(spec)) return;
        const key = SELECT_ORDER.find((one) => property(spec, one));
        const picked = key ? property(spec, key) : null;
        // An option not picked is still evaluated when the call runs: keep the call when that does
        // something, and `Platform.macos.js` answers it the same way at run time.
        const dropped = spec.properties.filter(
          (prop) => t.isObjectProperty(prop) && prop.value !== picked,
        );
        if (!dropped.every((prop) => isInert(prop.value))) return;
        path.replaceWith(picked ?? t.identifier('undefined'));
      },
    },
  };
};
