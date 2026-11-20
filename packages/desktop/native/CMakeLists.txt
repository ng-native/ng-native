# The ng-native desktop host.
#
#   core/    toolkit-free C++: mounting, the view tree and hit testing, input and hover, text
#            measurement, the module registry and desktop view props. No AppKit, no Objective-C.
#   appkit/  the macOS backend and the ngn-macos binary.
#   gtk/     the Linux backend over GTK 4 and the ngn-linux binary; it also builds on a Mac against
#            Homebrew's GTK, as a dev loop.
#
# scripts/build.sh is the way in: it fetches the pinned sources into the per-user cache and passes
# their paths here. NGN_BACKEND=none builds only the core and its tests (any OS, no Hermes), which
# is what proves the core never reaches for a toolkit; with NGN_RUNTIME, the runtime half over
# Hermes too, and its tests, still with no toolkit.
cmake_minimum_required(VERSION 3.25)
project(ngn_desktop LANGUAGES C CXX)

if(APPLE)
  set(_default_backend appkit)
else()
  set(_default_backend none)
endif()
set(NGN_BACKEND ${_default_backend} CACHE STRING "appkit, gtk or none")
set_property(CACHE NGN_BACKEND PROPERTY STRINGS appkit gtk none)
option(NGN_TESTS "Build the core tests" ON)
option(NGN_RUNTIME "With NGN_BACKEND=none, build the runtime half over Hermes too" OFF)

set(RN_DIR "" CACHE PATH "The installed react-native package")
set(NGN_SOURCES "" CACHE PATH "Sources fetched by scripts/fetch.sh (<cache>/src)")
set(NGN_HERMES_BUILD "" CACHE PATH "Hermes built by scripts/build-hermes.sh")
set(NGN_HERMES_PREBUILT "" CACHE PATH "React Native's prebuilt Hermes, from scripts/fetch-hermes.sh")
foreach(var RN_DIR NGN_SOURCES)
  if(NOT IS_DIRECTORY "${${var}}")
    message(FATAL_ERROR "${var} is not set to a directory; build through scripts/build.sh")
  endif()
endforeach()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
# The oldest macOS the host runs on (scripts/macos-target.sh reads it from here).
set(CMAKE_OSX_DEPLOYMENT_TARGET 14.0)
# React Native's libraries reference each other in both directions. Apple's linker and lld
# resolve archives in any order; GNU ld does not, so Linux links with lld.
if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
  add_link_options(-fuse-ld=lld)
  # A std::atomic of a type wider than the hardware's lock-free size calls libatomic on Linux;
  # Apple's runtime has those calls built in.
  link_libraries(atomic)
endif()
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE RelWithDebInfo)
endif()

if(APPLE)
  # The AppKit backend, and on macOS the core tests of its window-free parts.
  enable_language(OBJC OBJCXX)
endif()
if(NGN_BACKEND STREQUAL "appkit" OR NGN_BACKEND STREQUAL "gtk")
  set(NGN_WITH_RUNTIME ON)
elseif(NGN_BACKEND STREQUAL "none")
  set(NGN_WITH_RUNTIME ${NGN_RUNTIME})
else()
  message(FATAL_ERROR "NGN_BACKEND must be appkit, gtk or none, not ${NGN_BACKEND}")
endif()

