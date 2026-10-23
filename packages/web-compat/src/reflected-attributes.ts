import { editedByContent } from './element-tree.ts';
import {
  action,
  baseHref,
  boolean,
  contentOf,
  double,
  enumerated,
  long,
  nullable,
  nullAsEmpty,
  own,
  string,
  unsigned,
  url,
  type Reflecting,
  type Reflection,
} from './reflect.ts';

/**
 * Which properties of which HTML elements reflect an attribute, and how: see `reflect.ts`. Those
 * every HTML element has, and those of the elements a component library reads and writes, by
 * element name. A property an element has no reflection for is what the package had for it
 * before, or nothing.
 */

type Table = Readonly<Record<string, Reflection>>;

/** The elements a key reaches with no `tabindex` written. */
const FOCUSED_BY_A_KEY = new Set([
  'a',
  'area',
  'button',
  'iframe',
  'input',
  'select',
  'summary',
  'textarea',
]);

/** HTML's `hidden`: there or not, or `'until-found'`, which keeps its box until a find reaches it. */
const hidden: Reflection = {
  get: (node) => {
    const written = contentOf(node, 'hidden', 'hidden');
    if (written === null || node.props['hidden'] === false) return false;
    return written.toLowerCase() === 'until-found' ? 'until-found' : true;
  },
  set: (node, value) => {
    if (typeof value === 'string' && value.toLowerCase() === 'until-found') {
      node.setAttribute('hidden', 'until-found');
    } else if (value) node.setAttribute('hidden', '');
    else node.removeAttribute('hidden');
  },
};

/**
 * HTML's `draggable`: `true` or `false` by the attribute, and for an image or a link with an
 * `href` where it says neither, as a browser drags those unasked. Anything set is a boolean.
 */
const draggable: Reflection = {
  get: (node) => {
    const written = node.getAttribute('draggable')?.toLowerCase();
    if (written === 'true') return true;
    if (written === 'false') return false;
    return node.tag === 'img' || (node.tag === 'a' && node.getAttribute('href') !== null);
  },
  set: (node, value) => node.setAttribute('draggable', value ? 'true' : 'false'),
};

const DIRECTION = { keywords: ['ltr', 'rtl', 'auto'] };
const INPUT_MODE = {
  keywords: ['none', 'text', 'tel', 'url', 'email', 'numeric', 'decimal', 'search'],
};
const ENTER_KEY = { keywords: ['enter', 'done', 'go', 'next', 'previous', 'search', 'send'] };

/** `ariaReadOnly`'s attribute is `aria-readonly`: the property's name, in lower case. */
const ariaAttribute = (property: string) => `aria-${property.slice(4).toLowerCase()}`;

const ARIA_STRINGS = [
  'ariaBrailleLabel',
  'ariaBrailleRoleDescription',
  'ariaColCount',
  'ariaColIndex',
  'ariaColIndexText',
  'ariaColSpan',
  'ariaDescription',
  'ariaKeyShortcuts',
  'ariaLabel',
  'ariaLevel',
  'ariaPlaceholder',
  'ariaPosInSet',
  'ariaRelevant',
  'ariaRoleDescription',
  'ariaRowCount',
  'ariaRowIndex',
  'ariaRowIndexText',
  'ariaRowSpan',
  'ariaSetSize',
  'ariaValueMax',
  'ariaValueMin',
  'ariaValueNow',
  'ariaValueText',
];

const TRUE_FALSE = ['true', 'false'];

/** The ARIA states of fixed keywords, with what one that is none of them reads as. */
const ARIA_KEYWORDS: Readonly<Record<string, [keywords: string[], invalid?: string]>> = {
  ariaAtomic: [TRUE_FALSE, 'false'],
  ariaAutoComplete: [['inline', 'list', 'both', 'none'], 'none'],
  ariaBusy: [TRUE_FALSE, 'false'],
  ariaChecked: [['true', 'false', 'mixed']],
  ariaCurrent: [['page', 'step', 'location', 'date', 'time', 'true', 'false'], 'true'],
  ariaDisabled: [TRUE_FALSE, 'false'],
  ariaExpanded: [TRUE_FALSE],
  ariaHasPopup: [['true', 'false', 'menu', 'dialog', 'listbox', 'tree', 'grid'], 'false'],
  ariaHidden: [TRUE_FALSE, 'false'],
  ariaInvalid: [['true', 'false', 'spelling', 'grammar'], 'true'],
  ariaLive: [['polite', 'assertive', 'off'], 'off'],
  ariaModal: [TRUE_FALSE, 'false'],
  ariaMultiLine: [TRUE_FALSE, 'false'],
  ariaMultiSelectable: [TRUE_FALSE, 'false'],
  ariaOrientation: [['horizontal', 'vertical']],
  ariaPressed: [['true', 'false', 'mixed']],
  ariaReadOnly: [TRUE_FALSE, 'false'],
  ariaRequired: [TRUE_FALSE, 'false'],
  ariaSelected: [TRUE_FALSE],
  ariaSort: [['ascending', 'descending', 'other', 'none'], 'none'],
};

