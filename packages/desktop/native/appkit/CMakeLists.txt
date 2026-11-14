# The AppKit backend and the ngn-macos binary. Everything links statically: the binary loads
# nothing from outside itself but the system's frameworks.
add_executable(ngn-macos
    appkit-backend.mm
    host-view.mm
    main.mm
    menu-bar.mm
    network.mm
    surface-view.mm
    text-layout.mm)
target_link_libraries(ngn-macos PRIVATE ngn_core_runtime
    "-framework AppKit" "-framework Foundation" "-framework CoreText" "-framework QuartzCore")
target_compile_options(ngn-macos PRIVATE -fobjc-arc -Wall -Wno-unused-parameter)
