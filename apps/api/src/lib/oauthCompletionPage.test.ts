import { renderOAuthCompletionPage } from './oauthCompletionPage';

describe('renderOAuthCompletionPage', () => {
  it('builds the deep link path from providerSlug, not the display label', () => {
    // Regression: the Garmin brand label "Garmin Connect™" was previously fed
    // straight into the deep link path via provider.toLowerCase(), producing
    // `loamlogger://oauth/garmin connect™`. The space + ™ got (double) URL
    // encoded and matched no Expo route, dumping the user on "Unmatched Route".
    const html = renderOAuthCompletionPage({
      provider: 'Garmin Connect™',
      providerSlug: 'garmin',
      status: 'success',
      scheme: 'loamlogger',
      brandColor: '#007DC3',
    });

    // Path must stay `garmin` — app/oauth/garmin.tsx is what receives this.
    expect(html).toContain('loamlogger://oauth/garmin?status=success');
    // The display label may still appear in the copy, but never in the path.
    expect(html).not.toContain('oauth/garmin connect');
    expect(html).not.toContain('oauth/garmin%20connect');
  });

  it('keeps the display label in the visible page copy', () => {
    const html = renderOAuthCompletionPage({
      provider: 'Garmin Connect™',
      providerSlug: 'garmin',
      status: 'success',
      scheme: 'loamlogger',
      brandColor: '#007DC3',
    });

    expect(html).toContain('Garmin Connect™ Connected!');
  });

  it('honors a custom deep link scheme', () => {
    const html = renderOAuthCompletionPage({
      provider: 'Strava',
      providerSlug: 'strava',
      status: 'success',
      scheme: 'llstaging',
      brandColor: '#fc4c02',
    });

    expect(html).toContain('llstaging://oauth/strava?status=success');
  });

  it('appends reason and extra params to the deep link query', () => {
    const html = renderOAuthCompletionPage({
      provider: 'Strava',
      providerSlug: 'strava',
      status: 'error',
      reason: 'token_exchange_failed',
      scheme: 'loamlogger',
      brandColor: '#fc4c02',
      extraParams: { prompt: 'reauth' },
    });

    expect(html).toContain('loamlogger://oauth/strava?status=error');
    expect(html).toContain('reason=token_exchange_failed');
    expect(html).toContain('prompt=reauth');
  });
});
