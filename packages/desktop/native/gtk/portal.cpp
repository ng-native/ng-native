#include "portal.h"

#include <gtk/gtk.h>
#ifdef GDK_WINDOWING_X11
#include <gdk/x11/gdkx.h>
#endif
#ifdef GDK_WINDOWING_WAYLAND
#include <gdk/wayland/gdkwayland.h>
#endif

#include <atomic>
#include <cstdio>
#include <map>
#include <memory>

namespace ngn::gtk::portal {

namespace {

constexpr const char *kBusName = "org.freedesktop.portal.Desktop";
constexpr const char *kObjectPath = "/org/freedesktop/portal/desktop";

GDBusConnection *gInjected = nullptr;

// A new reference to the connection requests go over, or null when there is no session bus.
GDBusConnection *connection() {
  if (gInjected) {
    return G_DBUS_CONNECTION(g_object_ref(gInjected));
  }
  GError *error = nullptr;
  GDBusConnection *bus = g_bus_get_sync(G_BUS_TYPE_SESSION, nullptr, &error);
  if (error) {
    g_error_free(error);
  }
  return bus;
}

// One request in flight: its Response's subscription, the object path it arrives on, and the
// answer, given once.
struct Pending {
  GDBusConnection *connection{nullptr};
  guint subscription{0};
  std::string path;
  Answer answer;
  bool returnsRequest{true};
  std::function<void(const std::string &)> started;
  bool answered{false};

