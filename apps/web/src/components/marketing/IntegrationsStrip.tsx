export default function IntegrationsStrip() {
  return (
    <section className="lp-strip" aria-label="Supported ride platforms">
      <div className="lp-container lp-strip__inner">
        <p className="lp-strip__copy">
          Pulls rides from whatever you already record on. Connect once and forget it.
        </p>
        <ul className="lp-chips">
          <li className="lp-chip">Garmin Connect™</li>
          <li className="lp-chip">Strava</li>
          <li className="lp-chip">WHOOP</li>
          <li className="lp-chip lp-chip--pending">
            Suunto <span className="lp-chip__tag">in progress</span>
          </li>
        </ul>
      </div>
    </section>
  );
}
