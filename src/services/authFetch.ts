import { auth } from '../lib/firebase';

// fetch() that attaches the signed-in user's Firebase ID token. The SDK caches the token and
// refreshes it near expiry; a 401 triggers one forced refresh and retry.
export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  await auth.authStateReady();
  const user = auth.currentUser;
  const headers = new Headers(init.headers);
  if (user && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${await user.getIdToken()}`);
  }
  let res = await fetch(input, { ...init, headers });
  if (res.status === 401 && user) {
    headers.set('Authorization', `Bearer ${await user.getIdToken(true)}`);
    res = await fetch(input, { ...init, headers });
  }
  return res;
}
