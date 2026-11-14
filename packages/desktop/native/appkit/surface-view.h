// A window's content view, and the main container of one surface: it reports the mouse to the
// core's InputSink, which hit tests and sends touches and hover to Fabric.
#pragma once

#import <AppKit/AppKit.h>

#include "ngn/input.h"
#include "ngn/safe-areas.h"

#include <react/renderer/components/view/primitives.h>

#include <functional>

@interface NGNSurfaceView : NSView
@property (nonatomic, readonly) facebook::react::SurfaceId surfaceId;
// The view this container's hit test and Tab order start from.
@property (nonatomic, readonly) facebook::react::Tag rootTag;
// Set once by the host: each container's size and safe-area insets as they change (and nullopt
// as it goes), keyed by the tag its hit test starts from.
@property (class, nonatomic) std::function<void(facebook::react::Tag, std::optional<ngn::ContainerInsets>)> insetsChanged;
// Set once by the host: shows the context menu of the view under a secondary click, if one has a
// `contextMenu` prop. True when it showed one.
@property (class, nonatomic) std::function<bool(NGNSurfaceView *, NSEvent *, const ngn::PointerInput &)> contextMenuShower;
// Shows the cursor the core asked for (input-dispatcher.h), and keeps showing it over the views
// AppKit would reset it on.
+ (void)showCursor:(facebook::react::Cursor)cursor;
// The sink must outlive the view.
- (instancetype)initWithFrame:(NSRect)frame surfaceId:(facebook::react::SurfaceId)surfaceId input:(ngn::InputSink *)input;
// A container for part of a surface (a modal's in-window cover), hit-testing from `rootTag`.
- (instancetype)initWithFrame:(NSRect)frame
                    surfaceId:(facebook::react::SurfaceId)surfaceId
                    container:(ngn::ContainerId)container
                      rootTag:(facebook::react::Tag)rootTag
                        input:(ngn::InputSink *)input;
@end
