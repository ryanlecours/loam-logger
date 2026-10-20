import express from 'express';
import request from 'supertest';
import { TRUST_PROXY_HOPS } from './trust-proxy';
import { getClientIp } from '../auth/utils';

function appWithHops(hops: number) {
  const app = express();
  app.set('trust proxy', hops);
  app.get('/ip', (req, res) => {
    res.json({ ip: getClientIp(req) });
  });
  return app;
}

const VISITOR = '96.61.91.161';
const RAILWAY_HOP = '152.233.47.68';

describe('TRUST_PROXY_HOPS', () => {
  const app = appWithHops(TRUST_PROXY_HOPS);

  it('resolves the visitor from the header Railway forwards', async () => {
    const res = await request(app)
      .get('/ip')
      .set('X-Forwarded-For', `${VISITOR}, ${RAILWAY_HOP}`);

    expect(res.body.ip).toBe(VISITOR);
  });

  it('ignores entries a client wrote, if the edge appended instead of replacing', async () => {
    const res = await request(app)
      .get('/ip')
      .set('X-Forwarded-For', `203.0.113.77, ${VISITOR}, ${RAILWAY_HOP}`);

    expect(res.body.ip).toBe(VISITOR);
  });

  it('gives each visitor their own address behind the same Railway hop', async () => {
    const [a, b] = await Promise.all(
      ['198.51.100.1', '198.51.100.2'].map((ip) =>
        request(app).get('/ip').set('X-Forwarded-For', `${ip}, ${RAILWAY_HOP}`)
      )
    );

    expect(a.body.ip).toBe('198.51.100.1');
    expect(b.body.ip).toBe('198.51.100.2');
  });

  it('one trusted hop would key every visitor on the Railway hop', async () => {
    const res = await request(appWithHops(1))
      .get('/ip')
      .set('X-Forwarded-For', `${VISITOR}, ${RAILWAY_HOP}`);

    expect(res.body.ip).toBe(RAILWAY_HOP);
  });
});