/** ARIA's, which every element reflects: `role`, strings, and states with keywords or none. */
const ARIA: Table = {
  role: nullable('role'),
  ...Object.fromEntries(ARIA_STRINGS.map((name) => [name, nullable(ariaAttribute(name), name)])),
  ...Object.fromEntries(
    Object.entries(ARIA_KEYWORDS).map(([name, [keywords, invalid = null]]) => [
      name,
      enumerated(ariaAttribute(name), { keywords, missing: null, invalid }, name),
    ]),
  ),
};

/** What `nonce` was set to by the property, and what the attribute was then. */
const nonces = new WeakMap<object, { readonly value: string; readonly attribute: string | null }>();

/**
 * `nonce`: set by the property, it is kept apart from the attribute, which HTML hides from a
 * stylesheet that could read it. The attribute written again is what it is.
 */
const nonce: Reflection = {
  get: (node) => {
    const attribute = node.getAttribute('nonce');
    const set = nonces.get(node);
    return set && set.attribute === attribute ? set.value : (attribute ?? '');
  },
  set: (node, value) => {
    nonces.set(node, { value: String(value), attribute: node.getAttribute('nonce') });
  },
};

/** What every HTML element reflects. */
export const GLOBAL: Table = {
  ...ARIA,
  title: string('title'),
  lang: string('lang'),
  dir: enumerated('dir', DIRECTION),
  accessKey: string('accesskey', 'accessKey'),
  autofocus: boolean('autofocus'),
  hidden,
  draggable,
  // Read only: what `contenteditable` makes of the element, or of the one it is in.
  isContentEditable: own(editedByContent),
  inert: boolean('inert'),
  slot: string('slot'),
  nonce,
  inputMode: enumerated('inputmode', INPUT_MODE, 'inputMode'),
  enterKeyHint: enumerated('enterkeyhint', ENTER_KEY, 'enterKeyHint'),
  tabIndex: long(
    'tabindex',
    { fallback: (node: Reflecting) => (FOCUSED_BY_A_KEY.has(node.tag) ? 0 : -1) },
    'tabIndex',
  ),
};

const ENCODINGS = ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'];
const encoding = (attribute: string, property: string, missing = '') =>
  enumerated(
    attribute,
    { keywords: ENCODINGS, missing, invalid: 'application/x-www-form-urlencoded' },
    property,
  );
const formMethod = (keywords: string[]) =>
  enumerated('formmethod', { keywords, invalid: 'get' }, 'formMethod');

/** What a button and an input that submits a form say of how it is sent. */
const SUBMITTER: Table = {
  formAction: action('formaction', 'formAction'),
  formEnctype: encoding('formenctype', 'formEnctype'),
  formNoValidate: boolean('formnovalidate', 'formNoValidate'),
  formTarget: string('formtarget', 'formTarget'),
};

/** What every form control that can be turned off and required has. */
const CONTROL: Table = {
  disabled: boolean('disabled'),
  autocomplete: string('autocomplete'),
};

const INPUT_TYPES = [
  'hidden',
  'text',
  'search',
  'tel',
  'url',
  'email',
  'password',
  'date',
  'month',
  'week',
  'time',
  'datetime-local',
  'number',
  'range',
  'color',
  'checkbox',
  'radio',
  'file',
  'submit',
  'image',
  'reset',
  'button',
];

/** What a text field and a text area both have. */
const TYPED: Table = {
  dirName: string('dirname', 'dirName'),
  maxLength: long('maxlength', { fallback: -1, nonNegative: true }, 'maxLength'),
  minLength: long('minlength', { fallback: -1, nonNegative: true }, 'minLength'),
  placeholder: string('placeholder'),
  readOnly: boolean('readonly', 'readOnly'),
  required: boolean('required'),
};

const LINK: Table = {
  href: url('href'),
  target: string('target'),
  download: string('download'),
  ping: string('ping'),
  rel: string('rel'),
  hreflang: string('hreflang'),
  type: string('type'),
};

