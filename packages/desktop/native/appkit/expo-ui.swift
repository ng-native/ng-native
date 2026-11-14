// The SwiftUI half of `@expo/ui` on macOS: a HostView's tree (ngn/expo-ui.h) drawn as the SwiftUI
// views expo/ui draws for the same names and props on iOS, in an NSHostingController's view, behind
// a C interface that expo-ui-view.mm adapts to the HostView's NGNView.
//
// The tree arrives as JSON: `{tag, name, props, children}` per view. A control keeps what the user
// set until its prop changes, as expo/ui's views keep `@State` seeded from their props, and sends
// its event at once from the binding's setter, with expo/ui's iOS event name and payload.
// `ngn_ui_host_perform` acts on a control as the user would, through the same path.
import AppKit
import Charts
import SwiftUI

// The context, the view's tag, the event's name (expo/ui's, without `on`) and its payload as JSON.
public typealias NGNUIEvent = @convention(c) (UnsafeMutableRawPointer?, Int32, UnsafePointer<CChar>, UnsafePointer<CChar>) -> Void
// The context and an RNHostView's tag: its NSView, unretained, or null.
public typealias NGNUIViewForTag = @convention(c) (UnsafeMutableRawPointer?, Int32) -> UnsafeMutableRawPointer?

// MARK: - The tree

final class UINode {
  let tag: Int
  let name: String
  let props: [String: Any]
  let children: [UINode]

  init?(_ json: Any) {
    guard let object = json as? [String: Any], let tag = object["tag"] as? Int, let name = object["name"] as? String else {
      return nil
    }
    self.tag = tag
    self.name = name
    props = object["props"] as? [String: Any] ?? [:]
    children = (object["children"] as? [Any] ?? []).compactMap(UINode.init)
  }

  func string(_ key: String) -> String? { props[key] as? String }
  func number(_ key: String) -> Double? { (props[key] as? NSNumber).flatMap { $0 is Bool ? nil : $0.doubleValue } }
  func bool(_ key: String) -> Bool? { (props[key] as? NSNumber).map(\.boolValue) }

  var modifiers: [[String: Any]] { props["modifiers"] as? [[String: Any]] ?? [] }
  var isSlot: Bool { name == "SlotView" }
  var slotName: String? { isSlot ? string("name") : nil }

  func slot(_ name: String) -> UINode? { children.first { $0.slotName == name } }
  var withoutSlots: [UINode] { children.filter { !$0.isSlot } }

  func find(_ tag: Int) -> UINode? {
    if self.tag == tag { return self }
    for child in children {
      if let found = child.find(tag) { return found }
    }
    return nil
  }

  func all(_ into: inout [Int: UINode]) {
    into[tag] = self
    children.forEach { $0.all(&into) }
  }
}

final class UIStore: ObservableObject {
  @Published private(set) var root: UINode?
  // What the user set on a view, by tag and prop, until the prop changes.
  private var local: [Int: [String: Any]] = [:]
  var emit: (Int, String, [String: Any]) -> Void = { _, _, _ in }
  var viewForTag: (Int) -> NSView? = { _ in nil }

  func set(_ root: UINode?) {
    var before: [Int: UINode] = [:]
    self.root?.all(&before)
    var after: [Int: UINode] = [:]
    root?.all(&after)
    for (tag, values) in local {
      guard let now = after[tag], let was = before[tag] else {
        local[tag] = nil
        continue
      }
      for key in values.keys where !same(was.props[key], now.props[key]) {
        local[tag]?[key] = nil
      }
    }
    self.root = root
  }

  private func same(_ a: Any?, _ b: Any?) -> Bool {
    switch (a, b) {
    case (nil, nil): return true
    case let (a?, b?): return (a as AnyObject).isEqual(b)
    default: return false
    }
  }

  func value(_ node: UINode, _ key: String) -> Any? { local[node.tag]?[key] ?? node.props[key] }

  // The user set `key`: kept, drawn and sent as `event` with `payload`.
  func user(_ node: UINode, _ key: String, _ value: Any, event: String, payload: [String: Any]) {
    local[node.tag, default: [:]][key] = value
    objectWillChange.send()
    emit(node.tag, event, payload)
  }
}

// MARK: - Values

func uiColor(_ value: Any?) -> Color? {
  if let number = value as? NSNumber, !(number is Bool) {
    // React Native's processed colour: 0xAARRGGBB.
    let argb = number.uint32Value
    return Color(.sRGB, red: Double((argb >> 16) & 0xff) / 255, green: Double((argb >> 8) & 0xff) / 255,
                 blue: Double(argb & 0xff) / 255, opacity: Double((argb >> 24) & 0xff) / 255)
  }
  guard let text = (value as? String)?.trimmingCharacters(in: .whitespaces).lowercased() else { return nil }
  if text.hasPrefix("#") {
    var hex = String(text.dropFirst())
    if hex.count == 3 || hex.count == 4 { hex = hex.map { "\($0)\($0)" }.joined() }
    guard hex.count == 6 || hex.count == 8, let raw = UInt64(hex, radix: 16) else { return nil }
    let rgba = hex.count == 6 ? (raw << 8) | 0xff : raw
    return Color(.sRGB, red: Double((rgba >> 24) & 0xff) / 255, green: Double((rgba >> 16) & 0xff) / 255,
                 blue: Double((rgba >> 8) & 0xff) / 255, opacity: Double(rgba & 0xff) / 255)
  }
  let named: [String: Color] = [
    "red": .red, "orange": .orange, "yellow": .yellow, "green": .green, "mint": .mint, "teal": .teal, "cyan": .cyan,
    "blue": .blue, "indigo": .indigo, "purple": .purple, "pink": .pink, "brown": .brown, "white": .white,
    "gray": .gray, "grey": .gray, "black": .black, "clear": .clear, "transparent": .clear, "primary": .primary,
    "secondary": .secondary, "accentcolor": .accentColor,
  ]
  return named[text]
}

func uiHex(_ color: Color) -> String {
  let ns = NSColor(color).usingColorSpace(.sRGB) ?? .black
  let parts = [ns.redComponent, ns.greenComponent, ns.blueComponent, ns.alphaComponent].map { Int(($0 * 255).rounded()) }
  return String(format: "#%02X%02X%02X%02X", parts[0], parts[1], parts[2], parts[3])
}

func uiDate(_ value: Any?) -> Date? {
  if let number = value as? NSNumber, !(number is Bool) { return Date(timeIntervalSince1970: number.doubleValue / 1000) }
  guard let text = value as? String else { return nil }
  let full = ISO8601DateFormatter()
  full.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  return full.date(from: text) ?? ISO8601DateFormatter().date(from: text)
}

func uiAlignment(_ value: Any?) -> Alignment {
  switch value as? String {
  case "leading": return .leading
  case "trailing": return .trailing
  case "top": return .top
  case "bottom": return .bottom
  case "topLeading": return .topLeading
  case "topTrailing": return .topTrailing
  case "bottomLeading": return .bottomLeading
  case "bottomTrailing": return .bottomTrailing
  default: return .center
  }
}

func uiHorizontal(_ value: Any?) -> HorizontalAlignment {
  switch value as? String {
  case "leading": return .leading
  case "trailing": return .trailing
  default: return .center
  }
}

