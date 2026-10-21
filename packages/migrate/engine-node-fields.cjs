/**
 * 0.17.0 renamed the fields of an engine node that have the name of a DOM element's member, so
 * a node seen as an element does not hide that member: `children` is `childList`, `text` is
 * `nodeText`, `kind` is `nodeKind`, `host` is `engine` and `sheet` is `templateSheet`.
 * `HostNode`, `StyleTarget` and `ViewNameNode` from `@ng-native/fabric`, and `BrowserNode` from
 * `@ng-native/web`, which mirror it, have the new names too. What is rewritten, and what is
 * noted, is as `node-fields.cjs` says.
 */
const { nodeFieldRenames } = require('./node-fields.cjs');

const engineNodeFields = nodeFieldRenames({
  types: {
    '@ng-native/fabric': ['EngineNode', 'HostNode', 'StyleTarget', 'ViewNameNode'],
    '@ng-native/web': ['BrowserNode'],
  },
  fields: {
    children: { to: 'childList', what: 'child nodes' },
    text: { to: 'nodeText', what: 'text' },
    kind: { to: 'nodeKind', what: 'kind' },
    host: { to: 'engine', what: 'host engine' },
    sheet: { to: 'templateSheet', what: 'sheet' },
  },
});

module.exports = { engineNodeFields };
