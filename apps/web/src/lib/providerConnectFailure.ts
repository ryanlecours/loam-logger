/**
 * The `?message=` the API's OAuth callbacks redirect to /auth/error with.
 *
 * Only the messages the API actually sends are recognised. The URL is
 * public, so anything else could be a link crafted to put arbitrary text on
 * this domain; it is treated as unknown and the page shows generic copy.
 */

/** Where "Try again" goes: the Settings pane that holds the connect buttons. */
export const CONNECTED_SERVICES_PATH = '/settings?section=data-sources';

const PROVIDERS = ['Garmin', 'Strava', 'WHOOP', 'Suunto'] as const;
export type ConnectProvider = (typeof PROVIDERS)[number];

export type ConnectFailure =
  | { kind: 'failed'; provider: ConnectProvider }
  | { kind: 'already_linked'; provider: ConnectProvider }
  | { kind: 'unknown' };

const PROVIDER_PATTERN = PROVIDERS.join('|');
const FAILED_PATTERN = new RegExp(`^(${PROVIDER_PATTERN}) connection failed\\. Please try again\\.$`);
const ALREADY_LINKED_PATTERN = new RegExp(
  `^This (${PROVIDER_PATTERN}) account is already linked to another user\\.$`
);

export function parseConnectFailure(message: string | null): ConnectFailure {
  if (!message) return { kind: 'unknown' };
  const failed = FAILED_PATTERN.exec(message);
  if (failed) return { kind: 'failed', provider: failed[1] as ConnectProvider };
  const linked = ALREADY_LINKED_PATTERN.exec(message);
  if (linked) return { kind: 'already_linked', provider: linked[1] as ConnectProvider };
  return { kind: 'unknown' };
}

export function connectFailureCopy(failure: ConnectFailure): { title: string; body: string } {
  switch (failure.kind) {
    case 'failed':
      return {
        title: `${failure.provider} didn't connect`,
        body: `${failure.provider} connection failed. Please try again.`,
      };
    case 'already_linked':
      return {
        title: `${failure.provider} is linked elsewhere`,
        body: `This ${failure.provider} account is already linked to another user. Disconnect it from that account first, then connect it here.`,
      };
    default:
      return {
        title: "The connection didn't finish",
        body: 'Something went wrong while connecting your account. Please try again.',
      };
  }
}
