const mockConfig = {
  turnstileMode: 'monitor' as 'off' | 'monitor' | 'enforce',
  turnstileSecretKey: 'test-secret' as string | undefined,
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
  verifyTurnstileToken,
  type TurnstileVerdict,
} from './turnstile';

function siteverifyAnswer(body: unknown, status = 200) {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as jest.MockedFunction<typeof fetch>;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockConfig.turnstileMode = 'monitor';
  mockConfig.turnstileSecretKey = 'test-secret';
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

  it.each([['invalid-input-response'], ['timeout-or-duplicate'], ['bad-request']])(
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

  it.each([['invalid-input-secret'], ['missing-input-secret'], ['internal-error']])(
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

describe('evaluateSignupTurnstile', () => {
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
    const fetchImpl = siteverifyAnswer({ success: true, hostname: 'loamlogger.app' });

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

  it('applies in enforce mode to every outcome except verified', () => {
    mockConfig.turnstileMode = 'enforce';
    expect(requiresUnverifiedWebCap(verified)).toBe(false);
    expect(requiresUnverifiedWebCap(failed)).toBe(true);
    expect(requiresUnverifiedWebCap(missing)).toBe(true);
    expect(requiresUnverifiedWebCap(error)).toBe(true);
    expect(requiresUnverifiedWebCap(null)).toBe(false);
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
