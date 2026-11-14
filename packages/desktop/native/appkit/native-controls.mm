#import "native-controls.h"

#include <react/renderer/components/view/ViewEventEmitter.h>

using namespace facebook::react;
using RNSize = facebook::react::Size;
using ngn::ControlKind;
using ngn::ControlSize;
using ngn::NativeControlProps;

namespace {

NSControlSize nsControlSize(ControlSize size) {
  switch (size) {
    case ControlSize::Mini:
      return NSControlSizeMini;
    case ControlSize::Small:
      return NSControlSizeSmall;
    case ControlSize::Large:
      return NSControlSizeLarge;
    case ControlSize::Regular:
      return NSControlSizeRegular;
  }
  return NSControlSizeRegular;
}

NSString *nsString(const std::string &s) {
  NSString *result = [NSString stringWithUTF8String:s.c_str()];
  return result != nil ? result : @"";
}

NSFont *controlFont(ControlSize size) {
  return [NSFont systemFontOfSize:[NSFont systemFontSizeForControlSize:nsControlSize(size)]];
}

// The push button an NgNativeButton is: its title, picture and size, and what its kind means.
void configureButton(NSButton *button, const NativeControlProps &p) {
  button.title = nsString(p.title);
  button.controlSize = nsControlSize(p.controlSize);
  button.font = controlFont(p.controlSize);
  button.bordered = p.kind != "plain";
  button.bezelStyle = NSBezelStylePush;
  button.image = p.sfSymbol.empty() ? nil : [NSImage imageWithSystemSymbolName:nsString(p.sfSymbol) accessibilityDescription:nil];
  button.imagePosition = button.image == nil ? NSNoImage : (p.title.empty() ? NSImageOnly : NSImageLeading);
  // Return presses the default button of its window, and Escape the cancel one.
  button.keyEquivalent = p.kind == "default" ? @"\r" : p.kind == "cancel" ? @"\x1b" : @"";
  button.hasDestructiveAction = p.kind == "destructive";
  button.contentTintColor = p.kind == "destructive" ? NSColor.systemRedColor : nil;
  button.enabled = p.enabled;
  // VoiceOver reads the title, not the symbol's name.
  button.accessibilityLabel = p.title.empty() ? nil : nsString(p.title);
}

NSDatePickerElementFlags dateElements(const std::string &mode) {
  if (mode == "time" || mode == "countdown") {
    return NSDatePickerElementFlagHourMinute;
  }
  if (mode == "datetime") {
    return NSDatePickerElementFlagYearMonthDay | NSDatePickerElementFlagHourMinute;
  }
  return NSDatePickerElementFlagYearMonthDay;
}

NSDatePickerStyle dateStyle(const std::string &display) {
  return display == "inline" || display == "spinner" ? NSDatePickerStyleClockAndCalendar
                                                      : NSDatePickerStyleTextFieldAndStepper;
}

void configureSegments(NSSegmentedControl *control, NSSegmentedCell *cell, const NativeControlProps &p) {
  NSSegmentedCell *target = control != nil ? (NSSegmentedCell *)control.cell : cell;
  target.segmentCount = static_cast<NSInteger>(p.values.size());
  for (size_t i = 0; i < p.values.size(); i++) {
    [target setLabel:nsString(p.values[i]) forSegment:static_cast<NSInteger>(i)];
  }
  target.controlSize = nsControlSize(p.controlSize);
  target.font = controlFont(p.controlSize);
  target.trackingMode = p.momentary ? NSSegmentSwitchTrackingMomentary : NSSegmentSwitchTrackingSelectOne;
}

RNSize cellSize(NSCell *cell) {
  NSSize size = cell.cellSize;
  return {static_cast<Float>(std::ceil(size.width)), static_cast<Float>(std::ceil(size.height))};
}

RNSize fitting(NSView *view) {
  NSSize size = view.fittingSize;
  return {static_cast<Float>(std::ceil(size.width)), static_cast<Float>(std::ceil(size.height))};
}

} // namespace

