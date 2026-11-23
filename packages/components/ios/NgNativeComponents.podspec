require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

# The iOS side of the elements whose native view or module the host draws: `<native-button>` as a
# UIButton, `<split-view>` on an iPad as a UISplitViewController, the `NgNativeWindows` module,
# which opens `AppWindows` as iPadOS scenes, and the `NgNativeMenus`, `NgNativeUndo` and
# `NgNativeDragAndDrop` modules, which add context menus, drops and drags to React Native's own
# views by `nativeID`. Fabric components, so React Native's own C++ is a
# dependency.
Pod::Spec.new do |s|
  s.name           = 'NgNativeComponents'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license']
  s.author         = 'Angular Native'
  s.homepage       = 'https://github.com/coralogix/ng-native'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: 'https://github.com/coralogix/ng-native.git' }
  s.static_framework = true

  s.source_files = '**/*.{h,mm}'
  # The unit tests build on their own: `tests/run-tests.sh`.
  s.exclude_files = 'tests/**/*'
  s.dependency 'React-Core'
  install_modules_dependencies(s)
end
