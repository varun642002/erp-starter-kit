import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import type { NextFunction, Request, Response } from 'express';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

export interface VerifiedAuth {
  uid: string;
  email: string;
  role: string;
  branchId: string;
  approved: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: VerifiedAuth;
    }
  }
}

// AUTH_MODE: 'enforce' = reject unverified requests; 'log' = verify when a token is sent but still
// accept the legacy x-user-role / x-branch-id headers (rollout mode); default is 'log' until switched.
const IS_PROD = process.env.NODE_ENV === 'production';
// In production the default is to reject unverified requests, so a missing setting can never leave the API open.
const AUTH_MODE = (process.env.AUTH_MODE || (IS_PROD ? 'enforce' : 'log')).toLowerCase();

if (AUTH_MODE !== 'enforce') {
  console.warn(`[auth] AUTH_MODE=${AUTH_MODE}: API requests are NOT yet protected. Set AUTH_MODE=enforce in .env once verified sign-in works.`);
}

const KNOWN_ROLES = new Set([
  'Super Admin', 'Business Owner', 'Branch Person', 'Branch Manager', 'Accountant', 'Sales Manager',
  'Salesperson', 'Purchase Manager', 'Warehouse Manager', 'Warehouse Staff', 'Cashier'
]);

const firebaseConfig = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'firebase-applet-config.json'), 'utf8'));
const PROJECT_ID: string = firebaseConfig.projectId;

// Token verification only needs the project id: Google's public certificates are fetched, no service account.
const app = getApps()[0] || initializeApp({ projectId: PROJECT_ID });

const PROFILE_TTL_MS = 45_000;
const profileCache = new Map<string, { value: VerifiedAuth | null; expires: number }>();

class AuthFailure extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

async function loadProfile(uid: string, email: string, idToken: string): Promise<VerifiedAuth> {
  const cached = profileCache.get(uid);
  if (cached && cached.expires > Date.now()) {
    if (!cached.value) throw new AuthFailure(403, 'no-profile', 'No ERP profile for this account.');
    return cached.value;
  }

  // Read the user's own profile with THEIR token so Firestore rules decide what they may see.
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${encodeURIComponent(uid)}`;
  let res: globalThis.Response;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
  } catch {
    throw new AuthFailure(503, 'profile-unavailable', 'Could not reach the user profile service.');
  }
  if (res.status === 404) {
    profileCache.set(uid, { value: null, expires: Date.now() + 5_000 });
    throw new AuthFailure(403, 'no-profile', 'No ERP profile for this account.');
  }
  if (res.status === 401 || res.status === 403) throw new AuthFailure(401, 'bad-token', 'Sign-in token was rejected.');
  if (!res.ok) throw new AuthFailure(503, 'profile-unavailable', 'User profile lookup failed.');

  const doc: any = await res.json();
  const f = doc.fields || {};
  const profile: VerifiedAuth = {
    uid,
    email: f.email?.stringValue || email,
    role: f.role?.stringValue || '',
    branchId: f.branchId?.stringValue || 'branch-1',
    approved: f.approved?.booleanValue === true
  };
  profileCache.set(uid, { value: profile, expires: Date.now() + PROFILE_TTL_MS });
  if (profileCache.size > 500) {
    const first = profileCache.keys().next().value;
    if (first) profileCache.delete(first);
  }
  return profile;
}

async function verify(req: Request): Promise<VerifiedAuth | null> {
  const header = req.headers.authorization || '';
  const match = /^Bearer (.+)$/i.exec(header);
  if (!match) return null;
  const token = match[1];

  let decoded;
  try {
    decoded = await getAuth(app).verifyIdToken(token);
  } catch {
    throw new AuthFailure(401, 'bad-token', 'Sign-in token is invalid or expired.');
  }
  const profile = await loadProfile(decoded.uid, decoded.email || '', token);
  if (!profile.approved) throw new AuthFailure(403, 'account-pending', 'Your account is waiting for approval.');
  if (!KNOWN_ROLES.has(profile.role)) throw new AuthFailure(403, 'bad-role', 'Your account has no valid role.');
  return profile;
}

const isLoopback = (req: Request) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '');

// Local testing escape hatch: legacy headers, only off-production, only from this machine, only with no token.
const DEV_BYPASS = process.env.DEV_AUTH_BYPASS === '1' && !IS_PROD;
if (process.env.DEV_AUTH_BYPASS === '1' && IS_PROD) {
  throw new Error('DEV_AUTH_BYPASS must not be set in production.');
}
if (DEV_BYPASS) console.warn('[auth] DEV_AUTH_BYPASS is ON: loopback requests without a token use legacy headers.');

const seenUids = new Set<string>();

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.path === '/health' || req.path === '/api/health') return next();

  const hasToken = /^Bearer /i.test(req.headers.authorization || '');
  try {
    const auth = await verify(req);
    if (auth) {
      req.auth = auth;
      if (!seenUids.has(auth.uid)) {
        seenUids.add(auth.uid);
        console.log(`[auth] verified sign-in: ${auth.email} as ${auth.role} (${auth.branchId})`);
      }
      return next();
    }
  } catch (e) {
    if (AUTH_MODE === 'enforce') {
      const f = e instanceof AuthFailure ? e : new AuthFailure(503, 'auth-error', 'Authentication failed.');
      return res.status(f.status).json({ error: f.message, code: f.code });
    }
    console.warn(`[auth] token rejected (${e instanceof AuthFailure ? e.code : 'error'}) for ${req.method} ${req.originalUrl} - allowed in log mode`);
    return next();
  }

  // No token on the request.
  if (AUTH_MODE === 'enforce') {
    if (DEV_BYPASS && isLoopback(req) && !hasToken) return next();
    return res.status(401).json({ error: 'Sign in required.', code: 'no-token' });
  }
  return next();
}
