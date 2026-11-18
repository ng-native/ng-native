// The role a toolkit whose roles are WAI-ARIA's gives a view: GTK 4's GtkAccessibleRole, which a
// backend maps one to one. Keyed on the role name React Native goes by (roleName), not on AxRole,
// which is AppKit's shape: ARIA keeps distinctions AppKit has no role for (a landmark, a table and
// a grid, a toggle button), so the AppKit table would lose them on the way.
//
// Where ARIA's toolkit roles have no counterpart, the nearest stands in (complementary and
// contentinfo are a region, figure a group, term a label, summary a button), and the role
// description that AppKit would speak is dropped: AT-SPI does not pass one on, so a label has to
// say it.
#pragma once

#include "ngn/accessibility.h"

#include <string>

namespace ngn {

enum class AriaRole {
  // A view that is no element of its own: its children are read in its place.
  Generic,
  // An author's role="none" and role="presentation".
  None,
  Presentation,
  Alert,
  AlertDialog,
  // GTK 4.14's ARTICLE; a toolkit without it takes Group.
  Article,
  Banner,
  Button,
  Cell,
  Checkbox,
  ColumnHeader,
  ComboBox,
  Dialog,
  Document,
  Feed,
  Form,
  Grid,
  GridCell,
  Group,
  Heading,
  Img,
  // Static text.
  Label,
  Link,
  List,
  ListBox,
  ListItem,
  Log,
  Main,
  Marquee,
  Math,
  Menu,
  MenuBar,
  MenuItem,
  MenuItemCheckbox,
  MenuItemRadio,
  Meter,
  Navigation,
  Note,
  Option,
  ProgressBar,
  Radio,
  RadioGroup,
  Region,
  Row,
  RowGroup,
  RowHeader,
  Scrollbar,
  SearchBox,
  Separator,
  Slider,
  SpinButton,
  Status,
  Switch,
  Tab,
  TabList,
  TabPanel,
  Table,
  Timer,
  ToggleButton,
  Toolbar,
  Tooltip,
  Tree,
  TreeGrid,
  TreeItem,
};

// The role of a view whose role name is `name` (roleName, empty for none) and whose accessibility
// the core read as `info` (accessibilityInfo, or paragraphAccessibilityInfo for a Paragraph).
// `none` and `presentation` are their own roles; any other view that is no element is Generic. An
// element with no role name, or one this table does not know, is static text when the core reads
// it as text (a Paragraph) and a group otherwise.
AriaRole ariaRole(const std::string &name, const AxInfo &info);

} // namespace ngn
