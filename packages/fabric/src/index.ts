/**
 * The engine's public surface.
 *
 * Nothing here imports Angular, and nothing here may start to: the engine stays
 * framework-agnostic (see docs/ARCHITECTURE.md), which is what keeps the commit logic testable without Angular in
 * the loop and a second adapter possible later.
 *
 * The CSS runtime lives here rather than in a package of its own because the cascade is driven
 * from the commit walk - the resolver runs per node, per tick - and because it is as
 * framework-agnostic as the rest of the engine. The build-time half of CSS is a different
 * animal and lives in `@ng-native/metro`.
 */
export {
  StyleResolver,
  matches,
  styleSheetOf,
  type AttributeTest,
  type Combinator,
  type Compound,
  type Conditions,
  type DeferredDeclaration,
  type GradientTemplate,
  type HslChannel,
  type MediaCondition,
  type NthTest,
  type RuleIndex,
  type StyleCache,
  type StyleRule,
  type StyleSheet,
  type StyleTarget,
  type TokenKind,
  type TokenValue,
} from './css.ts';
export { ELEMENT_STYLES, ELEMENT_STYLES_CSS } from './element-styles.ts';
export { EngineIntersectionObserver, installDeferTriggers } from './defer-triggers.ts';
export { faceName } from './font-faces.ts';
export { firstFamily } from './inline-token.ts';
export {
  DIRECT_EVENTS,
  Engine,
  SyntheticEvent,
  claimHost,
  keepNativeView,
  declareNativeProps,
  fontsLoading,
  fontsRegistered,
  fontsSettled,
  markComponentHost,
  nativePlatform,
  onFontsRegistered,
  onFontsSettled,
  registerHoist,
  registerPlatformComponents,
  registerViewName,
  type PlatformViewName,
  type ViewNameOptions,
  viewNameOf,
  type EngineNode,
  type EngineOptions,
  type EngineStats,
  type FabricNode,
  type FabricNodeSet,
  type FabricUIManager,
  type HoistOptions,
  type NativeSyntheticEvent,
  type NodeKind,
  type ResponderEvent,
  type ResponderHandlers,
  type TouchPayload,
  type ViewNameNode,
  type WindowFrame,
} from './engine.ts';
export { reportUnboundFormsInput, type NamedHostNode } from './forms-inputs.ts';
export { HostEngine, type HostNode, type Settling } from './host.ts';
export { getFabricUIManager } from './fabric.ts';
export {
  pinnedRange,
  type DrivenProperty,
  type EventFeed,
  type NativeAnimated,
  type ScrollAxis,
  type ScrollDrive,
  type ScrollRange,
  type StaticTransform,
} from './native-drive.ts';
export {
  bezier,
  interpolate,
  redirect,
  sample,
  settled,
  step,
  tracksOf,
  tween,
  type AnimationSpec,
  type Keyframe,
  type RunningAnimation,
  type Transition,
  type TransitionSpec,
} from './transition.ts';
