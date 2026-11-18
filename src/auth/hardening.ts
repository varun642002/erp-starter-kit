import type { NextFunction, Request, Response } from 'express';

// Browser protections sent with every response. The Content-Security-Policy only holds the directives that
// cannot affect the app's own scripts, sign-in or fonts (no clickjacking, no plugins, no form hijacking).
export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.removeHeader('X-Powered-By');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(self), payment=()');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader(
    'Content-Security-Policy',
    "object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'"
  );
  next();
}

interface Bucket {
  count: number;
  resetAt: number;
}

// A small fixed-window limiter, kept in memory per server instance. It stops runaway scripts and guessing;
// ordinary use by a busy office stays far below the limits.
export function rateLimit(options: { name: string; windowMs: number; max: number; message?: string }) {
  const buckets = new Map<string, Bucket>();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }, 60_000);
  sweep.unref();

  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + options.windowMs };
      buckets.set(key, b);
    }
    b.count += 1;
    if (b.count > options.max) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((b.resetAt - now) / 1000))));
      if (b.count === options.max + 1) console.warn(`[security] rate limit "${options.name}" hit by ${key}`);
      return res.status(429).json({ error: options.message || 'Too many requests. Please wait a moment and try again.' });
    }
    next();
  };
}

// Messages that expose database internals (queries, parameters, constraint names, hosts) are logged on the
// server and replaced with a plain message. Friendly messages written for users pass through unchanged.
const TECHNICAL =
  /Failed query|SQLSTATE|violates (foreign key|unique|check|not-null)|duplicate key|syntax error at|relation "[^"]+"|column "[^"]+"|ECONNREFUSED|ECONNRESET|ETIMEDOUT|connect ENOENT|\bparams:|\bselect\b[\s\S]{0,80}\bfrom\b|\binsert into\b|\bupdate\b[\s\S]{0,60}\bset\b|\bdelete from\b|at \S+ \(|node_modules/i;

export function maskServerErrors(req: Request, res: Response, next: NextFunction) {
  const json = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (res.statusCode >= 500 && body && typeof body === 'object') {
      const b = body as { error?: unknown };
      if (typeof b.error === 'string' && TECHNICAL.test(b.error)) {
        console.error(`[error] ${req.method} ${req.originalUrl}: ${b.error.slice(0, 600)}`);
        return json({ ...b, error: 'Something went wrong on the server. Please try again, or contact support if it keeps happening.' });
      }
    }
    return json(body);
  }) as Response['json'];
  next();
}
