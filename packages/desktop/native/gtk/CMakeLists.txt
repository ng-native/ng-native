# The GTK 4 backend and the ngn-linux binary. GTK 4.10 is the floor (el9 ships 4.12) and newer API
# is refused at compile time; libadwaita is linked for its style manager and the header bar, and
# newer libadwaita (AdwDialog) is found at run time.
# Both come from pkg-config: the distribution's on Linux, Homebrew's on a Mac, where the backend
# builds as a dev loop.
#
# Every source but main.cpp, compiled once into objects the binary and the GTK view tests both link.
find_package(PkgConfig REQUIRED)
pkg_check_modules(NGN_GTK REQUIRED IMPORTED_TARGET gtk4>=4.10 libadwaita-1>=1.4 pangocairo gio-unix-2.0)
# Xlib, for an input script's steps posted to the X server (input-replay.h); a Mac's GTK has no X11.
if(NOT APPLE)
  pkg_check_modules(NGN_X11 REQUIRED IMPORTED_TARGET x11)
endif()
# libsecret, SecureStore's (0.20 keeps secrets through the Secret portal inside a Flatpak). Homebrew
# has none, so on a Mac the dev loop goes without it and SecureStore is absent.
if(APPLE)
  pkg_check_modules(NGN_SECRET IMPORTED_TARGET libsecret-1>=0.20)
else()
  pkg_check_modules(NGN_SECRET REQUIRED IMPORTED_TARGET libsecret-1>=0.20)
endif()
# GTK's own print dialog, which prints a PDF where no Print portal answers (printing.h); part of
# GTK on Linux and in Homebrew's.
pkg_check_modules(NGN_UNIX_PRINT IMPORTED_TARGET gtk4-unix-print)

add_library(ngn_gtk OBJECT
    accessible.cpp
    app-info.cpp
    app-windows.cpp
    box-paint.cpp
    cairo-canvas.cpp
    capture.cpp
    crypto.cpp
    drag-and-drop.cpp
    file-dialogs.cpp
    file-system.cpp
    gtk-backend.cpp
    host-sources.cpp
    image-view.cpp
    input-replay.cpp
    locales.cpp
    menus.cpp
    native-controls.cpp
    notifications.cpp
    pango-text.cpp
    portal.cpp
    printing.cpp
    screens.cpp
    secret-store.cpp
    scroll-view.cpp
    surface-input.cpp
    system-access.cpp
    text-field.cpp
    view-widget.cpp)
target_link_libraries(ngn_gtk PUBLIC ngn_core_runtime ngn_curl ngn_libraries PkgConfig::NGN_GTK)
if(NOT APPLE)
  target_link_libraries(ngn_gtk PUBLIC PkgConfig::NGN_X11)
endif()
if(NGN_SECRET_FOUND)
  target_link_libraries(ngn_gtk PUBLIC PkgConfig::NGN_SECRET)
  target_compile_definitions(ngn_gtk PUBLIC NGN_LIBSECRET=1)
endif()
if(NGN_UNIX_PRINT_FOUND)
  target_link_libraries(ngn_gtk PUBLIC PkgConfig::NGN_UNIX_PRINT)
  target_compile_definitions(ngn_gtk PUBLIC NGN_UNIX_PRINT=1)
endif()
target_compile_options(ngn_gtk PUBLIC -Wall -Werror -Wno-unused-parameter -Wno-missing-field-initializers)
target_compile_definitions(ngn_gtk PUBLIC
    GDK_VERSION_MIN_REQUIRED=GDK_VERSION_4_10 GDK_VERSION_MAX_ALLOWED=GDK_VERSION_4_10
    ADW_VERSION_MIN_REQUIRED=ADW_VERSION_1_4 ADW_VERSION_MAX_ALLOWED=ADW_VERSION_1_4)

add_executable(ngn-linux main.cpp)
# The autolinked code (cmake/linked-modules.cmake), which only a target linking it directly takes whole.
target_link_libraries(ngn-linux PRIVATE ngn_gtk ${NGN_LINKED})
# The React Native the host is built from, which PlatformConstants reports.
file(READ ${RN_DIR}/package.json _rn_package)
string(JSON _rn_version GET "${_rn_package}" version)
target_compile_definitions(ngn-linux PRIVATE NGN_REACT_NATIVE_VERSION="${_rn_version}")
# The hermesc built with the Hermes the binary links, beside it, as ngn-macos has it.
add_custom_command(TARGET ngn-linux POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different ${NGN_HERMES_BUILD}/bin/hermesc $<TARGET_FILE_DIR:ngn-linux>/hermesc
    VERBATIM)

# The GTK view tests: views mounted from Fabric mutations into a window GTK draws, through the
# backend the binary uses. Built with the core tests, and run beside them.
if(NGN_TESTS)
  set(ngn_gtk_test_SRC ../core/tests/main.cpp tests/accessible.test.cpp tests/app-windows.test.cpp tests/chrome.test.cpp tests/controls.test.cpp tests/drag-and-drop.test.cpp tests/image-view.test.cpp tests/input.test.cpp tests/input-replay.test.cpp tests/linking.test.cpp tests/locales.test.cpp tests/machine.test.cpp tests/menus.test.cpp tests/notifications.test.cpp tests/system-modules.test.cpp
      tests/screens.test.cpp tests/scroll-view.test.cpp tests/secret-store.test.cpp tests/svg.test.cpp tests/system-access.test.cpp tests/text.test.cpp tests/views.test.cpp)
  add_executable(ngn_gtk_tests ${ngn_gtk_test_SRC} ../core/testing/fake-network.cpp ../core/testing/fake-system.cpp)
  target_include_directories(ngn_gtk_tests PRIVATE ../core/tests ../core/testing)
  target_link_libraries(ngn_gtk_tests PRIVATE ngn_gtk doctest)
  if(NGN_DOCTEST_SOURCE_OPTIONS)
    set_source_files_properties(${ngn_gtk_test_SRC}
        PROPERTIES COMPILE_OPTIONS "${NGN_DOCTEST_SOURCE_OPTIONS}")
  endif()
  if(NOT APPLE)
    target_compile_options(ngn_gtk_tests PRIVATE
        $<$<CXX_COMPILER_ID:Clang>:-Wno-error=\#warnings>
        $<$<CXX_COMPILER_ID:GNU>:-Wno-error=cpp>)
  endif()
  add_test(NAME gtk COMMAND ngn_gtk_tests)
endif()
