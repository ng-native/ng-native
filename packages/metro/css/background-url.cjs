/**
 * A background of one image, `background: url('/wallpaper.jpg') center / cover`, in a sheet read
 * as a browser reads it. Native paints gradients alone as a background, so the image is kept as
 * `backgroundUrl`, which `@ng-native/web-compat` draws as an image under what the box holds. Its
 * size, position and repeat are compiled as a gradient's are, which the drawing reads, and the
 * rest of the declaration, a colour say, as it is written.
 *
 * ponytail: one layer. A url among other layers, `url(a.png), linear-gradient(...)`, is refused
 * as before; draw each layer if a library is seen writing several.
 */
const { CssUnsupported } = require('./values.cjs');

/**
 * `backgroundUrl` taken off by a background of no url() compiled into `out`, as a later image
 * replaces an earlier one: `background-image: none` over a rule's `url()`.
 */
function clearBackgroundUrl(declaration, out) {
  const property =
    declaration.property === 'unparsed'
      ? declaration.value?.propertyId?.property
      : declaration.property;
  if (property === 'background' || property === 'background-image') out.backgroundUrl = null;
}

/**
 * Whether a declaration is a background of one url(), compiled into `out`: the url as
 * `backgroundUrl`, and the rest by `add`, as any declaration is.
 */
function readBackgroundUrl(declaration, out, context, add) {
  const property = declaration.property;
  if (property !== 'background' && property !== 'background-image') return false;
  const layers = Array.isArray(declaration.value) ? declaration.value : [];
  const images = property === 'background' ? layers.map((layer) => layer?.image) : layers;
  const url = images.find((image) => image?.type === 'url');
  if (!url) return false;
  if (images.length !== 1) {
    throw new CssUnsupported(
      `${context}: a url() among other background layers is not drawn. One image alone is.`,
    );
  }
  const none = { type: 'none' };
  const rest = property === 'background' ? [{ ...layers[0], image: none }] : [none];
  add({ property, value: rest });
  out.backgroundUrl = `url(${JSON.stringify(url.value.url)})`;
  return true;
}

module.exports = { readBackgroundUrl, clearBackgroundUrl };
