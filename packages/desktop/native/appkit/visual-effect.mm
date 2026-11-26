#import "visual-effect.h"

namespace ngn::appkit {

namespace {

NSVisualEffectMaterial materialOf(VisualEffect::Material material) {
  using Material = VisualEffect::Material;
  switch (material) {
    case Material::Sidebar:
      return NSVisualEffectMaterialSidebar;
    case Material::WindowBackground:
      return NSVisualEffectMaterialWindowBackground;
    case Material::UnderWindowBackground:
      return NSVisualEffectMaterialUnderWindowBackground;
    case Material::ContentBackground:
      return NSVisualEffectMaterialContentBackground;
    case Material::UnderPageBackground:
      return NSVisualEffectMaterialUnderPageBackground;
    case Material::HeaderView:
      return NSVisualEffectMaterialHeaderView;
    case Material::Titlebar:
      return NSVisualEffectMaterialTitlebar;
    case Material::Menu:
      return NSVisualEffectMaterialMenu;
    case Material::Popover:
      return NSVisualEffectMaterialPopover;
    case Material::Sheet:
      return NSVisualEffectMaterialSheet;
    case Material::HudWindow:
      return NSVisualEffectMaterialHUDWindow;
    case Material::FullScreenUi:
      return NSVisualEffectMaterialFullScreenUI;
    case Material::Tooltip:
      return NSVisualEffectMaterialToolTip;
    case Material::Selection:
      return NSVisualEffectMaterialSelection;
  }
  return NSVisualEffectMaterialSidebar;
}

NSVisualEffectState stateOf(VisualEffect::State state) {
  switch (state) {
    case VisualEffect::State::Active:
      return NSVisualEffectStateActive;
    case VisualEffect::State::Inactive:
      return NSVisualEffectStateInactive;
    case VisualEffect::State::FollowsWindow:
      return NSVisualEffectStateFollowsWindowActiveState;
  }
  return NSVisualEffectStateFollowsWindowActiveState;
}

} // namespace

void applyVisualEffect(NSVisualEffectView *view, const VisualEffect &effect, CGFloat radius) {
  view.material = materialOf(effect.material);
  view.blendingMode = effect.blending == VisualEffect::Blending::WithinWindow ? NSVisualEffectBlendingModeWithinWindow
                                                                              : NSVisualEffectBlendingModeBehindWindow;
  view.state = stateOf(effect.state);
  view.emphasized = effect.emphasized;
  view.wantsLayer = YES;
  view.layer.cornerRadius = radius;
  view.layer.masksToBounds = radius > 0;
}

} // namespace ngn::appkit
