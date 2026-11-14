# The AppKit backend's Swift: what only Swift can call (Foundation Models, and SwiftUI for
# `@expo/ui`), compiled by swiftc for each architecture and joined with lipo into one object, which
# a target takes as a source with ngn_link_swift. CMake's own Swift support is not used: it does not build one Swift object for
# several architectures, which a universal host needs.
execute_process(COMMAND xcrun --find swiftc OUTPUT_VARIABLE NGN_SWIFTC OUTPUT_STRIP_TRAILING_WHITESPACE COMMAND_ERROR_IS_FATAL ANY)
execute_process(COMMAND xcrun --show-sdk-path OUTPUT_VARIABLE _ngn_sdk OUTPUT_STRIP_TRAILING_WHITESPACE COMMAND_ERROR_IS_FATAL ANY)
get_filename_component(_ngn_swift_toolchain "${NGN_SWIFTC}/../.." ABSOLUTE)

set(_ngn_swift_archs ${CMAKE_OSX_ARCHITECTURES})
if(NOT _ngn_swift_archs)
  set(_ngn_swift_archs ${CMAKE_HOST_SYSTEM_PROCESSOR})
endif()
set(_ngn_swift_sources ${CMAKE_CURRENT_SOURCE_DIR}/appkit/language-model.swift ${CMAKE_CURRENT_SOURCE_DIR}/appkit/expo-ui.swift)
set(_ngn_swift_objects)
foreach(arch ${_ngn_swift_archs})
  set(_object ${CMAKE_CURRENT_BINARY_DIR}/swift/ngn-swift-${arch}.o)
  add_custom_command(OUTPUT ${_object}
      COMMAND ${CMAKE_COMMAND} -E make_directory ${CMAKE_CURRENT_BINARY_DIR}/swift
      COMMAND ${NGN_SWIFTC} -c -parse-as-library -wmo $<IF:$<CONFIG:Debug>,-Onone,-O> -g
              -sdk ${_ngn_sdk} -target ${arch}-apple-macos${CMAKE_OSX_DEPLOYMENT_TARGET}
              -module-name NGNSwift ${_ngn_swift_sources} -o ${_object}
      DEPENDS ${_ngn_swift_sources}
      VERBATIM)
  list(APPEND _ngn_swift_objects ${_object})
endforeach()
set(NGN_SWIFT_OBJECT ${CMAKE_CURRENT_BINARY_DIR}/swift/ngn-swift.o)
add_custom_command(OUTPUT ${NGN_SWIFT_OBJECT}
    COMMAND lipo -create ${_ngn_swift_objects} -output ${NGN_SWIFT_OBJECT}
    DEPENDS ${_ngn_swift_objects}
    VERBATIM)
add_custom_target(ngn_swift DEPENDS ${NGN_SWIFT_OBJECT})

# Links the Swift object into `target`: the runtime is the OS's, found at link time in the SDK and
# the toolchain's back-deployment libraries, and Foundation Models is weak, so the binary still
# starts on a macOS without it.
function(ngn_link_swift target)
  add_dependencies(${target} ngn_swift)
  target_sources(${target} PRIVATE ${NGN_SWIFT_OBJECT})
  set_source_files_properties(${NGN_SWIFT_OBJECT} PROPERTIES EXTERNAL_OBJECT TRUE GENERATED TRUE)
  target_link_options(${target} PRIVATE
      -L${_ngn_sdk}/usr/lib/swift -L${_ngn_swift_toolchain}/lib/swift/macosx
      -Wl,-rpath,/usr/lib/swift -Wl,-weak_framework,FoundationModels)
endfunction()
