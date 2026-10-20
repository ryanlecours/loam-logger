import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import TurnstileWidget from './TurnstileWidget';
import { TURNSTILE_SCRIPT_SRC } from '@/lib/turnstile';

afterEach(() => {
  delete window.turnstile;
  document.querySelectorAll('script').forEach((s) => s.remove());
});

describe('TurnstileWidget', () => {
  it('loads the Cloudflare script once and renders after it arrives', async () => {
    const onToken = vi.fn();
    render(
      <>
        <TurnstileWidget siteKey="site-key" onToken={onToken} />
        <TurnstileWidget siteKey="site-key" onToken={onToken} />
      </>
    );

    const scripts = document.querySelectorAll<HTMLScriptElement>(`script[src="${TURNSTILE_SCRIPT_SRC}"]`);
    expect(scripts).toHaveLength(1);
    expect(TURNSTILE_SCRIPT_SRC).toMatch(/^https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/);

    const api = { render: vi.fn().mockReturnValue('w'), reset: vi.fn(), remove: vi.fn() };
    window.turnstile = api;
    scripts[0].onload?.(new Event('load'));

    await waitFor(() => expect(api.render).toHaveBeenCalledTimes(2));
  });
});
