// A portal of our own for the GTK tests: org.freedesktop.portal.Desktop's OpenURI, Inhibit,
// Notification, FileChooser and Print over
// a peer-to-peer connection, so no session bus is needed. The portal helper is pointed at it while
// it lasts.
#pragma once

#include "../portal.h"
#include "mounted-views.h"

#include <doctest/doctest.h>
#include <gio/gunixfdlist.h>

#include <sys/socket.h>
#include <sys/stat.h>
#include <unistd.h>

#include <string>
#include <tuple>
#include <utility>
#include <vector>

namespace ngn::testing {

// Two D-Bus connections joined to each other over a socket pair, a server's and a client's, with
// no bus between them. The caller owns both.
inline std::pair<GDBusConnection *, GDBusConnection *> peerToPeer() {
  REQUIRE(ngn::testing::gtkReady());
  int fds[2];
  REQUIRE(socketpair(AF_UNIX, SOCK_STREAM, 0, fds) == 0);
  auto stream = [](int fd) {
    GSocket *socket = g_socket_new_from_fd(fd, nullptr);
    auto *connection = G_IO_STREAM(g_socket_connection_factory_create_connection(socket));
    g_object_unref(socket);
    return connection;
  };
  GIOStream *serverStream = stream(fds[0]);
  GIOStream *clientStream = stream(fds[1]);
  gchar *guid = g_dbus_generate_guid();
  auto made = +[](GObject *, GAsyncResult *result, gpointer out) {
    *static_cast<GDBusConnection **>(out) = g_dbus_connection_new_finish(result, nullptr);
  };
  GDBusConnection *server = nullptr, *client = nullptr;
  g_dbus_connection_new(serverStream, guid,
                        GDBusConnectionFlags(G_DBUS_CONNECTION_FLAGS_AUTHENTICATION_SERVER | G_DBUS_CONNECTION_FLAGS_AUTHENTICATION_ALLOW_ANONYMOUS),
                        nullptr, nullptr, made, &server);
  g_dbus_connection_new(clientStream, nullptr, G_DBUS_CONNECTION_FLAGS_AUTHENTICATION_CLIENT, nullptr, nullptr, made, &client);
  ngn::testing::runUntil([&] { return server && client; });
  g_free(guid);
  g_object_unref(serverStream);
  g_object_unref(clientStream);
  return {server, client};
}

inline const char *kPortalIntrospection = R"(<node>
  <interface name="org.freedesktop.portal.OpenURI">
    <method name="OpenURI"><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="a{sv}" direction="in"/><arg type="o" direction="out"/></method>
    <method name="OpenFile"><arg type="s" direction="in"/><arg type="h" direction="in"/><arg type="a{sv}" direction="in"/><arg type="o" direction="out"/></method>
    <method name="OpenDirectory"><arg type="s" direction="in"/><arg type="h" direction="in"/><arg type="a{sv}" direction="in"/><arg type="o" direction="out"/></method>
  </interface>
  <interface name="org.freedesktop.portal.Inhibit">
    <method name="Inhibit"><arg type="s" direction="in"/><arg type="u" direction="in"/><arg type="a{sv}" direction="in"/><arg type="o" direction="out"/></method>
  </interface>
  <interface name="org.freedesktop.portal.Notification">
    <method name="AddNotification"><arg type="s" direction="in"/><arg type="a{sv}" direction="in"/></method>
    <method name="RemoveNotification"><arg type="s" direction="in"/></method>
    <signal name="ActionInvoked"><arg type="s"/><arg type="s"/><arg type="av"/></signal>
  </interface>
  <interface name="org.freedesktop.portal.FileChooser">
    <method name="OpenFile"><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="a{sv}" direction="in"/><arg type="o" direction="out"/></method>
    <method name="SaveFile"><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="a{sv}" direction="in"/><arg type="o" direction="out"/></method>
  </interface>
  <interface name="org.freedesktop.portal.Print">
    <method name="PreparePrint"><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="a{sv}" direction="in"/><arg type="a{sv}" direction="in"/><arg type="a{sv}" direction="in"/><arg type="o" direction="out"/></method>
    <method name="Print"><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="h" direction="in"/><arg type="a{sv}" direction="in"/><arg type="o" direction="out"/></method>
  </interface>
  <interface name="org.freedesktop.portal.Request">
    <method name="Close"/>
  </interface>
</node>)";

// A portal of our own, answering every Request with `response`: what each call was given is kept
// in `calls`, with the inode of a passed fd.
struct StandInPortal {
  struct Call {
    std::string path;
    std::string method;
    std::string first;
    std::string second;
    unsigned flags{0};
    ino_t inode{0};
    // A notification's body and default action, and whether its options had a handle_token.
    std::string body;
    std::string action;
    std::string target;
    bool token{false};
    // A file chooser's options, and the bytes of a file given to Print with the token it came with.
    bool multiple{false};
    bool directory{false};
    std::string name;
    std::vector<std::string> types;
    std::string printed;
    unsigned printToken{0};
  };

