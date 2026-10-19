import { ApolloLink, Observable, type FetchResult, type ObservableSubscription } from '@apollo/client';
import { refreshCsrfToken } from './csrf';

/** The API's verifyCsrf answers with one of these codes and a 403. */
const CSRF_CODES = new Set(['CSRF_MISSING', 'CSRF_INVALID']);

export function isCsrfRejection(err: unknown): boolean {
  const e = err as { statusCode?: number; result?: { code?: unknown } } | null;
  return e?.statusCode === 403 && typeof e.result?.code === 'string' && CSRF_CODES.has(e.result.code);
}

/**
 * Retries an operation once after the API rejects it for CSRF, having fetched
 * a fresh token first. That happens in a signed-in tab with no cached token (a
 * pasted URL starts with empty sessionStorage) or a stale one (a login in
 * another tab rotated the cookie). Signed-out requests carry no session cookie,
 * so the API never rejects them and this link costs them nothing.
 *
 * Must sit upstream of the link that sets the x-csrf-token header, so the
 * retry picks up the new token.
 */
export const csrfRetryLink = new ApolloLink(
  (operation, forward) =>
    new Observable<FetchResult>((observer) => {
      let sub: ObservableSubscription | undefined;
      let retried = false;
      let closed = false;

      const run = () => {
        sub = forward(operation).subscribe({
          next: (value) => observer.next(value),
          error: (err) => {
            if (retried || !isCsrfRejection(err)) {
              observer.error(err);
              return;
            }
            retried = true;
            void refreshCsrfToken().then((token) => {
              if (closed) return;
              if (token) run();
              else observer.error(err);
            });
          },
          complete: () => observer.complete(),
        });
      };

      run();
      return () => {
        closed = true;
        sub?.unsubscribe();
      };
    })
);
