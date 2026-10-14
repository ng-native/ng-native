/**
 * Icons, from the `@ng-icons` packages a web app already uses.
 *
 * The icon sets are plain strings of SVG markup and `provideIcons` is ordinary DI, so both come
 * across untouched; what this replaces is the rendering, which on the web is `innerHTML` and here
 * is react-native-svg's native shapes.
 */
export { NgIcon } from './ng-icon.ts';
export { type SvgNode } from './parse-svg.ts';
export { SvgImages, type SvgImagesNative } from './svg-images.ts';
export { brushOf, nativeProps, viewBoxProps, type Brush, type SvgContext } from './svg-props.ts';
