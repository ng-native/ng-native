# The libraries React Native's own CMakeLists link against, by the target names they use (glog,
# fmt, double-conversion, boost, fast_float, folly_runtime, nlohmann_json), built here from the
# pinned sources scripts/fetch.sh puts in the cache, and linked statically. Nothing comes from the
# system or Homebrew.
#
# The folly source list and flags mirror React Native's Fantom tester
# (private/react-native-fantom/tester/third-party/folly), by way of Basalt 0.2.9's ThirdParty.cmake
# (MIT, Copyright (c) 2026 Vince Vella).

set(BUILD_SHARED_LIBS OFF)
# double-conversion asks for a CMake older than 3.5, which CMake 4 refuses without this.
set(CMAKE_POLICY_VERSION_MINIMUM 3.5)
set(BUILD_TESTING OFF CACHE BOOL "" FORCE)

# --- glog 0.7.1 ----------------------------------------------------------------------------------
set(WITH_GFLAGS OFF CACHE BOOL "" FORCE)
set(WITH_GTEST OFF CACHE BOOL "" FORCE)
set(WITH_UNWIND none CACHE STRING "" FORCE)
set(WITH_PKGCONFIG OFF CACHE BOOL "" FORCE)
add_subdirectory(${NGN_SOURCES}/glog third-party/glog EXCLUDE_FROM_ALL SYSTEM)
# glog's build tree exports its whole src/ directory, internal headers included, and its internal
# demangle.h makes folly think libiberty is present. Consumers get the public headers only, as an
# installed glog gives them.
file(GLOB _glog_public ${NGN_SOURCES}/glog/src/glog/*.h)
file(COPY ${_glog_public} DESTINATION ${CMAKE_BINARY_DIR}/glog-include/glog)
set(_glog_include "$<BUILD_INTERFACE:${glog_BINARY_DIR}>;$<BUILD_INTERFACE:${CMAKE_BINARY_DIR}/glog-include>")
set_target_properties(glog PROPERTIES
    INTERFACE_INCLUDE_DIRECTORIES "${_glog_include}"
    INTERFACE_SYSTEM_INCLUDE_DIRECTORIES "${_glog_include}")
# glog 0.7 refuses its headers unless this says they are consumed the supported way.
target_compile_definitions(glog INTERFACE GLOG_USE_GLOG_EXPORT)
# React Native's Android build installs signal handlers through glog_init. A desktop host has
# nothing for it to do, as in Fantom.
add_library(glog_init INTERFACE)

# --- fmt 12.1.0 ----------------------------------------------------------------------------------
set(FMT_INSTALL OFF CACHE BOOL "" FORCE)
add_subdirectory(${NGN_SOURCES}/fmt third-party/fmt EXCLUDE_FROM_ALL SYSTEM)

# --- double-conversion 3.3.1 ---------------------------------------------------------------------
add_subdirectory(${NGN_SOURCES}/double-conversion third-party/double-conversion EXCLUDE_FROM_ALL SYSTEM)

# --- boost 1.83.0, headers only ------------------------------------------------------------------
add_library(boost INTERFACE)
target_include_directories(boost SYSTEM INTERFACE ${NGN_SOURCES}/boost)

# --- fast_float, nlohmann_json (header-only) -----------------------------------------------------
add_library(fast_float INTERFACE)
target_include_directories(fast_float SYSTEM INTERFACE ${NGN_SOURCES}/fast_float/include)
add_library(nlohmann_json INTERFACE)
target_include_directories(nlohmann_json SYSTEM INTERFACE ${NGN_SOURCES}/nlohmann_json/include)

# --- doctest (the core tests) --------------------------------------------------------------------
add_library(doctest INTERFACE)
target_include_directories(doctest SYSTEM INTERFACE ${NGN_SOURCES}/doctest)

# --- folly_runtime -------------------------------------------------------------------------------
set(folly_FLAGS -DFOLLY_NO_CONFIG=1 -DFOLLY_HAVE_CLOCK_GETTIME=1 -DFOLLY_CFG_NO_COROUTINES=1
    -DFOLLY_MOBILE=0 -DFOLLY_HAVE_RECVMMSG=1 -DFOLLY_HAVE_PTHREAD=1 -DFOLLY_HAVE_XSI_STRERROR_R=1)
set(folly_runtime_SRC
    Conv.cpp Demangle.cpp FileUtil.cpp Format.cpp ScopeGuard.cpp SharedMutex.cpp String.cpp
    Unicode.cpp concurrency/CacheLocality.cpp container/detail/F14Table.cpp
    detail/FileUtilDetail.cpp detail/Futex.cpp detail/SplitStringSimd.cpp
    detail/UniqueInstance.cpp hash/SpookyHashV2.cpp io/IOBuf.cpp json/dynamic.cpp
    json/json_pointer.cpp json/json.cpp lang/CString.cpp lang/Exception.cpp lang/SafeAssert.cpp
    lang/ToAscii.cpp memory/SanitizeAddress.cpp memory/detail/MallocImpl.cpp net/NetOps.cpp
    portability/SysUio.cpp synchronization/SanitizeThread.cpp synchronization/ParkingLot.cpp
    system/AtFork.cpp system/ThreadId.cpp system/ThreadName.cpp)
list(TRANSFORM folly_runtime_SRC PREPEND ${NGN_SOURCES}/folly/folly/)
add_library(folly_runtime STATIC ${folly_runtime_SRC})
target_compile_options(folly_runtime PRIVATE -fexceptions -frtti -Wno-sign-compare)
target_compile_options(folly_runtime PUBLIC ${folly_FLAGS})
target_include_directories(folly_runtime SYSTEM PUBLIC ${NGN_SOURCES}/folly)
target_link_libraries(folly_runtime PUBLIC glog double-conversion boost fmt fast_float)
