// The NSView every Fabric view mounts as: layer-backed, flipped, placed at Yoga's frame.
// A Paragraph draws its text with Core Text; a TextInput hosts a real NSTextField.
#pragma once

#import <AppKit/AppKit.h>

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