  GDBusConnection *server{nullptr};
  GDBusConnection *client{nullptr};
  GDBusNodeInfo *node{nullptr};
  std::vector<guint> registrations;
  std::vector<Call> calls;
  unsigned response{0};
  // Interfaces the stand-in does not offer: their calls fail as a missing portal's do.
  bool offersOpenUri{true};
  bool offersNotification{true};
  bool offersFileChooser{true};
  bool offersPrint{true};
  // What a FileChooser's Response chooses.
  std::vector<std::string> uris;

  StandInPortal() {
    std::tie(server, client) = peerToPeer();
    node = g_dbus_node_info_new_for_xml(kPortalIntrospection, nullptr);
    add("org.freedesktop.portal.OpenURI", "/org/freedesktop/portal/desktop");
    add("org.freedesktop.portal.Inhibit", "/org/freedesktop/portal/desktop");
    add("org.freedesktop.portal.Notification", "/org/freedesktop/portal/desktop");
    add("org.freedesktop.portal.FileChooser", "/org/freedesktop/portal/desktop");
    add("org.freedesktop.portal.Print", "/org/freedesktop/portal/desktop");
    ngn::gtk::portal::useConnection(client);
  }

  ~StandInPortal() {
    ngn::gtk::portal::useConnection(nullptr);
    for (auto id : registrations) {
      g_dbus_connection_unregister_object(server, id);
    }
    g_dbus_node_info_unref(node);
    g_dbus_connection_close_sync(client, nullptr, nullptr);
    g_object_unref(client);
    g_object_unref(server);
  }

  void add(const char *interface, const std::string &path) {
    static const GDBusInterfaceVTable vtable{+[](GDBusConnection *, const gchar *, const gchar *path, const gchar *interface,
                                                const gchar *method, GVariant *parameters, GDBusMethodInvocation *invocation,
                                                gpointer data) { static_cast<StandInPortal *>(data)->called(path, interface, method, parameters, invocation); }};
    registrations.push_back(g_dbus_connection_register_object(server, path.c_str(), g_dbus_node_info_lookup_interface(node, interface),
                                                              &vtable, this, nullptr, nullptr));
  }

