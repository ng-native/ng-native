#include "status-notifier.h"

#include "app-windows.h"

#include "svg-icon.h"

#include "ngn/dbus-menu.h"
#include "ngn/svg-markup.h"

#include <adwaita.h>
#include <gtk/gtk.h>

#include <algorithm>
#include <cstdio>
#include <functional>
#include <map>
#include <optional>
#include <vector>

namespace ngn::gtk {

namespace {

constexpr const char *kItemPath = "/StatusNotifierItem";
constexpr const char *kMenuPath = "/MenuBar";

constexpr const char *kItemXml = R"xml(<node>
  <interface name="org.kde.StatusNotifierItem">
    <property name="Category" type="s" access="read"/>
    <property name="Id" type="s" access="read"/>
    <property name="Title" type="s" access="read"/>
    <property name="Status" type="s" access="read"/>
    <property name="WindowId" type="i" access="read"/>
    <property name="IconName" type="s" access="read"/>
    <property name="IconPixmap" type="a(iiay)" access="read"/>
    <property name="OverlayIconName" type="s" access="read"/>
    <property name="AttentionIconName" type="s" access="read"/>
    <property name="ToolTip" type="(sa(iiay)ss)" access="read"/>
    <property name="ItemIsMenu" type="b" access="read"/>
    <property name="Menu" type="o" access="read"/>
    <method name="ContextMenu"><arg name="x" type="i" direction="in"/><arg name="y" type="i" direction="in"/></method>
    <method name="Activate"><arg name="x" type="i" direction="in"/><arg name="y" type="i" direction="in"/></method>
    <method name="SecondaryActivate"><arg name="x" type="i" direction="in"/><arg name="y" type="i" direction="in"/></method>
    <method name="Scroll"><arg name="delta" type="i" direction="in"/><arg name="orientation" type="s" direction="in"/></method>
    <signal name="NewTitle"/>
    <signal name="NewIcon"/>
    <signal name="NewToolTip"/>
    <signal name="NewStatus"><arg name="status" type="s"/></signal>
  </interface>
</node>)xml";

constexpr const char *kMenuXml = R"xml(<node>
  <interface name="com.canonical.dbusmenu">
    <property name="Version" type="u" access="read"/>
    <property name="TextDirection" type="s" access="read"/>
    <property name="Status" type="s" access="read"/>
    <property name="IconThemePath" type="as" access="read"/>
    <method name="GetLayout">
      <arg name="parentId" type="i" direction="in"/>
      <arg name="recursionDepth" type="i" direction="in"/>
      <arg name="propertyNames" type="as" direction="in"/>
      <arg name="revision" type="u" direction="out"/>
      <arg name="layout" type="(ia{sv}av)" direction="out"/>
    </method>
    <method name="GetGroupProperties">
      <arg name="ids" type="ai" direction="in"/>
      <arg name="propertyNames" type="as" direction="in"/>
      <arg name="properties" type="a(ia{sv})" direction="out"/>
    </method>
    <method name="GetProperty">
      <arg name="id" type="i" direction="in"/>
      <arg name="name" type="s" direction="in"/>
      <arg name="value" type="v" direction="out"/>
    </method>
    <method name="Event">
      <arg name="id" type="i" direction="in"/>
      <arg name="eventId" type="s" direction="in"/>
      <arg name="data" type="v" direction="in"/>
      <arg name="timestamp" type="u" direction="in"/>
    </method>
    <method name="EventGroup">
      <arg name="events" type="a(isvu)" direction="in"/>
      <arg name="idErrors" type="ai" direction="out"/>
    </method>
    <method name="AboutToShow">
      <arg name="id" type="i" direction="in"/>
      <arg name="needUpdate" type="b" direction="out"/>
    </method>
    <method name="AboutToShowGroup">
      <arg name="ids" type="ai" direction="in"/>
      <arg name="updatesNeeded" type="ai" direction="out"/>
      <arg name="idErrors" type="ai" direction="out"/>
    </method>
    <signal name="LayoutUpdated"><arg name="revision" type="u"/><arg name="parent" type="i"/></signal>
    <signal name="ItemsPropertiesUpdated">
      <arg name="updatedProps" type="a(ia{sv})"/>
      <arg name="removedProps" type="a(ias)"/>
    </signal>
  </interface>
</node>)xml";