func uiVertical(_ value: Any?) -> VerticalAlignment {
  switch value as? String {
  case "top": return .top
  case "bottom": return .bottom
  case "firstTextBaseline": return .firstTextBaseline
  case "lastTextBaseline": return .lastTextBaseline
  default: return .center
  }
}

func uiCGFloat(_ value: Any?) -> CGFloat? {
  guard let number = value as? NSNumber, !(number is Bool) else { return nil }
  return CGFloat(number.doubleValue)
}

// A frame's length: a number, with an infinite one (`Infinity` arrives as a huge number or null).
func uiLength(_ value: Any?) -> CGFloat? {
  guard let length = uiCGFloat(value) else { return nil }
  return length >= 1e10 ? .infinity : length
}

// A Picker's selection and its options' tags as one type: a string, or a number.
func uiTag(_ value: Any?) -> String? {
  if let text = value as? String { return "s:" + text }
  if let number = value as? NSNumber, !(number is Bool) { return "n:\(number.doubleValue)" }
  return nil
}

func uiTagValue(_ tag: String) -> Any {
  tag.hasPrefix("n:") ? (Double(tag.dropFirst(2)) ?? 0) as Any : String(tag.dropFirst(2)) as Any
}

// MARK: - Views

struct UIChildren: View {
  let nodes: [UINode]
  @ObservedObject var store: UIStore
  var body: some View {
    ForEach(nodes, id: \.tag) { UINodeView(node: $0, store: store) }
  }
}

struct UINodeView: View {
  let node: UINode
  @ObservedObject var store: UIStore

  var body: some View {
    uiModified(uiContent(node, store), node.modifiers)
  }
}

// What each name draws: the views `kExpoUIViews` lists (core/src/expo-ui.cpp).
let uiDrawn: Set<String> = [
  "AlertView", "BackgroundView", "BottomSheetView", "Button", "CapsuleView", "ChartView", "CircleView",
  "ColorPickerView", "ConfirmationDialogView", "ContentUnavailableView", "ContextMenu", "ControlGroupView",
  "DatePickerView", "DisclosureGroupView", "DividerView", "EllipseView", "FormView", "GaugeView",
  "GlassEffectContainerView", "GridView", "GridRowView", "GroupView", "HostView", "HStackView", "ImageView", "LabelView",
  "LabeledContentView", "LazyHStackView", "LazyVStackView", "LinkView", "ListView", "MaskView", "MenuView",
  "NavigationStackView", "OverlayView", "PickerView", "PopoverView", "ProgressView", "RectangleView", "RNHostView",
  "RoundedRectangleView", "ScrollViewComponent", "SectionView", "SecureFieldView", "ShareLinkView", "SliderView",
  "SlotView", "SpacerView", "StepperView", "SwipeActionsView", "TabView", "TextFieldView", "TextView", "ToggleView",
  "UnevenRoundedRectangleView", "VStackView", "ZStackView",
]

func uiContent(_ node: UINode, _ store: UIStore) -> AnyView {
  let all = UIChildren(nodes: node.children, store: store)
  let unslotted = UIChildren(nodes: node.withoutSlots, store: store)
  func slot(_ name: String) -> UIChildren? { node.slot(name).map { UIChildren(nodes: $0.children, store: store) } }

  switch node.name {
  case "HostView", "SlotView", "GroupView":
    return AnyView(Group { all })
  case "VStackView":
    return AnyView(VStack(alignment: uiHorizontal(node.props["alignment"]), spacing: uiCGFloat(node.props["spacing"])) { all })
  case "HStackView":
    return AnyView(HStack(alignment: uiVertical(node.props["alignment"]), spacing: uiCGFloat(node.props["spacing"])) { all })
  case "ZStackView":
    return AnyView(ZStack(alignment: uiAlignment(node.props["alignment"])) { all })
  case "LazyVStackView":
    return AnyView(LazyVStack(alignment: uiHorizontal(node.props["alignment"]), spacing: uiCGFloat(node.props["spacing"])) { all })
  case "LazyHStackView":
    return AnyView(LazyHStack(alignment: uiVertical(node.props["alignment"]), spacing: uiCGFloat(node.props["spacing"])) { all })
  case "GridView":
    return AnyView(Grid(alignment: uiAlignment(node.props["alignment"]), horizontalSpacing: uiCGFloat(node.props["horizontalSpacing"]),
                        verticalSpacing: uiCGFloat(node.props["verticalSpacing"])) { all })
  case "GridRowView":
    return AnyView(GridRow { all })
  case "SpacerView":
    return AnyView(Spacer(minLength: uiCGFloat(node.props["minLength"])))
  case "DividerView":
    return AnyView(Divider())
  case "RectangleView":
    return AnyView(Rectangle())
  case "CircleView":
    return AnyView(Circle())
  case "EllipseView":
    return AnyView(Ellipse())
  case "CapsuleView":
    return AnyView(Capsule(style: node.string("cornerStyle") == "circular" ? .circular : .continuous))
  case "RoundedRectangleView":
    return AnyView(RoundedRectangle(cornerRadius: uiCGFloat(node.props["cornerRadius"]) ?? 0))
  case "UnevenRoundedRectangleView":
    return AnyView(UnevenRoundedRectangle(
      topLeadingRadius: uiCGFloat(node.props["topLeadingRadius"]) ?? 0,
      bottomLeadingRadius: uiCGFloat(node.props["bottomLeadingRadius"]) ?? 0,
      bottomTrailingRadius: uiCGFloat(node.props["bottomTrailingRadius"]) ?? 0,
      topTrailingRadius: uiCGFloat(node.props["topTrailingRadius"]) ?? 0))
  case "TextView":
    return AnyView(uiText(node))
  case "LabelView":
    if let title = slot("title"), let icon = slot("icon") {
      return AnyView(Label { title } icon: { icon })
    }
    if let systemImage = node.string("systemImage") {
      return AnyView(Label(node.string("title") ?? "", systemImage: systemImage))
    }
    return AnyView(Text(node.string("title") ?? ""))
  case "ImageView":
    return AnyView(uiImage(node, store))
  case "ButtonView", "Button":
    return AnyView(uiButton(node, store, all))
  case "LinkView":
    let destination = node.string("destination").flatMap(URL.init(string:)) ?? URL(string: "about:blank")!
    if let label = node.string("label") {
      return AnyView(Link(label, destination: destination))
    }
    return AnyView(Link(destination: destination) { all })
  case "ShareLinkView":
    let item = node.string("item").flatMap(URL.init(string:)) ?? URL(string: "about:blank")!
    let subject = node.string("subject").map { Text($0) }
    let message = node.string("message").map { Text($0) }
    if node.children.isEmpty {
      return AnyView(ShareLink(item: item, subject: subject, message: message))
    }
    return AnyView(ShareLink(item: item, subject: subject, message: message) { all })
  case "ToggleView":
    return AnyView(uiToggle(node, store, all))
  case "SliderView":
    return AnyView(uiSlider(node, store))
  case "StepperView":
    return AnyView(uiStepper(node, store))
  case "PickerView":
    return AnyView(uiPicker(node, store))
  case "DatePickerView":
    return AnyView(uiDatePicker(node, store, all))
  case "ColorPickerView":
    return AnyView(uiColorPicker(node, store))
  case "TextFieldView", "SecureFieldView":
    return AnyView(uiTextField(node, store))
  case "ProgressView":
    return AnyView(uiProgress(node, all))
  case "GaugeView":
    return AnyView(uiGauge(node, slot))
  case "FormView":
    return AnyView(Form { all })
  case "ListView":
    return AnyView(uiList(node, store, all))
  case "SectionView":
    return AnyView(uiSection(node, store, slot, unslotted))
  case "DisclosureGroupView":
    return AnyView(uiDisclosure(node, store, slot, unslotted))
  case "LabeledContentView":
    let content: AnyView = slot("content").map { AnyView($0) } ?? AnyView(unslotted)
    if let label = slot("label") {
      return AnyView(LabeledContent { content } label: { label })
    }
    return AnyView(LabeledContent(node.string("label") ?? "") { content })
  case "ControlGroupView":
    if let label = slot("label") {
      return AnyView(ControlGroup { unslotted } label: { label })
    }
    if let label = node.string("label") {
      return AnyView(ControlGroup(label) { unslotted })
    }
    return AnyView(ControlGroup { all })
  case "MenuView":
    return AnyView(uiMenu(node, store, slot))
  case "ContextMenu":
    let trigger: AnyView = slot("trigger").map { AnyView($0) } ?? AnyView(unslotted)
    let items = slot("items")
    return AnyView(trigger.contextMenu { items })
  case "ScrollViewComponent":
    let axes: Axis.Set = switch node.string("axes") {
    case "horizontal": .horizontal
    case "both": [.horizontal, .vertical]
    default: .vertical
    }
    return AnyView(ScrollView(axes, showsIndicators: node.bool("showsIndicators") ?? true) { all })
  case "NavigationStackView":
    return AnyView(NavigationStack { all })
  case "TabView":
    return AnyView(uiTabs(node, store))
  case "BackgroundView", "OverlayView", "MaskView":
    let base = AnyView(unslotted)
    let alignment = uiAlignment(node.props["alignment"])
    let content: AnyView = slot("content").map { AnyView($0) } ?? AnyView(EmptyView())
    return switch node.name {
    case "BackgroundView": AnyView(base.background(alignment: alignment) { content })
    case "OverlayView": AnyView(base.overlay(alignment: alignment) { content })
    default: AnyView(base.mask(alignment: alignment) { content })
    }
  case "AlertView", "ConfirmationDialogView":
    return AnyView(uiDialog(node, store, slot))
  case "PopoverView":
    return AnyView(uiPopover(node, store, slot))
  case "BottomSheetView":
    return AnyView(uiSheet(node, store))
  case "ContentUnavailableView":
    if #available(macOS 14, *) {
      return AnyView(ContentUnavailableView(node.string("title") ?? "", systemImage: node.string("systemImage") ?? "",
                                            description: node.string("description").map { Text($0) }))
    }
    return AnyView(VStack(spacing: 8) {
      Image(systemName: node.string("systemImage") ?? "").font(.largeTitle).foregroundStyle(.secondary)
      Text(node.string("title") ?? "").font(.title2).bold()
      if let description = node.string("description") { Text(description).foregroundStyle(.secondary) }
    })
  case "GlassEffectContainerView":
    #if compiler(>=6.2)
    if #available(macOS 26, *) {
      return AnyView(GlassEffectContainer(spacing: uiCGFloat(node.props["spacing"])) { all })
    }
    #endif
    return AnyView(Group { all })
  case "SwipeActionsView":
    return AnyView(uiSwipeActions(node, store))
  case "ChartView":
    return AnyView(uiChart(node))
  case "RNHostView":
    return AnyView(UIEmbedded(tag: node.tag, store: store))
  default:
    return AnyView(EmptyView())
  }
}

