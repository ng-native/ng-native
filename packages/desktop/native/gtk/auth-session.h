// WebBrowser.openAuthSessionAsync on GTK (the core's LinkAuthSession, web-browser.h): the page
// opens in the user's browser through the OpenURI portal, or GTK's launcher where no portal
// answers, and the session ends on the link back on its scheme, which the desktop hands the
// running app (GApplication's open: a second launch or D-Bus activation). Meanwhile a dialog over
// the front window says the sign-in goes on in the browser, and its Cancel cancels the session.
#pragma once

#include "ngn/web-browser.h"

#include <memory>

namespace ngn::gtk {

std::shared_ptr<LinkAuthSession> makeAuthSession();

} // namespace ngn::gtk
