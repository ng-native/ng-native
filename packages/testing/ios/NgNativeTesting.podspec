require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

# The native side of device tests: the `NgNativeTesting` module, which captures the app's window
# for screenshots and colour checks, and turns UIKit's animations off and on.
Pod::Spec.new do |s|
  s.name           = 'NgNativeTesting'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license']
  s.author         = 'Angular Native'
  s.homepage       = 'https://github.com/coralogix/ng-native'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: 'https://github.com/coralogix/ng-native.git' }
  s.static_framework = true

  s.source_files = '**/*.swift'
  s.dependency 'ExpoModulesCore'
end
