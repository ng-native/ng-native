# react-native-worklets on the desktop host: its shared C++ (Common/cpp/worklets), with the
# desktop's glue (core/src/libraries/react-native-worklets.cpp) in place of its iOS module: the
# WorkletsModule TurboModule, a UI scheduler on the backend's UI thread, and animation frames from
# the backend's display link (ngn/animation-frames.h). Included by cmake/libraries.cmake.
if(NOT NGN_WITH_RUNTIME)
  return()
endif()
set(_worklets ${NGN_LIBRARY_PACKAGE_DIR})
file(READ ${_worklets}/package.json _worklets_package)
string(JSON _worklets_version GET "${_worklets_package}" version)
# The static feature flags, as the library's podspec passes them: its staticFlags.json.
file(READ ${_worklets}/src/featureFlags/staticFlags.json _worklets_flags_json)
string(JSON _count LENGTH "${_worklets_flags_json}")
set(_worklets_flags "")
math(EXPR _last "${_count} - 1")
foreach(i RANGE ${_last})
  string(JSON _key MEMBER "${_worklets_flags_json}" ${i})
  string(JSON _value GET "${_worklets_flags_json}" ${_key})
  if(_value)
    string(APPEND _worklets_flags "[${_key}:true]")
  else()
    string(APPEND _worklets_flags "[${_key}:false]")
  endif()
endforeach()

file(GLOB_RECURSE _worklets_srcs CONFIGURE_DEPENDS ${_worklets}/Common/cpp/worklets/*.cpp)
add_library(ngn_rnworklets OBJECT ${_worklets_srcs}
    ${CMAKE_CURRENT_SOURCE_DIR}/core/src/libraries/react-native-worklets.cpp)
target_include_directories(ngn_rnworklets SYSTEM PUBLIC ${_worklets}/Common/cpp)
target_include_directories(ngn_rnworklets PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/core/include)
target_compile_definitions(ngn_rnworklets PUBLIC
    WORKLETS_VERSION=${_worklets_version}
    "WORKLETS_FEATURE_FLAGS=${_worklets_flags}"
    HERMES_V1_ENABLED=1)
target_link_libraries(ngn_rnworklets PUBLIC react_native hermes-engine::hermesvm)
target_compile_options(ngn_rnworklets PRIVATE -fexceptions -frtti -include cstdint -w)
list(APPEND _lib_targets ngn_rnworklets)
string(APPEND _lib_glue_decls "void installGlue_rnworklets();\n")
string(APPEND _lib_glue_calls "  installGlue_rnworklets();\n")
