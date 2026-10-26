import { useEffect } from 'react';
import { Link } from 'react-router';
import { Check } from 'lucide-react';
import { usePageMeta } from '../hooks/usePageMeta';
import LandingNavbar from '../components/LandingNavbar';
import StoreBadges from '../components/marketing/StoreBadges';
import MarketingFooter from '../components/marketing/MarketingFooter';
import { APP_NODE_ID, ORG_NODE_ID } from '../components/marketing/SiteJsonLd';
import { APP_STORE_URL, PLAY_STORE_URL } from '../constants/storeLinks';
import { GET_THE_APP_ROUTE, jsonLdString } from '../prerender-inject';

/**
 * The download page: one URL to put in both store listings, in forum posts
 * and on a QR code, and the page that answers "is there an Android app?"
 * It is prerendered to its own file at build time (scripts/prerender-landing.mjs),
 * so its head here and in prerender-inject.ts say the same thing.
 */

const head = GET_THE_APP_ROUTE.head!;

const inTheApp = [
  'The same bikes, parts and service log as the web app, on the same account',
  'Rides arrive on their own from Garmin Connect™, Strava or WHOOP',
  'Every part shows its hours and whether it is overdue, due now, due soon or good to go',
  'Log a service or an inspection from the trailhead, with the hours filled in',
  'Free for one bike, with no card and no trial clock',
];

const steps = [
  {
    title: 'Install it',
    body: 'From the App Store on iPhone or Google Play on Android. Sign in with the account you use on the web, or make one in the app.',
  },
  {
    title: 'Connect once',
    body: 'Link Garmin Connect, Strava or WHOOP. If you already connected on the web, the app picks it up; there is nothing to do twice.',
  },
  {
    title: 'Check before you drop in',
    body: 'Open the app and the bike you are about to ride shows which parts are due. Log the service when you do it and the count starts over.',
  },
];

const PAGE_JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebPage',
      '@id': `${head.canonical}#page`,
      url: head.canonical,
      name: head.title,
      description: head.description,
      about: { '@id': APP_NODE_ID },
    },
    {
      '@type': 'MobileApplication',
      '@id': `${head.canonical}#ios`,
      name: 'Loam Logger for iOS',
      operatingSystem: 'iOS',
      applicationCategory: 'SportsApplication',
      installUrl: APP_STORE_URL,
      sameAs: APP_STORE_URL,
      isPartOf: { '@id': APP_NODE_ID },
      publisher: { '@id': ORG_NODE_ID },
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    },
    {
      '@type': 'MobileApplication',
      '@id': `${head.canonical}#android`,
      name: 'Loam Logger for Android',
      operatingSystem: 'Android',
      applicationCategory: 'SportsApplication',
      installUrl: PLAY_STORE_URL,
      sameAs: PLAY_STORE_URL,
      isPartOf: { '@id': APP_NODE_ID },
      publisher: { '@id': ORG_NODE_ID },
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    },
  ],
};

export default function GetTheApp() {
  usePageMeta(head);

  useEffect(() => {
    document.documentElement.classList.add('marketing-page');
    return () => {
      document.documentElement.classList.remove('marketing-page');
    };
  }, []);

  return (
    <main className="lp">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(PAGE_JSON_LD) }} />
      <LandingNavbar />

      <section className="lp-get" data-testid="get-the-app-hero">
        <img
          className="lp-get__photo"
          src="/ridingThroughFerns.jpg"
          alt="A rider threading singletrack through tall ferns"
          fetchPriority="high"
        />
        <div className="lp-get__shade" aria-hidden="true" />
        <div className="lp-container lp-get__content">
          <div className="lp-get__copy">
            <span className="lp-eyebrow">iOS and Android</span>
            <h1 className="lp-h1">
              Loam Logger, <em>in your pocket.</em>
            </h1>
            <p className="lp-lede">
              The app runs on the same account as the web app. Your rides sync from Garmin Connect,
              Strava or WHOOP, every part on the bike shows its hours, and the ones that are due say
              so before you leave the house.
            </p>
            <StoreBadges />
            <p className="lp-fine">
              Free for one bike. Prefer a bigger screen? <Link to="/signup">Start on the web</Link>{' '}
              and the app signs you straight in.
            </p>
          </div>

          <ul className="lp-free__card" aria-label="What the app does">
            {inTheApp.map((item) => (
              <li key={item}>
                <Check size={18} className="lp-plan__check" aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="lp-section lp-section--hemlock" id="how">
        <div className="lp-container">
          <span className="lp-eyebrow">Three steps</span>
          <h2 className="lp-h2">From install to a bike you trust.</h2>
          <ol className="lp-steps lp-get__steps">
            {steps.map((step, index) => (
              <li className="lp-step" key={step.title}>
                <div className="lp-step__head">
                  <span className="lp-step__num">{index + 1}</span>
                  <h3 className="lp-step__title">{step.title}</h3>
                </div>
                <p className="lp-step__body">{step.body}</p>
              </li>
            ))}
          </ol>
          <div className="lp-actions lp-get__actions">
            <a href={APP_STORE_URL} className="lp-btn lp-btn--primary" target="_blank" rel="noopener noreferrer">
              Get it on the App Store<span className="sr-only"> (opens in a new tab)</span>
            </a>
            <a href={PLAY_STORE_URL} className="lp-btn lp-btn--ghost" target="_blank" rel="noopener noreferrer">
              Get it on Google Play<span className="sr-only"> (opens in a new tab)</span>
            </a>
          </div>
          <p className="lp-fine">
            Something not working in the app? <Link to="/support">Support</Link> is the quickest way
            to reach us.
          </p>
        </div>
      </section>

      <MarketingFooter />
    </main>
  );
}
