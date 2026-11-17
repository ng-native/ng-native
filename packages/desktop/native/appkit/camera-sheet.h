// The host's camera for NgNativeImagePicker's launchCameraAsync (the core's CameraSheet): macOS has
// no system camera screen, so a sheet on the key window shows the camera's preview, mirrored as
// Photo Booth and FaceTime show it, with Cancel (Escape) and the shutter (Return) below it. The
// photo or movie itself is not mirrored, as on iOS. The sheet is a picker's size (pickerSheet).
//
// In photo mode the shutter is Take Photo. In video mode it is Record, then Stop, with the time
// recorded beside it; the recording also stops at the request's limit. A request for both shows a
// Photo and Video switch, in photo mode first, as iOS's camera opens; it is fixed while recording.
#pragma once

#include "ngn/camera.h"

#include <memory>

namespace ngn::appkit {

std::shared_ptr<CameraSheet> makeCameraSheet();

} // namespace ngn::appkit

#ifdef __OBJC__
#import <AVFoundation/AVFoundation.h>
#import <AppKit/AppKit.h>

#import "camera.h"

namespace ngn::appkit {
// The window the sheet shows on: the key window, the main one, or, in an app that is not active
// (as just after an OS permission prompt), its front window that can hold a sheet; nil for none.
NSWindow *windowForSheet();
} // namespace ngn::appkit

// What the sheet answers: a photo written as the request asks, with its size and the camera's EXIF
// (nil when it has none); a movie, with its size and length; or neither, with an error or, when
// the user cancelled, none.
using CameraSheetDone = std::function<void(ngn::CameraTake take, NSDictionary *exif, const std::string &error)>;

@interface NGNCameraSheet : NSViewController
- (instancetype)initWithCapture:(std::shared_ptr<ngn::appkit::SessionCapture>)capture
                        request:(ngn::CameraSheetRequest)request
                           done:(CameraSheetDone)done;
@property(nonatomic, readonly) NSButton *shutter;
@property(nonatomic, readonly) NSButton *cancelButton;
@property(nonatomic, readonly) AVCaptureVideoPreviewLayer *preview;
// Photo (0) and Video (1), for a request that takes either; nil otherwise.
@property(nonatomic, readonly) NSSegmentedControl *modeSwitch;
// The time recorded, shown in video mode.
@property(nonatomic, readonly) NSTextField *elapsed;
@property(nonatomic, readonly) BOOL videoMode;
// The camera is running: the shutter can take a photo or start a recording.
- (void)cameraRunning;
- (void)takePhoto:(id)sender;
// Starts a recording, or stops the one running.
- (void)record:(id)sender;
// Switches to the mode modeSwitch shows.
- (void)switchMode:(id)sender;
- (void)cancel:(id)sender;
@end
#endif
