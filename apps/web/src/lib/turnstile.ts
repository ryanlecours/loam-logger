/**
 * Loader for Cloudflare Turnstile, the bot check on web password signup.
 * The widget lives in components/TurnstileWidget.tsx.
 *
 * https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/
 */

export const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export interface TurnstileRenderOptions {
  sitekey: string;
  action?: string;
  theme?: 'light' | 'dark' | 'auto';
  size?: 'normal' | 'flexible' | 'compact';
  appearance?: 'always' | 'execute' | 'interaction-only';
  callback?: (token: string) => void;
  'expired-callback'?: () => void;
  'error-callback'?: (code: string) => void;
  'before-interactive-callback'?: () => void;
  'after-interactive-callback'?: () => void;
}

export interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileRenderOptions): string | undefined;
  reset(widgetId?: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null;

/** Load the Turnstile script once per page, however many widgets mount. */
export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!scriptPromise) {
    scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = TURNSTILE_SCRIPT_SRC;
      script.async = true;
      script.onload = () => {
        if (window.turnstile) resolve(window.turnstile);
        else reject(new Error('Turnstile script loaded without the turnstile API'));
      };
      script.onerror = () => {
        // Let the next mount try again (a blocker or a flaky network).
        scriptPromise = null;
        script.remove();
        reject(new Error('Turnstile script failed to load'));
      };
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}
