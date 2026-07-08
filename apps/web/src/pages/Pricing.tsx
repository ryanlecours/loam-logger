import { useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { gql, useMutation } from '@apollo/client';
import { Check, X } from 'lucide-react';
import { useState } from 'react';
import { useUserTier } from '../hooks/useUserTier';
import { posthog } from '../lib/posthog';

const CREATE_CHECKOUT = gql`
  mutation CreateCheckoutSession($plan: StripePlan!) {
    createCheckoutSession(plan: $plan) {
      sessionId
      url
    }
  }
`;

export default function Pricing() {
  const navigate = useNavigate();
  const { tier, isPro, isFoundingRider } = useUserTier();
  const [billingPeriod, setBillingPeriod] = useState<'MONTHLY' | 'ANNUAL'>('ANNUAL');
  const [createCheckout, { loading }] = useMutation(CREATE_CHECKOUT);

  const handleUpgrade = async () => {
    // Three-stage funnel:
    //   1. `checkout_session_started` — intent (fires on click)
    //   2. `checkout_session_created` — Stripe session URL returned (fires
    //      only when the mutation resolves with a URL; gap from #1 measures
    //      pre-Stripe failures: rate limits, network errors, validation)
    //   3. `subscription_checkout_completed` — payment succeeded (fires
    //      server-side from the Stripe webhook; authoritative)
    posthog.capture('checkout_session_started', { plan: billingPeriod, currentTier: tier });
    try {
      const { data } = await createCheckout({ variables: { plan: billingPeriod } });
      const url = data?.createCheckoutSession?.url;
      if (url) {
        posthog.capture('checkout_session_created', { plan: billingPeriod, currentTier: tier });
        window.location.href = url;
      }
    } catch {
      // Error handled by Apollo
    }
  };

  const tiers = [
    {
      name: 'Free',
      price: '$0',
      period: '',
      description: 'Track every part of one bike',
      current: tier === 'FREE' && !isPro,
      currentLabel: 'Current plan',
      accent: 'neutral',
      features: [
        { text: '1 bike', included: true },
        { text: 'All 23+ component types', included: true },
        { text: 'Automatic ride sync', included: true },
        { text: 'Service logging & usage counts', included: true },
        { text: 'Rides left until service due', included: false },
        { text: 'Ride weather tracking', included: false },
        { text: 'PDF service history export', included: false },
      ],
    },
    {
      name: 'Pro',
      price: billingPeriod === 'MONTHLY' ? '$4.99' : '$39.99',
      period: billingPeriod === 'MONTHLY' ? '/mo' : '/yr',
      description: 'Full access, unlimited bikes',
      current: isPro && !isFoundingRider,
      highlight: !isPro,
      features: [
        { text: 'Unlimited bikes', included: true },
        { text: 'Rides left until service due', included: true },
        { text: 'Ride-adjusted wear predictions', included: true },
        { text: 'Weather on every ride', included: true },
        { text: 'PDF service history export', included: true },
        { text: 'Import your full ride history', included: true },
        { text: 'Priority support', included: true },
      ],
    },
  ];

  return (
    <div
      className="min-h-screen py-16 px-6 bg-fixed"
      style={{ backgroundImage: 'linear-gradient(to bottom, rgba(10,10,10,0.85), rgba(10,10,10,0.8)), url(https://loamlogger.app/dakotaWhis.jpg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
    >
      <div className="container max-w-4xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <button
            onClick={() => navigate(-1)}
            className="btn-secondary btn-md mb-6 inline-flex items-center gap-2"
          >
            &larr; Back
          </button>

          {isPro ? (
            <div className="text-center py-12">
              <h1 className="section-title mb-2">You're on Pro!</h1>
              <p className="text-muted">
                {isFoundingRider
                  ? 'Lifetime access as a Founding Rider.'
                  : 'You have full access to all features.'}
              </p>
            </div>
          ) : (
            <>
              <div className="text-center mb-8">
                <h1 className="text-3xl font-bold text-white mb-3">Choose your plan</h1>
                <p className="text-lg text-muted">Track your bike maintenance with confidence</p>
              </div>

              {/* Billing toggle */}
              <div className="flex items-center justify-center gap-3 mb-8">
                <button
                  onClick={() => setBillingPeriod('MONTHLY')}
                  className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                    billingPeriod === 'MONTHLY' ? 'bg-primary text-white' : 'text-muted hover:text-white'
                  }`}
                >
                  Monthly
                </button>
                <button
                  onClick={() => setBillingPeriod('ANNUAL')}
                  className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                    billingPeriod === 'ANNUAL' ? 'bg-primary text-white' : 'text-muted hover:text-white'
                  }`}
                >
                  Annual
                  <span className="ml-1.5 text-xs text-green-400">Save 33%</span>
                </button>
              </div>

              <div className="mx-auto grid max-w-2xl gap-4 md:grid-cols-2">
                {tiers.map((t) => (
                  <div
                    key={t.name}
                    className={`flex flex-col rounded-2xl border p-6 ${
                      t.highlight
                        ? 'border-amber-500/60 bg-amber-500/5'
                        : {
                            green: 'border-green-500/40 bg-green-500/5',
                            neutral: 'border-white/20 bg-transparent',
                          }[t.accent as string] ?? 'border-app/60 bg-surface-2'
                    }`}
                  >
                    <h3 className="text-lg font-semibold text-white">{t.name}</h3>
                    <p className="text-xs text-muted mt-1">{t.description}</p>
                    <div className="mt-4 mb-6">
                      <span className="text-3xl font-bold text-white">{t.price}</span>
                      <span className="text-sm text-muted">{t.period}</span>
                    </div>

                    <ul className="flex-1 space-y-2 mb-6">
                      {t.features.map((f) => (
                        <li key={f.text} className="flex items-center gap-2 text-sm">
                          {f.included ? (
                            <Check className="h-4 w-4 text-green-400" />
                          ) : (
                            <X className="h-4 w-4 text-muted/40" />
                          )}
                          <span className={f.included ? 'text-white' : 'text-muted/60'}>
                            {f.text}
                          </span>
                        </li>
                      ))}
                    </ul>

                    {t.current ? (
                      <div className="rounded-lg border border-green-500/40 py-2 text-center text-sm text-green-400" >
                        {t.currentLabel || 'Current plan'}
                      </div>
                    ) : t.highlight ? (
                      <button
                        onClick={handleUpgrade}
                        disabled={loading}
                        className="w-full rounded-lg bg-amber-500 py-2 text-sm font-medium text-white transition hover:bg-amber-500/80 disabled:opacity-50"
                      >
                        {loading ? 'Loading...' : 'Upgrade to Pro'}
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </>
          )}
        </motion.div>
      </div>
    </div>
  );
}
