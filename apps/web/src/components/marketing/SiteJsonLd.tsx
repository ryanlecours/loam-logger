import { PRO_PRICE_MONTHLY_USD, PRO_PRICE_YEARLY_USD } from '../../constants/pricing';
import { jsonLdString } from '../../prerender-inject';

/**
 * Organization and SoftwareApplication structured data for the landing page.
 * Rendered here rather than in index.html so it is prerendered on "/" only,
 * and so the prices come from the same constant the pricing page uses.
 */
const SITE_JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': 'https://loamlogger.app/#org',
      name: 'Loam Labs LLC',
      url: 'https://loamlogger.app/',
      logo: 'https://loamlogger.app/loamLoggerLogo_512x512.png',
      founder: { '@type': 'Person', name: 'Ryan LeCours' },
    },
    {
      '@type': 'SoftwareApplication',
      '@id': 'https://loamlogger.app/#app',
      name: 'Loam Logger',
      url: 'https://loamlogger.app/',
      applicationCategory: 'SportsApplication',
      operatingSystem: 'Web, iOS',
      description:
        'A mountain bike service tracker. Rides sync from Garmin Connect, Strava or WHOOP, ride hours accrue against every installed component, and each part is flagged against its service interval.',
      featureList: [
        'Automatic ride sync from Garmin Connect, Strava and WHOOP',
        'Hours on every component against a service interval you set',
        'Four-state component health: overdue, due now, due soon, all good',
        'Service log with dates and hours, shareable and exportable',
        'Bike spec import from 99spokes',
        'E-bike motor and battery hours',
      ],
      publisher: { '@id': 'https://loamlogger.app/#org' },
      offers: [
        {
          '@type': 'Offer',
          name: 'Free',
          price: '0',
          priceCurrency: 'USD',
          description:
            'One bike, every component type, automatic ride sync, service log, past-due flag. No trial period.',
        },
        {
          '@type': 'Offer',
          name: 'Pro, yearly',
          price: PRO_PRICE_YEARLY_USD.toFixed(2),
          priceCurrency: 'USD',
          description:
            'Unlimited bikes, due-soon warnings with rides left, service alerts and a weekly bike check, ride weather, PDF export, full ride history import.',
        },
        {
          '@type': 'Offer',
          name: 'Pro, monthly',
          price: PRO_PRICE_MONTHLY_USD.toFixed(2),
          priceCurrency: 'USD',
          description: 'The same Pro features, billed monthly.',
        },
      ],
      sameAs: ['https://apps.apple.com/us/app/loam-logger/id6761736134'],
    },
  ],
};

export default function SiteJsonLd() {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(SITE_JSON_LD) }} />;
}
