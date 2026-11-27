/**
 * Whether the workspace saves exact versions, and the dependencies written that way when it does.
 * Shared with `@ng-native/turbo`, so it lives in `@ng-native/migrate`; this is the same module, so a
 * test that replaces its `registry` replaces the one every generator here uses.
 */
module.exports = require('@ng-native/migrate/save-exact.cjs');
