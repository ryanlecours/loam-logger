const mockConfig: { turnstileSecretKey?: string; isProduction: boolean } = {
  turnstileSecretKey: 'secret',
  isProduction: false,
};

jest.mock('../config/env', () => ({ config: mockConfig }));
jest.mock('@sentry/node', () => ({ captureException: jest.fn() }));
jest.mock('./logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

import { verifyTurnstileToken } from './turnstile';

const mockFetch = jest.fn();

beforeAll(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockConfig.turnstileSecretKey = 'secret';
});

function siteverifyReturns(body: unknown, ok = true, status = 200) {
  mockFetch.mockResolvedValue({ ok, status, json: async () => body });
}

describe('verifyTurnstileToken', () => {
  it('skips the check when no secret is configured', async () => {
    mockConfig.turnstileSecretKey = undefined;

    await expect(verifyTurnstileToken(undefined, '1.2.3.4')).resolves.toEqual({
      ok: true,
      skipped: 'not_configured',
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fails a missing token without calling Cloudflare', async () => {
    await expect(verifyTurnstileToken(undefined, '1.2.3.4')).resolves.toEqual({
      ok: false,
      errorCodes: ['missing-input-response'],
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('passes a token Cloudflare accepts, sending the secret and IP', async () => {
    siteverifyReturns({ success: true });

    await expect(verifyTurnstileToken('tok', '1.2.3.4')).resolves.toEqual({ ok: true });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(JSON.parse(init.body)).toEqual({ secret: 'secret', response: 'tok', remoteip: '1.2.3.4' });
  });

  it('fails a token Cloudflare rejects', async () => {
    siteverifyReturns({ success: false, 'error-codes': ['timeout-or-duplicate'] });

    await expect(verifyTurnstileToken('tok', '1.2.3.4')).resolves.toEqual({
      ok: false,
      errorCodes: ['timeout-or-duplicate'],
    });
  });

  it('allows the signup when Cloudflare is unreachable', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNRESET'));

    await expect(verifyTurnstileToken('tok', '1.2.3.4')).resolves.toEqual({
      ok: true,
      skipped: 'unavailable',
    });
  });

  it('allows the signup when Cloudflare answers with a server error', async () => {
    siteverifyReturns({}, false, 503);

    await expect(verifyTurnstileToken('tok', '1.2.3.4')).resolves.toEqual({
      ok: true,
      skipped: 'unavailable',
    });
  });
});