func uiText(_ node: UINode) -> Text {
  if let date = uiDate(node.props["date"]) {
    switch node.string("dateStyle") {
    case "time": return Text(date, style: .time)
    case "relative": return Text(date, style: .relative)
    case "offset": return Text(date, style: .offset)
    case "timer": return Text(date, style: .timer)
    default: return Text(date, style: .date)
    }
  }
  if let interval = node.props["timerInterval"] as? [String: Any], let lower = uiDate(interval["lower"]),
     let upper = uiDate(interval["upper"]), lower <= upper {
    return Text(timerInterval: lower...upper, countsDown: node.bool("countsDown") ?? true)
  }
  let text = node.string("text") ?? ""
  if node.bool("markdownEnabled") == true, let attributed = try? AttributedString(markdown: text) {
    return Text(attributed)
  }
  return Text(verbatim: text)
}

func uiImage(_ node: UINode, _ store: UIStore) -> some View {
  var image: Image
  if let name = node.string("systemName") {
    if let variable = node.number("variableValue") {
      image = Image(systemName: name, variableValue: variable)
    } else {
      image = Image(systemName: name)
    }
  } else if let uri = node.string("uiImage"), let url = URL(string: uri), let ns = NSImage(contentsOf: url) {
    image = Image(nsImage: ns)
  } else if let asset = node.string("assetName") {
    image = Image(asset)
  } else {
    image = Image(nsImage: NSImage())
  }
  if node.modifiers.contains(where: { $0["$type"] as? String == "resizable" }) {
    image = image.resizable()
  }
  return image.onTapGesture {
    if node.bool("useTapGesture") == true { store.emit(node.tag, "tap", [:]) }
  }
}

func uiButton(_ node: UINode, _ store: UIStore, _ all: UIChildren) -> some View {
  let role: ButtonRole? = switch node.string("role") {
  case "destructive": .destructive
  case "cancel": .cancel
  default: nil
  }
  let press = { store.emit(node.tag, "buttonPress", [:]) }
  if let label = node.string("label") {
    if let systemImage = node.string("systemImage") {
      return AnyView(Button(role: role, action: press) { Label(label, systemImage: systemImage) })
    }
    return AnyView(Button(label, role: role, action: press))
  }
  return AnyView(Button(role: role, action: press) { all })
}

func uiToggle(_ node: UINode, _ store: UIStore, _ all: UIChildren) -> some View {
  let isOn = Binding<Bool>(
    get: { (store.value(node, "isOn") as? Bool) ?? false },
    set: { store.user(node, "isOn", $0, event: "isOnChange", payload: ["isOn": $0]) })
  if let label = node.string("label") {
    if let systemImage = node.string("systemImage") {
      return AnyView(Toggle(isOn: isOn) { Label(label, systemImage: systemImage) })
    }
    return AnyView(Toggle(label, isOn: isOn))
  }
  return AnyView(Toggle(isOn: isOn) { all })
}

func uiSliderRange(_ node: UINode) -> ClosedRange<Double> {
  let low = max(node.number("min") ?? 0, node.number("lowerLimit") ?? -.infinity)
  let high = min(node.number("max") ?? 1, node.number("upperLimit") ?? .infinity)
  return low...max(low, high)
}

