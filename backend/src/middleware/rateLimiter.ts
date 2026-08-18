import { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * In-memory sliding-window rate limiter.
 *
 * Each unique IP address is tracked in a Map.  On every request the store
 * prunes timestamps that fall outside the current window, then checks whether
 * the remaining count exceeds the configured limit.
 *
 * This is a single-process implementation; for a multi-process deployment
 * the store should be replaced with a shared backend (e.g. Redis).
 */

interface RateLimiterOptions {
  /** Length of the sliding window in milliseconds. */
  windowMs: number;
  /** Maximum number of requests allowed within the window. */
  max: number;
  /** Human-readable message returned when the limit is exceeded. */
  message?: string;
}

type TimestampStore = Map<string, number[]>;

function createRateLimiter(options: RateLimiterOptions): RequestHandler {
  const { windowMs, max, message = 'Too many requests, please try again later.' } = options;
  const store: TimestampStore = new Map();

  return (req: Request, res: Response, next: NextFunction): void => {
    // Resolve client IP – trust the leftmost address in X-Forwarded-For when
    // the app runs behind a reverse proxy, otherwise fall back to socket IP.
    const ip =
      (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0].trim() ??
      req.socket.remoteAddress ??
      'unknown';

    const now = Date.now();
    const windowStart = now - windowMs;

    // Retrieve or initialise the timestamp list for this IP.
    let timestamps = store.get(ip) ?? [];

    // Prune timestamps outside the current sliding window.
    timestamps = timestamps.filter((ts) => ts > windowStart);

    if (timestamps.length >= max) {
      const retryAfter = Math.ceil(windowMs / 1000);
      res.set('Retry-After', String(retryAfter));
      res.set('X-RateLimit-Limit', String(max));
      res.set('X-RateLimit-Remaining', '0');
      res.set('X-RateLimit-Reset', String(Math.ceil((timestamps[0]! + windowMs) / 1000)));
      res.status(429).json({ error: message });
      return;
    }

    // Record this request and persist.
    timestamps.push(now);
    store.set(ip, timestamps);

    // Expose informational headers on allowed requests.
    res.set('X-RateLimit-Limit', String(max));
    res.set('X-RateLimit-Remaining', String(max - timestamps.length));
    res.set('X-RateLimit-Reset', String(Math.ceil((now + windowMs) / 1000)));

    next();
  };
}

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
