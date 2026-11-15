# react-native-reanimated on the desktop host: its shared C++ (Common/cpp/reanimated) over
# react-native-worklets' (cmake/libraries/react-native-worklets.cmake), with the desktop's glue
# (core/src/libraries/react-native-reanimated.cpp) in place of its iOS ReanimatedModule and
# REANodesManager. Included by cmake/libraries.cmake.
if(NOT NGN_WITH_RUNTIME)
  return()
endif()
set(_reanimated ${NGN_LIBRARY_PACKAGE_DIR})
file(READ ${_reanimated}/package.json _reanimated_package)
string(JSON _reanimated_version GET "${_reanimated_package}" version)
# The static feature flags, as its podspec passes them: staticFlags.json.
file(READ ${_reanimated}/src/featureFlags/staticFlags.json _reanimated_flags_json)
string(JSON _count LENGTH "${_reanimated_flags_json}")
set(_reanimated_flags "")
math(EXPR _last "${_count} - 1")
foreach(i RANGE ${_last})
  string(JSON _key MEMBER "${_reanimated_flags_json}" ${i})
  string(JSON _value GET "${_reanimated_flags_json}" ${_key})
  if(_value)
    string(APPEND _reanimated_flags "[${_key}:true]")
  else()
    string(APPEND _reanimated_flags "[${_key}:false]")
  endif()
endforeach()

file(GLOB_RECURSE _reanimated_srcs CONFIGURE_DEPENDS ${_reanimated}/Common/cpp/reanimated/*.cpp)
# Its component's codegen (REASharedTransitionBoundary), whose props its C++ reads. The component
# itself is not registered.
file(GLOB _reanimated_codegen CONFIGURE_DEPENDS ${NGN_LIBRARY_CODEGEN}/react/renderer/components/${NGN_LIBRARY_CODEGEN_NAME}/*.cpp)
list(APPEND _reanimated_srcs ${_reanimated_codegen})
add_library(ngn_rnreanimated OBJECT ${_reanimated_srcs}
    ${CMAKE_CURRENT_SOURCE_DIR}/core/src/libraries/react-native-reanimated.cpp)
target_include_directories(ngn_rnreanimated SYSTEM PUBLIC ${_reanimated}/Common/cpp ${NGN_LIBRARY_CODEGEN}
    ${NGN_LIBRARY_CODEGEN}/react/renderer/components/${NGN_LIBRARY_CODEGEN_NAME})
target_include_directories(ngn_rnreanimated PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/core/include)
target_compile_definitions(ngn_rnreanimated PUBLIC
    REANIMATED_VERSION=${_reanimated_version}
    "REANIMATED_FEATURE_FLAGS=${_reanimated_flags}")
# Reanimated needs Worklets, which the app has whenever it has Reanimated: the target is
# react-native-worklets' recipe's, in either order of the libraries.
target_link_libraries(ngn_rnreanimated PUBLIC ngn_rnworklets react_native)
target_compile_options(ngn_rnreanimated PRIVATE -fexceptions -frtti -include cstdint -w)
list(APPEND _lib_targets ngn_rnreanimated)
string(APPEND _lib_glue_decls "void installGlue_rnreanimated();\n")
string(APPEND _lib_glue_calls "  installGlue_rnreanimated();\n")