  void called(const std::string &path, const std::string &interface, const std::string &method, GVariant *parameters,
              GDBusMethodInvocation *invocation) {
    Call call{.path = path, .method = method};
    if (method == "Close") {
      calls.push_back(call);
      g_dbus_method_invocation_return_value(invocation, nullptr);
      return;
    }
    if (interface == "org.freedesktop.portal.Notification") {
      notified(method, parameters, invocation);
      return;
    }
    if ((interface == "org.freedesktop.portal.OpenURI" && !offersOpenUri) ||
        (interface == "org.freedesktop.portal.FileChooser" && !offersFileChooser) || (interface == "org.freedesktop.portal.Print" && !offersPrint)) {
      g_dbus_method_invocation_return_error(invocation, G_DBUS_ERROR, G_DBUS_ERROR_UNKNOWN_METHOD, "not offered here");
      return;
    }
    // The options come last.
    GVariant *options = g_variant_get_child_value(parameters, g_variant_n_children(parameters) - 1);
    g_variant_lookup(options, "multiple", "b", &call.multiple);
    g_variant_lookup(options, "directory", "b", &call.directory);
    g_variant_lookup(options, "token", "u", &call.printToken);
    if (const gchar *name = nullptr; g_variant_lookup(options, "current_name", "&s", &name)) {
      call.name = name;
    }
    if (GVariant *filter = g_variant_lookup_value(options, "current_filter", G_VARIANT_TYPE("(sa(us))"))) {
      GVariantIter *patterns = nullptr;
      g_variant_get(filter, "(&sa(us))", nullptr, &patterns);
      guint32 kind = 0;
      const gchar *pattern = nullptr;
      while (g_variant_iter_next(patterns, "(u&s)", &kind, &pattern)) {
        call.types.emplace_back(pattern);
      }
      g_variant_iter_free(patterns);
      g_variant_unref(filter);
    }
    if (method == "Print") {
      GVariant *handle = g_variant_get_child_value(parameters, 2);
      GUnixFDList *fds = g_dbus_message_get_unix_fd_list(g_dbus_method_invocation_get_message(invocation));
      int fd = fds ? g_unix_fd_list_get(fds, g_variant_get_handle(handle), nullptr) : -1;
      char buffer[4096];
      for (ssize_t n; fd >= 0 && (n = read(fd, buffer, sizeof buffer)) > 0;) {
        call.printed.append(buffer, n);
      }
      if (fd >= 0) {
        close(fd);
      }
      g_variant_unref(handle);
    }
    const gchar *token = "none";
    g_variant_lookup(options, "handle_token", "&s", &token);
    auto handle = "/org/freedesktop/portal/desktop/request/test/" + std::string(token);
    g_variant_unref(options);
    GVariant *first = g_variant_get_child_value(parameters, 0);
    call.first = g_variant_get_string(first, nullptr);
    g_variant_unref(first);
    GVariant *second = g_variant_get_child_value(parameters, 1);
    if (g_variant_is_of_type(second, G_VARIANT_TYPE_STRING)) {
      call.second = g_variant_get_string(second, nullptr);
    } else if (g_variant_is_of_type(second, G_VARIANT_TYPE_HANDLE)) {
      GUnixFDList *fds = g_dbus_message_get_unix_fd_list(g_dbus_method_invocation_get_message(invocation));
      int fd = fds ? g_unix_fd_list_get(fds, g_variant_get_handle(second), nullptr) : -1;
      struct stat info{};
      if (fd >= 0 && fstat(fd, &info) == 0) {
        call.inode = info.st_ino;
      }
      if (fd >= 0) {
        close(fd);
      }
    } else if (g_variant_is_of_type(second, G_VARIANT_TYPE_UINT32)) {
      call.flags = g_variant_get_uint32(second);
    }
    g_variant_unref(second);
    calls.push_back(call);
    g_dbus_method_invocation_return_value(invocation, g_variant_new("(o)", handle.c_str()));
    if (method == "Inhibit") {
      // Held until closed: no Response, and a Request object to close.
      add("org.freedesktop.portal.Request", handle);
      return;
    }
    // After the reply, as xdg-desktop-portal answers once the user has chosen.
    GVariantBuilder results;
    g_variant_builder_init(&results, G_VARIANT_TYPE_VARDICT);
    if (interface == "org.freedesktop.portal.FileChooser" && !uris.empty()) {
      GVariantBuilder chosen;
      g_variant_builder_init(&chosen, G_VARIANT_TYPE_STRING_ARRAY);
      for (const auto &uri : uris) {
        g_variant_builder_add(&chosen, "s", uri.c_str());
      }
      g_variant_builder_add(&results, "{sv}", "uris", g_variant_builder_end(&chosen));
    }
    if (method == "PreparePrint") {
      g_variant_builder_add(&results, "{sv}", "token", g_variant_new_uint32(7));
    }
    g_dbus_connection_emit_signal(server, nullptr, handle.c_str(), "org.freedesktop.portal.Request", "Response",
                                  g_variant_new("(ua{sv})", response, &results), nullptr);
  }

  // AddNotification(id, notification) and RemoveNotification(id), which return at once.
  void notified(const std::string &method, GVariant *parameters, GDBusMethodInvocation *invocation) {
    if (!offersNotification) {
      g_dbus_method_invocation_return_error(invocation, G_DBUS_ERROR, G_DBUS_ERROR_UNKNOWN_INTERFACE, "no Notification here");
      return;
    }
    Call call{.method = method};
    GVariant *id = g_variant_get_child_value(parameters, 0);
    call.first = g_variant_get_string(id, nullptr);
    g_variant_unref(id);
    if (method == "AddNotification") {
      GVariant *options = g_variant_get_child_value(parameters, 1);
      const gchar *text = nullptr;
      if (g_variant_lookup(options, "title", "&s", &text)) {
        call.second = text;
      }
      if (g_variant_lookup(options, "body", "&s", &text)) {
        call.body = text;
      }
      if (g_variant_lookup(options, "default-action", "&s", &text)) {
        call.action = text;
      }
      if (GVariant *target = g_variant_lookup_value(options, "default-action-target", G_VARIANT_TYPE_STRING)) {
        call.target = g_variant_get_string(target, nullptr);
        g_variant_unref(target);
      }
      if (GVariant *token = g_variant_lookup_value(options, "handle_token", nullptr)) {
        call.token = true;
        g_variant_unref(token);
      }
      g_variant_unref(options);
    }
    calls.push_back(call);
    g_dbus_method_invocation_return_value(invocation, nullptr);
  }

  // The user clicked the notification `id`: the portal tells the app, which it cannot activate.
  void invoke(const std::string &id, const std::string &action) {
    g_dbus_connection_emit_signal(server, nullptr, "/org/freedesktop/portal/desktop", "org.freedesktop.portal.Notification",
                                  "ActionInvoked", g_variant_new("(ss@av)", id.c_str(), action.c_str(), g_variant_new_array(G_VARIANT_TYPE_VARIANT, nullptr, 0)),
                                  nullptr);
  }
};

} // namespace ngn::testing
