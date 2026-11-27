import { createHash, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { readFileSync } from 'node:fs';
import { boundedId, safeJson, V2Error } from './core.ts';

export type Principal = { owner: string; subject: string; role: 'operator' | 'reviewer'; auth: 'test-token' | 'jwt' };
export type VerifyPrincipal = (authorization?: string) => Promise<Principal>;
export const PRODUCTION_PROJECT = 'wuonwttmkadwsmefjukv';
export function isolatedHttps(value: string, label: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || url.search || url.hostname.endsWith('.') || url.hostname.includes(PRODUCTION_PROJECT) || /(?:^|\.)(?:localhost|local|internal)$/.test(url.hostname) || /^\d|^\[/.test(url.hostname)) throw new V2Error('ISOLATION_REQUIRED', `${label} must be a separately configured public HTTPS origin.`);
  return url;
}
function bearer(value?: string): string {
  if (!value || !/^Bearer [^\s]{32,8192}$/.test(value)) throw new V2Error('UNAUTHORIZED', 'A V2 credential is required.', 401);
  return value.slice(7);
}
export type TestPrincipalConfig = { tokenSha256: string; owner: string; subject: string; role: 'operator' | 'reviewer' };
/** Explicitly provisioned independent test credentials; never accepts V1 Supabase tokens. */
export function testTokenVerifier(config: TestPrincipalConfig[]): VerifyPrincipal {
  if (!config.length || config.length > 100) throw new V2Error('AUTH_CONFIG', 'Provision 1–100 explicit V2 test principals.');
  const entries = config.map(row => {
    boundedId(row.owner); boundedId(row.subject);
    if (!/^[a-f0-9]{64}$/.test(row.tokenSha256) || !['operator', 'reviewer'].includes(row.role)) throw new V2Error('AUTH_CONFIG', 'Invalid V2 principal configuration.');
    return { ...row, digest: Buffer.from(row.tokenSha256, 'hex') };
  });
  if (new Set(entries.map(x=>x.tokenSha256)).size !== entries.length) throw new V2Error('AUTH_CONFIG', 'Duplicate V2 credential.');
  return async authorization => {
    const token = bearer(authorization);
    // Random opaque test tokens cannot be production JWTs or upstream API keys.
    if (!/^uidv2_[A-Za-z0-9_-]{43,128}$/.test(token)) throw new V2Error('UNAUTHORIZED', 'Invalid V2 credential.', 401);
    const digest = createHash('sha256').update(token).digest();
    let match: typeof entries[number] | undefined;
    for (const entry of entries) if (timingSafeEqual(digest, entry.digest)) match = entry;
    if (!match) throw new V2Error('UNAUTHORIZED', 'Invalid V2 credential.', 401);
    return { owner: match.owner, subject: match.subject, role: match.role, auth: 'test-token' };
  };
}
export function jwtVerifier(config: { issuer: string; audience: string; jwksUrl: string; members: Record<string, { owner: string; role: 'operator' | 'reviewer' }> }): VerifyPrincipal {
  const issuer = isolatedHttps(config.issuer, 'V2 issuer');
  const jwks = isolatedHttps(config.jwksUrl, 'V2 JWKS');
  if (jwks.origin !== issuer.origin || !config.audience) throw new V2Error('AUTH_CONFIG', 'JWKS must belong to the isolated issuer and audience is required.');
  const members = safeJson(config.members, 32_000);
  for (const [subject, member] of Object.entries(members)) {
    boundedId(subject); boundedId(member.owner);
    if (!['operator', 'reviewer'].includes(member.role)) throw new V2Error('AUTH_CONFIG', 'Invalid V2 membership.');
  }
  if (!Object.keys(members).length) throw new V2Error('AUTH_CONFIG', 'Explicit isolated V2 membership is required.');
  const keys = createRemoteJWKSet(jwks, { timeoutDuration: 5000, cooldownDuration: 30_000 });
  return async authorization => {
    try {
      const { payload } = await jwtVerify(bearer(authorization), keys, { issuer: config.issuer, audience: config.audience, algorithms: ['RS256', 'ES256'], requiredClaims: ['sub', 'iat', 'exp', 'aud', 'iss'], clockTolerance: 5 });
      const member = payload.sub && Object.hasOwn(members, payload.sub) ? members[payload.sub] : undefined;
      if (!member) throw new Error('Inactive member');
      return { owner: member.owner, subject: payload.sub!, role: member.role, auth: 'jwt' };
    } catch { throw new V2Error('UNAUTHORIZED', 'Invalid or inactive V2 membership.', 401); }
  };
}
export function verifierFromEnv(env: NodeJS.ProcessEnv): VerifyPrincipal {
  if (env.V2_AUTH_MODE === 'test-token') {
    if (!!env.V2_TEST_PRINCIPALS_FILE === !!env.V2_TEST_PRINCIPALS_JSON) throw new V2Error('AUTH_CONFIG', 'Configure exactly one isolated test-principal source.');
    const input = env.V2_TEST_PRINCIPALS_JSON || readFileSync(env.V2_TEST_PRINCIPALS_FILE!, 'utf8');
    return testTokenVerifier(safeJson(JSON.parse(input), 32_000));
  }
  if (env.V2_AUTH_MODE === 'jwt') return jwtVerifier({ issuer: env.V2_JWT_ISSUER || '', audience: env.V2_JWT_AUDIENCE || '', jwksUrl: env.V2_JWKS_URL || '', members: JSON.parse(env.V2_MEMBERS_JSON || '{}') });
  throw new V2Error('AUTH_CONFIG', 'Configure isolated V2 authentication; public mode is disabled.');
}