GDBusInterfaceInfo *interfaceInfo(const char *xml) {
  GDBusNodeInfo *node = g_dbus_node_info_new_for_xml(xml, nullptr);
  // Kept for the process: every icon's objects use it.
  return node->interfaces[0];
}

GDBusInterfaceInfo *itemInterface() {
  static GDBusInterfaceInfo *info = interfaceInfo(kItemXml);
  return info;
}

GDBusInterfaceInfo *menuInterface() {
  static GDBusInterfaceInfo *info = interfaceInfo(kMenuXml);
  return info;
}

GVariant *noPixmaps() {
  return g_variant_new_array(G_VARIANT_TYPE("(iiay)"), nullptr, 0);
}

// The colour an SVG icon is drawn in, for the panel the tray most likely sits on (tray-and-dock.h).
uint32_t iconColor() {
  const char *desktop = g_getenv("XDG_CURRENT_DESKTOP");
  bool dark = adw_is_initialized() && adw_style_manager_get_dark(adw_style_manager_get_default());
  return linuxTrayIconColor(desktop ? desktop : "", dark);
}

// The side of a menu item's SVG icon in pixels: twice a menu's 16, for a host that draws at 2x.
constexpr int kMenuIconPixels = 32;

// Whether `node` or any item under it has an SVG icon.
bool hasSvgIcon(const DbusMenuNode &node) {
  return !node.svgIcon.empty() || std::any_of(node.children.begin(), node.children.end(), hasSvgIcon);
}

// A menu node's properties as dbusmenu names them.
GVariant *nodeProperties(const DbusMenuNode &node, bool root) {
  GVariantBuilder props;
  g_variant_builder_init(&props, G_VARIANT_TYPE("a{sv}"));
  if (root) {
    g_variant_builder_add(&props, "{sv}", "children-display", g_variant_new_string("submenu"));
  } else if (node.separator) {
    g_variant_builder_add(&props, "{sv}", "type", g_variant_new_string("separator"));
  } else {
    g_variant_builder_add(&props, "{sv}", "label", g_variant_new_string(node.label.c_str()));
    g_variant_builder_add(&props, "{sv}", "enabled", g_variant_new_boolean(node.enabled));
    if (node.checked) {
      g_variant_builder_add(&props, "{sv}", "toggle-type", g_variant_new_string("checkmark"));
      g_variant_builder_add(&props, "{sv}", "toggle-state", g_variant_new_int32(1));
    }
    if (!node.children.empty()) {
      g_variant_builder_add(&props, "{sv}", "children-display", g_variant_new_string("submenu"));
    }
    if (auto png = svgIconPng(node.svgIcon, kMenuIconPixels, iconColor()); !png.empty()) {
      g_variant_builder_add(
          &props, "{sv}", "icon-data", g_variant_new_fixed_array(G_VARIANT_TYPE_BYTE, png.data(), png.size(), 1));
    }
  }
  return g_variant_builder_end(&props);
}

// `(ia{sv}av)`: the node, and its children down to `depth` levels (all at -1).
GVariant *layoutOf(const DbusMenuNode &node, int depth, bool root) {
  GVariantBuilder children;
  g_variant_builder_init(&children, G_VARIANT_TYPE("av"));
  if (depth != 0) {
    for (const auto &child : node.children) {
      g_variant_builder_add(&children, "v", layoutOf(child, depth - 1, false));
    }
  }
  return g_variant_new("(i@a{sv}av)", node.id, nodeProperties(node, root), &children);
}

class Tray;

// One icon: its own connection, so closing it takes the icon off the watcher.
struct Icon {
  TrayIcon icon;
  std::string appId;
  GDBusConnection *connection{nullptr};
  guint item{0};
  guint menu{0};
  DbusMenuNode layout;
  guint32 revision{1};
  TrayEvents *events{nullptr};

  ~Icon() {
    if (connection) {
      g_dbus_connection_unregister_object(connection, item);
      g_dbus_connection_unregister_object(connection, menu);
      g_dbus_connection_close_sync(connection, nullptr, nullptr);
      g_object_unref(connection);
    }
  }

