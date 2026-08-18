import { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * In-memory sliding-window rate limiter.
 *
 * Each unique key (the client IP by default) is tracked in a Map. On every
 * request the store prunes timestamps that fall outside the current window,
 * then checks whether the remaining count exceeds the configured limit.
 *
 * A `keyGenerator` lets a limiter bucket requests by something other than IP —
 * e.g. the Stellar address that authored a commitment — so abuse can be capped
 * per identity, not just per network origin.
 *
 * This is a single-process implementation; for a multi-process deployment the
 * store should be replaced with a shared backend (e.g. Redis). The client in
 * `src/indexer/cache.ts` is the natural home for that.
 */

/** Matches a Stellar public key (G...) or contract address (C...). */
const STELLAR_ADDRESS = /^[GC][A-Z2-7]{55}$/;

/**
 * Resolves the calling client's IP, honouring the leftmost `X-Forwarded-For`
 * address when the app runs behind a reverse proxy and falling back to the
 * socket address otherwise.
 */
export const clientIp = (req: Request): string =>
  (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ||
  req.socket.remoteAddress ||
  'unknown';

/** Derives the sliding-window bucket key for a request. */
type KeyGenerator = (req: Request) => string;

interface RateLimiterOptions {
  /** Length of the sliding window in milliseconds. */
  windowMs: number;
  /** Maximum number of requests allowed within the window. */
  max: number;
  /** Human-readable message returned when the limit is exceeded. */
  message?: string;
  /**
   * Buckets requests under a custom key instead of the client IP. Defaults to
   * per-IP limiting.
   */
  keyGenerator?: KeyGenerator;
}

type TimestampStore = Map<string, number[]>;

// How often, at most, a limiter walks its whole store to drop keys whose
// timestamps have all aged out. This bounds memory as clients come and go
// without a background timer that would keep the process (and `node --test`)
// alive; the sweep piggy-backs on request traffic instead.
const SWEEP_INTERVAL_MS = 60 * 1000;

function createRateLimiter(options: RateLimiterOptions): RequestHandler {
  const {
    windowMs,
    max,
    message = 'Too many requests, please try again later.',
    keyGenerator = (req: Request) => `ip:${clientIp(req)}`,
  } = options;

  const store: TimestampStore = new Map();
  let lastSweep = Date.now();

  const sweep = (now: number): void => {
    if (now - lastSweep < SWEEP_INTERVAL_MS) return;
    lastSweep = now;
    const windowStart = now - windowMs;
    for (const [key, timestamps] of store) {
      if (timestamps[timestamps.length - 1]! <= windowStart) store.delete(key);
    }
  };

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const windowStart = now - windowMs;
    sweep(now);

    const key = keyGenerator(req);

    // Prune timestamps outside the current sliding window.
    timestamps = timestamps.filter((ts) => ts > windowStart);

    if (timestamps.length >= max) {
      // The oldest in-window hit frees a slot the moment it exits the window;
      // report exactly how long that is instead of making the client wait a
      // full window (which, at an hour, would be needlessly punishing).
      const resetAt = timestamps[0]! + windowMs;
      const retryAfter = Math.max(1, Math.ceil((resetAt - now) / 1000));
      res.set('Retry-After', String(retryAfter));
      res.set('X-RateLimit-Limit', String(max));
      res.set('X-RateLimit-Remaining', '0');
      res.set('X-RateLimit-Reset', String(Math.ceil(resetAt / 1000)));
      // Persist the pruned list so aged-out timestamps do not accumulate.
      store.set(key, timestamps);
      res.status(429).json({ error: message });
      return;
    }

    // Record this request and persist.
    timestamps.push(now);
    store.set(key, timestamps);

    // Expose informational headers on allowed requests.
    res.set('X-RateLimit-Limit', String(max));
    res.set('X-RateLimit-Remaining', String(max - timestamps.length));
    res.set('X-RateLimit-Reset', String(Math.ceil((now + windowMs) / 1000)));

    next();
  };
}

/**
 * Buckets a commitment-creation request by its issuing Stellar address —
 * `partyA` in the request body. Requests whose `partyA` is missing or not a
 * well-formed address (malformed input, unauthenticated probing) fall back to
 * per-IP limiting, so the cap cannot be dodged simply by omitting the field.
 *
 * The address is the *claimed* issuer; the API does not verify its signature
 * (that authenticity is enforced on-chain by `require_auth`). Per-address
 * limiting here is therefore a first line of defence against spamming
 * `create_commitment`, not an authentication boundary.
 */
const commitmentKey: KeyGenerator = (req: Request): string => {
  const partyA = (req.body as { partyA?: unknown } | undefined)?.partyA;
  if (typeof partyA === 'string' && STELLAR_ADDRESS.test(partyA)) {
    return `addr:${partyA}`;
  }
  return `ip:${clientIp(req)}`;
};

/**
 * Standard rate limiter for GET / read endpoints.
 * Allows 100 requests per IP per 60-second sliding window.
 */
export const standardLimiter: RequestHandler = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  message: 'Too many requests from this IP, please try again after a minute.',
});

/**
 * Strict rate limiter for write (POST / PUT / PATCH / DELETE) endpoints.
 * Allows 10 requests per IP per 60-second sliding window.
 */
export const strictLimiter: RequestHandler = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: 'Too many write requests from this IP, please try again after a minute.',
});

/**
 * Per-address rate limiter for POST /commitments (the on-chain
 * `create_commitment` call). Caps each issuing Stellar address to 10 commitment
 * creations per hour so the API cannot be used to spam the registry — bloating
 * on-chain storage and polluting reputation scores — with a per-IP fallback for
 * requests that carry no valid address.
 */
export const createCommitmentLimiter: RequestHandler = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message:
    'Too many commitments created for this address. A maximum of 10 per hour is allowed; please try again later.',
  keyGenerator: commitmentKey,
});
