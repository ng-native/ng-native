/**
 * `@ng-icons/core` with its icon component the one that draws natively, which a library's import
 * of `@ng-icons/core` is resolved to under `withWebCompat` and `webCompat`: see `build.cjs`.
 */
import { NgIcon } from '@ng-native/icons';

export * from '@ng-icons/core';
export { NgIcon, NgIcon as NgIconComponent };
