/**
 * The question riders actually ask each other, and the dashboard that answers it.
 * The mock is static sample data: it illustrates the four health states, it is
 * not a claim about anyone's bike.
 */
export default function HoursSection() {
  return (
    <section className="lp-section lp-section--tight">
      <div className="lp-container lp-split">
        <div className="lp-split__text">
          <h2 className="lp-h2">Do you actually know how many hours are on your lowers?</h2>
          <p className="lp-copy">
            Most of us don&apos;t. The usual system is lowers in spring and fall, damper once a year
            if you remember, and a vague feeling that the shock is probably due. It holds up fine
            until a busy month of riding puts 60 hours on a fork you thought had 20.
          </p>
          <p className="lp-copy">
            Dampers don&apos;t warn you either. They feel normal right up until the oil has already
            chewed on the internals, and they let go the weekend before the trip. Lowers are roughly
            thirty bucks in oil and seals and an hour in the garage. A cooked damper is a couple
            hundred and a week without the bike.
          </p>
          <p className="lp-copy lp-copy--bright">
            Loam Logger keeps the count. Open it and you see what&apos;s due, on which bike, before
            you load the truck.
          </p>
        </div>

        <div className="lp-mock" data-testid="dashboard-mock">
          <div className="lp-mock__head">
            <div>
              <div className="lp-eyebrow">Saturday morning</div>
              <div className="lp-mock__title">3 things to sort before you ride</div>
            </div>
            <span className="lp-pill">Synced 2 min ago</span>
          </div>

          <div className="lp-mock__bike">
            <div className="lp-mock__bikehead">
              <span className="lp-mock__name">Enduro bike</span>
              <span className="lp-mock__meta">Ridden yesterday · 2 h 14 m</span>
            </div>
            <div className="lp-mock__row lp-mock__row--overdue">
              <span className="lp-dot" />
              <span className="lp-mock__part">Fork lowers service</span>
              <span className="lp-mock__state">Overdue · 58 h on a 50 h interval</span>
            </div>
            <div className="lp-mock__row lp-mock__row--due-now">
              <span className="lp-dot" />
              <span className="lp-mock__part">Rear brake pads</span>
              <span className="lp-mock__state">Due now · 40 h of 40 h</span>
            </div>
            <div className="lp-mock__row lp-mock__row--due-soon">
              <span className="lp-dot" />
              <span className="lp-mock__part">Shock air can</span>
              <span className="lp-mock__state">Due soon · about 4 rides left</span>
            </div>
            <span className="lp-mock__meta">Chain, cassette, dropper, headset, pivots: fine</span>
          </div>

          <div className="lp-mock__bike lp-mock__bike--flat">
            <div>
              <div className="lp-mock__name">Trail bike</div>
              <div className="lp-mock__meta">Ridden 4 days ago</div>
            </div>
            <span className="lp-mock__good">
              <span className="lp-dot" />
              Good to go
            </span>
          </div>

          <div className="lp-mock__bike lp-mock__bike--flat">
            <div>
              <div className="lp-mock__name">Dirt jumper</div>
              <div className="lp-mock__meta">No rides synced</div>
            </div>
            <span className="lp-mock__unknown">
              <span className="lp-dot" />
              Nothing tracked
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