/** The obsolete `align` most elements of text and of a table had. */
const ALIGNED: Table = { align: string('align') };
/** A list's obsolete `compact`. */
const COMPACT: Table = { compact: boolean('compact') };
/** A box's size as the attributes say it, which is text. */
const SIZED: Table = { width: string('width'), height: string('height') };
/** The space beside an image or an object, in pixels. */
const SPACED: Table = { hspace: unsigned('hspace'), vspace: unsigned('vspace') };
/** What the rows and the groups of a table had, before CSS. */
const TABLE_PART: Table = {
  ...ALIGNED,
  ch: string('char', 'ch'),
  chOff: string('charoff', 'chOff'),
  vAlign: string('valign', 'vAlign'),
};
/** The frame of a frame or an inline frame. */
const FRAMED: Table = {
  scrolling: string('scrolling'),
  frameBorder: string('frameborder', 'frameBorder'),
  longDesc: url('longdesc', 'longDesc'),
  marginHeight: nullAsEmpty('marginheight', 'marginHeight'),
  marginWidth: nullAsEmpty('marginwidth', 'marginWidth'),
};
/** What loads its media when it is about to be seen, or at once. */
const LOADING = enumerated('loading', {
  keywords: ['lazy', 'eager'],
  missing: 'eager',
  invalid: 'eager',
});
const DESTINATIONS = [
  ...['fetch', 'audio', 'document', 'embed', 'font', 'image', 'manifest', 'object', 'report'],
  ...['script', 'sharedworker', 'style', 'track', 'video', 'worker', 'xslt'],
];

/** Who a request for what an element loads is sent with, and where it says it came from. */
const FETCHED: Table = {
  crossOrigin: enumerated(
    'crossorigin',
    { keywords: ['anonymous', 'use-credentials'], missing: null, invalid: 'anonymous' },
    'crossOrigin',
  ),
  referrerPolicy: enumerated(
    'referrerpolicy',
    {
      keywords: [
        '',
        'no-referrer',
        'no-referrer-when-downgrade',
        'same-origin',
        'origin',
        'strict-origin',
        'origin-when-cross-origin',
        'strict-origin-when-cross-origin',
        'unsafe-url',
      ],
    },
    'referrerPolicy',
  ),
};

const MEDIA: Table = {
  crossOrigin: FETCHED['crossOrigin']!,
  loading: LOADING,
  src: url('src'),
  autoplay: boolean('autoplay'),
  loop: boolean('loop'),
  controls: boolean('controls'),
  defaultMuted: boolean('muted', 'defaultMuted'),
  preload: enumerated('preload', {
    keywords: ['none', 'metadata', 'auto'],
    missing: 'metadata',
    invalid: 'auto',
  }),
};

const CITED: Table = { cite: url('cite'), dateTime: string('datetime', 'dateTime') };
const CELL: Table = {
  ...TABLE_PART,
  ...SIZED,
  axis: string('axis'),
  noWrap: boolean('nowrap', 'noWrap'),
  bgColor: nullAsEmpty('bgcolor', 'bgColor'),
  abbr: string('abbr'),
  headers: string('headers'),
  colSpan: unsigned('colspan', { fallback: 1, clamp: [1, 1000] }, 'colSpan'),
  rowSpan: unsigned('rowspan', { fallback: 1, clamp: [0, 65534] }, 'rowSpan'),
  scope: enumerated('scope', { keywords: ['row', 'col', 'rowgroup', 'colgroup'] }),
};

