# The ng-native desktop host.
#
#   core/    toolkit-free C++: mounting, the view tree and hit testing, input and hover, text
#            measurement, the module registry and desktop view props. No AppKit, no Objective-C.
#   appkit/  the macOS backend and the ngn-macos binary.
#
# scripts/build.sh is the way in: it fetches the pinned sources into the per-user cache and passes
# their paths here. NGN_BACKEND=none builds only the core and its tests (any OS, no Hermes), which
# is what proves the core never reaches for a toolkit.
cmake_minimum_required(VERSION 3.25)
project(ngn_desktop LANGUAGES C CXX)

if(APPLE)
  set(_default_backend appkit)
else()
  set(_default_backend none)
endif()
set(NGN_BACKEND ${_default_backend} CACHE STRING "appkit or none")
set_property(CACHE NGN_BACKEND PROPERTY STRINGS appkit none)
option(NGN_TESTS "Build the core tests" ON)

set(RN_DIR "" CACHE PATH "The installed react-native package")
set(NGN_SOURCES "" CACHE PATH "Sources fetched by scripts/fetch.sh (<cache>/src)")
set(NGN_HERMES_BUILD "" CACHE PATH "Hermes built by scripts/build-hermes.sh")
foreach(var RN_DIR NGN_SOURCES)
  if(NOT IS_DIRECTORY "${${var}}")
    message(FATAL_ERROR "${var} is not set to a directory; build through scripts/build.sh")
  endif()
endforeach()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_OSX_DEPLOYMENT_TARGET 13.0)
# React Native's libraries reference each other in both directions. Apple's linker and lld
# resolve archives in any order; GNU ld does not, so Linux links with lld.
if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
  add_link_options(-fuse-ld=lld)
endif()
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE RelWithDebInfo)
endif()

if(APPLE)
  # The AppKit backend, and on macOS the core tests of its window-free parts.
  enable_language(OBJC OBJCXX)
endif()
if(NGN_BACKEND STREQUAL "appkit")
  set(NGN_WITH_RUNTIME ON)
elseif(NGN_BACKEND STREQUAL "none")
  set(NGN_WITH_RUNTIME OFF)
else()
  message(FATAL_ERROR "NGN_BACKEND must be appkit or none, not ${NGN_BACKEND}")
endif()

include(cmake/third-party.cmake)
if(NGN_WITH_RUNTIME)
  include(cmake/runtime-dependencies.cmake)
endif()
include(cmake/react-native.cmake)
if(APPLE)
  include(cmake/swift.cmake)
endif()

# --- core -----------------------------------------------------------------------------------------
add_library(ngn_core STATIC
    core/src/accessibility.cpp
    core/src/app-menus.cpp
    core/src/app-windows.cpp
    core/src/bytes.cpp
    core/src/desktop-modal.cpp
    core/src/desktop-view-props.cpp
    core/src/default-menu.cpp
    core/src/dev-server.cpp
    core/src/focus-order.cpp
    core/src/header-bar.cpp
    core/src/host-state.cpp
    core/src/input-dispatcher.cpp
    core/src/key-value-store.cpp
    core/src/launch-settings.cpp
    core/src/live-regions.cpp
    core/src/library-glue.cpp
    core/src/module-registry.cpp
    core/src/mounting-manager.cpp
    core/src/native-controls.cpp
    core/src/native-module.cpp
    core/src/network.cpp
    core/src/text-layout-manager.cpp
    core/src/tray-and-dock.cpp
    core/src/safe-areas.cpp
    core/src/posix-launcher.cpp
    core/src/processes.cpp
    core/src/screen-presentation.cpp
    core/src/screen-stacks.cpp
    core/src/spawn-rules.cpp
    core/src/split-view.cpp
    core/src/svg.cpp
    core/src/symbol.cpp
    core/src/tabs-host.cpp
    core/src/download.cpp
    core/src/updates.cpp
    core/src/expo-image.cpp
    core/src/view-tree.cpp
    core/src/web-view.cpp
    core/src/modules/accessibility-manager.cpp
    core/src/modules/address-search.cpp
    core/src/modules/alert-manager.cpp
    core/src/modules/app-info.cpp
    core/src/modules/app-modules.cpp
    core/src/modules/asset.cpp
    core/src/modules/async-storage.cpp
    core/src/modules/audio.cpp
    core/src/modules/battery.cpp
    core/src/modules/calendar.cpp
    core/src/modules/camera.cpp
    core/src/modules/core-modules.cpp
    core/src/modules/crypto.cpp
    core/src/modules/desktop-expo.cpp
    core/src/modules/file-system.cpp
    core/src/modules/fonts.cpp
    core/src/modules/image-loader.cpp
    core/src/modules/image-manipulator.cpp
    core/src/modules/language-model.cpp
    core/src/modules/local-authentication.cpp
    core/src/modules/location.cpp
    core/src/modules/network-state.cpp
    core/src/modules/networking.cpp
    core/src/modules/notifications.cpp
    core/src/modules/photo-library.cpp
    core/src/modules/printing.cpp
    core/src/modules/screen-capture.cpp
    core/src/modules/sharing.cpp
    core/src/modules/splash-screen.cpp
    core/src/modules/sqlite.cpp
    core/src/modules/store-review.cpp
    core/src/modules/text-recognition.cpp
    core/src/modules/tracking.cpp
    core/src/modules/undo.cpp
    core/src/modules/web-browser.cpp
    core/src/modules/web-socket.cpp)
