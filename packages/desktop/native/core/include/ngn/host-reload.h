// Where React Native's own reloads go. ReactHost::reloadReactInstance, which DevSettings.reload(),
// the dev server's reload command and the debugger's call, tears its instance down and makes the
// next on a thread of its own, with nothing holding off the UI thread: a window sized meanwhile
// (one the splash screen lets go as the reload ends its module, say) reads a SurfaceManager already
// freed. The host builds a copy of ReactHost.cpp (cmake/react-native.cmake) that comes here
// instead, and the core's Runtime routes its host's reloads to Runtime::reload, which keeps the
// surfaces in step with the UI thread as it runs. React Native's own never runs: a host has no
// route while the runtime is still making it or already tearing it down, and its own reload's
// thread would then make an instance beside the one being made, or outlive the host (a second
// reload command from the dev server, which the host still hears as it goes, reads it freed).
#pragma once

#include <functional>

namespace ngn {

// Sends `host`'s reloads to `reload` from now on; a null `reload` drops them. Any thread.
void routeHostReload(const void *host, std::function<void()> reload);

// Runs the reload routed for `host`, outside any lock, and answers true; false where none is, and
// the reload is dropped.
bool reloadThroughRoute(const void *host);

} // namespace ngn
