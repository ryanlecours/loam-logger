/**
 * Apollo context for the public share pages' queries: send no cookies.
 *
 * The API's CSRF check rejects any POST that carries the ll_session cookie
 * without a matching x-csrf-token header. The web app can only find that token
 * in sessionStorage (the ll_csrf cookie belongs to the API host, so
 * document.cookie on this origin never sees it), and sessionStorage starts
 * empty in a tab opened by pasting a URL. So a signed-in rider pasting a share
 * link got a 403 and the "isn't shared" page. These queries need no identity,
 * so leaving the cookies off makes them succeed for everyone.
 */
export const PUBLIC_QUERY_CONTEXT = { fetchOptions: { credentials: 'omit' } } as const;
