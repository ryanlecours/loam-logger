import {
  APP_STORE_BADGE_SRC,
  APP_STORE_URL,
  PLAY_STORE_BADGE_SRC,
  PLAY_STORE_URL_FROM_SITE,
} from '../../constants/storeLinks';

type Props = {
  /** `sm` is the footer size; the default suits a hero or CTA. */
  size?: 'md' | 'sm';
  className?: string;
};

/**
 * The App Store and Google Play badges, side by side, in the stores' own
 * artwork. The link text is in the alt attribute, so a screen reader hears
 * "Download on the App Store" and "Get it on Google Play" rather than an
 * empty link, and the width/height attributes hold the row's size before
 * the images arrive.
 */
export default function StoreBadges({ size = 'md', className }: Props) {
  const classes = ['lp-store-badges', size === 'sm' ? 'lp-store-badges--sm' : null, className]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={classes}>
      <a href={APP_STORE_URL} target="_blank" rel="noopener noreferrer" className="lp-store-badges__apple">
        <img src={APP_STORE_BADGE_SRC} alt="Download on the App Store" width={250} height={83} loading="lazy" />
      </a>
      <a href={PLAY_STORE_URL_FROM_SITE} target="_blank" rel="noopener noreferrer" className="lp-store-badges__play">
        <img src={PLAY_STORE_BADGE_SRC} alt="Get it on Google Play" width={646} height={250} loading="lazy" />
      </a>
    </div>
  );
}
