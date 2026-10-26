import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { UserRole } from '../shared/types.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const SECRET_FILE = path.join(DATA_DIR, '.session_secret');

function getOrCreateSessionSecret(): string {
  const envSecret = process.env.SESSION_SECRET?.trim();
  if (envSecret && envSecret.length >= 16) {
    return envSecret;
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(SECRET_FILE)) {
    const existing = fs.readFileSync(SECRET_FILE, 'utf8').trim();
    if (existing.length >= 32) {
      return existing;
    }
  }
  const generated = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_FILE, generated, { mode: 0o600 });
  return generated;
}

const SESSION_SECRET = getOrCreateSessionSecret();

export function hashSecret(plain: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(plain, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

export function verifySecret(plain: string, storedHash: string | null | undefined): boolean {
  if (!storedHash || !storedHash.startsWith('scrypt:')) {
    return false;
  }
  const parts = storedHash.split(':');
  if (parts.length !== 3) {
    return false;
  }
  const [, salt, expectedHex] = parts;
  const derived = crypto.scryptSync(plain, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(derived, expected);
}

export function generateOneTimeActivationCode(): string {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = crypto.randomBytes(8);
  let part1 = '';
  let part2 = '';
  for (let i = 0; i < 4; i++) {
    part1 += alphabet[bytes[i] % alphabet.length];
    part2 += alphabet[bytes[i + 4] % alphabet.length];
  }
  return `FAOL-${part1}-${part2}`;
}

export interface SessionTokenPayload {
  uid: number;
  sid: string;
  role: UserRole;
  exp: number;
}

export function signSessionToken(uid: number, serviceId: string, role: UserRole): string {
  const payload: SessionTokenPayload = {
    uid,
    sid: serviceId,
    role,
    exp: Date.now() + 12 * 60 * 60 * 1000, // 12 hours
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payloadB64)
    .digest('base64url');
  return `${payloadB64}.${sig}`;
}

export function verifySessionToken(token: string): SessionTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) {
    return null;
  }
  const [payloadB64, providedSig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payloadB64)
    .digest('base64url');

  const bufA = Buffer.from(providedSig, 'utf8');
  const bufB = Buffer.from(expectedSig, 'utf8');
  if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as SessionTokenPayload;
    if (!parsed.exp || Date.now() > parsed.exp) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

// IP-level brute force guard to complement per-account DB lockout
interface IpAttemptState {
  count: number;
  windowStart: number;
}

const ipAttempts = new Map<string, IpAttemptState>();
const IP_WINDOW_MS = 15 * 60 * 1000;
const IP_MAX_FAILURES = 15;

export function isIpRateLimited(ip: string): boolean {
  const entry = ipAttempts.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.windowStart > IP_WINDOW_MS) {
    ipAttempts.delete(ip);
    return false;
  }
  return entry.count >= IP_MAX_FAILURES;
}

export function recordIpFailure(ip: string): void {
  const now = Date.now();
  const entry = ipAttempts.get(ip);
  if (!entry || now - entry.windowStart > IP_WINDOW_MS) {
    ipAttempts.set(ip, { count: 1, windowStart: now });
  } else {
    entry.count += 1;
  }
}

export function clearIpFailures(ip: string): void {
  ipAttempts.delete(ip);
}