# A dev build carries React Native's debugger: Hermes's CDP agents and the inspector targets that
# the dev server's inspector proxy lists, as React Native's own Debug builds do. React Native gates
# them on a Debug build type or this; a packaged app (Release) leaves them out.
if(NOT CMAKE_BUILD_TYPE STREQUAL "Release")
  set(REACT_NATIVE_DEBUG_OPTIMIZED ON)
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
    core/src/absent-views.cpp
    core/src/accent-colors.cpp
    core/src/accessibility.cpp
    core/src/aria-role.cpp
    core/src/animation-frames.cpp
    core/src/app-menus.cpp
    core/src/app-windows.cpp
    core/src/back-swipe.cpp
    core/src/bytes.cpp
    core/src/control-sizes.cpp
    core/src/crash-report.cpp
    core/src/desktop-modal.cpp
    core/src/desktop-view-props.cpp
    core/src/dbus-menu.cpp
    core/src/default-menu.cpp
    core/src/dev-server.cpp
    core/src/dom-web-view.cpp
    core/src/focus-order.cpp
    core/src/gestures.cpp
    core/src/glass.cpp
    core/src/header-bar.cpp
    core/src/host-os.cpp
    core/src/host-state.cpp
    core/src/host-views.cpp
    core/src/image-source.cpp
    core/src/input-dispatcher.cpp
    core/src/input-script.cpp
    core/src/key-value-store.cpp
    core/src/launch-settings.cpp
    core/src/live-regions.cpp
    core/src/text-units.cpp
    core/src/accessibility-relations.cpp
    core/src/library-glue.cpp
    core/src/module-registry.cpp
    core/src/mounting-manager.cpp
    core/src/native-controls.cpp
    core/src/native-module.cpp
    core/src/network.cpp
    core/src/text-input.cpp
    core/src/text-layout-manager.cpp
    core/src/tray-and-dock.cpp
    core/src/undo-stacks.cpp
    core/src/safe-areas.cpp
    core/src/scrollers.cpp
    core/src/posix-launcher.cpp
    core/src/processes.cpp
    core/src/screen-presentation.cpp
    core/src/screen-stacks.cpp
    core/src/spawn-rules.cpp
    core/src/split-view.cpp
    core/src/svg.cpp
    core/src/symbol.cpp
    core/src/system.cpp
    core/src/tabs-host.cpp
    core/src/download.cpp
    core/src/updates.cpp
    core/src/view-box.cpp
    core/src/view-transform.cpp
    core/src/red-box.cpp
    core/src/expo-image.cpp
    core/src/expo-ui.cpp
    core/src/view-tree.cpp
    core/src/web-view.cpp
    core/src/worklet-host.cpp
    core/src/modules/accessibility-manager.cpp
    core/src/modules/address-search.cpp
    core/src/modules/alert-manager.cpp
    core/src/modules/app-info.cpp
    core/src/modules/app-modules.cpp
    core/src/modules/apple-authentication.cpp
    core/src/modules/asset.cpp
    core/src/modules/async-storage.cpp
    core/src/modules/audio.cpp
    core/src/modules/battery.cpp
    core/src/modules/calendar.cpp
    core/src/modules/camera.cpp
    core/src/modules/core-modules.cpp
    core/src/modules/crypto.cpp
    core/src/modules/desktop-expo.cpp
    core/src/modules/desktop-modules.cpp
    core/src/modules/file-system.cpp
    core/src/modules/fonts.cpp
    core/src/modules/image-loader.cpp
    core/src/modules/image-manipulator.cpp
    core/src/modules/language-model.cpp
    core/src/modules/local-authentication.cpp
    core/src/modules/location.cpp
    core/src/modules/maps.cpp
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
    core/src/modules/video.cpp
    core/src/modules/web-browser.cpp
    core/src/modules/web-socket.cpp)
target_include_directories(ngn_core PUBLIC core/include)
# The system's sqlite3, behind NgNativeSqlite (libsqlite3-dev on Linux).
find_package(SQLite3 REQUIRED)
target_link_libraries(ngn_core PUBLIC react_native SQLite::SQLite3)
target_compile_options(ngn_core PRIVATE -Wall -Wextra -Werror -Wno-unused-parameter -Wno-missing-field-initializers)

