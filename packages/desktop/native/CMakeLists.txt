# The ng-native desktop host.
#
#   core/    toolkit-free C++: mounting, the view tree and hit testing, input and hover, text
#            measurement, the module registry and desktop view props. No AppKit, no Objective-C.
#
# scripts/build.sh is the way in: it fetches the pinned sources into the per-user cache and passes
# their paths here. NGN_BACKEND=none builds the core and its tests (any OS, no Hermes), which is
# what proves the core never reaches for a toolkit.
cmake_minimum_required(VERSION 3.25)
project(ngn_desktop LANGUAGES C CXX)

set(NGN_BACKEND none CACHE STRING "none")
set_property(CACHE NGN_BACKEND PROPERTY STRINGS none)
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
if(NOT NGN_BACKEND STREQUAL "none")
  message(FATAL_ERROR "NGN_BACKEND must be none, not ${NGN_BACKEND}")
endif()
set(NGN_WITH_RUNTIME OFF)

# A dev build carries React Native's debugger: Hermes's CDP agents and the inspector targets that
# the dev server's inspector proxy lists, as React Native's own Debug builds do. React Native gates
# them on a Debug build type or this; a packaged app (Release) leaves them out.
if(NOT CMAKE_BUILD_TYPE STREQUAL "Release")
  set(REACT_NATIVE_DEBUG_OPTIMIZED ON)
endif()

include(cmake/third-party.cmake)
include(cmake/react-native.cmake)

# --- core -----------------------------------------------------------------------------------------
add_library(ngn_core STATIC
    core/src/absent-views.cpp
    core/src/accessibility.cpp
    core/src/back-swipe.cpp
    core/src/bytes.cpp
    core/src/desktop-modal.cpp
    core/src/desktop-view-props.cpp
    core/src/glass.cpp
    core/src/header-bar.cpp
    core/src/live-regions.cpp
    core/src/library-glue.cpp
    core/src/module-registry.cpp
    core/src/mounting-manager.cpp
    core/src/native-controls.cpp
    core/src/native-module.cpp
    core/src/network.cpp
    core/src/text-input.cpp
    core/src/text-layout-manager.cpp
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
    core/src/tabs-host.cpp
    core/src/download.cpp
    core/src/view-transform.cpp
    core/src/expo-image.cpp
    core/src/expo-ui.cpp
    core/src/view-tree.cpp
    core/src/web-view.cpp
    core/src/modules/apple-authentication.cpp
    core/src/modules/camera.cpp
    core/src/modules/crypto.cpp
    core/src/modules/file-system.cpp
    core/src/modules/location.cpp
    core/src/modules/maps.cpp
    core/src/modules/video.cpp)
target_include_directories(ngn_core PUBLIC core/include)
# The system's sqlite3, behind NgNativeSqlite (libsqlite3-dev on Linux).
find_package(SQLite3 REQUIRED)
target_link_libraries(ngn_core PUBLIC react_native SQLite::SQLite3)
target_compile_options(ngn_core PRIVATE -Wall -Wextra -Werror -Wno-unused-parameter -Wno-missing-field-initializers)

if(NGN_TESTS)
  file(GLOB core_test_SRC CONFIGURE_DEPENDS core/tests/*.cpp)
  add_executable(ngn_core_tests ${core_test_SRC} core/testing/fake-backend.cpp core/testing/fake-network.cpp core/testing/fake-system.cpp)
  target_include_directories(ngn_core_tests PRIVATE core/testing core/tests)
  target_link_libraries(ngn_core_tests PRIVATE ngn_core doctest)
  enable_testing()
  add_test(NAME core COMMAND ngn_core_tests)
endif()
