#include "ngn/aria-role.h"

#include <unordered_map>

namespace ngn {

namespace {

// Every role name roleName gives: React Native's Role (ARIA's), its accessibilityRole values, and
// the ARIA roles Role lacks that the desktop props keep as written.
const std::unordered_map<std::string, AriaRole> &roles() {
  static const std::unordered_map<std::string, AriaRole> table{
      // React Native's Role.
      {"alert", AriaRole::Alert},
      {"alertdialog", AriaRole::AlertDialog},
      // GTK's APPLICATION is an AT-SPI frame, which would nest a frame in the window.
      {"application", AriaRole::Group},
      {"article", AriaRole::Article},
      {"banner", AriaRole::Banner},
      {"button", AriaRole::Button},
      {"cell", AriaRole::Cell},
      {"checkbox", AriaRole::Checkbox},
      {"columnheader", AriaRole::ColumnHeader},
      {"combobox", AriaRole::ComboBox},
      {"complementary", AriaRole::Region},
      {"contentinfo", AriaRole::Region},
      {"definition", AriaRole::Generic},
      {"dialog", AriaRole::Dialog},
      {"directory", AriaRole::List},
      {"document", AriaRole::Document},
      {"feed", AriaRole::Feed},
      {"figure", AriaRole::Group},
      {"form", AriaRole::Form},
      {"grid", AriaRole::Grid},
      {"group", AriaRole::Group},
      {"heading", AriaRole::Heading},
      {"img", AriaRole::Img},
      {"link", AriaRole::Link},
      {"list", AriaRole::List},
      {"listitem", AriaRole::ListItem},
      {"log", AriaRole::Log},
      {"main", AriaRole::Main},
      {"marquee", AriaRole::Marquee},
      {"math", AriaRole::Math},
      {"menu", AriaRole::Menu},
      {"menubar", AriaRole::MenuBar},
      {"menuitem", AriaRole::MenuItem},
      {"meter", AriaRole::Meter},
      {"navigation", AriaRole::Navigation},
      {"none", AriaRole::None},
      {"note", AriaRole::Note},
      {"option", AriaRole::Option},
      {"presentation", AriaRole::Presentation},
      {"progressbar", AriaRole::ProgressBar},
      {"radio", AriaRole::Radio},
      {"radiogroup", AriaRole::RadioGroup},
      {"region", AriaRole::Region},
      {"row", AriaRole::Row},
      {"rowgroup", AriaRole::RowGroup},
      {"rowheader", AriaRole::RowHeader},
      {"scrollbar", AriaRole::Scrollbar},
      {"searchbox", AriaRole::SearchBox},
      {"separator", AriaRole::Separator},
      {"slider", AriaRole::Slider},
      {"spinbutton", AriaRole::SpinButton},
      {"status", AriaRole::Status},
      {"summary", AriaRole::Button},
      {"switch", AriaRole::Switch},
      {"tab", AriaRole::Tab},
      {"table", AriaRole::Table},
      {"tablist", AriaRole::TabList},
      {"tabpanel", AriaRole::TabPanel},
      {"term", AriaRole::Label},
      {"timer", AriaRole::Timer},
      {"toolbar", AriaRole::Toolbar},
      {"tooltip", AriaRole::Tooltip},
      {"tree", AriaRole::Tree},
      {"treegrid", AriaRole::TreeGrid},
      {"treeitem", AriaRole::TreeItem},
      // React Native's accessibilityRole values Role does not have.
      {"togglebutton", AriaRole::ToggleButton},
      // A search field, not ARIA's search landmark.
      {"search", AriaRole::SearchBox},
      {"image", AriaRole::Img},
      {"text", AriaRole::Label},
      {"adjustable", AriaRole::Slider},
      {"imagebutton", AriaRole::Button},
      {"header", AriaRole::Heading},
      {"tabbar", AriaRole::TabList},
      {"viewgroup", AriaRole::Generic},
      {"keyboardkey", AriaRole::Button},
      {"pager", AriaRole::Group},
      // The scrolling widget is the scroll pane.
      {"scrollview", AriaRole::Generic},
      {"horizontalscrollview", AriaRole::Generic},
      {"webview", AriaRole::Document},
      {"drawerlayout", AriaRole::Group},
      {"slidingdrawer", AriaRole::Group},
      {"iconmenu", AriaRole::Menu},
      // ARIA roles Role lacks, kept as written (DesktopProps::role).
      {"listbox", AriaRole::ListBox},
      {"gridcell", AriaRole::GridCell},
      {"menuitemcheckbox", AriaRole::MenuItemCheckbox},
      {"menuitemradio", AriaRole::MenuItemRadio},
  };
  return table;
}

} // namespace

AriaRole ariaRole(const std::string &name, const AxInfo &info) {
  if (name == "none") {
    return AriaRole::None;
  }
  if (name == "presentation") {
    return AriaRole::Presentation;
  }
  if (!info.element) {
    return AriaRole::Generic;
  }
  if (auto it = roles().find(name); it != roles().end()) {
    return it->second;
  }
  return info.role == AxRole::StaticText ? AriaRole::Label : AriaRole::Group;
}

} // namespace ngn
