export default function PhotoBandSection() {
  return (
    <section className="lp-band">
      <img
        className="lp-band__photo"
        src="/TommyBermGap.jpg"
        alt="Rider gapping a berm in late evening light"
        loading="lazy"
      />
      <div className="lp-band__shade" aria-hidden="true" />
      <div className="lp-container lp-band__content">
        <p className="lp-band__line">Fewer mechanicals.</p>
        <p className="lp-band__line lp-band__line--accent">More good rides.</p>
        <p className="lp-lede" style={{ marginTop: '1rem', maxWidth: '48ch' }}>
          The same amount of wrenching, with less of it done on the side of the trail.
        </p>
      </div>
    </section>
  );
}
