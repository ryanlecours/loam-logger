const mockConfig = {
  isProduction: false,
  turnstileMode: 'monitor' as 'off' | 'monitor' | 'enforce',
  turnstileSecretKey: 'test-secret' as string | undefined,
  turnstileAllowedHostnames: [] as string[],
};
const mockCapture = jest.fn();
const mockSentryMessage = jest.fn();

jest.mock('../config/env', () => ({ config: mockConfig }));
const mockLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() };
jest.mock('../lib/logger', () => ({ logger: mockLogger }));
jest.mock('../lib/posthog', () => ({ captureServerEvent: (...a: unknown[]) => mockCapture(...a) }));
jest.mock('@sentry/node', () => ({ captureMessage: (...a: unknown[]) => mockSentryMessage(...a) }));

import {
  TURNSTILE_SITEVERIFY_URL,
  checkTurnstileConfig,
  evaluateSignupTurnstile,
  reportSignupTurnstile,
  requiresUnverifiedWebCap,
  resetTurnstileOutageReports,
  verifyTurnstileToken,
  type TurnstileVerdict,
} from './turnstile';

const TEST_SECRET = '1x0000000000000000000000000000000AA';

function siteverifyAnswer(body: unknown, status = 200) {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as jest.MockedFunction<typeof fetch>;
}

beforeEach(() => {
  jest.clearAllMocks();
  resetTurnstileOutageReports();
  mockConfig.isProduction = false;
  mockConfig.turnstileMode = 'monitor';
  mockConfig.turnstileSecretKey = 'test-secret';
  mockConfig.turnstileAllowedHostnames = [];
});

describe('verifyTurnstileToken', () => {
  it('posts the secret, token and visitor IP to siteverify as a form', async () => {
    const fetchImpl = siteverifyAnswer({ success: true, hostname: 'loamlogger.app' });

    await verifyTurnstileToken({ token: 'tok', secret: 'shh', remoteIp: '1.2.3.4', fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(TURNSTILE_SITEVERIFY_URL);
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' });
    const form = new URLSearchParams(init?.body as string);
    expect(form.get('secret')).toBe('shh');
    expect(form.get('response')).toBe('tok');
    expect(form.get('remoteip')).toBe('1.2.3.4');
    expect(init?.signal).toBeDefined();
  });

  it('leaves out remoteip when the IP is unknown', async () => {
    const fetchImpl = siteverifyAnswer({ success: true });

    await verifyTurnstileToken({ token: 'tok', secret: 'shh', remoteIp: null, fetchImpl });

    const form = new URLSearchParams(fetchImpl.mock.calls[0][1]?.body as string);
    expect(form.has('remoteip')).toBe(false);
  });

  it('accepts a successful answer and keeps the hostname', async () => {
    const fetchImpl = siteverifyAnswer({ success: true, hostname: 'loamlogger.app', 'error-codes': [] });

    await expect(verifyTurnstileToken({ token: 'tok', secret: 'shh', fetchImpl })).resolves.toEqual({
      ok: true,
      hostname: 'loamlogger.app',
    });
  });

  // internal-error counts as failed (capped in enforce mode), not as an
  // outage: it comes back in answer to a submitted token.
  it.each([['invalid-input-response'], ['timeout-or-duplicate'], ['bad-request'], ['internal-error']])(
    'treats %s as a failed token',
    async (code) => {
      const fetchImpl = siteverifyAnswer({ success: false, 'error-codes': [code] });

      await expect(verifyTurnstileToken({ token: 'tok', secret: 'shh', fetchImpl })).resolves.toEqual({
        ok: false,
        outcome: 'failed',
        reason: code,
      });
    }
  );

  it.each([['invalid-input-secret'], ['missing-input-secret']])(
    'treats %s as our error, not the visitor\'s',
    async (code) => {
      const fetchImpl = siteverifyAnswer({ success: false, 'error-codes': ['invalid-input-response', code] });

      await expect(verifyTurnstileToken({ token: 'tok', secret: 'shh', fetchImpl })).resolves.toEqual({
        ok: false,
        outcome: 'error',
        reason: code,
      });
    }
  );

  it('reports an unknown failure when Cloudflare gives no error code', async () => {
    const fetchImpl = siteverifyAnswer({ success: false });

    await expect(verifyTurnstileToken({ token: 'tok', secret: 'shh', fetchImpl })).resolves.toEqual({
      ok: false,
      outcome: 'failed',
      reason: 'unknown',
    });
  });

  it('returns an error for a non-2xx answer', async () => {
    const fetchImpl = siteverifyAnswer({}, 503);

    await expect(verifyTurnstileToken({ token: 'tok', secret: 'shh', fetchImpl })).resolves.toEqual({
      ok: false,
      outcome: 'error',
      reason: 'http_503',
    });
  });

  it('returns an error instead of throwing when the request fails', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch;

    await expect(verifyTurnstileToken({ token: 'tok', secret: 'shh', fetchImpl })).resolves.toEqual({
      ok: false,
      outcome: 'error',
      reason: 'network',
    });
  });

  it('returns an error when the answer is not JSON', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    }) as unknown as typeof fetch;

    await expect(verifyTurnstileToken({ token: 'tok', secret: 'shh', fetchImpl })).resolves.toEqual({
      ok: false,
      outcome: 'error',
      reason: 'bad_response',
    });
  });
});

