require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

# The iOS side of the elements whose native view or module the host draws: `<native-button>` as a
# UIButton, the `contextMenu`, `fileDrop` and `dragItem` view props, and the `NgNativeMenus` and
# `NgNativeUndo` modules. Fabric components, so React Native's own C++ is a dependency.
Pod::Spec.new do |s|
  s.name           = 'NgNativeComponents'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license']
  s.author         = 'Angular Native'
  s.homepage       = 'https://github.com/ng-native/ng-native'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: 'https://github.com/ng-native/ng-native.git' }
  s.static_framework = true

  s.source_files = '**/*.{h,mm}'
  s.dependency 'React-Core'
  install_modules_dependencies(s)
end
