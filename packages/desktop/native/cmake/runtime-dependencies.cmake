# What the runtime half needs beyond the renderer: Hermes, built statically by
# scripts/build-hermes.sh, with off macOS the static ICU it was built against, and the one OpenSSL
# call React Native's dev-server helper makes.

if(IS_DIRECTORY "${NGN_HERMES_PREBUILT}")
  # React Native's prebuilt Hermes on macOS: a dynamic framework, which the binary finds beside
  # itself in a build and in Contents/Frameworks in a packaged app.
  set(NGN_HERMES_FRAMEWORK ${NGN_HERMES_PREBUILT}/Library/Frameworks/macosx/hermesvm.framework)
  set(NGN_HERMESC ${NGN_HERMES_PREBUILT}/bin/hermesc)
  foreach(alias hermesvm libhermes)
    add_library(hermes-engine::${alias} INTERFACE IMPORTED GLOBAL)
    set_target_properties(hermes-engine::${alias} PROPERTIES
        INTERFACE_LINK_LIBRARIES ${NGN_HERMES_FRAMEWORK}
        INTERFACE_LINK_OPTIONS "LINKER:-rpath,@executable_path;LINKER:-rpath,@executable_path/../Frameworks")
  endforeach()
  include_directories(SYSTEM ${NGN_HERMES_PREBUILT}/include)
  # Without the cache folder's absolute path, which CMake would add for the framework: the binary
  # finds Hermes only beside itself or in its app's Frameworks, wherever it was built.
  set(CMAKE_SKIP_BUILD_RPATH ON)
  # The tests, which never ship, find it where it was fetched, whichever target built first.
  get_filename_component(_hermes_frameworks ${NGN_HERMES_FRAMEWORK} DIRECTORY)
  set(NGN_HERMES_TEST_RPATH "LINKER:-rpath,${_hermes_frameworks}")
else()
if(NOT IS_DIRECTORY "${NGN_HERMES_BUILD}")
  message(FATAL_ERROR "NGN_HERMES_BUILD is not set to a directory; build through scripts/build.sh")
endif()
set(NGN_HERMESC ${NGN_HERMES_BUILD}/bin/hermesc)

# --- Hermes, static ------------------------------------------------------------------------------
# React Native's CMakeLists link hermes-engine::hermesvm (0.87 and later) or ::libhermes (before).
# GLOBAL, since React Native's directories are siblings of this one.
set(HERMES_SRC ${NGN_SOURCES}/hermes)
set(_hermes_link ${NGN_HERMES_BUILD}/lib/libhermesvm_a.a)
# Hermes's own Boost.Context (renamed hoost), which its stack executor runs on, is a library of
# its own beside the archive.
file(GLOB _hermes_context ${NGN_HERMES_BUILD}/external/boost/*/libs/context/libboost_context.a)
list(APPEND _hermes_link ${_hermes_context})
if(APPLE)
  # Intl is built over Foundation, as in React Native's Apple builds.
  list(APPEND _hermes_link "-framework Foundation")
else()
  # Its Unicode layer over the ICU scripts/build-icu.sh built beside it, data and all.
  foreach(lib icui18n icuuc icudata)
    if(NOT EXISTS ${NGN_HERMES_BUILD}/icu/lib/lib${lib}.a)
      message(FATAL_ERROR "${NGN_HERMES_BUILD} has no ICU (icu/lib/lib${lib}.a); build through scripts/build.sh")
    endif()
    list(APPEND _hermes_link ${NGN_HERMES_BUILD}/icu/lib/lib${lib}.a)
  endforeach()
  list(APPEND _hermes_link ${CMAKE_DL_LIBS} pthread)
endif()
foreach(alias hermesvm libhermes)
  add_library(hermes-engine::${alias} INTERFACE IMPORTED GLOBAL)
  set_target_properties(hermes-engine::${alias} PROPERTIES INTERFACE_LINK_LIBRARIES "${_hermes_link}")
endforeach()
# React Native's hermes targets include <hermes/hermes.h> without a target that carries the path.
include_directories(SYSTEM ${HERMES_SRC}/API ${HERMES_SRC}/public ${NGN_HERMES_BUILD}/lib/config)
endif()

# --- OpenSSL::Crypto -----------------------------------------------------------------------------
# ReactCxxPlatform's DevServerHelper hashes a device id with SHA256_Init/Update/Final and nothing
# else from OpenSSL. A shim header maps those onto the system's own SHA-256 rather than building
# OpenSSL for one hash.
add_library(OpenSSL::Crypto INTERFACE IMPORTED GLOBAL)
set_target_properties(OpenSSL::Crypto PROPERTIES
    INTERFACE_INCLUDE_DIRECTORIES ${CMAKE_CURRENT_SOURCE_DIR}/shim)
