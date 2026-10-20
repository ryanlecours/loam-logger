// How many proxies sit between a visitor and the API on Railway.
//
// Express's `trust proxy` hop count decides which X-Forwarded-For entry
// becomes req.ip, and req.ip keys every per-IP rate limit (signup, login,
// the Turnstile and App Attest fallback buckets) plus User.signupIp.
//
// Railway sends each request through two proxies: its edge, then an internal
// hop. Measured on 2026-10-20 against the staging API (same edge as
// production), a request that sent its own X-Forwarded-For and X-Real-IP
// arrived as:
//
//   X-Forwarded-For: <visitor>, 152.233.47.68
//   X-Real-Ip:       <visitor>
//
// The edge drops the client's X-Forwarded-For and starts a fresh one with the
// address it saw, and the internal hop appends its own (it varied across
// 152.233.47.66 to .69 between requests). With one trusted hop, req.ip was
// that internal address, so every visitor shared a handful of rate-limit
// buckets. Two hops lands on the visitor.
//
// Two hops also holds if the edge ever starts appending to a client header
// instead of replacing it: anything the client wrote sits further left and
// is never read. Express only reads X-Forwarded-For, so a client-sent
// Forwarded header (which the edge passes through) does not matter.
export const TRUST_PROXY_HOPS = 2;