func uiSlider(_ node: UINode, _ store: UIStore) -> some View {
  let range = uiSliderRange(node)
  let value = Binding<Double>(
    get: { min(range.upperBound, max(range.lowerBound, ((store.value(node, "value") as? NSNumber)?.doubleValue) ?? 0)) },
    set: { uiSlide(node, store, $0) })
  let editing: (Bool) -> Void = { store.emit(node.tag, "editingChanged", ["isEditing": $0]) }
  let labels = (node.slot("label"), node.slot("minimum"), node.slot("maximum"))
  let label = UIChildren(nodes: labels.0?.children ?? [], store: store)
  let minimum = UIChildren(nodes: labels.1?.children ?? [], store: store)
  let maximum = UIChildren(nodes: labels.2?.children ?? [], store: store)
  if let step = node.number("step"), step > 0 {
    return AnyView(Slider(value: value, in: range, step: step, label: { label }, minimumValueLabel: { minimum },
                          maximumValueLabel: { maximum }, onEditingChanged: editing))
  }
  return AnyView(Slider(value: value, in: range, label: { label }, minimumValueLabel: { minimum },
                        maximumValueLabel: { maximum }, onEditingChanged: editing))
}

// The user moved the slider: expo/ui counts the events so a stale `value` prop is not applied.
func uiSlide(_ node: UINode, _ store: UIStore, _ raw: Double) {
  let range = uiSliderRange(node)
  let value = min(range.upperBound, max(range.lowerBound, raw))
  let count = ((store.value(node, "eventCount") as? Int) ?? 0) + 1
  store.user(node, "eventCount", count, event: "editingChanged", payload: ["isEditing": true])
  store.user(node, "value", value, event: "valueChanged", payload: ["value": value, "eventCount": count])
}

func uiStepper(_ node: UINode, _ store: UIStore) -> some View {
  let low = Int(node.number("min") ?? 0), high = Int(node.number("max") ?? 100)
  let value = Binding<Int>(
    get: { ((store.value(node, "value") as? NSNumber)?.intValue) ?? 0 },
    set: { store.user(node, "value", $0, event: "valueChange", payload: ["value": $0]) })
  return Stepper(node.string("label") ?? "", value: value, in: low...max(low, high), step: Int(node.number("step") ?? 1))
}

func uiPicker(_ node: UINode, _ store: UIStore) -> some View {
  let selection = Binding<String>(
    get: { uiTag(store.value(node, "selection")) ?? "" },
    set: { tag in
      guard tag != uiTag(store.value(node, "selection")) else { return }
      store.user(node, "selection", uiTagValue(tag), event: "selectionChange", payload: ["selection": uiTagValue(tag)])
    })
  let content = UIChildren(nodes: node.slot("content")?.children ?? [], store: store)
  if let label = node.slot("label") {
    return AnyView(Picker(selection: selection) { content } label: { UIChildren(nodes: label.children, store: store) })
  }
  let label = node.string("label") ?? ""
  if let systemImage = node.string("systemImage") {
    return AnyView(Picker(selection: selection) { content } label: { Label(label, systemImage: systemImage) })
  }
  return AnyView(Picker(label, selection: selection) { content })
}

func uiDatePicker(_ node: UINode, _ store: UIStore, _ all: UIChildren) -> some View {
  let date = Binding<Date>(
    get: { uiDate(store.value(node, "selection")) ?? Date() },
    set: { store.user(node, "selection", $0.timeIntervalSince1970 * 1000, event: "dateChange",
                      payload: ["date": $0.timeIntervalSince1970 * 1000]) })
  var components: DatePickerComponents = []
  for name in node.props["displayedComponents"] as? [String] ?? ["date"] {
    if name == "date" { components.insert(.date) }
    if name == "hourAndMinute" { components.insert(.hourAndMinute) }
  }
  let range = node.props["range"] as? [String: Any]
  let start = uiDate(range?["start"]), end = uiDate(range?["end"])
  let title = node.string("title") ?? ""
  let picker: AnyView
  if let start, let end, start <= end {
    picker = AnyView(DatePicker(title, selection: date, in: start...end, displayedComponents: components))
  } else if let start {
    picker = AnyView(DatePicker(title, selection: date, in: start..., displayedComponents: components))
  } else if let end {
    picker = AnyView(DatePicker(title, selection: date, in: ...end, displayedComponents: components))
  } else {
    picker = AnyView(DatePicker(title, selection: date, displayedComponents: components))
  }
  return node.string("title") == nil && node.children.isEmpty ? AnyView(picker.labelsHidden()) : picker
}

func uiColorPicker(_ node: UINode, _ store: UIStore) -> some View {
  let selection = Binding<Color>(
    get: { uiColor(store.value(node, "selection")) ?? .clear },
    set: { color in
      let hex = uiHex(color)
      store.user(node, "selection", hex, event: "selectionChange", payload: ["value": hex])
    })
  return ColorPicker(node.string("label") ?? "", selection: selection, supportsOpacity: node.bool("supportsOpacity") ?? true)
}

// A text field keeps what is typed: expo/ui's `text` is an ObservableState, which macOS has no
// module for, so a `text` given as a string is taken instead.
func uiTextField(_ node: UINode, _ store: UIStore) -> some View {
  let text = Binding<String>(
    get: { (store.value(node, "text") as? String) ?? "" },
    set: { value in
      var typed = value
      if let limit = node.number("maxLength"), limit >= 0 { typed = String(typed.prefix(Int(limit))) }
      store.user(node, "text", typed, event: "textChange", payload: ["value": typed])
    })
  let placeholder = node.string("placeholder") ?? ""
  if node.name == "SecureFieldView" {
    return AnyView(SecureField(placeholder, text: text))
  }
  return AnyView(TextField(placeholder, text: text, axis: node.string("axis") == "vertical" ? .vertical : .horizontal))
}

func uiProgress(_ node: UINode, _ all: UIChildren) -> some View {
  if let interval = node.props["timerInterval"] as? [String: Any], let lower = uiDate(interval["lower"]),
     let upper = uiDate(interval["upper"]), lower <= upper {
    return AnyView(ProgressView(timerInterval: lower...upper, countsDown: node.bool("countsDown") ?? true) { all })
  }
  if let value = node.number("value") {
    return AnyView(ProgressView(value: min(1, max(0, value))) { all })
  }
  return AnyView(ProgressView { all })
}

func uiGauge(_ node: UINode, _ slot: (String) -> UIChildren?) -> some View {
  let low = node.number("min") ?? 0, high = node.number("max") ?? 1
  let value = min(max(node.number("value") ?? 0, low), max(low, high))
  return Gauge(value: value, in: low...max(low, high)) {
    slot("label")
  } currentValueLabel: {
    slot("currentValue")
  } minimumValueLabel: {
    slot("minimumValue")
  } maximumValueLabel: {
    slot("maximumValue")
  }
}

func uiList(_ node: UINode, _ store: UIStore, _ all: UIChildren) -> some View {
  guard node.props["selection"] != nil else { return AnyView(List { all }) }
  let selection = Binding<Set<String>>(
    get: { Set(((store.value(node, "selection") as? [Any]) ?? []).compactMap(uiTag)) },
    set: { tags in
      let values = tags.sorted().map(uiTagValue)
      store.user(node, "selection", values, event: "selectionChange", payload: ["selection": values])
    })
  return AnyView(List(selection: selection) { all })
}

