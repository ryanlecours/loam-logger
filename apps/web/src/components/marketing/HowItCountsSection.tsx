const steps = [
  {
    title: 'Connect what you already record with',
    body: 'Garmin Connect™, Strava or WHOOP. Suunto is in progress. Rides show up a few minutes after you save them, and your back catalog imports a year at a time so a bike you’ve had since 2023 starts with the right hours on it. If the same ride lands from two platforms, it’s counted once.',
  },
  {
    title: 'Tell it what’s on the bike',
    body: 'Fork, shock, dropper, pads, rotors, chain, cassette, pivot bearings, hubs, headset. Pull the stock build from 99spokes and swap in whatever you’ve changed. Each ride’s duration goes onto every part that was installed at the time. Spares sit on the shelf with their hours intact, so a fork that moves between two bikes keeps its count.',
  },
  {
    title: 'Set your own intervals',
    body: 'An hour of fire road climbing and an hour of park laps are not the same hour. Fox says one number, RockShox says another, your suspension guy says less than both. The intervals are yours to set per part. Run lowers at 50 on the park bike and 100 on the XC bike if that’s how they actually wear.',
  },
  {
    title: 'Log the service when you do it',
    body: 'Did the lowers Saturday? Log it. The clock resets and the entry stays: date, hours at service, what you replaced. Three years on you have the full history of the bike, and when you sell it the buyer gets the receipts instead of “it’s been looked after”.',
  },
];

export default function HowItCountsSection() {
  return (
    <section id="how" className="lp-section lp-section--hemlock">
      <div className="lp-container">
        <div className="lp-intro">
          <h2 className="lp-h2">How it counts hours</h2>
          <p className="lp-copy">
            You don&apos;t type anything in after a ride. The ride file you already save is the input.
          </p>
        </div>

        <ol className="lp-steps">
          {steps.map((step, index) => (
            <li key={step.title} className="lp-step">
              <div className="lp-step__head">
                <span className="lp-step__num">{index + 1}</span>
                <h3 className="lp-step__title">{step.title}</h3>
              </div>
              <p className="lp-copy lp-step__body">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