namespace ngn::appkit {

AppKitControlMeasurer::AppKitControlMeasurer() {
  for (int i = 0; i < 4; i++) {
    auto size = static_cast<ControlSize>(i);
    NSSwitch *toggle = [NSSwitch new];
    toggle.controlSize = nsControlSize(size);
    switches_[i] = fitting(toggle);
    NSProgressIndicator *spinner = [NSProgressIndicator new];
    spinner.style = NSProgressIndicatorStyleSpinning;
    spinner.controlSize = nsControlSize(size);
    [spinner sizeToFit];
    spinners_[i] = {static_cast<Float>(spinner.frame.size.width), static_cast<Float>(spinner.frame.size.height)};
  }
}

RNSize AppKitControlMeasurer::measure(ControlKind kind, const NativeControlProps &p) const {
  @autoreleasepool {
    switch (kind) {
      case ControlKind::Button: {
        NSButtonCell *cell = [NSButtonCell new];
        cell.title = nsString(p.title);
        cell.controlSize = nsControlSize(p.controlSize);
        cell.font = controlFont(p.controlSize);
        cell.bordered = p.kind != "plain";
        cell.bezelStyle = NSBezelStylePush;
        if (!p.sfSymbol.empty()) {
          cell.image = [NSImage imageWithSystemSymbolName:nsString(p.sfSymbol) accessibilityDescription:nil];
          cell.imagePosition = p.title.empty() ? NSImageOnly : NSImageLeading;
        }
        return cellSize(cell);
      }
      case ControlKind::Switch:
        return switches_[static_cast<int>(p.controlSize)];
      case ControlKind::ActivityIndicator: {
        // `size` picks AppKit's small or regular spinner unless the element names a control size.
        auto size = p.controlSize != ControlSize::Regular ? p.controlSize
            : p.size == "large"                          ? ControlSize::Regular
                                                         : ControlSize::Small;
        return spinners_[static_cast<int>(size)];
      }
      case ControlKind::SegmentedControl: {
        NSSegmentedCell *cell = [NSSegmentedCell new];
        configureSegments(nil, cell, p);
        return cellSize(cell);
      }
      case ControlKind::DatePicker: {
        NSDatePickerCell *cell = [NSDatePickerCell new];
        cell.datePickerElements = dateElements(p.mode);
        cell.datePickerStyle = dateStyle(p.display);
        cell.controlSize = nsControlSize(p.controlSize);
        cell.font = controlFont(p.controlSize);
        cell.dateValue = [NSDate dateWithTimeIntervalSince1970:p.date.value_or(0) / 1000];
        cell.bezeled = YES;
        return cellSize(cell);
      }
    }
  }
  return {0, 0};
}

} // namespace ngn::appkit

#pragma mark - Views

// A Fabric view holding one AppKit control that fills it, and sending its events.
@interface NGNControlView : NGNView
@property (nonatomic, readonly) NSControl *control;
- (const NativeControlProps *)controlProps;
- (void)send:(const std::string &)name payload:(folly::dynamic)payload;
@end

@implementation NGNControlView

- (instancetype)initWithShadowView:(const ShadowView &)view control:(NSControl *)control {
  if ((self = [super initWithShadowView:view])) {
    _control = control;
    control.frame = self.bounds;
    control.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    control.target = self;
    control.action = @selector(controlChanged:);
    [self addSubview:control];
  }
  return self;
}

- (const NativeControlProps *)controlProps {
  return dynamic_cast<const NativeControlProps *>(self.props.get());
}

- (void)updateProps:(const Props::Shared &)props {
  [super updateProps:props];
  if (const auto *p = self.controlProps) {
    [self apply:*p];
  }
}

- (void)apply:(const NativeControlProps &)p {
}

- (void)controlChanged:(id)sender {
}

- (void)send:(const std::string &)name payload:(folly::dynamic)payload {
  if (auto emitter = self.eventEmitter) {
    emitter->dispatchEvent(name, std::move(payload), RawEvent::Category::Discrete);
  }
}

- (NSResponder *)keyboardResponder {
  return self.control;
}

// The AppKit control is the accessibility element, with its own role, title and state.
- (BOOL)isAccessibilityElement {
  return NO;
}

// The control takes the clicks: the core's touches would press the element a second time.
- (BOOL)acceptsFirstResponder {
  return NO;
}

@end

@interface NGNButtonView : NGNControlView
@end

@implementation NGNButtonView
- (void)apply:(const NativeControlProps &)p {
  configureButton((NSButton *)self.control, p);
}
- (void)controlChanged:(id)sender {
  [self send:"buttonPress" payload:folly::dynamic::object()];
}
@end

@interface NGNSwitchView : NGNControlView
@end

@implementation NGNSwitchView
- (void)apply:(const NativeControlProps &)p {
  NSSwitch *toggle = (NSSwitch *)self.control;
  toggle.controlSize = nsControlSize(p.controlSize);
  toggle.state = p.value ? NSControlStateValueOn : NSControlStateValueOff;
  toggle.enabled = p.enabled;
}
- (void)controlChanged:(id)sender {
  BOOL on = ((NSSwitch *)self.control).state == NSControlStateValueOn;
  [self send:"change" payload:folly::dynamic::object("value", (bool)on)("target", (int)self.reactTag)];
}
- (void)handleCommand:(const std::string &)name args:(const folly::dynamic &)args {
  if ((name == "setValue" || name == "setNativeValue") && args.isArray() && args.size() >= 1 && args[0].isBool()) {
    ((NSSwitch *)self.control).state = args[0].asBool() ? NSControlStateValueOn : NSControlStateValueOff;
  }
}
@end