func uiSection(_ node: UINode, _ store: UIStore, _ slot: (String) -> UIChildren?, _ unslotted: UIChildren) -> some View {
  let content: AnyView = slot("content").map { AnyView($0) } ?? AnyView(unslotted)
  let header: AnyView = slot("header").map { AnyView($0) } ?? AnyView(node.string("title").map { Text($0) })
  let footer: AnyView = slot("footer").map { AnyView($0) } ?? AnyView(EmptyView())
  if node.props["isExpanded"] != nil, #available(macOS 14, *) {
    let expanded = Binding<Bool>(
      get: { (store.value(node, "isExpanded") as? Bool) ?? true },
      set: { store.user(node, "isExpanded", $0, event: "isExpandedChange", payload: ["isExpanded": $0]) })
    return AnyView(Section(isExpanded: expanded) { content } header: { header })
  }
  return AnyView(Section { content } header: { header } footer: { footer })
}

func uiDisclosure(_ node: UINode, _ store: UIStore, _ slot: (String) -> UIChildren?, _ unslotted: UIChildren) -> some View {
  let expanded = Binding<Bool>(
    get: { (store.value(node, "isExpanded") as? Bool) ?? true },
    set: { store.user(node, "isExpanded", $0, event: "isExpandedChange", payload: ["isExpanded": $0]) })
  if let label = slot("label") {
    return AnyView(DisclosureGroup(isExpanded: expanded) { unslotted } label: { label })
  }
  return AnyView(DisclosureGroup(node.string("label") ?? "", isExpanded: expanded) { unslotted })
}

func uiMenu(_ node: UINode, _ store: UIStore, _ slot: (String) -> UIChildren?) -> some View {
  let items = UIChildren(nodes: node.children.filter { $0.slotName != "label" }, store: store)
  let label: AnyView
  if let custom = slot("label") {
    label = AnyView(custom)
  } else if let systemImage = node.string("systemImage") {
    label = AnyView(Label(node.string("label") ?? "", systemImage: systemImage))
  } else {
    label = AnyView(Text(node.string("label") ?? ""))
  }
  if node.bool("hasPrimaryAction") == true {
    return AnyView(Menu { items } label: { label } primaryAction: { store.emit(node.tag, "primaryAction", [:]) })
  }
  return AnyView(Menu { items } label: { label })
}

func uiTabs(_ node: UINode, _ store: UIStore) -> some View {
  let tabs = node.withoutSlots
  let key: (UINode, Int) -> String = { tab, index in tab.string("value") ?? "\(index)" }
  let selection = Binding<String>(
    get: { (store.value(node, "selection") as? String) ?? node.string("defaultSelection") ?? tabs.first.map { key($0, 0) } ?? "" },
    set: { store.user(node, "selection", $0, event: "selectionChange", payload: ["selection": $0]) })
  return TabView(selection: selection) {
    ForEach(Array(tabs.enumerated()), id: \.element.tag) { index, tab in
      UIChildren(nodes: tab.name == "SlotView" ? tab.children : [tab], store: store)
        .tabItem {
          if let systemImage = tab.string("systemImage") {
            Label(tab.string("label") ?? "", systemImage: systemImage)
          } else {
            Text(tab.string("label") ?? key(tab, index))
          }
        }
        .tag(key(tab, index))
    }
  }
}

func uiPresented(_ node: UINode, _ store: UIStore) -> Binding<Bool> {
  Binding<Bool>(
    get: { (store.value(node, "isPresented") as? Bool) ?? false },
    set: { shown in
      guard shown != ((store.value(node, "isPresented") as? Bool) ?? false) else { return }
      store.user(node, "isPresented", shown, event: "isPresentedChange", payload: ["isPresented": shown])
      if !shown && node.name == "BottomSheetView" { store.emit(node.tag, "dismiss", [:]) }
    })
}

func uiDialog(_ node: UINode, _ store: UIStore, _ slot: (String) -> UIChildren?) -> some View {
  let trigger: AnyView = slot("trigger").map { AnyView($0) } ?? AnyView(EmptyView())
  let actions = slot("actions")
  let message = slot("message")
  let title = node.string("title") ?? ""
  if node.name == "AlertView" {
    return AnyView(trigger.alert(title, isPresented: uiPresented(node, store)) { actions } message: { message })
  }
  let visibility: Visibility = switch node.string("titleVisibility") {
  case "visible": .visible
  case "hidden": .hidden
  default: .automatic
  }
  return AnyView(trigger.confirmationDialog(title, isPresented: uiPresented(node, store), titleVisibility: visibility) {
    actions
  } message: { message })
}

func uiPopover(_ node: UINode, _ store: UIStore, _ slot: (String) -> UIChildren?) -> some View {
  let trigger: AnyView = slot("trigger").map { AnyView($0) } ?? AnyView(EmptyView())
  let edge: Edge = switch node.string("arrowEdge") {
  case "leading": .leading
  case "trailing": .trailing
  case "bottom": .bottom
  default: .top
  }
  let content = slot("popover")
  return trigger.popover(isPresented: uiPresented(node, store), arrowEdge: edge) { content }
}

func uiSheet(_ node: UINode, _ store: UIStore) -> some View {
  let content = UIChildren(nodes: node.withoutSlots, store: store)
  let anchor: AnyView = node.slot("anchor").map { AnyView(UIChildren(nodes: $0.children, store: store)) } ?? AnyView(Color.clear.frame(width: 0, height: 0))
  return anchor.sheet(isPresented: uiPresented(node, store)) { content }
}

func uiSwipeActions(_ node: UINode, _ store: UIStore) -> some View {
  var row = AnyView(UIChildren(nodes: node.withoutSlots, store: store))
  for actions in node.children where actions.slotName == "actions" {
    let extra = actions.props["extraProps"] as? [String: Any]
    let edge: HorizontalEdge = extra?["edge"] as? String == "leading" ? .leading : .trailing
    let full = (extra?["allowsFullSwipe"] as? Bool) ?? true
    row = AnyView(row.swipeActions(edge: edge, allowsFullSwipe: full) { UIChildren(nodes: actions.children, store: store) })
  }
  return row
}

struct UIChartPoint: Identifiable {
  let id: Int
  let x: String
  let y: Double
  let color: Color?
}

func uiChart(_ node: UINode) -> some View {
  let points = (node.props["data"] as? [[String: Any]] ?? []).enumerated().map { index, point in
    UIChartPoint(id: index, x: (point["x"] as? String) ?? (point["x"] as? NSNumber).map { "\($0)" } ?? "\(index)",
                 y: (point["y"] as? NSNumber)?.doubleValue ?? 0, color: uiColor(point["color"]))
  }
  let type = node.string("type") ?? "line"
  let chart = Chart(points) { point in
    switch type {
    case "bar":
      BarMark(x: .value("x", point.x), y: .value("y", point.y)).foregroundStyle(point.color ?? .accentColor)
    case "area":
      AreaMark(x: .value("x", point.x), y: .value("y", point.y)).foregroundStyle(point.color ?? .accentColor)
    case "point":
      PointMark(x: .value("x", point.x), y: .value("y", point.y)).foregroundStyle(point.color ?? .accentColor)
    case "rectangle":
      RectangleMark(x: .value("x", point.x), y: .value("y", point.y)).foregroundStyle(point.color ?? .accentColor)
    case "rule":
      RuleMark(y: .value("y", point.y)).foregroundStyle(point.color ?? .accentColor)
    default:
      LineMark(x: .value("x", point.x), y: .value("y", point.y)).foregroundStyle(point.color ?? .accentColor)
    }
  }
  if type == "pie", #available(macOS 14, *) {
    return AnyView(Chart(points) { point in
      SectorMark(angle: .value("y", point.y), innerRadius: .ratio(0), angularInset: 2)
        .foregroundStyle(point.color ?? .accentColor)
    })
  }
  let grid = node.bool("showGrid") ?? true
  return AnyView(chart.chartXAxis(grid ? .automatic : .hidden).chartYAxis(grid ? .automatic : .hidden))
}

