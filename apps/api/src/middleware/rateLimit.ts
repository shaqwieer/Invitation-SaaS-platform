import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import { TooManyRequestsError } from '../lib/errors.js';

export interface RateLimitRule {
  windowMs: number;
  limit: number;
}

export interface RateLimitConfig {
  /** Login, register, refresh. */
  auth: RateLimitRule;
  /** OTP requests — each one costs money in production. */
  otp: RateLimitRule;
  /** Public invite-token lookups. Tight, because this is the enumeration surface. */
  inviteLookup: RateLimitRule;
  /** Guest RSVP submissions. */
  rsvp: RateLimitRule;
  /**
   * Guest-list imports. The most expensive authenticated operation in the API —
   * a 10 MB workbook parsed with ExcelJS — so it gets a far smaller budget than
   * `general`, which is sized for ordinary reads.
   */
  fileImport: RateLimitRule;
  /**
   * Door scans. Generous, and keyed by session rather than IP — every staff
   * member at a venue shares one WiFi address, so an IP-keyed budget would have
   * three doors competing for it and start refusing guests at the gate.
   */
  scan: RateLimitRule;
  /** The scanner gate. Tight: this is a password, and it is the same one all night. */
  scanGate: RateLimitRule;
  /** Everything else. */
  general: RateLimitRule;
}

const MINUTE = 60_000;

export const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  auth: { windowMs: 15 * MINUTE, limit: 10 },
  otp: { windowMs: 10 * MINUTE, limit: 3 },
  inviteLookup: { windowMs: MINUTE, limit: 30 },
  rsvp: { windowMs: 10 * MINUTE, limit: 20 },
  fileImport: { windowMs: 15 * MINUTE, limit: 30 },
  scan: { windowMs: 15 * MINUTE, limit: 600 },
  scanGate: { windowMs: 15 * MINUTE, limit: 10 },
  general: { windowMs: 15 * MINUTE, limit: 300 },
};

function build(
  rule: RateLimitRule,
  code: string,
  keyGenerator?: (req: { get(name: string): string | undefined; ip?: string }) => string,
): RateLimitRequestHandler {
  return rateLimit({
    windowMs: rule.windowMs,
    limit: rule.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    ...(keyGenerator ? { keyGenerator: keyGenerator as never } : {}),
    // Route through the app's error pipeline so the body shape matches every
    // other error the client has to handle.
    handler: (_req, _res, next) => {
      next(new TooManyRequestsError('Too many requests, please slow down', code));
    },
  });
}

export interface RateLimiters {
  auth: RateLimitRequestHandler;
  otp: RateLimitRequestHandler;
  inviteLookup: RateLimitRequestHandler;
  rsvp: RateLimitRequestHandler;
  fileImport: RateLimitRequestHandler;
  scan: RateLimitRequestHandler;
  scanGate: RateLimitRequestHandler;
  general: RateLimitRequestHandler;
}

/**
 * Build a fresh set of limiters.
 *
 * Constructed per app instance rather than at module scope so each test gets its
 * own in-memory counters — module-level limiters leak state between test files
 * and produce failures that depend on execution order.
 */
export function createRateLimiters(config: RateLimitConfig = DEFAULT_RATE_LIMITS): RateLimiters {
  return {
    auth: build(config.auth, 'AUTH_RATE_LIMITED'),
    otp: build(config.otp, 'OTP_RATE_LIMITED'),
    inviteLookup: build(config.inviteLookup, 'INVITE_RATE_LIMITED'),
    rsvp: build(config.rsvp, 'RSVP_RATE_LIMITED'),
    fileImport: build(config.fileImport, 'IMPORT_RATE_LIMITED'),
    scan: build(
      config.scan,
      'SCAN_RATE_LIMITED',
      (req) =>
        // Per door session, so one busy gate cannot starve another at the same venue.
        req.get('x-scan-session') ?? req.ip ?? 'unknown',
    ),
    scanGate: build(config.scanGate, 'SCAN_GATE_RATE_LIMITED'),
    general: build(config.general, 'RATE_LIMITED'),
  };
}