  ~Pending() {
    unsubscribe();
    g_clear_object(&connection);
  }
  void unsubscribe() {
    if (subscription != 0) {
      g_dbus_connection_signal_unsubscribe(connection, subscription);
      subscription = 0;
    }
  }
  void finish(Outcome outcome, GVariant *results) {
    if (answered) {
      return;
    }
    answered = true;
    unsubscribe();
    answer(outcome, results);
  }
};

// The pending requests, by an id the signal and reply callbacks carry, so a request whose answer
// came is gone for both (a Response after the reply's error, or the reverse).
std::map<guint, std::unique_ptr<Pending>> &pending() {
  static std::map<guint, std::unique_ptr<Pending>> requests;
  return requests;
}

void finish(guint id, Outcome outcome, GVariant *results) {
  auto it = pending().find(id);
  if (it == pending().end()) {
    return;
  }
  auto request = std::move(it->second);
  pending().erase(it);
  request->finish(outcome, results);
}

void responded(GDBusConnection *, const gchar *, const gchar *path, const gchar *, const gchar *, GVariant *parameters,
               gpointer data) {
  auto id = GPOINTER_TO_UINT(data);
  auto it = pending().find(id);
  if (it == pending().end() || it->second->path != path) {
    return;
  }
  guint32 response = 2;
  GVariant *results = nullptr;
  g_variant_get(parameters, "(u@a{sv})", &response, &results);
  finish(id, response == 0 ? Outcome::Done : response == 1 ? Outcome::Cancelled : Outcome::Failed, results);
  g_variant_unref(results);
}

void subscribe(Pending &request, guint id) {
  request.unsubscribe();
  request.subscription = g_dbus_connection_signal_subscribe(
      request.connection, gInjected ? nullptr : kBusName, "org.freedesktop.portal.Request", "Response",
      request.path.empty() ? nullptr : request.path.c_str(), nullptr, G_DBUS_SIGNAL_FLAGS_NO_MATCH_RULE, responded, GUINT_TO_POINTER(id), nullptr);
}

// The path a Request for `token` has, from the connection's unique name (":1.42" makes
// "1_42"), as xdg-desktop-portal names it; empty on a peer-to-peer connection, which has none.
std::string requestPath(GDBusConnection *connection, const std::string &token) {
  const gchar *unique = g_dbus_connection_get_unique_name(connection);
  if (!unique) {
    return "";
  }
  std::string sender = unique[0] == ':' ? unique + 1 : unique;
  for (auto &c : sender) {
    if (c == '.') {
      c = '_';
    }
  }
  return std::string(kObjectPath) + "/request/" + sender + "/" + token;
}

// Whether a call's error says no portal (or not this one) is there to answer, rather than that
// the portal refused it: the bus's own errors, from a name nobody owns to a method not offered.
bool absent(const GError *error) {
  return error->domain == G_DBUS_ERROR || error->domain == G_IO_ERROR;
}

void replied(GObject *source, GAsyncResult *result, gpointer data) {
  auto id = GPOINTER_TO_UINT(data);
  GError *error = nullptr;
  GVariant *reply = g_dbus_connection_call_with_unix_fd_list_finish(G_DBUS_CONNECTION(source), nullptr, result, &error);
  if (error) {
    bool missing = absent(error);
    if (!missing) {
      fprintf(stderr, "[ngn] portal: %s\n", error->message);
    }
    g_error_free(error);
    finish(id, missing ? Outcome::Absent : Outcome::Failed, nullptr);
    return;
  }
  auto it = pending().find(id);
  if (it == pending().end()) {
    g_variant_unref(reply);
    return;
  }
  auto &request = *it->second;
  if (!request.returnsRequest) {
    if (request.started && g_variant_is_of_type(reply, G_VARIANT_TYPE("(o)"))) {
      const gchar *path = nullptr;
      g_variant_get(reply, "(&o)", &path);
      auto started = std::move(request.started);
      started(path);
    }
    g_variant_unref(reply);
    finish(id, Outcome::Done, nullptr);
    return;
  }
  const gchar *handle = nullptr;
  if (g_variant_is_of_type(reply, G_VARIANT_TYPE("(o)"))) {
    g_variant_get(reply, "(&o)", &handle);
  }
  // A portal older than handle_token names its Request itself: the Response is on that path. A
  // peer-to-peer connection's subscription matches every path (its unique name, and so the path,
  // was unknown), and its replies and signals arrive in order, so it only needs the path to match.
  if (handle && request.path != handle) {
    bool everyPath = request.path.empty();
    request.path = handle;
    if (!everyPath) {
      subscribe(request, id);
    }
  }
  g_variant_unref(reply);
  if (request.started) {
    auto started = std::move(request.started);
    started(request.path);
  }
}

struct Call {
  std::string interface;
  std::string method;
  GVariant *leading;
  GVariantBuilder *options;
  GUnixFDList *fds;
  Answer answer;
  bool returnsRequest;
  std::function<void(const std::string &)> started;
};

void start(std::unique_ptr<Call> call) {
  static guint next = 0;
  static std::atomic<int> tokens{0};
  GDBusConnection *bus = connection();
  if (!bus) {
    g_variant_unref(call->leading);
    if (call->options) {
      g_variant_builder_unref(call->options);
    }
    g_clear_object(&call->fds);
    call->answer(Outcome::Absent, nullptr);
    return;
  }
  // A method with no Request takes no handle_token: a portal that checks its options (the
  // Notification portal's) refuses one it does not know.
  auto token = "ngn" + std::to_string(++tokens);
  if (call->returnsRequest && call->options) {
    g_variant_builder_add(call->options, "{sv}", "handle_token", g_variant_new_string(token.c_str()));
  }
  GVariantBuilder arguments;
  g_variant_builder_init(&arguments, G_VARIANT_TYPE_TUPLE);
  for (gsize i = 0, n = g_variant_n_children(call->leading); i < n; ++i) {
    g_variant_builder_add_value(&arguments, g_variant_get_child_value(call->leading, i));
  }
  if (call->options) {
    g_variant_builder_add_value(&arguments, g_variant_builder_end(call->options));
    g_variant_builder_unref(call->options);
  }
  g_variant_unref(call->leading);

  auto id = ++next;
  auto request = std::make_unique<Pending>();
  request->connection = bus;
  request->path = requestPath(bus, token);
  request->answer = std::move(call->answer);
  request->returnsRequest = call->returnsRequest;
  request->started = std::move(call->started);
  // Subscribed before the call, so a Response sent before the reply is heard.
  if (call->returnsRequest) {
    subscribe(*request, id);
  }
  pending()[id] = std::move(request);
  g_dbus_connection_call_with_unix_fd_list(bus, gInjected ? nullptr : kBusName, kObjectPath, call->interface.c_str(),
                                           call->method.c_str(), g_variant_builder_end(&arguments), nullptr,
                                           G_DBUS_CALL_FLAGS_NONE, G_MAXINT, call->fds, nullptr, replied, GUINT_TO_POINTER(id));
  g_clear_object(&call->fds);
}

} // namespace

void request(const char *interface, const char *method, GVariant *leading, GVariantBuilder *options, GUnixFDList *fds,
             Answer answer, bool returnsRequest, std::function<void(const std::string &)> started) {
  auto call = std::make_unique<Call>(Call{
      .interface = interface,
      .method = method,
      .leading = g_variant_ref_sink(leading),
      .options = options,
      .fds = fds ? G_UNIX_FD_LIST(g_object_ref(fds)) : nullptr,
      .answer = std::move(answer),
      .returnsRequest = returnsRequest,
      .started = std::move(started),
  });
  // On the main context, where the replies and signals then arrive, whichever thread asked.
  g_main_context_invoke(nullptr, +[](gpointer data) -> gboolean {
    start(std::unique_ptr<Call>(static_cast<Call *>(data)));
    return G_SOURCE_REMOVE;
  }, call.release());
}

void parentHandle(GtkWindow *window, std::function<void(const std::string &, std::function<void()>)> ready) {
  [[maybe_unused]] GdkSurface *surface = window ? gtk_native_get_surface(GTK_NATIVE(window)) : nullptr;
#ifdef GDK_WINDOWING_X11
  if (surface && GDK_IS_X11_SURFACE(surface)) {
    char handle[32];
    snprintf(handle, sizeof handle, "x11:%lx", static_cast<unsigned long>(gdk_x11_surface_get_xid(surface)));
    ready(handle, [] {});
    return;
  }
#endif
#ifdef GDK_WINDOWING_WAYLAND
  if (surface && GDK_IS_WAYLAND_TOPLEVEL(surface)) {
    using Ready = std::shared_ptr<std::function<void(const std::string &, std::function<void()>)>>;
    auto shared = std::make_shared<std::function<void(const std::string &, std::function<void()>)>>(std::move(ready));
    auto exported = gdk_wayland_toplevel_export_handle(GDK_TOPLEVEL(surface), +[](GdkToplevel *toplevel, const char *handle, gpointer data) {
      auto &ready = **static_cast<Ready *>(data);
      g_object_ref(toplevel);
      ready(std::string("wayland:") + handle, [toplevel] {
        gdk_wayland_toplevel_unexport_handle(toplevel);
        g_object_unref(toplevel);
      });
    }, new Ready(shared), +[](gpointer data) { delete static_cast<Ready *>(data); });
    if (!exported) {
      // The compositor has no xdg-foreign: the dialog comes up unparented.
      (*shared)("", [] {});
    }
    return;
  }
#endif
  ready("", [] {});
}

GtkWindow *frontWindow() {
  GtkWindow *front = nullptr;
  GListModel *windows = gtk_window_get_toplevels();
  for (guint i = 0, n = g_list_model_get_n_items(windows); i < n; ++i) {
    auto *window = GTK_WINDOW(g_list_model_get_item(windows, i));
    g_object_unref(window);
    if (gtk_widget_get_visible(GTK_WIDGET(window)) && (!front || gtk_window_is_active(window))) {
      front = window;
    }
  }
  return front;
}

std::function<void()> subscribe(const char *interface, const char *signal, std::function<void(GVariant *)> heard) {
  GDBusConnection *bus = connection();
  if (!bus) {
    return [] {};
  }
  using Heard = std::function<void(GVariant *)>;
  guint id = g_dbus_connection_signal_subscribe(
      bus, gInjected ? nullptr : kBusName, interface, signal, kObjectPath, nullptr, G_DBUS_SIGNAL_FLAGS_NONE,
      +[](GDBusConnection *, const gchar *, const gchar *, const gchar *, const gchar *, GVariant *parameters, gpointer data) {
        (*static_cast<Heard *>(data))(parameters);
      },
      new Heard(std::move(heard)), +[](gpointer data) { delete static_cast<Heard *>(data); });
  return [bus, id] {
    g_dbus_connection_signal_unsubscribe(bus, id);
    g_object_unref(bus);
  };
}

void close(const std::string &path) {
  auto *heap = new std::string(path);
  g_main_context_invoke(nullptr, +[](gpointer data) -> gboolean {
    std::unique_ptr<std::string> path(static_cast<std::string *>(data));
    // A closed Request sends no Response: it is dropped here, unanswered, with its subscription.
    for (auto it = pending().begin(); it != pending().end(); ++it) {
      if (it->second->path == *path) {
        pending().erase(it);
        break;
      }
    }
    if (GDBusConnection *bus = connection()) {
      g_dbus_connection_call(bus, gInjected ? nullptr : kBusName, path->c_str(), "org.freedesktop.portal.Request", "Close",
                             nullptr, nullptr, G_DBUS_CALL_FLAGS_NONE, -1, nullptr, nullptr, nullptr);
      g_object_unref(bus);
    }
    return G_SOURCE_REMOVE;
  }, heap);
}

void closeSession(const std::string &path) {
  auto *heap = new std::string(path);
  g_main_context_invoke(nullptr, +[](gpointer data) -> gboolean {
    std::unique_ptr<std::string> path(static_cast<std::string *>(data));
    if (GDBusConnection *bus = connection()) {
      g_dbus_connection_call(bus, gInjected ? nullptr : kBusName, path->c_str(), "org.freedesktop.portal.Session", "Close",
                             nullptr, nullptr, G_DBUS_CALL_FLAGS_NONE, -1, nullptr, nullptr, nullptr);
      g_object_unref(bus);
    }
    return G_SOURCE_REMOVE;
  }, heap);
}

size_t requestsInFlight() {
  return pending().size();
}

void useConnection(GDBusConnection *connection) {
  g_clear_object(&gInjected);
  if (connection) {
    gInjected = G_DBUS_CONNECTION(g_object_ref(connection));
  }
}

} // namespace ngn::gtk::portal