// An RNHostView: the app's own views, which the host's view for the tag holds, inside the content.
final class UIEmbedContainer: NSView {
  override var isFlipped: Bool { true }
  override var intrinsicContentSize: NSSize { subviews.first?.frame.size ?? .zero }
}

struct UIEmbedded: NSViewRepresentable {
  let tag: Int
  let store: UIStore
  func makeNSView(context: Context) -> UIEmbedContainer { UIEmbedContainer() }
  func updateNSView(_ container: UIEmbedContainer, context: Context) {
    guard let view = store.viewForTag(tag), view.superview !== container else { return }
    container.subviews.forEach { $0.removeFromSuperview() }
    view.setFrameOrigin(.zero)
    container.addSubview(view)
    container.invalidateIntrinsicContentSize()
  }
}

// MARK: - Modifiers

func uiFont(_ m: [String: Any]) -> Font {
  let weight: Font.Weight? = switch m["weight"] as? String {
  case "ultraLight": .ultraLight
  case "thin": .thin
  case "light": .light
  case "regular": .regular
  case "medium": .medium
  case "semibold": .semibold
  case "bold": .bold
  case "heavy": .heavy
  case "black": .black
  default: nil
  }
  let design: Font.Design = switch m["design"] as? String {
  case "rounded": .rounded
  case "serif": .serif
  case "monospaced": .monospaced
  default: .default
  }
  var font: Font
  if let family = m["family"] as? String {
    font = .custom(family, size: uiCGFloat(m["size"]) ?? NSFont.systemFontSize)
  } else if let size = uiCGFloat(m["size"]) {
    font = .system(size: size, design: design)
  } else {
    let style: Font.TextStyle = switch m["textStyle"] as? String {
    case "largeTitle": .largeTitle
    case "title": .title
    case "title2": .title2
    case "title3": .title3
    case "headline": .headline
    case "subheadline": .subheadline
    case "callout": .callout
    case "footnote": .footnote
    case "caption": .caption
    case "caption2": .caption2
    default: .body
    }
    font = .system(style, design: design)
  }
  if let weight { font = font.weight(weight) }
  return font
}

func uiPadded(_ view: AnyView, _ m: [String: Any]) -> AnyView {
  func length(_ key: String) -> CGFloat?? {
    guard let value = m[key] else { return nil }
    return .some(uiCGFloat(value))  // `default` is the system's padding
  }
  var out = view
  var any = false
  let edges: [(String, Edge.Set)] = [("all", .all), ("horizontal", .horizontal), ("vertical", .vertical), ("top", .top),
                                     ("bottom", .bottom), ("leading", .leading), ("trailing", .trailing)]
  for (key, edge) in edges {
    if let value = length(key) {
      out = AnyView(out.padding(edge, value))
      any = true
    }
  }
  return any ? out : AnyView(view.padding())
}

func uiShapeStyle(_ value: Any?) -> AnyShapeStyle? {
  if let color = uiColor(value) { return AnyShapeStyle(color) }
  guard let style = value as? [String: Any] else { return nil }
  switch style["type"] as? String {
  case "color":
    return uiColor(style["color"]).map { AnyShapeStyle($0) }
  case "hierarchical":
    return switch style["hierarchical"] as? String {
    case "secondary": AnyShapeStyle(.secondary)
    case "tertiary": AnyShapeStyle(.tertiary)
    case "quaternary": AnyShapeStyle(.quaternary)
    default: AnyShapeStyle(.primary)
    }
  case "linearGradient":
    let colors = (style["colors"] as? [Any] ?? []).compactMap(uiColor)
    return AnyShapeStyle(LinearGradient(colors: colors, startPoint: .top, endPoint: .bottom))
  default:
    return nil
  }
}

func uiModified(_ view: AnyView, _ modifiers: [[String: Any]]) -> AnyView {
  modifiers.reduce(view) { view, m in uiModifier(view, m) }
}

