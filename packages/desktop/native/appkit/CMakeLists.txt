# The AppKit backend and the ngn-macos binary. Everything links statically: the binary loads
# nothing from outside itself but the system's frameworks.
#
# Every source but main.mm, compiled once into objects the binary and the AppKit view tests
# (tests/views) both link whole.
add_library(ngn_appkit OBJECT
    animation-frames.mm
    app-info.mm
    app-windows.mm
    crypto.mm
    desktop-expo.mm
    file-system.mm
    bookmarks.mm
    fonts.mm
    appkit-backend.mm
    calendar.mm
    audio.mm
    language-model.mm
    screen-capture.mm
    testing-capture.mm
    photo-library.mm
    tracking.mm
    image-manipulator.mm
    printing.mm
    web-view.mm
    web-view-component.mm
    expo-image-drawing.mm
    expo-image-view.mm
    expo-ui-renderer.mm
    expo-ui-view.mm
    camera.mm
    camera-sheet.mm
    camera-view.mm
    maps.mm
    map-view.mm
    apple-authentication.mm
    apple-id-button.mm
    apple-button-view.mm
    video.mm
    video-view.mm
    battery.mm
    header-toolbar.mm
    host-view.mm
    input-replay.mm
    image-view.mm
    image-request.mm
    local-authentication.mm
    location.mm
    geocoder.mm
    address-search.mm
    symbol-drawing.mm
    symbol-view.mm
    red-box.mm
    share-picker.mm
    menu-bar.mm
    glass-effect.mm
    glass-view.mm
    visual-effect.mm
    visual-effect-view.mm
    modal-focus.mm
    modal-host-view.mm
    native-controls.mm
    presentation-label.mm
    presented-screen.mm
    push.mm
    network.mm
    network-state.mm
    notifications.mm
    scroll-view.mm
    scrollers.mm
    search-field.mm
    search-toolbar-item.mm
    split-view.mm
    surface-view.mm
    svg-view.mm
    svg-icon.mm
    cg-canvas.mm
    tray-and-dock.mm
    store-review.mm
    system.mm
    system-access.mm
    tab-walk.mm
    test-launch.mm
    text-input-field.mm
    text-layout.mm
    text-recognition.mm
    undo.mm
    view-effects.mm
    updates.mm
    web-browser.mm
    app-updater.mm)
target_link_libraries(ngn_appkit PUBLIC ngn_core_runtime ngn_libraries)
target_compile_options(ngn_appkit PUBLIC -fobjc-arc -Wall -Wno-unused-parameter)
set(NGN_APPKIT_FRAMEWORKS
    "-framework AppKit" "-framework Foundation" "-framework CoreText" "-framework ImageIO" "-framework QuartzCore" "-framework Security" "-framework IOKit" "-framework UniformTypeIdentifiers" "-framework UserNotifications" "-framework LocalAuthentication" "-framework CoreLocation" "-framework CoreServices" "-framework SystemConfiguration" "-framework Network" "-framework AuthenticationServices" "-framework Vision" "-framework EventKit" "-framework StoreKit" "-framework AVFoundation" "-framework CoreMedia" "-framework Photos" "-framework PhotosUI" "-framework AppTrackingTransparency" "-framework AdSupport" "-framework MapKit" "-framework WebKit" "-framework PDFKit" "-framework CoreImage" "-framework AVKit")

add_executable(ngn-macos
    main.mm)
# The autolinked code (cmake/linked-modules.cmake), which only a target linking it directly takes whole.
target_link_libraries(ngn-macos PRIVATE ngn_appkit ${NGN_LINKED} ${NGN_APPKIT_FRAMEWORKS})
ngn_link_swift(ngn-macos)
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
    COMMAND ${CMAKE_COMMAND} -E copy_if_different ${NGN_HERMESC} $<TARGET_FILE_DIR:ngn-macos>/hermesc
    VERBATIM)
# React Native's prebuilt Hermes beside the binary, which loads it from there in a build and
# `package` embeds in Contents/Frameworks.
if(NGN_HERMES_FRAMEWORK)
  add_custom_command(TARGET ngn-macos POST_BUILD
      COMMAND rm -rf $<TARGET_FILE_DIR:ngn-macos>/hermesvm.framework
      COMMAND ditto ${NGN_HERMES_FRAMEWORK} $<TARGET_FILE_DIR:ngn-macos>/hermesvm.framework
      VERBATIM)
endif()

# Sparkle's framework beside the binary, where `package --format dmg` takes it from to embed it.
# The binary never links it: it loads it at runtime in a dmg build only (app-updater.mm).
set(_sparkle ${NGN_SOURCES}/sparkle/Sparkle.framework)
if(EXISTS ${_sparkle})
  add_custom_command(TARGET ngn-macos POST_BUILD
      COMMAND rm -rf $<TARGET_FILE_DIR:ngn-macos>/Sparkle.framework
      COMMAND ditto ${_sparkle} $<TARGET_FILE_DIR:ngn-macos>/Sparkle.framework
      VERBATIM)
endif()

# The AppKit view tests: views mounted from Fabric mutations into an offscreen window, through the
# backend the binary uses. Built with the core tests, and run beside them.
if(NGN_TESTS)
  add_executable(ngn_appkit_tests ../core/tests/main.cpp tests/views/accessibility.test.mm tests/views/svg-foreign-object.test.mm
    tests/views/tab-walk.test.mm tests/views/camera-view.test.mm tests/views/text-input-alignment.test.mm
    tests/views/image-view.test.mm tests/views/modal-beside-split.test.mm
    tests/views/split-under-pushed-screen.test.mm tests/views/view-effects.test.mm
    tests/views/native-button.test.mm tests/views/sidebar-rows.test.mm tests/views/split-toolbar-insets.test.mm
    tests/views/split-content-inset.test.mm
    tests/views/tags-after-reload.test.mm tests/views/surface-resize.test.mm
    tests/views/text-input-key-press.test.mm tests/views/window-subtitle.test.mm tests/views/header-svg-icons.test.mm)
  target_include_directories(ngn_appkit_tests PRIVATE ../core/tests)
  target_link_libraries(ngn_appkit_tests PRIVATE ngn_appkit doctest ${NGN_APPKIT_FRAMEWORKS})
  if(NGN_HERMES_TEST_RPATH)
    target_link_options(ngn_appkit_tests PRIVATE ${NGN_HERMES_TEST_RPATH})
  endif()
  ngn_link_swift(ngn_appkit_tests)
  add_test(NAME appkit COMMAND ngn_appkit_tests)
endif()