if(NGN_TESTS)
  file(GLOB core_test_SRC CONFIGURE_DEPENDS core/tests/*.cpp)
  add_executable(ngn_core_tests ${core_test_SRC} core/testing/fake-backend.cpp core/testing/fake-network.cpp core/testing/fake-system.cpp)
  # shim/ for the SHA-256 shim's own test.
  target_include_directories(ngn_core_tests PRIVATE core/testing core/tests shim)
  target_link_libraries(ngn_core_tests PRIVATE ngn_core doctest)
  # doctest includes <ciso646> under clang, which libstdc++ 15 marks deprecated with a #warning;
  # keep it a warning rather than an error under -Werror (libc++, on Apple, has no such warning).
  # The group is #warnings in clang and cpp in GCC, which rejects the other's name.
  if(NOT APPLE)
    target_compile_options(ngn_core_tests PRIVATE
        $<$<CXX_COMPILER_ID:Clang>:-Wno-error=\#warnings>
        $<$<CXX_COMPILER_ID:GNU>:-Wno-error=cpp>)
    # clang 22's -Wpedantic calls doctest's __COUNTER__ a C2y extension. -Wpedantic comes from
    # React Native's interface options, which follow the target's own, so the exception goes on
    # the sources, whose options come last.
    include(CheckCXXCompilerFlag)
    check_cxx_compiler_flag(-Wc2y-extensions NGN_HAS_WC2Y_EXTENSIONS)
    if(NGN_HAS_WC2Y_EXTENSIONS)
      set(NGN_DOCTEST_SOURCE_OPTIONS -Wno-c2y-extensions)
      set_source_files_properties(${core_test_SRC} PROPERTIES COMPILE_OPTIONS -Wno-c2y-extensions)
    endif()
  endif()
  # The AppKit backend's own logic that needs no window: on macOS only, over the system's frameworks,
  # and not in a GTK build on a Mac, which tests the GTK backend instead.
  if(APPLE AND NOT NGN_BACKEND STREQUAL "gtk")
    ngn_link_swift(ngn_core_tests)
    target_sources(ngn_core_tests PRIVATE
        appkit/updates.mm appkit/tests/update-crypto.test.mm
        appkit/crypto.mm appkit/tests/crypto.test.mm
        appkit/app-info.mm appkit/tests/app-info.test.mm
        appkit/network-state.mm appkit/tests/network-state.test.mm
        appkit/battery.mm appkit/tests/battery.test.mm
        appkit/fonts.mm appkit/text-layout.mm appkit/tests/fonts.test.mm appkit/tests/text-layout.test.mm
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
        appkit/expo-ui-renderer.mm appkit/tests/expo-ui.test.mm
        appkit/camera.mm appkit/tests/camera.test.mm appkit/camera-sheet.mm appkit/system-access.mm appkit/tests/camera-sheet.test.mm
        appkit/maps.mm appkit/tests/maps.test.mm
        appkit/apple-authentication.mm appkit/tests/apple-authentication.test.mm
        appkit/video.mm appkit/tests/video.test.mm
        appkit/apple-id-button.mm appkit/tests/apple-id-button.test.mm
        appkit/text-input-field.mm appkit/tests/text-input-field.test.mm
        appkit/search-field.mm appkit/tests/search-field.test.mm
        appkit/search-toolbar-item.mm appkit/tests/search-toolbar-item.test.mm
        appkit/cg-canvas.mm appkit/tests/svg-effects.test.mm appkit/tests/svg-text.test.mm
        appkit/scrollers.mm appkit/tests/scrollers.test.mm
        appkit/bookmarks.mm appkit/tests/bookmarks.test.mm
        appkit/push.mm appkit/tests/push.test.mm
        appkit/notifications.mm appkit/tests/notifications.test.mm
        appkit/undo.mm appkit/tests/undo.test.mm
        appkit/input-replay.mm appkit/tests/input-replay.test.mm
        appkit/modal-focus.mm appkit/tests/modal-focus.test.mm
        appkit/presentation-label.mm appkit/tests/presentation-label.test.mm
        appkit/glass-effect.mm appkit/tests/glass.test.mm
        appkit/menu-bar.mm appkit/tests/menu-bar.test.mm
        appkit/system.mm appkit/tests/system.test.mm
        appkit/image-request.mm appkit/tests/image-request.test.mm
        appkit/tests/pointer-buttons.test.mm
        appkit/test-launch.mm appkit/desktop-expo.mm appkit/tests/test-launch.test.mm appkit/tests/locales.test.mm
        appkit/tests/desktop-expo.test.mm)
    target_compile_options(ngn_core_tests PRIVATE $<$<COMPILE_LANGUAGE:OBJCXX>:-fobjc-arc>)
    target_link_libraries(ngn_core_tests PRIVATE "-framework Foundation" "-framework Security" "-framework IOKit" "-framework SystemConfiguration" "-framework Network" "-framework AppKit" "-framework CoreText" "-framework ImageIO" "-framework Vision" "-framework UniformTypeIdentifiers" "-framework EventKit" "-framework AVFoundation" "-framework CoreMedia" "-framework Photos" "-framework PhotosUI" "-framework AppTrackingTransparency" "-framework AdSupport" "-framework CoreLocation" "-framework MapKit" "-framework WebKit" "-framework PDFKit" "-framework CoreImage" "-framework AuthenticationServices" "-framework AVKit" "-framework UserNotifications")
  endif()
  enable_testing()
  if(NGN_HERMES_TEST_RPATH)
    target_link_options(ngn_core_tests PRIVATE ${NGN_HERMES_TEST_RPATH})
  endif()
  add_test(NAME core COMMAND ngn_core_tests)
endif()

# --- the HTTP and WebSocket client over libcurl, for a backend whose OS has none (gtk) -------------
# AUTO follows the backend on every configure, so a build directory reused for another backend
# gets that backend's choice; ON or OFF is the developer's own.
set(NGN_CURL AUTO CACHE STRING "Build the libcurl client (core/src/curl-network.cpp) and its tests: AUTO (on for gtk), ON or OFF")
set_property(CACHE NGN_CURL PROPERTY STRINGS AUTO ON OFF)
if(NGN_CURL STREQUAL "AUTO")
  if(NGN_BACKEND STREQUAL "gtk")
    set(_ngn_curl ON)
  else()
    set(_ngn_curl OFF)
  endif()
else()
  set(_ngn_curl ${NGN_CURL})
endif()
if(NGN_BACKEND STREQUAL "gtk" AND NOT _ngn_curl)
  message(FATAL_ERROR "The GTK backend's networking is the libcurl client: NGN_CURL must be AUTO or ON")
endif()
if(_ngn_curl)
  include(cmake/curl.cmake)
  add_library(ngn_curl STATIC core/src/curl-network.cpp)
  target_link_libraries(ngn_curl PUBLIC ngn_core PRIVATE ngn_libcurl)
  target_compile_options(ngn_curl PRIVATE -Wall -Wextra -Werror -Wno-unused-parameter -Wno-missing-field-initializers)
  # The Expo Updates client's hash and signature check over the same system OpenSSL 3, for the
  # backend with no OS crypto of its own.
  add_library(ngn_openssl STATIC core/src/openssl-update-crypto.cpp)
  target_include_directories(ngn_openssl PRIVATE ${NGN_OPENSSL_INCLUDE_DIRS})
  target_link_libraries(ngn_openssl PUBLIC ngn_core ${NGN_OPENSSL_LINK_LIBRARIES})
  target_compile_options(ngn_openssl PRIVATE -Wall -Wextra -Werror -Wno-unused-parameter -Wno-missing-field-initializers)
  if(NGN_TESTS)
    target_sources(ngn_core_tests PRIVATE core/tests/openssl/update-crypto.test.cpp)
    target_link_libraries(ngn_core_tests PRIVATE ngn_openssl)
    set_source_files_properties(core/tests/openssl/update-crypto.test.cpp PROPERTIES COMPILE_OPTIONS "${NGN_DOCTEST_SOURCE_OPTIONS}")
    # Against a local server, test-server.py, which needs python3.
    set(_curl_tests core/tests/curl/network.test.cpp)
    target_sources(ngn_core_tests PRIVATE ${_curl_tests})
    target_link_libraries(ngn_core_tests PRIVATE ngn_curl)
    set_source_files_properties(${_curl_tests} PROPERTIES
        COMPILE_DEFINITIONS NGN_CURL_TEST_SERVER="${CMAKE_CURRENT_SOURCE_DIR}/core/tests/curl/test-server.py"
        COMPILE_OPTIONS "${NGN_DOCTEST_SOURCE_OPTIONS}")
  endif()
endif()

# --- the core's runtime half: ReactHost over Hermes ----------------------------------------------
if(NGN_WITH_RUNTIME)
  add_library(ngn_core_runtime STATIC
      core/src/dev-server-helper.cpp
      core/src/host-services.cpp
      core/src/layout-animations.cpp
      core/src/runtime.cpp)
  target_link_libraries(ngn_core_runtime PUBLIC ngn_core hermes-engine::hermesvm)
  target_compile_options(ngn_core_runtime PRIVATE -Wall -Wextra -Werror -Wno-unused-parameter -Wno-missing-field-initializers)
  if(REACT_NATIVE_DEBUG_OPTIMIZED)
    target_compile_definitions(ngn_core_runtime PRIVATE NGN_INSPECTOR=1)
  endif()
  # The dev red box's JavaScript hook (core/src/red-box-errors.js), as a string the runtime
  # evaluates before the bundle.
  set(_red_box_js ${CMAKE_CURRENT_SOURCE_DIR}/core/src/red-box-errors.js)
  set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS ${_red_box_js})
  file(READ ${_red_box_js} NGN_RED_BOX_ERRORS_JS)
  file(CONFIGURE OUTPUT ${CMAKE_BINARY_DIR}/generated/red-box-errors.h CONTENT
      "// Generated by CMakeLists.txt from core/src/red-box-errors.js.\n#pragma once\nconstexpr const char *kRedBoxErrors = R\"ngn(@NGN_RED_BOX_ERRORS_JS@)ngn\";\n" @ONLY)
  target_include_directories(ngn_core_runtime PRIVATE ${CMAKE_BINARY_DIR}/generated)

  # Hermes and the runtime half linked whole, as a host links them: what no backend links yet on
  # Linux, so an unresolved symbol or a missing ICU fails here first.
  if(NGN_TESTS)
    file(GLOB runtime_test_SRC CONFIGURE_DEPENDS core/runtime-tests/*.cpp)
    add_executable(ngn_runtime_tests ${runtime_test_SRC})
    target_link_libraries(ngn_runtime_tests PRIVATE "$<LINK_LIBRARY:WHOLE_ARCHIVE,ngn_core_runtime>" doctest)
    # doctest's warnings, as for the core tests above.
    if(NOT APPLE)
      target_compile_options(ngn_runtime_tests PRIVATE
          $<$<CXX_COMPILER_ID:Clang>:-Wno-error=\#warnings>
          $<$<CXX_COMPILER_ID:GNU>:-Wno-error=cpp>)
    endif()
    if(NGN_DOCTEST_SOURCE_OPTIONS)
      set_source_files_properties(${runtime_test_SRC} PROPERTIES COMPILE_OPTIONS ${NGN_DOCTEST_SOURCE_OPTIONS})
    endif()
    # A prebuilt Hermes framework loads through @rpath, as for the core tests above.
    if(NGN_HERMES_TEST_RPATH)
      target_link_options(ngn_runtime_tests PRIVATE ${NGN_HERMES_TEST_RPATH})
    endif()
    add_test(NAME runtime COMMAND ngn_runtime_tests)
  endif()
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
elseif(NGN_BACKEND STREQUAL "gtk")
  add_subdirectory(gtk)
endif()