// One of expo/ui's modifiers, by its `$type`. One with no macOS meaning, or none here yet, is
// skipped.
func uiModifier(_ view: AnyView, _ m: [String: Any]) -> AnyView {
  switch m["$type"] as? String {
  case "padding":
    return uiPadded(view, m)
  case "frame":
    if m["width"] != nil || m["height"] != nil {
      return AnyView(view.frame(width: uiCGFloat(m["width"]), height: uiCGFloat(m["height"]), alignment: uiAlignment(m["alignment"])))
    }
    return AnyView(view.frame(minWidth: uiLength(m["minWidth"]), idealWidth: uiLength(m["idealWidth"]), maxWidth: uiLength(m["maxWidth"]),
                              minHeight: uiLength(m["minHeight"]), idealHeight: uiLength(m["idealHeight"]),
                              maxHeight: uiLength(m["maxHeight"]), alignment: uiAlignment(m["alignment"])))
  case "foregroundColor":
    return uiColor(m["color"]).map { AnyView(view.foregroundColor($0)) } ?? view
  case "foregroundStyle":
    return uiShapeStyle(m["style"] ?? m["color"]).map { AnyView(view.foregroundStyle($0)) } ?? view
  case "tint":
    return uiColor((m["tint"] as? [String: Any])?["color"] ?? m["tint"] ?? m["color"]).map { AnyView(view.tint($0)) } ?? view
  case "background":
    return uiShapeStyle(m["style"] ?? m["color"]).map { AnyView(view.background($0)) } ?? view
  case "opacity":
    return AnyView(view.opacity((m["value"] as? NSNumber)?.doubleValue ?? 1))
  case "font":
    return AnyView(view.font(uiFont(m)))
  case "bold":
    return AnyView(view.bold())
  case "italic":
    return AnyView(view.italic())
  case "monospacedDigit":
    return AnyView(view.monospacedDigit())
  case "disabled":
    return AnyView(view.disabled((m["disabled"] as? Bool) ?? true))
  case "hidden":
    return (m["hidden"] as? Bool) ?? true ? AnyView(view.hidden()) : view
  case "tag":
    return uiTag(m["tag"]).map { AnyView(view.tag($0)) } ?? view
  case "cornerRadius":
    return AnyView(view.clipShape(RoundedRectangle(cornerRadius: uiCGFloat(m["radius"]) ?? 0)))
  case "clipShape":
    return switch m["shape"] as? String {
    case "circle": AnyView(view.clipShape(Circle()))
    case "capsule": AnyView(view.clipShape(Capsule()))
    case "roundedRectangle": AnyView(view.clipShape(RoundedRectangle(cornerRadius: uiCGFloat(m["cornerRadius"]) ?? 0)))
    default: AnyView(view.clipShape(Rectangle()))
    }
  case "clipped":
    return (m["clipped"] as? Bool) ?? true ? AnyView(view.clipped()) : view
  case "border":
    return AnyView(view.border(uiColor(m["color"]) ?? .primary, width: uiCGFloat(m["width"]) ?? 1))
  case "shadow":
    return AnyView(view.shadow(color: uiColor(m["color"]) ?? .black.opacity(0.33), radius: uiCGFloat(m["radius"]) ?? 0,
                               x: uiCGFloat(m["x"]) ?? 0, y: uiCGFloat(m["y"]) ?? 0))
  case "offset":
    return AnyView(view.offset(x: uiCGFloat(m["x"]) ?? 0, y: uiCGFloat(m["y"]) ?? 0))
  case "scaleEffect":
    return AnyView(view.scaleEffect(x: uiCGFloat(m["x"]) ?? 1, y: uiCGFloat(m["y"]) ?? 1))
  case "rotationEffect":
    return AnyView(view.rotationEffect(.degrees((m["angle"] as? NSNumber)?.doubleValue ?? 0)))
  case "zIndex":
    return AnyView(view.zIndex((m["index"] as? NSNumber)?.doubleValue ?? 0))
  case "layoutPriority":
    return AnyView(view.layoutPriority((m["priority"] as? NSNumber)?.doubleValue ?? 0))
  case "blur":
    return AnyView(view.blur(radius: uiCGFloat(m["radius"]) ?? 0))
  case "fixedSize":
    return AnyView(view.fixedSize(horizontal: (m["horizontal"] as? Bool) ?? true, vertical: (m["vertical"] as? Bool) ?? true))
  case "aspectRatio":
    return AnyView(view.aspectRatio(uiCGFloat(m["ratio"]), contentMode: m["contentMode"] as? String == "fill" ? .fill : .fit))
  case "lineLimit":
    return AnyView(view.lineLimit((m["limit"] as? NSNumber)?.intValue ?? (m["max"] as? NSNumber)?.intValue))
  case "multilineTextAlignment":
    let alignment: TextAlignment = switch m["alignment"] as? String {
    case "center": .center
    case "trailing": .trailing
    default: .leading
    }
    return AnyView(view.multilineTextAlignment(alignment))
  case "textSelection":
    return (m["value"] as? Bool) == true ? AnyView(view.textSelection(.enabled)) : view
  case "labelsHidden":
    return AnyView(view.labelsHidden())
  case "accessibilityLabel":
    return AnyView(view.accessibilityLabel(Text(m["label"] as? String ?? "")))
  case "accessibilityHint":
    return AnyView(view.accessibilityHint(Text(m["hint"] as? String ?? "")))
  case "accessibilityHidden":
    return AnyView(view.accessibilityHidden((m["hidden"] as? Bool) ?? true))
  case "accessibilityIdentifier":
    return AnyView(view.accessibilityIdentifier(m["identifier"] as? String ?? ""))
  case "help":
    return AnyView(view.help(m["text"] as? String ?? ""))
  case "controlSize":
    let size: ControlSize = switch m["size"] as? String {
    case "mini": .mini
    case "small": .small
    case "large": .large
    case "extraLarge": .large
    default: .regular
    }
    return AnyView(view.controlSize(size))
  case "pickerStyle":
    return switch m["style"] as? String {
    case "menu": AnyView(view.pickerStyle(.menu))
    case "segmented", "palette": AnyView(view.pickerStyle(.segmented))
    case "inline": AnyView(view.pickerStyle(.inline))
    case "radioGroup": AnyView(view.pickerStyle(.radioGroup))
    default: view  // `wheel` is iOS's
    }
  case "toggleStyle":
    return switch m["style"] as? String {
    case "switch": AnyView(view.toggleStyle(.switch))
    case "button": AnyView(view.toggleStyle(.button))
    case "checkbox": AnyView(view.toggleStyle(.checkbox))
    default: view
    }
  case "buttonStyle":
    return switch m["style"] as? String {
    case "bordered": AnyView(view.buttonStyle(.bordered))
    case "borderedProminent": AnyView(view.buttonStyle(.borderedProminent))
    case "borderless": AnyView(view.buttonStyle(.borderless))
    case "plain": AnyView(view.buttonStyle(.plain))
    case "link": AnyView(view.buttonStyle(.link))
    default: view
    }
  case "datePickerStyle":
    return switch m["style"] as? String {
    case "compact": AnyView(view.datePickerStyle(.compact))
    case "graphical": AnyView(view.datePickerStyle(.graphical))
    case "field": AnyView(view.datePickerStyle(.field))
    case "stepperField": AnyView(view.datePickerStyle(.stepperField))
    default: view  // `wheel` is iOS's
    }
  case "progressViewStyle":
    return switch m["style"] as? String {
    case "circular": AnyView(view.progressViewStyle(.circular))
    case "linear": AnyView(view.progressViewStyle(.linear))
    default: view
    }
  case "gaugeStyle":
    return switch m["style"] as? String {
    case "circular": AnyView(view.gaugeStyle(.accessoryCircular))
    case "circularCapacity": AnyView(view.gaugeStyle(.accessoryCircularCapacity))
    case "linear": AnyView(view.gaugeStyle(.accessoryLinear))
    case "linearCapacity": AnyView(view.gaugeStyle(.linearCapacity))
    default: view
    }
  case "labelStyle":
    return switch m["style"] as? String {
    case "iconOnly": AnyView(view.labelStyle(.iconOnly))
    case "titleOnly": AnyView(view.labelStyle(.titleOnly))
    case "titleAndIcon": AnyView(view.labelStyle(.titleAndIcon))
    default: view
    }
  case "listStyle":
    return switch m["style"] as? String {
    case "plain": AnyView(view.listStyle(.plain))
    case "inset", "insetGrouped": AnyView(view.listStyle(.inset))
    case "sidebar": AnyView(view.listStyle(.sidebar))
    case "bordered": AnyView(view.listStyle(.bordered))
    default: view
    }
  case "textFieldStyle":
    return switch m["style"] as? String {
    case "plain": AnyView(view.textFieldStyle(.plain))
    case "roundedBorder": AnyView(view.textFieldStyle(.roundedBorder))
    case "squareBorder": AnyView(view.textFieldStyle(.squareBorder))
    default: view
    }
  case "menuStyle":
    return m["style"] as? String == "button" ? AnyView(view.menuStyle(.button)) : view
  case "imageScale":
    return switch m["scale"] as? String {
    case "small": AnyView(view.imageScale(.small))
    case "large": AnyView(view.imageScale(.large))
    default: AnyView(view.imageScale(.medium))
    }
  case "navigationTitle":
    return AnyView(view.navigationTitle(m["title"] as? String ?? ""))
  case "preferredColorScheme":
    return switch m["colorScheme"] as? String {
    case "dark": AnyView(view.environment(\.colorScheme, .dark))
    case "light": AnyView(view.environment(\.colorScheme, .light))
    default: view
    }
  case "badge":
    return AnyView(view.badge((m["value"] as? String).map { Text($0) }))
  case "underline":
    return AnyView(view.underline((m["isActive"] as? Bool) ?? true, color: uiColor(m["color"])))
  case "strikethrough":
    return AnyView(view.strikethrough((m["isActive"] as? Bool) ?? true, color: uiColor(m["color"])))
  case "kerning":
    return AnyView(view.kerning(uiCGFloat(m["value"]) ?? 0))
  case "lineSpacing":
    return AnyView(view.lineSpacing(uiCGFloat(m["value"]) ?? 0))
  case "textCase":
    return AnyView(view.textCase(m["value"] as? String == "lowercase" ? .lowercase : .uppercase))
  case "glassEffect":
    #if compiler(>=6.2)
    if #available(macOS 26, *) { return AnyView(view.glassEffect()) }
    #endif
    return view
  default:
    return view
  }
}