describe('verifyTurnstileToken action and hostname checks', () => {
  const answer = { success: true, hostname: 'loamlogger.app', action: 'signup' };

  it('accepts a token for the expected action and an allowed hostname', async () => {
    await expect(
      verifyTurnstileToken({
        token: 'tok',
        secret: 'shh',
        expectedAction: 'signup',
        allowedHostnames: ['loamlogger.app'],
        fetchImpl: siteverifyAnswer(answer),
      })
    ).resolves.toEqual({ ok: true, hostname: 'loamlogger.app' });
  });

  it.each([[{ ...answer, action: 'login' }], [{ ...answer, action: undefined }]])(
    'refuses a token minted for another action (%p)',
    async (body) => {
      await expect(
        verifyTurnstileToken({ token: 'tok', secret: 'shh', expectedAction: 'signup', fetchImpl: siteverifyAnswer(body) })
      ).resolves.toEqual({ ok: false, outcome: 'failed', reason: 'action_mismatch' });
    }
  );

  it('refuses a token solved on a hostname outside the list', async () => {
    await expect(
      verifyTurnstileToken({
        token: 'tok',
        secret: 'shh',
        expectedAction: 'signup',
        allowedHostnames: ['loamlogger.app'],
        fetchImpl: siteverifyAnswer({ ...answer, hostname: 'evil.example' }),
      })
    ).resolves.toEqual({ ok: false, outcome: 'failed', reason: 'hostname_mismatch' });
  });

  it('matches the hostname Cloudflare reports case-insensitively', async () => {
    await expect(
      verifyTurnstileToken({
        token: 'tok',
        secret: 'shh',
        expectedAction: 'signup',
        allowedHostnames: ['loamlogger.app'],
        fetchImpl: siteverifyAnswer({ ...answer, hostname: 'LoamLogger.App' }),
      })
    ).resolves.toEqual({ ok: true, hostname: 'LoamLogger.App' });
  });

  it('skips the hostname check when no list is configured', async () => {
    await expect(
      verifyTurnstileToken({
        token: 'tok',
        secret: 'shh',
        expectedAction: 'signup',
        allowedHostnames: [],
        fetchImpl: siteverifyAnswer({ ...answer, hostname: 'anywhere.example' }),
      })
    ).resolves.toMatchObject({ ok: true });
  });

  it("skips both checks for Cloudflare's test secrets, which answer with action test on localhost", async () => {
    await expect(
      verifyTurnstileToken({
        token: 'XXXX.DUMMY.TOKEN.XXXX',
        secret: '1x0000000000000000000000000000000AA',
        expectedAction: 'signup',
        allowedHostnames: ['loamlogger.app'],
        fetchImpl: siteverifyAnswer({ success: true, hostname: 'localhost', action: 'test' }),
      })
    ).resolves.toEqual({ ok: true, hostname: 'localhost' });
  });
});

