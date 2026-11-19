// The XDG desktop portals (org.freedesktop.portal.Desktop on the session bus), called over GDBus
// with one Request and Response routine, inside a sandbox and outside one, so Flatpak is a packaging
// step and not a second code path. Where no portal answers (no session bus, as in the dev loop on a
// Mac, or no xdg-desktop-portal running), a caller falls back to GTK's own path.
#pragma once

#include <gio/gio.h>
#include <gio/gunixfdlist.h>
#include <gtk/gtk.h>

#include <functional>
#include <string>

namespace ngn::gtk::portal {

// How a portal request ended: the user's choice (Response's 0, 1 and 2), or no portal to ask.
enum class Outcome { Done, Cancelled, Failed, Absent };

// Answers on the main context, with the Response's results (an a{sv}, borrowed for the call), or
// null when the request never reached a portal.
using Answer = std::function<void(Outcome outcome, GVariant *results)>;

// Calls `method` of `interface` (org.freedesktop.portal.OpenURI, say) with `leading` (a tuple of
// the arguments before its options, floating or owned, consumed) and `options` (an a{sv} builder's
// end, consumed; null for a method with no options; a handle_token is added when the method returns
// a Request), and with `fds` (may be
// null) for its `h` arguments. Answers once the portal's Request has its Response. A portal with no
// Request (a method that returns at once, `returnsRequest` false) answers Done with null results.
// `started`, when given, hears the Request's object path once the portal returns it: a request
// that lasts until closed (Inhibit's) is ended with close(path). For a method with no Request it
// hears the object path the method returns, if any (CreateSession's session), before the answer.
void request(const char *interface, const char *method, GVariant *leading, GVariantBuilder *options, GUnixFDList *fds,
             Answer answer, bool returnsRequest = true, std::function<void(const std::string &path)> started = {});

// Hears each `signal` of `interface` the portal sends (Notification's ActionInvoked, say), with its
// parameters borrowed for the call, on the main context, until the answer is called. Nothing is
// heard where there is no session bus.
std::function<void()> subscribe(const char *interface, const char *signal, std::function<void(GVariant *parameters)> heard);

// Ends the Request at `path` (org.freedesktop.portal.Request.Close), which then never answers.
void close(const std::string &path);

// Ends the Session at `path` (org.freedesktop.portal.Session.Close): a Location session's updates
// stop.
void closeSession(const std::string &path);

// The requests still waiting for a Response: none once each has answered or been closed.
size_t requestsInFlight();

// The window identifier the portals place a dialog against ("x11:<xid>" or "wayland:<handle>"),
// handed to `ready` on the main context; empty for no window or a windowing system with none (a
// Mac's). A Wayland handle is exported for the call and dropped by the returned cleanup.
void parentHandle(GtkWindow *window, std::function<void(const std::string &handle, std::function<void()> drop)> ready);

// The window the app is in front with: a dialog's parent, and where a launched app takes its
// activation token from.
GtkWindow *frontWindow();

// The connection requests go over: the session bus, or, in the GTK tests, a peer-to-peer
// connection to a stand-in portal (null restores the session bus).
void useConnection(GDBusConnection *connection);

} // namespace ngn::gtk::portal