/** What each element reflects besides what every one does. */
export const BY_ELEMENT: Readonly<Record<string, Table>> = {
  a: {
    name: string('name'),
    ...LINK,
    referrerPolicy: FETCHED['referrerPolicy']!,
    coords: string('coords'),
    shape: string('shape'),
    noHref: boolean('nohref', 'noHref'),
    rev: string('rev'),
    charset: string('charset'),
  },
  area: {
    ...LINK,
    referrerPolicy: FETCHED['referrerPolicy']!,
    alt: string('alt'),
    coords: string('coords'),
    shape: string('shape'),
    noHref: boolean('nohref', 'noHref'),
  },
  img: {
    name: string('name'),
    ...FETCHED,
    alt: string('alt'),
    src: url('src'),
    srcset: string('srcset'),
    sizes: string('sizes'),
    useMap: string('usemap', 'useMap'),
    isMap: boolean('ismap', 'isMap'),
    loading: enumerated('loading', { keywords: ['lazy', 'eager'], missing: 'eager' }),
    decoding: enumerated('decoding', { keywords: ['sync', 'async', 'auto'], missing: 'auto' }),
    ...ALIGNED,
    ...SPACED,
    lowsrc: url('lowsrc'),
    longDesc: url('longdesc', 'longDesc'),
    border: nullAsEmpty('border'),
  },
  label: { htmlFor: string('for', 'htmlFor') },
  form: {
    name: string('name'),
    acceptCharset: string('accept-charset', 'acceptCharset'),
    action: action('action'),
    autocomplete: enumerated('autocomplete', { keywords: ['on', 'off'], missing: 'on' }),
    enctype: encoding('enctype', 'enctype', ENCODINGS[0]),
    encoding: encoding('enctype', 'encoding', ENCODINGS[0]),
    method: enumerated('method', { keywords: ['get', 'post', 'dialog'], missing: 'get' }),
    noValidate: boolean('novalidate', 'noValidate'),
    target: string('target'),
    rel: string('rel'),
  },
  input: {
    name: string('name'),
    ...CONTROL,
    ...SUBMITTER,
    ...TYPED,
    formMethod: formMethod(['get', 'post']),
    accept: string('accept'),
    alt: string('alt'),
    defaultChecked: boolean('checked', 'defaultChecked'),
    defaultValue: string('value', 'defaultValue'),
    max: string('max'),
    min: string('min'),
    step: string('step'),
    pattern: string('pattern'),
    multiple: boolean('multiple'),
    size: unsigned('size', { fallback: 20, positive: true }),
    src: url('src'),
    type: enumerated('type', { keywords: INPUT_TYPES, missing: 'text' }),
    useMap: string('usemap', 'useMap'),
    align: string('align'),
  },
  button: {
    name: string('name'),
    ...SUBMITTER,
    disabled: boolean('disabled'),
    formMethod: formMethod(['get', 'post', 'dialog']),
    type: enumerated('type', { keywords: ['submit', 'reset', 'button'], missing: 'submit' }),
    value: string('value'),
  },
  select: {
    name: string('name'),
    ...CONTROL,
    multiple: boolean('multiple'),
    required: boolean('required'),
    size: unsigned('size'),
  },
  textarea: {
    name: string('name'),
    ...CONTROL,
    ...TYPED,
    cols: unsigned('cols', { fallback: 20, positive: true, orFallback: true }),
    rows: unsigned('rows', { fallback: 2, positive: true, orFallback: true }),
    wrap: string('wrap'),
  },
  fieldset: { name: string('name'), disabled: boolean('disabled') },
  legend: ALIGNED,
  caption: ALIGNED,
  div: ALIGNED,
  p: ALIGNED,
  ...Object.fromEntries(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map((name) => [name, ALIGNED])),
  hr: {
    ...ALIGNED,
    color: string('color'),
    noShade: boolean('noshade', 'noShade'),
    size: string('size'),
    width: string('width'),
  },
  pre: { width: long('width') },
  br: { clear: string('clear') },
  font: { color: nullAsEmpty('color'), face: string('face'), size: string('size') },
  body: {
    text: nullAsEmpty('text'),
    link: nullAsEmpty('link'),
    vLink: nullAsEmpty('vlink', 'vLink'),
    aLink: nullAsEmpty('alink', 'aLink'),
    bgColor: nullAsEmpty('bgcolor', 'bgColor'),
    background: string('background'),
  },
  ul: { ...COMPACT, type: string('type') },
  dl: COMPACT,
  menu: COMPACT,
  dir: COMPACT,
  progress: { max: double('max', { fallback: 1, positive: true }) },
  meter: {
    value: double('value'),
    min: double('min'),
    max: double('max'),
    low: double('low'),
    high: double('high'),
    optimum: double('optimum'),
  },
  table: {
    ...ALIGNED,
    border: string('border'),
    frame: string('frame'),
    rules: string('rules'),
    summary: string('summary'),
    width: string('width'),
    bgColor: nullAsEmpty('bgcolor', 'bgColor'),
    cellPadding: nullAsEmpty('cellpadding', 'cellPadding'),
    cellSpacing: nullAsEmpty('cellspacing', 'cellSpacing'),
  },
  tbody: TABLE_PART,
  thead: TABLE_PART,
  tfoot: TABLE_PART,
  tr: { ...TABLE_PART, bgColor: nullAsEmpty('bgcolor', 'bgColor') },
  marquee: {
    behavior: enumerated('behavior', {
      keywords: ['scroll', 'slide', 'alternate'],
      missing: 'scroll',
    }),
    bgColor: string('bgcolor', 'bgColor'),
    direction: enumerated('direction', {
      keywords: ['up', 'right', 'down', 'left'],
      missing: 'left',
    }),
    ...SIZED,
    ...SPACED,
    scrollAmount: unsigned('scrollamount', { fallback: 6 }, 'scrollAmount'),
    scrollDelay: unsigned('scrolldelay', { fallback: 85 }, 'scrollDelay'),
    trueSpeed: boolean('truespeed', 'trueSpeed'),
  },
  frameset: { cols: string('cols'), rows: string('rows') },
  frame: {
    name: string('name'),
    src: url('src'),
    noResize: boolean('noresize', 'noResize'),
    ...FRAMED,
  },
  optgroup: { disabled: boolean('disabled'), label: string('label') },
  option: {
    disabled: boolean('disabled'),
    defaultSelected: boolean('selected', 'defaultSelected'),
  },
  details: { open: boolean('open') },
  dialog: { open: boolean('open') },
  ol: {
    ...COMPACT,
    reversed: boolean('reversed'),
    start: long('start', { fallback: 1 }),
    type: string('type'),
  },
  li: { value: long('value'), type: string('type') },
  data: { value: string('value') },
  q: CITED,
  blockquote: CITED,
  del: CITED,
  ins: CITED,
  time: { dateTime: string('datetime', 'dateTime') },
  td: CELL,
  th: CELL,
  col: {
    span: unsigned('span', { fallback: 1, clamp: [1, 1000] }),
    ...TABLE_PART,
    width: string('width'),
  },
  colgroup: {
    span: unsigned('span', { fallback: 1, clamp: [1, 1000] }),
    ...TABLE_PART,
    width: string('width'),
  },
  video: {
    ...MEDIA,
    poster: url('poster'),
    playsInline: boolean('playsinline', 'playsInline'),
    width: unsigned('width'),
    height: unsigned('height'),
  },
  audio: MEDIA,
  source: {
    src: url('src'),
    type: string('type'),
    srcset: string('srcset'),
    sizes: string('sizes'),
    media: string('media'),
  },
  track: {
    kind: enumerated('kind', {
      keywords: ['subtitles', 'captions', 'descriptions', 'chapters', 'metadata'],
      missing: 'subtitles',
      invalid: 'metadata',
    }),
    src: url('src'),
    srclang: string('srclang'),
    label: string('label'),
    default: boolean('default'),
  },
  iframe: {
    name: string('name'),
    referrerPolicy: FETCHED['referrerPolicy']!,
    src: url('src'),
    srcdoc: string('srcdoc'),
    allow: string('allow'),
    allowFullscreen: boolean('allowfullscreen', 'allowFullscreen'),
    ...SIZED,
    ...ALIGNED,
    ...FRAMED,
  },
  link: {
    ...FETCHED,
    href: url('href'),
    rel: string('rel'),
    media: string('media'),
    hreflang: string('hreflang'),
    type: string('type'),
    integrity: string('integrity'),
    as: enumerated('as', { keywords: DESTINATIONS }),
    charset: string('charset'),
    rev: string('rev'),
    target: string('target'),
  },
  meta: {
    name: string('name'),
    content: string('content'),
    httpEquiv: string('http-equiv', 'httpEquiv'),
    media: string('media'),
    scheme: string('scheme'),
  },
  script: {
    ...FETCHED,
    src: url('src'),
    type: string('type'),
    noModule: boolean('nomodule', 'noModule'),
    defer: boolean('defer'),
    integrity: string('integrity'),
    charset: string('charset'),
    event: string('event'),
    htmlFor: string('for', 'htmlFor'),
  },
  style: { media: string('media'), type: string('type') },
  base: { href: baseHref, target: string('target') },
  embed: { src: url('src'), type: string('type'), name: string('name'), ...SIZED, ...ALIGNED },
  object: {
    name: string('name'),
    data: url('data'),
    type: string('type'),
    useMap: string('usemap', 'useMap'),
    ...SIZED,
    ...ALIGNED,
    ...SPACED,
    archive: string('archive'),
    code: string('code'),
    declare: boolean('declare'),
    standby: string('standby'),
    codeBase: url('codebase', 'codeBase'),
    codeType: string('codetype', 'codeType'),
    border: nullAsEmpty('border'),
  },
  html: { version: string('version') },
  map: { name: string('name') },
  output: { name: string('name') },
  param: {
    name: string('name'),
    value: string('value'),
    type: string('type'),
    valueType: string('valuetype', 'valueType'),
  },
  slot: { name: string('name') },
};