@interface NGNSegmentedView : NGNControlView
@end

@implementation NGNSegmentedView
- (void)apply:(const NativeControlProps &)p {
  NSSegmentedControl *segments = (NSSegmentedControl *)self.control;
  configureSegments(segments, nil, p);
  segments.selectedSegment = p.selectedIndex;
  segments.enabled = p.enabled;
}
- (void)controlChanged:(id)sender {
  NSSegmentedControl *segments = (NSSegmentedControl *)self.control;
  NSInteger index = segments.selectedSegment;
  NSString *label = index >= 0 ? [segments labelForSegment:index] : @"";
  [self send:"change"
       payload:folly::dynamic::object("value", std::string(label.UTF8String != nullptr ? label.UTF8String : ""))("selectedSegmentIndex", (int)index)];
}
@end

@interface NGNDatePickerView : NGNControlView
@end

@implementation NGNDatePickerView
- (void)apply:(const NativeControlProps &)p {
  NSDatePicker *picker = (NSDatePicker *)self.control;
  picker.datePickerElements = dateElements(p.mode);
  picker.datePickerStyle = dateStyle(p.display);
  picker.controlSize = nsControlSize(p.controlSize);
  picker.font = controlFont(p.controlSize);
  if (p.date) {
    picker.dateValue = [NSDate dateWithTimeIntervalSince1970:*p.date / 1000];
  }
  picker.minDate = p.minimumDate ? [NSDate dateWithTimeIntervalSince1970:*p.minimumDate / 1000] : nil;
  picker.maxDate = p.maximumDate ? [NSDate dateWithTimeIntervalSince1970:*p.maximumDate / 1000] : nil;
  picker.enabled = p.enabled;
}
- (void)controlChanged:(id)sender {
  NSDate *date = ((NSDatePicker *)self.control).dateValue;
  double offset = [NSTimeZone.localTimeZone secondsFromGMTForDate:date] / 60.0;
  [self send:"change" payload:folly::dynamic::object("timestamp", date.timeIntervalSince1970 * 1000)("utcOffset", offset)];
}
@end

// Not an NSControl: it has no action, and nothing to send.
@interface NGNActivityIndicatorView : NGNView
@end

@implementation NGNActivityIndicatorView {
  NSProgressIndicator *_spinner;
}
- (instancetype)initWithShadowView:(const ShadowView &)view {
  if ((self = [super initWithShadowView:view])) {
    _spinner = [NSProgressIndicator new];
    _spinner.style = NSProgressIndicatorStyleSpinning;
    _spinner.displayedWhenStopped = NO;
    [self addSubview:_spinner];
  }
  return self;
}
- (void)updateProps:(const Props::Shared &)props {
  [super updateProps:props];
  const auto *p = dynamic_cast<const NativeControlProps *>(props.get());
  if (p == nullptr) {
    return;
  }
  auto size = p->controlSize != ControlSize::Regular ? p->controlSize
      : p->size == "large"                           ? ControlSize::Regular
                                                     : ControlSize::Small;
  _spinner.controlSize = nsControlSize(size);
  _spinner.displayedWhenStopped = !p->hidesWhenStopped;
  if (p->animating) {
    [_spinner startAnimation:nil];
  } else {
    [_spinner stopAnimation:nil];
  }
  [self centreSpinner];
}
- (void)updateLayout:(const LayoutMetrics &)metrics {
  [super updateLayout:metrics];
  [self centreSpinner];
}
- (BOOL)isAccessibilityElement {
  return NO;
}
- (void)centreSpinner {
  [_spinner sizeToFit];
  NSSize s = _spinner.frame.size;
  _spinner.frame = NSMakeRect((self.bounds.size.width - s.width) / 2, (self.bounds.size.height - s.height) / 2, s.width, s.height);
}
@end

NGNView *NGNMakeControlView(const ShadowView &view) {
  auto kind = ngn::controlKind(view.componentName);
  if (!kind) {
    return nil;
  }
  switch (*kind) {
    case ControlKind::Button:
      return [[NGNButtonView alloc] initWithShadowView:view control:[NSButton new]];
    case ControlKind::Switch:
      return [[NGNSwitchView alloc] initWithShadowView:view control:[NSSwitch new]];
    case ControlKind::SegmentedControl:
      return [[NGNSegmentedView alloc] initWithShadowView:view control:[NSSegmentedControl new]];
    case ControlKind::DatePicker:
      return [[NGNDatePickerView alloc] initWithShadowView:view control:[NSDatePicker new]];
    case ControlKind::ActivityIndicator:
      return [[NGNActivityIndicatorView alloc] initWithShadowView:view];
  }
  return nil;
}
