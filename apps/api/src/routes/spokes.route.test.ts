/**
 * The route's job is parameter parsing: everything else is the service's. What
 * is worth pinning down is `excludeFramesets`, because it is the difference
 * between onboarding offering a rider a frameset it cannot build a bike from
 * and not offering one, and because a query string is a string, so the parse
 * is the whole contract.
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';

const mockSearchBikes = jest.fn();

jest.mock('../services/spokes', () => ({
  searchBikes: (...args: unknown[]) => mockSearchBikes(...args),
  getBikeById: jest.fn(),
  isSpokesConfigured: () => true,
}));

jest.mock('../lib/logger', () => ({
  logError: jest.fn(),
}));

import router from './spokes';

interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: RequestHandler }>;
  };
}

function getSearchHandler(): RequestHandler | undefined {
  const stack = (router as unknown as { stack: RouteLayer[] }).stack;
  return stack.find((l) => l.route?.path === '/search' && l.route?.methods?.get)?.route?.stack?.[0]
    ?.handle;
}

/** The flag as the service received it, for one request carrying `raw`. */
async function excludeFramesetsFor(raw: unknown): Promise<boolean | undefined> {
  const handler = getSearchHandler();
  if (!handler) throw new Error('Handler not found');

  const req = {
    sessionUser: { uid: 'user-123' },
    query: { q: 'evil offering', ...(raw === undefined ? {} : { excludeFramesets: raw }) },
  } as unknown as Request;
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;

  await handler(req, res, jest.fn() as NextFunction);
  return mockSearchBikes.mock.calls[0]?.[0]?.excludeFramesets;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSearchBikes.mockResolvedValue([]);
});

describe('GET /search excludeFramesets', () => {
  it('is off when the caller says nothing', async () => {
    expect(await excludeFramesetsFor(undefined)).toBe(false);
  });

  it('accepts the two documented forms', async () => {
    expect(await excludeFramesetsFor('1')).toBe(true);
    jest.clearAllMocks();
    expect(await excludeFramesetsFor('true')).toBe(true);
  });

  // A client sending the flag from a boolean-to-string conversion can easily
  // send "True". Strictness here bought nothing and silently served framesets.
  it('is case-insensitive', async () => {
    expect(await excludeFramesetsFor('True')).toBe(true);
    jest.clearAllMocks();
    expect(await excludeFramesetsFor('TRUE')).toBe(true);
  });

  it('treats anything else as off rather than guessing', async () => {
    expect(await excludeFramesetsFor('0')).toBe(false);
    jest.clearAllMocks();
    expect(await excludeFramesetsFor('yes')).toBe(false);
    jest.clearAllMocks();
    // Express hands repeated params through as an array, not a string.
    expect(await excludeFramesetsFor(['1', '1'])).toBe(false);
  });
});
