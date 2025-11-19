export default function BetaTesterWaitlist() {
  return (
    <div className="min-h-screen w-full bg-[radial-gradient(circle_at_top,_rgba(0,60,30,0.6),_transparent),radial-gradient(circle_at_bottom,_rgba(0,20,10,0.8),_rgb(6,8,6))] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-[32px] panel-soft shadow-soft border border-app/80 p-8 space-y-6">
        <div className="text-center space-y-3">
          <div className="text-5xl">🚧</div>
          <h1 className="text-2xl font-semibold text-white">Beta Testing Coming Soon</h1>
          <p className="text-sm text-muted">
            Thanks for your interest in Loam Logger! You're not yet on the beta tester list, but you can join the waitlist.
          </p>
        </div>

        <div className="rounded-xl bg-surface-2 p-4 border border-app/40 space-y-3">
          <p className="text-sm">
            Email us at{' '}
            <a
              href="mailto:ryan.lecours@loamlogger.app"
              className="font-semibold text-primary hover:underline transition-colors"
            >
              ryan.lecours@loamlogger.app
            </a>{' '}
            to request access to the beta.
          </p>
          <p className="text-xs text-muted">
            We're rolling out access in waves to ensure quality. We'll get back to you soon!
          </p>
        </div>

        <button
          onClick={() => window.location.href = '/'}
          className="w-full py-2 px-4 rounded-full btn-primary font-semibold text-center transition-colors hover:opacity-90"
        >
          Back to Home
        </button>
      </div>
    </div>
  );
}
