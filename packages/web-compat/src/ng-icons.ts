/**
 * `@ng-icons/core` as a component library imports it, with the icon component the one that draws
 * natively. Everything else is the real module's own, so an app's `provideIcons()` and a
 * library's are one registry. The build resolves a library's import here: see `build.cjs`.
 */
import { NgIcon } from '@ng-native/icons';

export * from '@ng-icons/core';
export { NgIcon, NgIcon as NgIconComponent };
/** The directives a module imports for icons, which is the one component. */
export const NG_ICON_DIRECTIVES = [NgIcon] as const;
