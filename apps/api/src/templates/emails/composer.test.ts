import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ComposerEmail, { parseComposerBody, templateConfig } from './composer';

// @react-email/render's CJS build dynamic-imports react-dom/server, which
// Jest can't execute without --experimental-vm-modules. Static markup is
// equivalent for content assertions.
const render = async (element: ReactElement) => renderToStaticMarkup(element);
import { getTemplateById, EMAIL_TEMPLATES, buildTemplateProps } from './index';

const SAMPLE_BODY = [
  'Quick one this month, and it is mostly good news.',
  '',
  '## Android beta is open',
  '',
  'The waitlist is gone. [Grab the beta](https://loamlogger.app/android) and ride.',
  '',
  '---',
  '',
  'Chains and cassettes now wear as a **set**.',
  '',
  '- Chain wear drives cassette predictions',
  '- Replace-together suggestions',
  '',
  '> If you replaced a chain recently, log it.',
  '',
  '[button: Open Loam Logger](https://loamlogger.app)',
].join('\n');

describe('parseComposerBody', () => {
  it('parses the full block vocabulary', () => {
    const blocks = parseComposerBody(SAMPLE_BODY);
    expect(blocks.map((b) => b.kind)).toEqual([
      'paragraph',
      'h2',
      'paragraph',
      'hr',
      'paragraph',
      'bullets',
      'callout',
      'button',
    ]);
  });

  it('joins consecutive lines into one paragraph and splits on blank lines', () => {
    const blocks = parseComposerBody('line one\nline two\n\nsecond para');
    expect(blocks).toEqual([
      { kind: 'paragraph', text: 'line one line two' },
      { kind: 'paragraph', text: 'second para' },
    ]);
  });

  it('normalizes Windows line endings', () => {
    const blocks = parseComposerBody('## Heading\r\n\r\nbody text');
    expect(blocks).toEqual([
      { kind: 'h2', text: 'Heading' },
      { kind: 'paragraph', text: 'body text' },
    ]);
  });

  it('splits callouts into paragraphs on blank quoted lines', () => {
    const blocks = parseComposerBody('> first\n>\n> second');
    expect(blocks).toEqual([{ kind: 'callout', paragraphs: ['first', 'second'] }]);
  });

  it('collects consecutive dashes and asterisks into one bullet list', () => {
    const blocks = parseComposerBody('- one\n* two');
    expect(blocks).toEqual([{ kind: 'bullets', items: ['one', 'two'] }]);
  });

  it('rejects button lines with unsafe protocols', () => {
    const blocks = parseComposerBody('[button: Click](javascript:alert(1))');
    // Falls through to a plain paragraph, never a button block
    expect(blocks).toEqual([
      { kind: 'paragraph', text: '[button: Click](javascript:alert(1))' },
    ]);
  });
});

describe('ComposerEmail rendering', () => {
  it('renders every block type with the ll-* styling classes', async () => {
    const html = await render(
      ComposerEmail({
        recipientFirstName: 'Alex',
        header: 'June update',
        previewText: 'A quick June update',
        body: SAMPLE_BODY,
        unsubscribeUrl: 'https://api.loamlogger.app/api/email/unsubscribe?token=t',
      })
    );

    expect(html).toContain('Hi Alex,');
    expect(html).toContain('June update');
    expect(html).toContain('Android beta is open');
    expect(html).toContain('ll-h2');
    expect(html).toContain('ll-hr');
    expect(html).toContain('ll-callout');
    expect(html).toContain('ll-bullets');
    expect(html).toContain('•');
    expect(html).toContain('ll-button');
    expect(html).toContain('href="https://loamlogger.app"');
    expect(html).toContain('Open Loam Logger');
    expect(html).toContain('href="https://loamlogger.app/android"');
    expect(html).toContain('ll-emph');
    expect(html).toContain('– Ryan');
    expect(html).toContain('Unsubscribe');
  });

  it('escapes HTML typed into the body', async () => {
    const html = await render(
      ComposerEmail({
        header: 'Test',
        body: 'Hello <script>alert(1)</script> & <img src=x onerror=y>',
      })
    );

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
  });

  it('never linkifies unsafe protocols', async () => {
    const html = await render(
      ComposerEmail({
        header: 'Test',
        body: 'Click [here](javascript:alert(1)) now.',
      })
    );

    expect(html).not.toContain('href="javascript:');
  });

  it('substitutes {{firstName}} with the recipient name', async () => {
    const html = await render(
      ComposerEmail({
        recipientFirstName: 'Alex',
        header: 'Test',
        body: 'Thanks for riding, {{firstName}}!',
      })
    );

    expect(html).toContain('Thanks for riding, Alex!');
  });

  it('falls back to "there" when no first name is available', async () => {
    const html = await render(
      ComposerEmail({
        header: 'Test',
        body: 'Thanks for riding, {{firstName}}!',
      })
    );

    expect(html).toContain('Hi there,');
    expect(html).toContain('Thanks for riding, there!');
  });

  it('uses the header as preview text fallback', async () => {
    const html = await render(
      ComposerEmail({ header: 'Fallback preview', body: 'text' })
    );

    expect(html).toContain('Fallback preview');
  });
});

describe('composer template registration', () => {
  it('is registered and admin-visible', () => {
    expect(getTemplateById('composer')).toBe(templateConfig);
    expect(EMAIL_TEMPLATES.some((t) => t.id === 'composer')).toBe(true);
  });

  it('renders through the registry with auto-filled props', async () => {
    const template = getTemplateById('composer');
    expect(template).toBeDefined();

    const props = buildTemplateProps(
      template!,
      { header: 'Registry render', body: 'Hello {{firstName}}.' },
      {
        recipientFirstName: 'Sam',
        email: 'sam@example.com',
        unsubscribeUrl: 'https://api.loamlogger.app/unsub',
      }
    );
    const html = await render(template!.render(props));

    expect(html).toContain('Registry render');
    expect(html).toContain('Hello Sam.');
    expect(html).toContain('https://api.loamlogger.app/unsub');
  });
});
