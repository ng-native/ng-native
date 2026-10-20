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
  # `@expo/ui` is an optional peer. Where the app depends on it, which is when Expo links its pod,
  # the modifiers it is given are built. Read from the app's package.json, the nearest above its
  # Podfile: resolving the package finds a copy the app does not depend on, in a workspace's root
  # or pnpm's store, and its pod is then not there to depend on.
  app = Pod::Config.instance.installation_root.ascend.find { |dir| (dir + 'package.json').file? }
  app_package = app ? JSON.parse((app + 'package.json').read) : {}
  has_expo_ui = %w[dependencies devDependencies optionalDependencies].any? do |kind|
    app_package.dig(kind, '@expo/ui')
  end
  s.dependency 'ExpoUI' if has_expo_ui

  s.source_files = '**/*.swift'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
