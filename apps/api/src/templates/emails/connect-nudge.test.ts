import * as React from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// @react-email/render's CJS build dynamic-imports react-dom/server, which
// Jest can't execute without --experimental-vm-modules. Static markup is
// equivalent for content assertions.
const render = async (element: ReactElement) => renderToStaticMarkup(element);
import ConnectNudgeEmail, { CONNECT_NUDGE_SUBJECT } from './connect-nudge';

describe('ConnectNudgeEmail', () => {
  it('renders the rider and bike into the copy with the connect button first', async () => {
    const html = await render(
      React.createElement(ConnectNudgeEmail, {
        recipientFirstName: 'Casey',
        bikeName: 'Smuggler',
        connectUrl: 'https://app.test/settings?section=data-sources',
        dashboardUrl: 'https://app.test/dashboard',
        unsubscribeUrl: 'https://api.test/unsub',
      })
    );

    expect(html).toContain('Smuggler is set up. It just has no rides yet.');
    expect(html).toContain('Hi Casey,');
    expect(html).toContain('You added Smuggler a couple of days ago');
    expect(html).toContain('href="https://app.test/settings?section=data-sources"');
    expect(html).toContain('Connect a ride source');
    expect(html).toContain('href="https://app.test/dashboard"');
    expect(html).toContain('href="https://api.test/unsub"');
    expect(html.indexOf('Connect a ride source')).toBeLessThan(html.indexOf('No watch or app?'));
  });

  it('sanitizes rider-supplied strings', async () => {
    const html = await render(
      React.createElement(ConnectNudgeEmail, {
        recipientFirstName: '<script>alert(1)</script>',
        bikeName: 'Bike<img src=x onerror=alert(1)>',
      })
    );

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
  });

  it('keeps the house style: no em dashes in subject or body', async () => {
    const html = await render(React.createElement(ConnectNudgeEmail, { recipientFirstName: 'Casey' }));

    expect(CONNECT_NUDGE_SUBJECT).not.toContain('2014');
    expect(html).not.toContain('2014');
  });

  it('omits the unsubscribe line when no URL is given', async () => {
    const html = await render(React.createElement(ConnectNudgeEmail, {}));

    expect(html).toContain('Your bike is set up.');
    expect(html).toContain('Hi there,');
    expect(html).not.toContain('Unsubscribe');
  });
});
