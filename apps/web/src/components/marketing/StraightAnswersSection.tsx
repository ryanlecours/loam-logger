import { formatUsd, PRO_PRICE_YEARLY_USD } from '../../constants/pricing';
import { jsonLdString } from '../../prerender-inject';

const answers = [
  {
    q: 'Does it know when my chain is worn?',
    a: 'No. It knows the hours on it. A chain checker knows if it’s worn, and your eyes know if the pads are done. Hours tell you when to go look, which is the part people skip.',
  },
  {
    q: 'What counts as an hour?',
    a: 'Whatever your ride file says the ride lasted. If you record a park day as one activity, that’s a long day on the fork, which is probably fair. If you only record the descents, set shorter intervals.',
  },
  {
    q: 'Do I have to use Strava?',
    a: 'No. Garmin Connect™ and WHOOP work on their own, Suunto is coming. You do need to record rides somewhere. The hours have to come from a ride file; there’s no magic.',
  },
  {
    q: 'Is it going to nag me?',
    a: 'Free has no alerts at all. You open it, you look. Pro adds a service-due alert and one weekly check across your bikes, and both can be turned off.',
  },
  {
    q: 'What does Free actually leave out?',
    a: 'The early warning. Free shows the hours on every part against its interval and flags it once it’s past due. Pro flags it while it’s still due soon, with an estimate of the rides left, so the seal kit is on the bench before the fork needs it. Pro also lifts the one-bike limit.',
  },
  {
    q: 'Is this another subscription?',
    a: `Free covers one bike: every part, ride sync, the service log, and a flag when something is past its interval. Not a trial, nothing expires. Pro is ${formatUsd(PRO_PRICE_YEARLY_USD)} a year if you run a quiver and want the due-soon heads-up and the alerts. One person builds this, and that’s what keeps the server on.`,
  },
  {
    q: 'There are other trackers. Why this one?',
    a: 'Most hang off one platform. This one takes rides from Garmin Connect™, Strava or WHOOP, whichever you already use, and it does more with them than add up hours: rides left until each part is due, weather on every ride, hours per part across every bike you own. The history isn’t locked in either. Every install and service exports to a PDF, which is what a buyer actually wants to see when you sell.',
  },
  {
    q: 'E-bike?',
    a: 'Motor and battery get hours like any other part. They don’t get a service state, because ride time says nothing useful about motor assist or battery cycles and we’re not going to pretend it does.',
  },
];

// The same questions as FAQPage structured data, so search engines and AI
// crawlers can lift the answers verbatim instead of paraphrasing the page.
const faqJsonLd = jsonLdString({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: answers.map((item) => ({
    '@type': 'Question',
    name: item.q,
    acceptedAnswer: { '@type': 'Answer', text: item.a },
  })),
});

export default function StraightAnswersSection() {
  return (
    <section id="answers" className="lp-section">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: faqJsonLd }} />
      <div className="lp-container lp-answers">
        <div className="lp-answers__aside">
          <h2 className="lp-h2">Straight answers</h2>
          <p className="lp-copy">What people ask when one of these gets posted.</p>
          <div className="lp-answers__photo">
            <img
              src="/ridingThroughFerns.jpg"
              width={2048}
              height={1365}
              alt="Two riders descending a fern-lined trail between firs"
              loading="lazy"
            />
          </div>
        </div>

        <dl className="lp-faq">
          {answers.map((item) => (
            <div key={item.q} className="lp-faq__item">
              <dt className="lp-faq__q">{item.q}</dt>
              <dd className="lp-faq__a">{item.a}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