  // None for an SVG icon, which goes as its pixmap: a host draws the name where it finds one.
  std::string iconName() const {
    if (drawsSvg()) {
      return "";
    }
    return icon.image.empty() ? appId : icon.image;
  }
  bool drawsSvg() const {
    return parseSvgMarkup(icon.svgIcon).has_value();
  }
  std::string title() const {
    return !icon.title.empty() ? icon.title : !icon.tooltip.empty() ? icon.tooltip : appId;
  }
  void emit(const char *interface, const char *path, const char *signal, GVariant *args) const {
    g_dbus_connection_emit_signal(connection, nullptr, path, interface, signal, args, nullptr);
  }
};

using IconRef = std::weak_ptr<Icon>;

std::shared_ptr<Icon> iconOf(gpointer data) {
  return static_cast<IconRef *>(data)->lock();
}

GVariant *itemProperty(GDBusConnection *, const gchar *, const gchar *, const gchar *, const gchar *name, GError **error, gpointer data) {
  auto icon = iconOf(data);
  if (!icon) {
    return nullptr;
  }
  std::string n = name;
  const TrayIcon &t = icon->icon;
  if (n == "Category") return g_variant_new_string("ApplicationStatus");
  if (n == "Id") return g_variant_new_string((icon->appId + "-" + t.id).c_str());
  if (n == "Title") return g_variant_new_string(icon->title().c_str());
  if (n == "Status") return g_variant_new_string("Active");
  if (n == "WindowId") return g_variant_new_int32(0);
  if (n == "IconName") return g_variant_new_string(icon->iconName().c_str());
  if (n == "IconPixmap") return icon->drawsSvg() ? svgIconPixmaps(t.svgIcon, iconColor()) : noPixmaps();
  if (n == "OverlayIconName" || n == "AttentionIconName") return g_variant_new_string("");
  if (n == "ToolTip") {
    return g_variant_new("(s@a(iiay)ss)", "", noPixmaps(), (t.tooltip.empty() ? icon->title() : t.tooltip).c_str(), "");
  }
  if (n == "ItemIsMenu") return g_variant_new_boolean(t.menu.has_value());
  if (n == "Menu") return g_variant_new_object_path(t.menu ? kMenuPath : "/NO_DBUSMENU");
  g_set_error(error, G_DBUS_ERROR, G_DBUS_ERROR_UNKNOWN_PROPERTY, "No property %s", name);
  return nullptr;
}

void itemCall(GDBusConnection *, const gchar *, const gchar *, const gchar *, const gchar *method, GVariant *, GDBusMethodInvocation *invocation, gpointer data) {
  auto icon = iconOf(data);
  // A click on an icon with no menu presses it; with one, the host opens the menu instead.
  if (icon && g_str_equal(method, "Activate") && !icon->icon.menu && icon->events->press) {
    icon->events->press(icon->icon.id);
  }
  g_dbus_method_invocation_return_value(invocation, nullptr);
}

GVariant *menuProperty(GDBusConnection *, const gchar *, const gchar *, const gchar *, const gchar *name, GError **error, gpointer) {
  std::string n = name;
  if (n == "Version") return g_variant_new_uint32(3);
  if (n == "TextDirection") return g_variant_new_string(gtk_widget_get_default_direction() == GTK_TEXT_DIR_RTL ? "rtl" : "ltr");
  if (n == "Status") return g_variant_new_string("normal");
  if (n == "IconThemePath") return g_variant_new_strv(nullptr, 0);
  g_set_error(error, G_DBUS_ERROR, G_DBUS_ERROR_UNKNOWN_PROPERTY, "No property %s", name);
  return nullptr;
}

// A click on a menu item: the item the app knows, if it names one.
bool menuEvent(const Icon &icon, gint32 id, const char *eventId) {
  const DbusMenuNode *node = findDbusMenuNode(icon.layout, id);
  if (!node) {
    return false;
  }
  if (!g_str_equal(eventId, "clicked") || !node->enabled) {
    return true;
  }
  if (node->command != MenuCommand::AppItem) {
    if (icon.events->command) {
      icon.events->command(node->command);
    }
  } else if (!node->itemId.empty() && icon.events->menuSelect) {
    icon.events->menuSelect(icon.icon.id, node->itemId);
  }
  return true;
}

