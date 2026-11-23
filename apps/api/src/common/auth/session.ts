/** httpOnly cookie carrying the session JWT for the web app. */
export const SESSION_COOKIE = 'aab_session';

/**
 * Required on state-changing requests authenticated by cookie. A custom
 * header cannot be sent cross-site without a CORS preflight (which this API
 * does not allow), so this blocks CSRF in addition to SameSite=Lax.
 */
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_HEADER_VALUE = 'aab-web';

export const JWT_ISSUER = 'aab-api';
export const JWT_AUDIENCE = 'aab';

export interface SessionClaims {
  sub: string;
  email: string;
}
