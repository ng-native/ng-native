# The AppKit backend and the ngn-macos binary. Everything links statically: the binary loads
# nothing from outside itself but the system's frameworks.
add_executable(ngn-macos
    app-windows.mm
    desktop-expo.mm
    appkit-backend.mm
    header-toolbar.mm
    host-view.mm
    image-view.mm
    main.mm
    menu-bar.mm
    modal-host-view.mm
    native-controls.mm
    presented-screen.mm
    network.mm
    scroll-view.mm
    split-view.mm
    surface-view.mm
    tray-and-dock.mm
    system.mm
    system-access.mm
    text-layout.mm
    updates.mm
    app-updater.mm)
target_link_libraries(ngn-macos PRIVATE ngn_core_runtime ngn_libraries ${NGN_LINKED}
    "-framework AppKit" "-framework Foundation" "-framework CoreText" "-framework ImageIO" "-framework QuartzCore" "-framework Security" "-framework IOKit")
target_compile_options(ngn-macos PRIVATE -fobjc-arc -Wall -Wno-unused-parameter)
# The React Native the host is built from, which PlatformConstants reports and React Native's
# JavaScript checks against its own.
file(READ ${RN_DIR}/package.json _rn_package)
string(JSON _rn_version GET "${_rn_package}" version)
target_compile_definitions(ngn-macos PRIVATE NGN_REACT_NATIVE_VERSION="${_rn_version}")

# Sparkle's framework beside the binary, where `package --format dmg` takes it from to embed it.
# The binary never links it: it loads it at runtime in a dmg build only (app-updater.mm).
set(_sparkle ${NGN_SOURCES}/sparkle/Sparkle.framework)
if(EXISTS ${_sparkle})
  add_custom_command(TARGET ngn-macos POST_BUILD
      COMMAND rm -rf $<TARGET_FILE_DIR:ngn-macos>/Sparkle.framework
      COMMAND ditto ${_sparkle} $<TARGET_FILE_DIR:ngn-macos>/Sparkle.framework
      VERBATIM)
endif()
