// Where React Native's own reloads go. ReactHost::reloadReactInstance, which DevSettings.reload(),
// the dev server's reload command and the debugger's call, tears its instance down and makes the
// next on a thread of its own, with nothing holding off the UI thread: a window sized meanwhile
// (one the splash screen lets go as the reload ends its module, say) reads a SurfaceManager already
// freed. The host builds a copy of ReactHost.cpp (cmake/react-native.cmake) that asks here first,
// and the core's Runtime routes its host's reloads to Runtime::reload, which keeps the surfaces in
// step with the UI thread as it runs.
#pragma once

#include <functional>

namespace ngn {

// Sends `host`'s reloads to `reload` from now on; a null `reload` lets them go to React Native's
// own again. Any thread.
void routeHostReload(const void *host, std::function<void()> reload);

// Runs the reload routed for `host`, outside any lock, and answers true; false where none is.
bool reloadThroughRoute(const void *host);

} // namespace ngn
