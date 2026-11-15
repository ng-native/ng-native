// What a linked library includes to draw its Fabric component on macOS: the NSView every Fabric
// view mounts as (NGNView, host-view.h), and the call that names the subclass for a component.
//
// The library's codegen gives the host the component's props, events and shadow node, as on
// Android (cmake/libraries.cmake), so the component lays out and its events reach JavaScript. Its
// view is a subclass of NGNView that overrides updateProps: (calling super, which keeps the view's
// background, border, opacity and accessibility) and reads its props by casting to the codegen's
// Props class. Events go out through the codegen's EventEmitter, cast from `eventEmitter`.
//
// Registered from the library's own code as it loads (`+load` or a static initializer), the way
// its TurboModules are. The host's own components keep their views: a library's class for one of
// their names is ignored. A component with no class registered mounts as a plain NGNView.
#pragma once

#import "host-view.h"

void NGNRegisterComponentView(NSString *componentName, Class viewClass);
