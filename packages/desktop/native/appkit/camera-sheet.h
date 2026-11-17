// The host's camera for NgNativeImagePicker's launchCameraAsync (the core's CameraSheet): macOS has
// no system camera screen, so a sheet on the key window shows the camera's preview, mirrored as
// Photo Booth and FaceTime show it, with Cancel (Escape) and Take Photo (Return) below it. The
// photo itself is not mirrored, as on iOS. The sheet is a picker's size (pickerSheet).
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

// What the sheet answers: a photo written as the request asks, with its size and the camera's EXIF
// (nil when it has none); or no photo, with an error or, when the user cancelled, none.
using CameraSheetDone = std::function<void(std::optional<ngn::CameraShot> shot, NSDictionary *exif, const std::string &error)>;

@interface NGNCameraSheet : NSViewController
- (instancetype)initWithCapture:(std::shared_ptr<ngn::appkit::SessionCapture>)capture
                        request:(ngn::CameraPictureRequest)request
                           done:(CameraSheetDone)done;
@property(nonatomic, readonly) NSButton *shutter;
@property(nonatomic, readonly) NSButton *cancelButton;
@property(nonatomic, readonly) AVCaptureVideoPreviewLayer *preview;
// The camera is running: the shutter can take a photo.
- (void)cameraRunning;
- (void)takePhoto:(id)sender;
- (void)cancel:(id)sender;
@end
#endif
