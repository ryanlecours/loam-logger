/**
 * The one place the app store identities live. The web app links to the
 * stores from the landing page, the footer, the /app page, the structured
 * data and the web manifest, and the crawler files in public/ are checked
 * against these values in seo-files.test.ts.
 */
export const APPLE_APP_ID = '6761736134';
export const APP_STORE_URL = `https://apps.apple.com/us/app/loam-logger/id${APPLE_APP_ID}`;

export const ANDROID_PACKAGE = 'com.loamlabs.loamlogger';
export const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;

/**
 * Play passes the `referrer` value to the installed app through the Install
 * Referrer API, so installs that started on the site can be told apart from
 * store search. The app does not read it yet; the value is there for when
 * it does, and the clean URL above is the one to publish anywhere else.
 */
export const PLAY_STORE_URL_FROM_SITE = `${PLAY_STORE_URL}&referrer=${encodeURIComponent(
  'utm_source=loamlogger.app&utm_medium=web',
)}`;

/**
 * Official badge artwork, served by the stores' own badge tools. Both
 * programs require the artwork unmodified, so the images are theirs to
 * host and ours to size; the Guest Jersey Rule in DESIGN.md applies.
 * Apple's badge is 250x83 and Google's 646x250 with transparent padding
 * built in, which is why the CSS gives the Play badge the taller box.
 */
export const APP_STORE_BADGE_SRC =
  'https://toolbox.marketingtools.apple.com/api/badges/download-on-the-app-store/black/en-us?size=250x83';
export const PLAY_STORE_BADGE_SRC =
  'https://play.google.com/intl/en_us/badges/static/images/badges/en_badge_web_generic.png';
