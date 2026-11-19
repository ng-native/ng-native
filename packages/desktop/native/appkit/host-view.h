// The NSView every Fabric view mounts as: layer-backed, flipped, placed at Yoga's frame.
// A Paragraph draws its text with Core Text; a TextInput hosts a real NSTextField.
#pragma once

#import <AppKit/AppKit.h>

#include "ngn/accessibility.h"
#include "ngn/desktop-view-props.h"
#include "ngn/input-dispatcher.h"

#include <react/renderer/mounting/ShadowView.h>

@interface NGNView : NSView
// Set once by the host: where VoiceOver's press, Space and Return on a focused view send the click
// they stand for when the view has no accessibility handler of its own.
@property (class, nonatomic) ngn::InputDispatcher *activator;
@property (nonatomic, readonly) NSInteger reactTag;
@property (nonatomic, readonly) NSInteger surfaceId;
@property (nonatomic, readonly, copy) NSString *componentName;
// A screen below the top of its stack: hidden, and kept mounted.
@property (nonatomic) BOOL covered;
// A back swipe's frame (back-swipe.h): the screen in front moved right by `swipeOffset` points
// and faded to `swipeOpacity`, and the covered screen below it drawn while `swipeShown`. Layout
// keeps them until the swipe sets them back.
@property (nonatomic) CGFloat swipeOffset;
@property (nonatomic) CGFloat swipeOpacity;
@property (nonatomic) BOOL swipeShown;
- (instancetype)initWithShadowView:(const facebook::react::ShadowView &)view;
- (void)updateProps:(const facebook::react::Props::Shared &)props;
- (void)updateLayout:(const facebook::react::LayoutMetrics &)metrics;
- (void)updateState:(const facebook::react::State::Shared &)state;
- (void)updateEventEmitter:(const facebook::react::EventEmitter::Shared &)emitter;
- (void)updateDesktopProps:(const ngn::DesktopProps &)props;
- (void)handleCommand:(const std::string &)name args:(const folly::dynamic &)args;
- (facebook::react::EventEmitter::Shared)eventEmitter;
- (const ngn::DesktopProps &)desktopProps;
- (facebook::react::Props::Shared)props;
- (facebook::react::State::Shared)state;
- (const facebook::react::LayoutMetrics &)layoutMetrics;
// What VoiceOver is told about the view (accessibility.h).
- (ngn::AxInfo)axInfo;
// The views it is labelled and described by (accessibility-relations.h), held weakly. Their text is
// its label, ahead of its own, and its help, ahead of its hint, read each time VoiceOver asks.
- (void)setLabelledBy:(NSArray<NGNView *> *)labelledBy describedBy:(NSArray<NGNView *> *)describedBy;
// The AppKit control or field inside the view that is the accessibility element where the view is
// not (isAccessibilityElement is NO): the relations' text is its label and help, which a view that
// holds one sets there, and clears with the relations. Nil for a view that is its own element.
- (NSView *)accessibilityControl;
// Sets the relations' text on the accessibilityControl again: after the control's own props were
// applied over it, or the text of a view named changed.
- (void)refreshControlRelations;
// Where Fabric children mount: the view itself, or a scroll view's document view.
- (NSView *)contentContainer;
// What takes the keyboard when Tab moves the focus here: the view itself, or the AppKit control
// or field it holds.
- (NSResponder *)keyboardResponder;
@end

// Hosts a real NSTextField, so the field editor, NSTextInputClient and IME are AppKit's own.
@interface NGNTextInputView : NGNView <NSTextFieldDelegate>
@end

// The view for a component name: a text field for TextInput, a plain NGNView otherwise.
NGNView *NGNMakeView(const facebook::react::ShadowView &view);