describe('evaluateSignupTurnstile', () => {
  it('checks for the signup action and the configured hostnames', async () => {
    mockConfig.turnstileAllowedHostnames = ['loamlogger.app'];

    await expect(
      evaluateSignupTurnstile({
        token: 'tok',
        fetchImpl: siteverifyAnswer({ success: true, hostname: 'loamlogger.app', action: 'login' }),
      })
    ).resolves.toMatchObject({ label: 'web:failed:action_mismatch' });
    await expect(
      evaluateSignupTurnstile({
        token: 'tok',
        fetchImpl: siteverifyAnswer({ success: true, hostname: 'other.example', action: 'signup' }),
      })
    ).resolves.toMatchObject({ label: 'web:failed:hostname_mismatch' });
  });

  it('returns null and calls nothing when Turnstile is off', async () => {
    mockConfig.turnstileMode = 'off';
    const fetchImpl = siteverifyAnswer({ success: true });

    await expect(evaluateSignupTurnstile({ token: 'tok', fetchImpl })).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([[undefined], [null], ['']])('labels a missing token (%p) without calling Cloudflare', async (token) => {
    const fetchImpl = siteverifyAnswer({ success: true });

    const result = await evaluateSignupTurnstile({ token, fetchImpl });

    expect(result).toMatchObject({ outcome: 'missing', label: 'web:missing' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([[42], [{ token: 'x' }], ['x'.repeat(2049)]])('rejects a malformed token without calling Cloudflare', async (token) => {
    const fetchImpl = siteverifyAnswer({ success: true });

    const result = await evaluateSignupTurnstile({ token, fetchImpl });

    expect(result).toMatchObject({ outcome: 'failed', label: 'web:failed:malformed' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports not_configured when the secret is unset', async () => {
    mockConfig.turnstileSecretKey = undefined;

    const result = await evaluateSignupTurnstile({ token: 'tok', fetchImpl: siteverifyAnswer({ success: true }) });

    expect(result).toMatchObject({ outcome: 'error', label: 'web:error:not_configured' });
  });

  it('labels a passing token web:verified', async () => {
    const fetchImpl = siteverifyAnswer({ success: true, hostname: 'loamlogger.app', action: 'signup' });

    const result = await evaluateSignupTurnstile({ token: 'tok', remoteIp: '1.2.3.4', fetchImpl });

    expect(result).toEqual({ outcome: 'verified', reason: undefined, label: 'web:verified', hostname: 'loamlogger.app' });
    expect(new URLSearchParams(fetchImpl.mock.calls[0][1]?.body as string).get('secret')).toBe('test-secret');
  });

  it('labels a rejected token with the Cloudflare error code', async () => {
    const fetchImpl = siteverifyAnswer({ success: false, 'error-codes': ['timeout-or-duplicate'] });

    const result = await evaluateSignupTurnstile({ token: 'tok', fetchImpl });

    expect(result).toMatchObject({ outcome: 'failed', label: 'web:failed:timeout-or-duplicate' });
    expect(mockSentryMessage).not.toHaveBeenCalled();
  });

  it('flags an outage to Sentry and labels it web:error', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('ECONNRESET')) as unknown as typeof fetch;

    const result = await evaluateSignupTurnstile({ token: 'tok', fetchImpl });

    expect(result).toMatchObject({ outcome: 'error', label: 'web:error:network' });
    expect(mockSentryMessage).toHaveBeenCalledTimes(1);
  });

  it('sends one Sentry event per reason during a long outage, but logs every failure', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('ECONNRESET')) as unknown as typeof fetch;

    for (let i = 0; i < 5; i++) await evaluateSignupTurnstile({ token: 'tok', fetchImpl });
    await evaluateSignupTurnstile({ token: 'tok', fetchImpl: siteverifyAnswer({}, 503) });

    expect(mockSentryMessage).toHaveBeenCalledTimes(2);
    expect(mockSentryMessage).toHaveBeenCalledWith('Turnstile siteverify unavailable: network', expect.anything());
    expect(mockSentryMessage).toHaveBeenCalledWith('Turnstile siteverify unavailable: http_503', expect.anything());
    expect(mockLogger.error).toHaveBeenCalledTimes(6);
  });

  it('reports the same reason again once the window has passed', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-20T12:00:00Z') });
    try {
      const fetchImpl = jest.fn().mockRejectedValue(new Error('ECONNRESET')) as unknown as typeof fetch;
      await evaluateSignupTurnstile({ token: 'tok', fetchImpl });
      jest.setSystemTime(new Date('2026-10-20T12:11:00Z'));
      await evaluateSignupTurnstile({ token: 'tok', fetchImpl });

      expect(mockSentryMessage).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('requiresUnverifiedWebCap', () => {
  const verified: TurnstileVerdict = { outcome: 'verified', label: 'web:verified' };
  const failed: TurnstileVerdict = { outcome: 'failed', reason: 'invalid-input-response', label: 'web:failed:invalid-input-response' };
  const missing: TurnstileVerdict = { outcome: 'missing', label: 'web:missing' };
  const error: TurnstileVerdict = { outcome: 'error', reason: 'network', label: 'web:error:network' };

  it('never applies outside enforce mode', () => {
    mockConfig.turnstileMode = 'monitor';
    expect([verified, failed, missing, error].some(requiresUnverifiedWebCap)).toBe(false);
    expect(requiresUnverifiedWebCap(null)).toBe(false);
  });

  it('applies in enforce mode to missing and rejected tokens only', () => {
    mockConfig.turnstileMode = 'enforce';
    expect(requiresUnverifiedWebCap(verified)).toBe(false);
    expect(requiresUnverifiedWebCap(failed)).toBe(true);
    expect(requiresUnverifiedWebCap(missing)).toBe(true);
    expect(requiresUnverifiedWebCap(null)).toBe(false);
  });

  it('lets a Cloudflare outage or a bad secret through uncapped, so it cannot throttle every signup', () => {
    mockConfig.turnstileMode = 'enforce';
    expect(requiresUnverifiedWebCap(error)).toBe(false);
    expect(requiresUnverifiedWebCap({ outcome: 'error', reason: 'not_configured', label: 'web:error:not_configured' })).toBe(
      false
    );
  });
});

describe('checkTurnstileConfig', () => {
  it('warns about an unrecognized mode and a missing secret', () => {
    mockConfig.turnstileSecretKey = undefined;

    checkTurnstileConfig('enforcing');

    expect(mockLogger.warn).toHaveBeenCalledWith({ value: 'enforcing' }, expect.stringContaining('Unrecognized TURNSTILE_MODE'));
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('TURNSTILE_SECRET_KEY not set'));
  });

  it('stays quiet about the secret while Turnstile is off', () => {
    mockConfig.turnstileMode = 'off';
    mockConfig.turnstileSecretKey = undefined;

    checkTurnstileConfig('off');

    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('sends enforce mode without a secret to Sentry, since it checks nothing', () => {
    mockConfig.turnstileMode = 'enforce';
    mockConfig.turnstileSecretKey = undefined;

    checkTurnstileConfig('enforce');

    expect(mockSentryMessage).toHaveBeenCalledWith(
      expect.stringContaining('enforce without TURNSTILE_SECRET_KEY'),
      expect.objectContaining({ level: 'error' })
    );
  });

  it('flags a Cloudflare test secret in production', () => {
    mockConfig.isProduction = true;
    mockConfig.turnstileSecretKey = TEST_SECRET;

    checkTurnstileConfig('monitor');

    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('test secret in production'));
    expect(mockSentryMessage).toHaveBeenCalledWith(
      expect.stringContaining('test secret in production'),
      expect.objectContaining({ level: 'error' })
    );
  });

  it('accepts a test secret outside production without noise', () => {
    mockConfig.turnstileSecretKey = TEST_SECRET;

    checkTurnstileConfig('monitor');

    expect(mockLogger.warn).not.toHaveBeenCalled();
    expect(mockLogger.error).not.toHaveBeenCalled();
    expect(mockSentryMessage).not.toHaveBeenCalled();
  });

  it('warns when a real secret has no hostname list', () => {
    mockConfig.turnstileSecretKey = '0x4AAAAAAAreal-secret';

    checkTurnstileConfig('monitor');
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('TURNSTILE_ALLOWED_HOSTNAMES not set'));

    mockLogger.warn.mockClear();
    mockConfig.turnstileAllowedHostnames = ['loamlogger.app'];
    checkTurnstileConfig('monitor');
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });
});

describe('reportSignupTurnstile', () => {
  it('sends the verdict on the shared signup_attestation event as platform web', () => {
    mockConfig.turnstileMode = 'enforce';

    reportSignupTurnstile('user_1', {
      outcome: 'failed',
      reason: 'invalid-input-response',
      label: 'web:failed:invalid-input-response',
    });

    expect(mockCapture).toHaveBeenCalledWith('user_1', 'signup_attestation', {
      attestation_mode: 'enforce',
      attestation_outcome: 'failed',
      attestation_platform: 'web',
      attestation_reason: 'invalid-input-response',
      attestation_check: 'turnstile',
      turnstile_hostname: null,
    });
  });
});