void menuCall(GDBusConnection *, const gchar *, const gchar *, const gchar *, const gchar *method, GVariant *args, GDBusMethodInvocation *invocation, gpointer data) {
  auto icon = iconOf(data);
  if (!icon) {
    g_dbus_method_invocation_return_dbus_error(invocation, "org.freedesktop.DBus.Error.UnknownObject", "The icon is gone");
    return;
  }
  std::string m = method;
  auto unknown = [invocation](gint32 id) {
    g_dbus_method_invocation_return_error(invocation, G_DBUS_ERROR, G_DBUS_ERROR_INVALID_ARGS, "No menu item %d", id);
  };
  if (m == "GetLayout") {
    gint32 parent = 0, depth = -1;
    g_variant_get(args, "(ii^a&s)", &parent, &depth, nullptr);
    const DbusMenuNode *node = findDbusMenuNode(icon->layout, parent);
    if (!node) {
      unknown(parent);
      return;
    }
    g_dbus_method_invocation_return_value(invocation, g_variant_new("(u@(ia{sv}av))", icon->revision, layoutOf(*node, depth, parent == 0)));
  } else if (m == "GetGroupProperties") {
    GVariantIter *ids = nullptr;
    g_variant_get(args, "(aias)", &ids, nullptr);
    GVariantBuilder out;
    g_variant_builder_init(&out, G_VARIANT_TYPE("a(ia{sv})"));
    gint32 id = 0;
    bool any = false;
    while (g_variant_iter_next(ids, "i", &id)) {
      any = true;
      if (const DbusMenuNode *node = findDbusMenuNode(icon->layout, id)) {
        g_variant_builder_add(&out, "(i@a{sv})", id, nodeProperties(*node, id == 0));
      }
    }
    // dbusmenu: no ids asks for every item.
    if (!any) {
      std::function<void(const DbusMenuNode &)> all = [&](const DbusMenuNode &node) {
        g_variant_builder_add(&out, "(i@a{sv})", node.id, nodeProperties(node, node.id == 0));
        for (const auto &child : node.children) all(child);
      };
      all(icon->layout);
    }
    g_variant_iter_free(ids);
    g_dbus_method_invocation_return_value(invocation, g_variant_new("(@a(ia{sv}))", g_variant_builder_end(&out)));
  } else if (m == "GetProperty") {
    gint32 id = 0;
    const gchar *name = nullptr;
    g_variant_get(args, "(i&s)", &id, &name);
    const DbusMenuNode *node = findDbusMenuNode(icon->layout, id);
    GVariant *props = node ? g_variant_ref_sink(nodeProperties(*node, id == 0)) : nullptr;
    GVariant *value = props ? g_variant_lookup_value(props, name, nullptr) : nullptr;
    if (props) {
      g_variant_unref(props);
    }
    if (!value) {
      unknown(id);
      return;
    }
    g_dbus_method_invocation_return_value(invocation, g_variant_new("(v)", value));
    g_variant_unref(value);
  } else if (m == "Event") {
    gint32 id = 0;
    const gchar *eventId = nullptr;
    g_variant_get(args, "(i&svu)", &id, &eventId, nullptr, nullptr);
    if (!menuEvent(*icon, id, eventId)) {
      unknown(id);
      return;
    }
    g_dbus_method_invocation_return_value(invocation, nullptr);
  } else if (m == "EventGroup") {
    GVariantIter *events = nullptr;
    g_variant_get(args, "(a(isvu))", &events);
    GVariantBuilder errors;
    g_variant_builder_init(&errors, G_VARIANT_TYPE("ai"));
    gint32 id = 0;
    const gchar *eventId = nullptr;
    while (g_variant_iter_next(events, "(i&svu)", &id, &eventId, nullptr, nullptr)) {
      if (!menuEvent(*icon, id, eventId)) {
        g_variant_builder_add(&errors, "i", id);
      }
    }
    g_variant_iter_free(events);
    g_dbus_method_invocation_return_value(invocation, g_variant_new("(@ai)", g_variant_builder_end(&errors)));
  } else if (m == "AboutToShow") {
    g_dbus_method_invocation_return_value(invocation, g_variant_new("(b)", FALSE));
  } else {
    g_dbus_method_invocation_return_value(invocation, g_variant_new("(@ai@ai)", g_variant_new_array(G_VARIANT_TYPE_INT32, nullptr, 0),
                                                                    g_variant_new_array(G_VARIANT_TYPE_INT32, nullptr, 0)));
  }
}

