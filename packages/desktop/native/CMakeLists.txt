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

if(NGN_BACKEND STREQUAL "appkit")
  enable_language(OBJC OBJCXX)
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

# --- core -----------------------------------------------------------------------------------------
add_library(ngn_core STATIC
    core/src/bytes.cpp
    core/src/desktop-modal.cpp
    core/src/desktop-view-props.cpp
    core/src/default-menu.cpp
    core/src/dev-server.cpp
    core/src/header-bar.cpp
    core/src/host-state.cpp
    core/src/input-dispatcher.cpp
    core/src/key-value-store.cpp
    core/src/library-glue.cpp
    core/src/module-registry.cpp
    core/src/mounting-manager.cpp
    core/src/native-module.cpp
    core/src/network.cpp
    core/src/text-layout-manager.cpp
    core/src/safe-areas.cpp
    core/src/screen-stacks.cpp
    core/src/view-tree.cpp
    core/src/modules/alert-manager.cpp
    core/src/modules/app-modules.cpp
    core/src/modules/async-storage.cpp
    core/src/modules/core-modules.cpp
    core/src/modules/image-loader.cpp
    core/src/modules/networking.cpp
    core/src/modules/web-socket.cpp)
target_include_directories(ngn_core PUBLIC core/include)
target_link_libraries(ngn_core PUBLIC react_native)
target_compile_options(ngn_core PRIVATE -Wall -Wextra -Werror -Wno-unused-parameter)

if(NGN_TESTS)
  file(GLOB core_test_SRC CONFIGURE_DEPENDS core/tests/*.cpp)
  add_executable(ngn_core_tests ${core_test_SRC} core/testing/fake-backend.cpp core/testing/fake-network.cpp core/testing/fake-system.cpp)
  target_include_directories(ngn_core_tests PRIVATE core/testing core/tests)
  target_link_libraries(ngn_core_tests PRIVATE ngn_core doctest)
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

# --- backends -------------------------------------------------------------------------------------
if(NGN_BACKEND STREQUAL "appkit")
  add_subdirectory(appkit)
endif()
