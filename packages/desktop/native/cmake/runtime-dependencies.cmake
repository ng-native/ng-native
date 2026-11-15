# What the runtime half needs beyond the renderer: Hermes, built statically by
# scripts/build-hermes.sh, and the one OpenSSL call React Native's dev-server helper makes.

if(NOT IS_DIRECTORY "${NGN_HERMES_BUILD}")
  message(FATAL_ERROR "NGN_HERMES_BUILD is not set to a directory; build through scripts/build.sh")
endif()

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
endif()
foreach(alias hermesvm libhermes)
  add_library(hermes-engine::${alias} INTERFACE IMPORTED GLOBAL)
  set_target_properties(hermes-engine::${alias} PROPERTIES INTERFACE_LINK_LIBRARIES "${_hermes_link}")
endforeach()
# React Native's hermes targets include <hermes/hermes.h> without a target that carries the path.
include_directories(SYSTEM ${HERMES_SRC}/API ${HERMES_SRC}/public ${NGN_HERMES_BUILD}/lib/config)

# --- OpenSSL::Crypto -----------------------------------------------------------------------------
# ReactCxxPlatform's DevServerHelper hashes a device id with SHA256_Init/Update/Final and nothing
# else from OpenSSL. A shim header maps those onto the system's own SHA-256 rather than building
# OpenSSL for one hash.
add_library(OpenSSL::Crypto INTERFACE IMPORTED GLOBAL)
set_target_properties(OpenSSL::Crypto PROPERTIES
    INTERFACE_INCLUDE_DIRECTORIES ${CMAKE_CURRENT_SOURCE_DIR}/shim)
