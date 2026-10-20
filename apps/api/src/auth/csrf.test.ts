import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { Response } from 'express';
import type { NextFunction, Request } from 'express';
import { isWellFormedCsrfToken, setCsrfCookie, verifyCsrf } from './csrf';

describe('isWellFormedCsrfToken', () => {
  it('accepts the tokens setCsrfCookie mints', () => {
    const res = { cookie: jest.fn() } as unknown as Response;
    for (let i = 0; i < 5; i++) {
      expect(isWellFormedCsrfToken(setCsrfCookie(res))).toBe(true);
    }
  });

  it('rejects anything else', () => {
    expect(isWellFormedCsrfToken('a'.repeat(63))).toBe(false);
    expect(isWellFormedCsrfToken('a'.repeat(65))).toBe(false);
    expect(isWellFormedCsrfToken('A'.repeat(64))).toBe(false);
    expect(isWellFormedCsrfToken('<script>')).toBe(false);
    expect(isWellFormedCsrfToken(undefined)).toBe(false);
    expect(isWellFormedCsrfToken(['a'.repeat(64)])).toBe(false);
  });
});

describe('verifyCsrf on the provider-link routes', () => {
  // The web link creates the session, so it can't carry a CSRF token yet;
  // it's exempt like /auth/login and protected by the link token + password.
  function run(path: string, cookies: Record<string, string>) {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    const next = jest.fn() as NextFunction;
    const req = { method: 'POST', path, headers: {}, cookies, is: () => 'application/json' };
    verifyCsrf(req as unknown as Request, res as unknown as Response, next);
    return { res, next };
  }

  it('lets the web link through even with a leftover session cookie and no CSRF header', () => {
    const { res, next } = run('/auth/link-provider', { ll_session: 'stale' });
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('lets the mobile link through, which carries no cookie, like /auth/mobile/google', () => {
    expect(run('/auth/mobile/link-provider', {}).next).toHaveBeenCalled();
  });

  it('still blocks a non-exempt path with a session cookie and no CSRF header', () => {
    const { res, next } = run('/auth/password/change', { ll_session: 'stale' });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('verifyCsrf against login CSRF', () => {
  // Mirrors the parser order in server.ts, so a form body is parsed the way
  // production would parse it before verifyCsrf sees it.
  const handled = jest.fn();
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());
  app.use(verifyCsrf);
  app.post('/auth/login', (req, res) => {
    handled(req.body);
    res.cookie('ll_session', 'signed-in-as-' + req.body.email);
    res.json({ ok: true });
  });
  app.post('/auth/verify-email/complete', (req, res) => {
    handled(req.body);
    res.json({ ok: true });
  });
  app.post('/webhooks/strava', (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/auth/garmin/callback', (_req, res) => {
    res.json({ ok: true });
  });

  beforeEach(() => handled.mockClear());

  it('refuses a urlencoded login, which is what a cross-site HTML form sends', async () => {
    const res = await request(app)
      .post('/auth/login')
      .type('form')
      .send({ email: 'attacker@example.com', password: 'hunter22' });

    expect(res.status).toBe(415);
    expect(res.body.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(handled).not.toHaveBeenCalled();
  });

  it('refuses the other content types a form can send', async () => {
    const plain = await request(app)
      .post('/auth/login')
      .set('Content-Type', 'text/plain')
      .send('{"email":"attacker@example.com","password":"hunter22"}');
    const multipart = await request(app)
      .post('/auth/login')
      .field('email', 'attacker@example.com')
      .field('password', 'hunter22');

    expect(plain.status).toBe(415);
    expect(multipart.status).toBe(415);
    expect(handled).not.toHaveBeenCalled();
  });

  it('holds the email sign-in exchange to JSON too, since it also starts a session', async () => {
    const form = await request(app).post('/auth/verify-email/complete').type('form').send({ email: 'rider@example.com' });
    const json = await request(app).post('/auth/verify-email/complete').send({ email: 'rider@example.com' });

    expect(form.status).toBe(415);
    expect(json.status).toBe(200);
    expect(handled).toHaveBeenCalledTimes(1);
  });

  it('refuses a login with no body at all', async () => {
    expect((await request(app).post('/auth/login')).status).toBe(415);
    expect(handled).not.toHaveBeenCalled();
  });

  it('still lets a JSON login through and sets the session cookie', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'rider@example.com', password: 'hunter22' });

    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']?.[0]).toContain('ll_session=signed-in-as-rider%40example.com');
    expect(handled).toHaveBeenCalledWith({ email: 'rider@example.com', password: 'hunter22' });
  });

  it('accepts JSON with a charset, as browsers may send it', async () => {
    const res = await request(app)
      .post('/auth/login')
      .set('Content-Type', 'application/json; charset=utf-8')
      .send(JSON.stringify({ email: 'rider@example.com', password: 'hunter22' }));

    expect(res.status).toBe(200);
  });

  it.each([
    '/auth/google/code',
    '/auth/signup',
    '/auth/link-provider',
    '/auth/verify-email',
    '/auth/resend-verification',
    '/api/waitlist',
  ])('refuses a urlencoded POST to %s', async (path) => {
    const res = await request(app).post(path).type('form').send({ a: 'b' });
    expect(res.status).toBe(415);
  });

  it('leaves provider webhooks on whatever body format the provider sends', async () => {
    const res = await request(app).post('/webhooks/strava').type('form').send({ a: 'b' });
    expect(res.status).toBe(200);
  });

  it('leaves OAuth GET callbacks alone', async () => {
    const res = await request(app).get('/auth/garmin/callback?code=abc&state=xyz');
    expect(res.status).toBe(200);
  });
});
