# The AppKit backend and the ngn-macos binary. Everything links statically: the binary loads
# nothing from outside itself but the system's frameworks.
add_executable(ngn-macos
    app-info.mm
    app-windows.mm
    crypto.mm
    desktop-expo.mm
    file-system.mm
    fonts.mm
    appkit-backend.mm
    calendar.mm
    audio.mm
    language-model.mm
    screen-capture.mm
    photo-library.mm
    tracking.mm
    image-manipulator.mm
    battery.mm
    header-toolbar.mm
    host-view.mm
    image-view.mm
    local-authentication.mm
    location.mm
    geocoder.mm
    address-search.mm
    symbol-drawing.mm
    symbol-view.mm
    share-picker.mm
    main.mm
    menu-bar.mm
    modal-host-view.mm
    native-controls.mm
    presented-screen.mm
    network.mm
    network-state.mm
    notifications.mm
    scroll-view.mm
    split-view.mm
    surface-view.mm
    svg-view.mm
    tray-and-dock.mm
    store-review.mm
    system.mm
    system-access.mm
    text-layout.mm
    text-recognition.mm
    undo.mm
    updates.mm
    web-browser.mm
    app-updater.mm)
target_link_libraries(ngn-macos PRIVATE ngn_core_runtime ngn_libraries ${NGN_LINKED}
    "-framework AppKit" "-framework Foundation" "-framework CoreText" "-framework ImageIO" "-framework QuartzCore" "-framework Security" "-framework IOKit" "-framework UniformTypeIdentifiers" "-framework UserNotifications" "-framework LocalAuthentication" "-framework CoreLocation" "-framework CoreServices" "-framework SystemConfiguration" "-framework Network" "-framework AuthenticationServices" "-framework Vision" "-framework EventKit" "-framework StoreKit" "-framework AVFoundation" "-framework CoreMedia" "-framework Photos" "-framework PhotosUI" "-framework AppTrackingTransparency" "-framework AdSupport" "-framework MapKit")
ngn_link_swift(ngn-macos)
target_compile_options(ngn-macos PRIVATE -fobjc-arc -Wall -Wno-unused-parameter)
# A Release build is what a packaged app ships: the linker drops the code nothing reaches.
target_link_options(ngn-macos PRIVATE $<$<CONFIG:Release>:-Wl,-dead_strip>)
# The React Native the host is built from, which PlatformConstants reports and React Native's
# JavaScript checks against its own.
file(READ ${RN_DIR}/package.json _rn_package)
string(JSON _rn_version GET "${_rn_package}" version)
target_compile_definitions(ngn-macos PRIVATE NGN_REACT_NATIVE_VERSION="${_rn_version}")

# The hermesc built with the Hermes the binary links, beside it, where `package` takes it from to
# compile the bundle to bytecode of the version this Hermes runs.
add_custom_command(TARGET ngn-macos POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different ${NGN_HERMES_BUILD}/bin/hermesc $<TARGET_FILE_DIR:ngn-macos>/hermesc
    VERBATIM)

# Sparkle's framework beside the binary, where `package --format dmg` takes it from to embed it.
# The binary never links it: it loads it at runtime in a dmg build only (app-updater.mm).
set(_sparkle ${NGN_SOURCES}/sparkle/Sparkle.framework)
if(EXISTS ${_sparkle})
  add_custom_command(TARGET ngn-macos POST_BUILD
      COMMAND rm -rf $<TARGET_FILE_DIR:ngn-macos>/Sparkle.framework
      COMMAND ditto ${_sparkle} $<TARGET_FILE_DIR:ngn-macos>/Sparkle.framework
      VERBATIM)
endif()