const GDBusInterfaceVTable kItemVTable{.method_call = itemCall, .get_property = itemProperty};
const GDBusInterfaceVTable kMenuVTable{.method_call = menuCall, .get_property = menuProperty};

void freeRef(gpointer data) {
  delete static_cast<IconRef *>(data);
}

class Tray final : public TrayBackend, public std::enable_shared_from_this<Tray> {
 public:
  Tray(std::string appId, TrayEvents events) : appId_(std::move(appId)), events_(std::move(events)) {}

  ~Tray() override {
    if (watch_) {
      g_bus_unwatch_name(watch_);
    }
    if (styleChanged_) {
      g_signal_handler_disconnect(adw_style_manager_get_default(), styleChanged_);
    }
  }

  // The watcher, given every icon each time it appears.
  void start() {
    watch_ = g_bus_watch_name(
        G_BUS_TYPE_SESSION, kStatusNotifierWatcher, G_BUS_NAME_WATCHER_FLAGS_NONE,
        [](GDBusConnection *, const gchar *, const gchar *, gpointer data) {
          auto *self = static_cast<Tray *>(data);
          self->watcher_ = true;
          for (auto &[id, icon] : self->icons_) {
            registerIcon(*icon);
          }
        },
        [](GDBusConnection *, const gchar *, gpointer data) { static_cast<Tray *>(data)->watcher_ = false; }, this, nullptr);
    // An SVG icon is drawn in a colour that can follow the style, so a change draws it again.
    if (adw_is_initialized()) {
      styleChanged_ = g_signal_connect_swapped(
          adw_style_manager_get_default(), "notify::dark", G_CALLBACK(+[](Tray *self) { self->redrawSvgIcons(); }), this);
    }
  }

  // Tell the hosts to draw each SVG icon, and each menu holding one, again.
  void redrawSvgIcons() {
    for (auto &[id, icon] : icons_) {
      if (icon->drawsSvg()) {
        icon->emit("org.kde.StatusNotifierItem", kItemPath, "NewIcon", nullptr);
      }
      if (hasSvgIcon(icon->layout)) {
        icon->emit("com.canonical.dbusmenu", kMenuPath, "LayoutUpdated", g_variant_new("(ui)", ++icon->revision, 0));
      }
    }
  }

  void setIcons(std::vector<TrayIcon> icons) override {
    onMainContext([weak = weak_from_this(), icons = std::move(icons)]() mutable {
      if (auto self = weak.lock()) {
        self->apply(std::move(icons));
      }
    });
  }

 private:
  static void registerIcon(const Icon &icon) {
    g_dbus_connection_call(
        icon.connection, kStatusNotifierWatcher, "/StatusNotifierWatcher", kStatusNotifierWatcher, "RegisterStatusNotifierItem",
        g_variant_new("(s)", kItemPath), nullptr, G_DBUS_CALL_FLAGS_NONE, -1, nullptr, nullptr, nullptr);
  }

  std::shared_ptr<Icon> make(const TrayIcon &spec) {
    GError *error = nullptr;
    gchar *address = g_dbus_address_get_for_bus_sync(G_BUS_TYPE_SESSION, nullptr, &error);
    GDBusConnection *connection = address ? g_dbus_connection_new_for_address_sync(
        address, static_cast<GDBusConnectionFlags>(G_DBUS_CONNECTION_FLAGS_AUTHENTICATION_CLIENT | G_DBUS_CONNECTION_FLAGS_MESSAGE_BUS_CONNECTION),
        nullptr, nullptr, &error) : nullptr;
    g_free(address);
    if (!connection) {
      fprintf(stderr, "[ngn] tray icon %s: %s\n", spec.id.c_str(), error ? error->message : "no session bus");
      g_clear_error(&error);
      return nullptr;
    }
    auto icon = std::make_shared<Icon>();
    icon->icon = spec;
    icon->appId = appId_;
    icon->connection = connection;
    icon->events = &events_;
    icon->layout = dbusMenuLayout(spec.menu.value_or(std::vector<MenuItem>{}));
    icon->item = g_dbus_connection_register_object(connection, kItemPath, itemInterface(), &kItemVTable, new IconRef(icon), freeRef, nullptr);
    icon->menu = g_dbus_connection_register_object(connection, kMenuPath, menuInterface(), &kMenuVTable, new IconRef(icon), freeRef, nullptr);
    if (watcher_) {
      registerIcon(*icon);
    }
    return icon;
  }

