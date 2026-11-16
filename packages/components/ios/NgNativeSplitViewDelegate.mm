#import "NgNativeSplitViewDelegate.h"

@implementation NgNativeSplitViewDelegate {
  __weak UISplitViewController *_controller;
  // Whether the app has shown the content: the top of the stack the columns collapse into.
  BOOL _contentShown;
  // The collapsed state last applied or reported, so a change is sent once.
  BOOL _collapsed;
  // While the columns expand out of the stack: the sidebar showing then is no step back.
  BOOL _expanding;
  // The controller's width and size class when a column was last laid out.
  CGFloat _settledWidth;
  UIUserInterfaceSizeClass _settledSizeClass;
}

- (instancetype)initWithController:(UISplitViewController *)controller
{
  if (self = [super init]) {
    _controller = controller;
  }
  return self;
}

- (void)setCollapsed:(BOOL)collapsed
{
  if (collapsed == _collapsed) {
    return;
  }
  _collapsed = collapsed;
  UISplitViewController *controller = _controller;
  controller.preferredDisplayMode = collapsed ? UISplitViewControllerDisplayModeSecondaryOnly
                                              : UISplitViewControllerDisplayModeOneBesideSecondary;
  if (!controller.isCollapsed) {
    collapsed ? [controller hideColumn:UISplitViewControllerColumnPrimary]
              : [controller showColumn:UISplitViewControllerColumnPrimary];
  }
}

- (void)showContent
{
  _contentShown = YES;
  UISplitViewController *controller = _controller;
  if (controller.isCollapsed || controller.displayMode == UISplitViewControllerDisplayModeOneOverSecondary) {
    [controller showColumn:UISplitViewControllerColumnSecondary];
  }
}

- (void)showSidebar
{
  _contentShown = NO;
  UISplitViewController *controller = _controller;
  if (controller.isCollapsed) {
    [controller showColumn:UISplitViewControllerColumnPrimary];
  }
}

- (void)columnLaidOut
{
  UISplitViewController *controller = _controller;
  _settledWidth = controller.view.bounds.size.width;
  _settledSizeClass = controller.traitCollection.horizontalSizeClass;
}

#pragma mark UISplitViewControllerDelegate

- (void)splitViewController:(UISplitViewController *)svc willChangeToDisplayMode:(UISplitViewControllerDisplayMode)displayMode
{
  if (svc.isCollapsed || displayMode == UISplitViewControllerDisplayModeAutomatic) {
    return;
  }
  BOOL collapsed = displayMode == UISplitViewControllerDisplayModeSecondaryOnly;
  if (collapsed == _collapsed) {
    return;
  }
  // A narrower window hides the sidebar, and a wider one brings it back: UIKit's, not the user's.
  if (svc.view.bounds.size.width != _settledWidth
      || svc.traitCollection.horizontalSizeClass != _settledSizeClass) {
    return;
  }
  // The user's choice, kept as the size changes, until the app says otherwise.
  _collapsed = collapsed;
  svc.preferredDisplayMode = collapsed ? UISplitViewControllerDisplayModeSecondaryOnly
                                       : UISplitViewControllerDisplayModeOneBesideSecondary;
  if (self.onCollapse) {
    self.onCollapse(collapsed);
  }
}

- (UISplitViewControllerColumn)splitViewController:(UISplitViewController *)svc
    topColumnForCollapsingToProposedTopColumn:(UISplitViewControllerColumn)proposedTopColumn
{
  return _contentShown ? UISplitViewControllerColumnSecondary : UISplitViewControllerColumnPrimary;
}

- (UISplitViewControllerDisplayMode)splitViewController:(UISplitViewController *)svc
                displayModeForExpandingToProposedDisplayMode:(UISplitViewControllerDisplayMode)proposedDisplayMode
{
  _expanding = YES;
  return _collapsed ? UISplitViewControllerDisplayModeSecondaryOnly
                    : UISplitViewControllerDisplayModeOneBesideSecondary;
}

- (void)splitViewControllerDidExpand:(UISplitViewController *)svc
{
  _expanding = NO;
}

- (void)splitViewControllerDidCollapse:(UISplitViewController *)svc
{
  _expanding = NO;
}

- (void)splitViewController:(UISplitViewController *)svc willShowColumn:(UISplitViewControllerColumn)column
{
  // Back from the content, in the stack the columns collapsed into. Expanding shows the sidebar
  // too, while the controller still says it is collapsed, and keeps what the app had shown.
  if (svc.isCollapsed && !_expanding && column == UISplitViewControllerColumnPrimary) {
    _contentShown = NO;
  }
}

@end
