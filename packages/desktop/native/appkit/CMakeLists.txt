# The AppKit backend and the ngn-macos binary. Everything links statically: the binary loads
# nothing from outside itself but the system's frameworks.
add_executable(ngn-macos
    app-windows.mm
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
    text-layout.mm)
target_link_libraries(ngn-macos PRIVATE ngn_core_runtime ngn_libraries
    "-framework AppKit" "-framework Foundation" "-framework CoreText" "-framework ImageIO" "-framework QuartzCore")
target_compile_options(ngn-macos PRIVATE -fobjc-arc -Wall -Wno-unused-parameter)
# The React Native the host is built from, which PlatformConstants reports and React Native's
# JavaScript checks against its own.
file(READ ${RN_DIR}/package.json _rn_package)
string(JSON _rn_version GET "${_rn_package}" version)
target_compile_definitions(ngn-macos PRIVATE NGN_REACT_NATIVE_VERSION="${_rn_version}")
