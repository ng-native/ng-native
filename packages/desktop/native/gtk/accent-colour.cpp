#include "accent-colour.h"

#include "settings-portal.h"

#include <adwaita.h>

namespace ngn::gtk {

AccentFollower::AccentFollower() {
  if (adw_get_major_version() > 1 || adw_get_minor_version() >= 6) {
    return;
  }
  portal_ = std::make_unique<SettingsPortal>(std::vector<std::string>{"accent-color"}, [this](const std::string &, GVariant *value) {
    GVariant *color = portalValue(value);
    accent_.reset();
    if (color && g_variant_is_of_type(color, G_VARIANT_TYPE("(ddd)"))) {
      Rgb rgb;
      g_variant_get(color, "(ddd)", &rgb.red, &rgb.green, &rgb.blue);
      accent_ = rgb;
    }
    if (color) {
      g_variant_unref(color);
    }
    apply();
  });
  g_signal_connect_swapped(adw_style_manager_get_default(), "notify::dark", G_CALLBACK(+[](AccentFollower *self) { self->apply(); }), this);
}

AccentFollower::~AccentFollower() {
  if (portal_) {
    g_signal_handlers_disconnect_by_data(adw_style_manager_get_default(), this);
  }
  if (provider_) {
    if (GdkDisplay *display = gdk_display_get_default()) {
      gtk_style_context_remove_provider_for_display(display, GTK_STYLE_PROVIDER(provider_));
    }
    g_clear_object(&provider_);
  }
}

void AccentFollower::apply() {
  bool dark = adw_style_manager_get_dark(adw_style_manager_get_default());
  auto colors = accent_ ? accentColors(*accent_, dark) : std::nullopt;
  css_ = colors ? accentCss(*colors) : std::string();
  GdkDisplay *display = gdk_display_get_default();
  if (!display) {
    return;
  }
  if (!provider_) {
    provider_ = gtk_css_provider_new();
    // Over libadwaita's stylesheet (the theme's priority), under the app's own CSS.
    gtk_style_context_add_provider_for_display(display, GTK_STYLE_PROVIDER(provider_), GTK_STYLE_PROVIDER_PRIORITY_THEME + 1);
  }
  gtk_css_provider_load_from_data(provider_, css_.c_str(), -1);
}

} // namespace ngn::gtk
