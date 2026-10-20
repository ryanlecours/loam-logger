import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRef } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import TurnstileWidget, { type TurnstileHandle } from './TurnstileWidget';
import { TURNSTILE_SCRIPT_SRC, type TurnstileRenderOptions } from '@/lib/turnstile';

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

  it.each([
    ['a reset', (_o: TurnstileRenderOptions, ref: TurnstileHandle | null) => ref?.reset()],
    ['a widget error', (o: TurnstileRenderOptions) => o['error-callback']?.('300030')],
  ])('drops the interactive spacing after %s', async (_label, trigger) => {
    const renderWidget = vi.fn<(el: HTMLElement, opts: TurnstileRenderOptions) => string>().mockReturnValue('w');
    window.turnstile = { render: renderWidget, reset: vi.fn(), remove: vi.fn() };
    const ref = createRef<TurnstileHandle>();
    render(<TurnstileWidget ref={ref} siteKey="site-key" onToken={vi.fn()} />);

    await waitFor(() => expect(renderWidget).toHaveBeenCalled());
    const options = renderWidget.mock.calls[0][1];
    act(() => options['before-interactive-callback']?.());
    expect(screen.getByTestId('turnstile-widget')).toHaveClass('mb-4');

    act(() => trigger(options, ref.current));
    expect(screen.getByTestId('turnstile-widget')).not.toHaveClass('mb-4');
  });
});