// MARK: - The host

final class UIHostView: NSView {
  let store = UIStore()
  let controller: NSHostingController<UIRoot>

  init() {
    controller = NSHostingController(rootView: UIRoot(store: store))
    super.init(frame: .zero)
    controller.view.frame = bounds
    controller.view.autoresizingMask = [.width, .height]
    addSubview(controller.view)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError() }

  override var isFlipped: Bool { true }
}

struct UIRoot: View {
  @ObservedObject var store: UIStore
  var body: some View {
    if let root = store.root {
      UINodeView(node: root, store: store)
    }
  }
}

private func host(_ pointer: UnsafeMutableRawPointer) -> UIHostView {
  Unmanaged<UIHostView>.fromOpaque(pointer).takeUnretainedValue()
}

private func json(_ text: UnsafePointer<CChar>) -> Any? {
  try? JSONSerialization.jsonObject(with: Data(String(cString: text).utf8), options: [.fragmentsAllowed])
}

/// A host view, retained: its events go to `onEvent` and its RNHostViews come from `viewForTag`,
/// each with `context`.
@_cdecl("ngn_ui_host_make")
public func ngnUIHostMake(_ context: UnsafeMutableRawPointer?, _ onEvent: NGNUIEvent, _ viewForTag: NGNUIViewForTag) -> UnsafeMutableRawPointer {
  let view = UIHostView()
  view.store.emit = { tag, name, payload in
    let data = (try? JSONSerialization.data(withJSONObject: payload)) ?? Data("{}".utf8)
    name.withCString { n in String(decoding: data, as: UTF8.self).withCString { p in onEvent(context, Int32(tag), n, p) } }
  }
  view.store.viewForTag = { tag in
    viewForTag(context, Int32(tag)).map { Unmanaged<NSView>.fromOpaque($0).takeUnretainedValue() }
  }
  return Unmanaged.passRetained(view).toOpaque()
}

/// Sends no more events and asks for no more views: the renderer that made the view is gone.
@_cdecl("ngn_ui_host_detach")
public func ngnUIHostDetach(_ pointer: UnsafeMutableRawPointer) {
  let store = host(pointer).store
  store.emit = { _, _, _ in }
  store.viewForTag = { _ in nil }
}

/// Draws `tree` (the HostView's, as JSON) from now on.
@_cdecl("ngn_ui_host_set_tree")
public func ngnUIHostSetTree(_ pointer: UnsafeMutableRawPointer, _ tree: UnsafePointer<CChar>) {
  host(pointer).store.set(json(tree).flatMap(UINode.init))
}

/// The content's size: its fitting size, or with a `width` or `height` (when not negative) given,
/// the size it takes in that.
@_cdecl("ngn_ui_host_fit")
public func ngnUIHostFit(_ pointer: UnsafeMutableRawPointer, _ width: Double, _ height: Double,
                         _ outWidth: UnsafeMutablePointer<Double>, _ outHeight: UnsafeMutablePointer<Double>) {
  let view = host(pointer)
  let size: CGSize
  if width < 0 && height < 0 {
    size = view.controller.view.fittingSize
  } else {
    let ideal = view.controller.view.fittingSize
    size = view.controller.sizeThatFits(in: CGSize(width: width < 0 ? ideal.width : width, height: height < 0 ? .greatestFiniteMagnitude : height))
  }
  outWidth.pointee = size.width.isFinite ? Double(size.width) : 0
  outHeight.pointee = size.height.isFinite ? Double(size.height) : 0
}

/// Acts on the view `tag` as the user would, with `action` (JSON): what a control is set to, a
/// press, or a presentation's dismissal. False for a tag or an action the view does not take.
@_cdecl("ngn_ui_host_perform")
public func ngnUIHostPerform(_ pointer: UnsafeMutableRawPointer, _ tag: Int32, _ action: UnsafePointer<CChar>) -> Bool {
  let store = host(pointer).store
  guard let node = store.root?.find(Int(tag)) else { return false }
  let value = (json(action) as? [String: Any]) ?? [:]
  switch node.name {
  case "Button":
    store.emit(node.tag, "buttonPress", [:])
  case "MenuView":
    store.emit(node.tag, "primaryAction", [:])
  case "ToggleView":
    guard let on = value["isOn"] as? Bool else { return false }
    store.user(node, "isOn", on, event: "isOnChange", payload: ["isOn": on])
  case "SliderView":
    guard let number = value["value"] as? NSNumber else { return false }
    uiSlide(node, store, number.doubleValue)
  case "StepperView":
    guard let number = value["value"] as? NSNumber else { return false }
    store.user(node, "value", number.intValue, event: "valueChange", payload: ["value": number.intValue])
  case "PickerView":
    guard let tag = uiTag(value["selection"]) else { return false }
    store.user(node, "selection", uiTagValue(tag), event: "selectionChange", payload: ["selection": uiTagValue(tag)])
  case "DatePickerView":
    guard let date = uiDate(value["date"]) else { return false }
    let ms = date.timeIntervalSince1970 * 1000
    store.user(node, "selection", ms, event: "dateChange", payload: ["date": ms])
  case "ColorPickerView":
    guard let color = uiColor(value["value"]) else { return false }
    let hex = uiHex(color)
    store.user(node, "selection", hex, event: "selectionChange", payload: ["value": hex])
  case "TextFieldView", "SecureFieldView":
    guard let text = value["text"] as? String else { return false }
    store.user(node, "text", text, event: "textChange", payload: ["value": text])
  case "DisclosureGroupView", "SectionView":
    guard let expanded = value["isExpanded"] as? Bool else { return false }
    store.user(node, "isExpanded", expanded, event: "isExpandedChange", payload: ["isExpanded": expanded])
  case "AlertView", "ConfirmationDialogView", "PopoverView", "BottomSheetView":
    guard let shown = value["isPresented"] as? Bool else { return false }
    uiPresented(node, store).wrappedValue = shown
  case "TabView":
    guard let selection = value["selection"] as? String else { return false }
    store.user(node, "selection", selection, event: "selectionChange", payload: ["selection": selection])
  case "ListView":
    guard let selection = value["selection"] as? [Any] else { return false }
    store.user(node, "selection", selection, event: "selectionChange", payload: ["selection": selection])
  default:
    return false
  }
  return true
}

/// Whether the renderer draws the iOS view `name`.
@_cdecl("ngn_ui_draws")
public func ngnUIDraws(_ name: UnsafePointer<CChar>) -> Bool {
  uiDrawn.contains(String(cString: name))
}
