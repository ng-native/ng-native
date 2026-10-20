require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'NgNativeExpo'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license']
  s.author         = 'Angular Native'
  s.homepage       = 'https://github.com/ng-native/ng-native'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/ng-native/ng-native.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # `@expo/ui` is an optional peer. Where the app has it, the modifiers it is given are built.
  # Looked for from the app's Podfile, not from here, and without the NODE_PATH `expo run:ios`
  # sets: from here, or through pnpm's store, a workspace app finds this package's own copy.
  has_expo_ui = system(
    { 'NODE_PATH' => nil },
    'node', '-e', "require.resolve('@expo/ui/package.json', { paths: [process.argv[1]] })",
    Pod::Config.instance.installation_root.to_s,
    out: File::NULL, err: File::NULL
  )
  s.dependency 'ExpoUI' if has_expo_ui

  s.source_files = '**/*.swift'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