  // The new set: an icon whose id was there before keeps its connection and tells the host what
  // changed; one gone closes its connection.
  void apply(std::vector<TrayIcon> icons) {
    std::map<std::string, std::shared_ptr<Icon>> next;
    for (const auto &spec : icons) {
      auto it = icons_.find(spec.id);
      if (it == icons_.end()) {
        if (auto icon = make(spec)) {
          next[spec.id] = std::move(icon);
        }
        continue;
      }
      auto icon = it->second;
      if (!(icon->icon == spec)) {
        auto layout = dbusMenuLayout(spec.menu.value_or(std::vector<MenuItem>{}));
        bool relaid = !(layout == icon->layout);
        bool menuChanged = icon->icon.menu.has_value() != spec.menu.has_value();
        icon->icon = spec;
        icon->layout = std::move(layout);
        for (const char *signal : {"NewTitle", "NewIcon", "NewToolTip"}) {
          icon->emit("org.kde.StatusNotifierItem", kItemPath, signal, nullptr);
        }
        icon->emit("org.kde.StatusNotifierItem", kItemPath, "NewStatus", g_variant_new("(s)", "Active"));
        if (menuChanged) {
          // Menu and ItemIsMenu follow whether there is a menu, which no New* signal tells a host to reread.
          GVariantBuilder changed;
          g_variant_builder_init(&changed, G_VARIANT_TYPE("a{sv}"));
          g_variant_builder_add(&changed, "{sv}", "Menu", g_variant_new_object_path(spec.menu ? kMenuPath : "/NO_DBUSMENU"));
          g_variant_builder_add(&changed, "{sv}", "ItemIsMenu", g_variant_new_boolean(spec.menu.has_value()));
          icon->emit("org.freedesktop.DBus.Properties", kItemPath, "PropertiesChanged",
                     g_variant_new("(sa{sv}as)", "org.kde.StatusNotifierItem", &changed, nullptr));
        }
        if (relaid) {
          icon->emit("com.canonical.dbusmenu", kMenuPath, "LayoutUpdated", g_variant_new("(ui)", ++icon->revision, 0));
        }
      }
      next[spec.id] = std::move(icon);
    }
    icons_ = std::move(next);
  }

  std::string appId_;
  TrayEvents events_;
  guint watch_{0};
  gulong styleChanged_{0};
  bool watcher_{false};
  std::map<std::string, std::shared_ptr<Icon>> icons_;
};

} // namespace

bool statusNotifierWatcherRunning() {
  GDBusConnection *bus = g_bus_get_sync(G_BUS_TYPE_SESSION, nullptr, nullptr);
  if (!bus) {
    return false;
  }
  GVariant *reply = g_dbus_connection_call_sync(
      bus, "org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "NameHasOwner",
      g_variant_new("(s)", kStatusNotifierWatcher), G_VARIANT_TYPE("(b)"), G_DBUS_CALL_FLAGS_NONE, 1000, nullptr, nullptr);
  g_object_unref(bus);
  if (!reply) {
    return false;
  }
  gboolean owned = FALSE;
  g_variant_get(reply, "(b)", &owned);
  g_variant_unref(reply);
  return owned;
}

std::shared_ptr<TrayBackend> makeStatusNotifierTray(const std::string &appId, TrayEvents events) {
  auto tray = std::make_shared<Tray>(appId, std::move(events));
  tray->start();
  return tray;
}

} // namespace ngn::gtk
