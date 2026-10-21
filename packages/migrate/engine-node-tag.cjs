/**
 * 0.14.0 renamed the field an engine node keeps its element's tag in, `view` or `text-input`, from
 * `name` to `tag`, so that `name` is free for the DOM's attribute. `StyleTarget`, `ViewNameNode`
 * and `NamedHostNode` from `@ng-native/fabric`, and `BrowserNode` from `@ng-native/web`, which
 * mirror it, have `tag` too. What is rewritten, and what is noted, is as `node-fields.cjs` says.
 */
const { nodeFieldRenames } = require('./node-fields.cjs');

const engineNodeTag = nodeFieldRenames({
  types: {
    '@ng-native/fabric': ['EngineNode', 'StyleTarget', 'ViewNameNode', 'NamedHostNode'],
    '@ng-native/web': ['BrowserNode'],
  },
  fields: { name: { to: 'tag', what: 'element tag' } },
});

module.exports = { engineNodeTag };
