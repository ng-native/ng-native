# libcurl for the HTTP and WebSocket client in core/src/curl-network.cpp: the version fetch.sh pins,
# built static as part of the host build, with only what the client uses. HTTP/1.1 and HTTP/2
# (nghttp2), `file:`, WebSockets, cookies, and gzip and deflate bodies (zlib); no other protocol,
# no IDN, PSL, brotli or zstd, and none of curl's own messages, which name an OpenSSL 3.2 call
# (curl-network.cpp has its own).
#
# TLS is the system's OpenSSL 3, linked dynamically with nghttp2 and zlib: every tier 1 distribution
# ships libssl.so.3, which keeps its ABI across 3.x, and its CA certificates are found at run time,
# so curl is built with no bundle path of its own. native/docker/glibc-floor.sh checks that nothing
# needs an OpenSSL newer than 3.0, Ubuntu 24.04's. The libraries come from pkg-config: on Linux the
# distribution's -devel packages; on a Mac Homebrew's, with
# PKG_CONFIG_PATH="$(brew --prefix openssl@3)/lib/pkgconfig".
#
# curl configures in a build of its own (ExternalProject), so its find_package(OpenSSL) never meets
# the OpenSSL::Crypto shim cmake/runtime-dependencies.cmake defines for React Native.
include(ExternalProject)
find_package(PkgConfig REQUIRED)
find_package(Threads REQUIRED)
find_package(ZLIB REQUIRED)
pkg_check_modules(NGN_OPENSSL REQUIRED openssl>=3.0)
pkg_check_modules(NGN_NGHTTP2 REQUIRED libnghttp2)

if(NOT EXISTS ${NGN_SOURCES}/curl/CMakeLists.txt)
  message(FATAL_ERROR "${NGN_SOURCES} has no curl; build through scripts/build.sh")
endif()

set(_curl_build ${CMAKE_BINARY_DIR}/third-party/curl)
set(_curl_library ${_curl_build}/lib/libcurl.a)
string(REPLACE ";" "|" _curl_archs "${CMAKE_OSX_ARCHITECTURES}")
set(_curl_off
    BUILD_SHARED_LIBS BUILD_CURL_EXE BUILD_TESTING BUILD_EXAMPLES BUILD_LIBCURL_DOCS BUILD_MISC_DOCS
    ENABLE_CURL_MANUAL CURL_ENABLE_EXPORT_TARGET PICKY_COMPILER ENABLE_ARES CURL_BROTLI CURL_ZSTD
    USE_LIBIDN2 USE_APPLE_IDN CURL_USE_LIBPSL CURL_USE_LIBSSH2 CURL_USE_LIBSSH CURL_USE_GSSAPI
    CURL_USE_GSASL CURL_USE_LIBUV USE_NGTCP2 USE_QUICHE USE_ECH USE_HTTPSRR CURL_ENABLE_NTLM)
set(_curl_on
    BUILD_STATIC_LIBS CURL_DISABLE_INSTALL CURL_USE_OPENSSL USE_NGHTTP2 CURL_ZLIB ENABLE_THREADED_RESOLVER
    CURL_CA_FALLBACK CURL_DISABLE_VERBOSE_STRINGS CURL_DISABLE_DICT CURL_DISABLE_FTP CURL_DISABLE_GOPHER
    CURL_DISABLE_IMAP CURL_DISABLE_LDAP CURL_DISABLE_LDAPS CURL_DISABLE_MQTT CURL_DISABLE_POP3
    CURL_DISABLE_RTSP CURL_DISABLE_SMTP CURL_DISABLE_TELNET CURL_DISABLE_TFTP CURL_DISABLE_IPFS
    CURL_DISABLE_DOH CURL_DISABLE_NETRC CURL_DISABLE_AWS)
set(_curl_args)
foreach(option ${_curl_off})
  list(APPEND _curl_args -D${option}=OFF)
endforeach()
foreach(option ${_curl_on})
  list(APPEND _curl_args -D${option}=ON)
endforeach()

ExternalProject_Add(ngn_curl_build
    SOURCE_DIR ${NGN_SOURCES}/curl
    BINARY_DIR ${_curl_build}
    LIST_SEPARATOR |
    CMAKE_ARGS
        -DCMAKE_BUILD_TYPE=Release
        -DCMAKE_C_COMPILER=${CMAKE_C_COMPILER}
        -DCMAKE_C_COMPILER_LAUNCHER=${CMAKE_C_COMPILER_LAUNCHER}
        -DCMAKE_OSX_ARCHITECTURES=${_curl_archs}
        -DCMAKE_OSX_DEPLOYMENT_TARGET=${CMAKE_OSX_DEPLOYMENT_TARGET}
        -DCMAKE_POSITION_INDEPENDENT_CODE=ON
        -DOPENSSL_ROOT_DIR=${NGN_OPENSSL_PREFIX}
        # The certificates are found at run time (findCaCertificates), else OpenSSL's defaults.
        -DCURL_CA_BUNDLE=none
        -DCURL_CA_PATH=none
        ${_curl_args}
    BUILD_COMMAND ${CMAKE_COMMAND} --build <BINARY_DIR> --target libcurl_static
    INSTALL_COMMAND ""
    BUILD_BYPRODUCTS ${_curl_library})

add_library(ngn_libcurl STATIC IMPORTED GLOBAL)
set(_curl_links ${NGN_OPENSSL_LINK_LIBRARIES} ${NGN_NGHTTP2_LINK_LIBRARIES} ZLIB::ZLIB Threads::Threads)
if(APPLE)
  list(APPEND _curl_links "-framework CoreFoundation" "-framework SystemConfiguration")
endif()
set_target_properties(ngn_libcurl PROPERTIES
    IMPORTED_LOCATION ${_curl_library}
    INTERFACE_INCLUDE_DIRECTORIES ${NGN_SOURCES}/curl/include
    INTERFACE_COMPILE_DEFINITIONS CURL_STATICLIB
    INTERFACE_LINK_LIBRARIES "${_curl_links}")
add_dependencies(ngn_libcurl ngn_curl_build)
