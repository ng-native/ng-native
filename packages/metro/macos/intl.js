/**
 * The `Intl` a `linux` bundle installs before the app's code, since the Linux host's Hermes is
 * built without one: formatjs's polyfills, with English data and every time zone. Each installs only
 * what `Intl` lacks. Another locale's data is the app's to import, from the same packages'
 * `locale-data` folders. macOS keeps Hermes's own `Intl`.
 */
import '@formatjs/intl-getcanonicallocales/polyfill.js';
import '@formatjs/intl-locale/polyfill.js';
import '@formatjs/intl-pluralrules/polyfill.js';
import '@formatjs/intl-pluralrules/locale-data/en.js';
import '@formatjs/intl-numberformat/polyfill.js';
import '@formatjs/intl-numberformat/locale-data/en.js';
import '@formatjs/intl-datetimeformat/polyfill.js';
import '@formatjs/intl-datetimeformat/locale-data/en.js';
import '@formatjs/intl-datetimeformat/add-all-tz.js';
import '@formatjs/intl-relativetimeformat/polyfill.js';
import '@formatjs/intl-relativetimeformat/locale-data/en.js';
import '@formatjs/intl-listformat/polyfill.js';
import '@formatjs/intl-listformat/locale-data/en.js';
import '@formatjs/intl-displaynames/polyfill.js';
import '@formatjs/intl-displaynames/locale-data/en.js';