target_include_directories(ngn_core PUBLIC core/include)
# The system's sqlite3, behind NgNativeSqlite (libsqlite3-dev on Linux).
find_package(SQLite3 REQUIRED)
target_link_libraries(ngn_core PUBLIC react_native SQLite::SQLite3)
target_compile_options(ngn_core PRIVATE -Wall -Wextra -Werror -Wno-unused-parameter)

if(NGN_TESTS)
  file(GLOB core_test_SRC CONFIGURE_DEPENDS core/tests/*.cpp)
  add_executable(ngn_core_tests ${core_test_SRC} core/testing/fake-backend.cpp core/testing/fake-network.cpp core/testing/fake-system.cpp)
  target_include_directories(ngn_core_tests PRIVATE core/testing core/tests)
  target_link_libraries(ngn_core_tests PRIVATE ngn_core doctest)
  # The AppKit backend's own logic that needs no window: on macOS only, over the system's frameworks.
  if(APPLE)
    ngn_link_swift(ngn_core_tests)
    target_sources(ngn_core_tests PRIVATE
        appkit/updates.mm appkit/tests/update-crypto.test.mm
        appkit/crypto.mm appkit/tests/crypto.test.mm
        appkit/app-info.mm appkit/tests/app-info.test.mm
        appkit/network-state.mm appkit/tests/network-state.test.mm
        appkit/battery.mm appkit/tests/battery.test.mm
        appkit/fonts.mm appkit/text-layout.mm appkit/tests/fonts.test.mm
        appkit/text-recognition.mm appkit/tests/text-recognition.test.mm
        appkit/calendar.mm appkit/tests/calendar.test.mm
        appkit/audio.mm appkit/tests/audio.test.mm
        appkit/language-model.mm appkit/tests/language-model.test.mm
        appkit/screen-capture.mm appkit/tests/screen-capture.test.mm
        appkit/photo-library.mm appkit/tests/photo-library.test.mm
        appkit/tracking.mm appkit/tests/tracking.test.mm
        appkit/image-manipulator.mm appkit/tests/image-manipulator.test.mm
        appkit/geocoder.mm appkit/tests/geocoder.test.mm
        appkit/address-search.mm appkit/tests/address-search.test.mm
        appkit/symbol-drawing.mm appkit/tests/symbol.test.mm
        appkit/share-picker.mm appkit/tests/share-picker.test.mm
        appkit/printing.mm appkit/tests/printing.test.mm
        appkit/web-view.mm appkit/tests/web-view.test.mm
        appkit/expo-image-drawing.mm appkit/tests/expo-image.test.mm
        appkit/camera.mm appkit/tests/camera.test.mm
        appkit/test-launch.mm appkit/desktop-expo.mm appkit/tests/test-launch.test.mm)
    target_compile_options(ngn_core_tests PRIVATE $<$<COMPILE_LANGUAGE:OBJCXX>:-fobjc-arc>)
    target_link_libraries(ngn_core_tests PRIVATE "-framework Foundation" "-framework Security" "-framework IOKit" "-framework SystemConfiguration" "-framework Network" "-framework AppKit" "-framework CoreText" "-framework ImageIO" "-framework Vision" "-framework UniformTypeIdentifiers" "-framework EventKit" "-framework AVFoundation" "-framework CoreMedia" "-framework Photos" "-framework PhotosUI" "-framework AppTrackingTransparency" "-framework AdSupport" "-framework CoreLocation" "-framework MapKit" "-framework WebKit" "-framework PDFKit" "-framework CoreImage")
  endif()
  enable_testing()
  add_test(NAME core COMMAND ngn_core_tests)
endif()

# --- the core's runtime half: ReactHost over Hermes ----------------------------------------------
if(NGN_WITH_RUNTIME)
  add_library(ngn_core_runtime STATIC
      core/src/dev-server-helper.cpp
      core/src/host-services.cpp
      core/src/layout-animations.cpp
      core/src/runtime.cpp)
  target_link_libraries(ngn_core_runtime PUBLIC ngn_core hermes-engine::hermesvm)
  target_compile_options(ngn_core_runtime PRIVATE -Wall -Wextra -Werror -Wno-unused-parameter)
endif()

# --- libraries' components (react-native-screens, react-native-safe-area-context) ---------------
include(cmake/libraries.cmake)

# --- autolinked libraries and app modules ------------------------------------------------------
if(NGN_WITH_RUNTIME)
  include(cmake/linked-modules.cmake)
endif()

# --- backends -------------------------------------------------------------------------------------
if(NGN_BACKEND STREQUAL "appkit")
  add_subdirectory(appkit)
endif()
