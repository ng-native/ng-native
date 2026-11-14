# Autolinked native code: the libraries and app modules bin/autolink.mjs lists in the app's
# link.json, which scripts/build.sh passes as NGN_DESKTOP_LINK.
#
# - A library's CMake fragment (its `macos.cmakeDir`, `desktop` by default) declares the target its
#   `macos.cmakeTarget` names. The build gives that target React Native's headers, JSI and folly,
#   and the codegen of the library's TurboModule spec when its package.json has a codegenConfig
#   (the `<Name>JSI.h` its C++ module implements, as on Android).
# - An app module's `modules/<name>/macos/` folder either has a CMakeLists.txt declaring the target
#   its expo-module.config.json names, or is compiled whole: every .cpp, .mm, .m and .c in it.
#
# Either way the code registers its TurboModules itself as it loads, the way React Native's iOS
# host takes a C++ module: registerCxxModuleToGlobalModuleMap (ReactCommon/CxxTurboModuleUtils.h)
# from a static initializer or `+load`. The registry asks that map after the host's own modules
# (ngn/module-registry.h). Each target links whole, so nothing that only registers is dropped.
#
# NGN_LINKED is what the binary links: every target above (static ones whole), or nothing. A list
# rather than an interface target, since an object library's objects reach only what links it
# directly.
set(NGN_DESKTOP_LINK "" CACHE FILEPATH "The app's link.json from bin/autolink.mjs")
set(NGN_LINK_CODEGEN "" CACHE STRING "<package>|<dir> for each linked library's module codegen")

add_library(ngn_module_api INTERFACE)
target_link_libraries(ngn_module_api INTERFACE react_native)

set(NGN_LINKED "")

macro(ngn_link_target target)
  target_link_libraries(${target} PRIVATE ngn_module_api)
  get_target_property(_type ${target} TYPE)
  if(_type STREQUAL "STATIC_LIBRARY")
    list(APPEND NGN_LINKED "$<LINK_LIBRARY:WHOLE_ARCHIVE,${target}>")
  else()
    list(APPEND NGN_LINKED ${target})
  endif()
endmacro()

if(NGN_DESKTOP_LINK)
  if(NOT EXISTS ${NGN_DESKTOP_LINK})
    message(FATAL_ERROR "NGN_DESKTOP_LINK names ${NGN_DESKTOP_LINK}, which does not exist")
  endif()
  set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS ${NGN_DESKTOP_LINK})
  file(READ ${NGN_DESKTOP_LINK} _link)
  string(JSON _version GET "${_link}" version)
  if(NOT _version EQUAL 1)
    message(FATAL_ERROR "${NGN_DESKTOP_LINK} is version ${_version}; this host reads version 1")
  endif()

  string(JSON _count LENGTH "${_link}" libraries)
  if(_count GREATER 0)
    math(EXPR _last "${_count} - 1")
    foreach(i RANGE ${_last})
      string(JSON _name GET "${_link}" libraries ${i} name)
      string(JSON _target GET "${_link}" libraries ${i} cmakeTarget)
      string(JSON _dir GET "${_link}" libraries ${i} cmakeDir)
      string(MAKE_C_IDENTIFIER "${_name}" _id)
      add_subdirectory(${_dir} ${CMAKE_BINARY_DIR}/linked/${_id})
      if(NOT TARGET ${_target})
        message(FATAL_ERROR "${_name}'s ${_dir}/CMakeLists.txt declares no target ${_target}, which its expo-module.config.json names")
      endif()
      foreach(_entry ${NGN_LINK_CODEGEN})
        string(REPLACE "|" ";" _pair "${_entry}")
        list(GET _pair 0 _for)
        list(GET _pair 1 _codegen)
        if(_for STREQUAL _name)
          file(GLOB _spec_dirs LIST_DIRECTORIES true ${_codegen}/codegen/react/renderer/components/*)
          target_include_directories(${_target} SYSTEM PRIVATE ${_codegen}/codegen ${_spec_dirs})
        endif()
      endforeach()
      ngn_link_target(${_target})
    endforeach()
  endif()

  string(JSON _count LENGTH "${_link}" appModules)
  if(_count GREATER 0)
    math(EXPR _last "${_count} - 1")
    foreach(i RANGE ${_last})
      string(JSON _name GET "${_link}" appModules ${i} name)
      string(JSON _dir GET "${_link}" appModules ${i} dir)
      string(JSON _target_type TYPE "${_link}" appModules ${i} cmakeTarget)
      string(MAKE_C_IDENTIFIER "${_name}" _id)
      if(_target_type STREQUAL "STRING")
        string(JSON _target GET "${_link}" appModules ${i} cmakeTarget)
        if(NOT EXISTS ${_dir}/CMakeLists.txt)
          message(FATAL_ERROR "The app module ${_name} names the CMake target ${_target} without a ${_dir}/CMakeLists.txt")
        endif()
        add_subdirectory(${_dir} ${CMAKE_BINARY_DIR}/linked/app-${_id})
        if(NOT TARGET ${_target})
          message(FATAL_ERROR "${_dir}/CMakeLists.txt declares no target ${_target}, which the app module ${_name} names")
        endif()
      else()
        file(GLOB_RECURSE _srcs CONFIGURE_DEPENDS ${_dir}/*.cpp ${_dir}/*.mm ${_dir}/*.m ${_dir}/*.c)
        if(NOT _srcs)
          message(WARNING "The app module ${_name} has no sources in ${_dir}, so nothing is compiled for it")
          continue()
        endif()
        set(_target ngn_app_module_${_id})
        add_library(${_target} OBJECT ${_srcs})
        target_include_directories(${_target} PRIVATE ${_dir})
        if(APPLE)
          target_compile_options(${_target} PRIVATE $<$<COMPILE_LANGUAGE:OBJC,OBJCXX>:-fobjc-arc>)
        endif()
      endif()
      ngn_link_target(${_target})
    endforeach()
  endif()
endif()
