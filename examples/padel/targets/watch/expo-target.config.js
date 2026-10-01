/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: 'watch',
  name: 'PadelWatch',
  displayName: 'Padel',
  bundleIdentifier: '.watchkitapp',
  deploymentTarget: '11.0',
  frameworks: ['SwiftUI', 'WatchConnectivity'],
};
