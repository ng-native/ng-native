/**
 * The migrations that update an Angular Native app to a new release, and what runs them: `forNx()`
 * for `nx migrate`, `forAngular()` for `ng update`, and the `ng-native-migrate` command for an app
 * with neither.
 */
const { forNx, forAngular } = require('./adapters.cjs');
const { files } = require('./host.cjs');
const { migrations } = require('./migrations.cjs');

module.exports = { migrations, files, forNx, forAngular };
