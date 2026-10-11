import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

/** Execute the actual component's auth helpers with isolated fetch/storage, not a copied implementation. */
function helpers(fetcher: typeof fetch) {
  const source = readFileSync('src/components/AdminFeedback.tsx', 'utf8');
  const start = source.indexOf('  const refreshSession = async');
  const end = source.indexOf('  const loadGuideRoutes = async', start);
  assert.ok(start > 0 && end > start);
  const code = transformSync(source.slice(start, end) + '\nreturn { refreshSession, authFetch };', { loader: 'ts' }).code;
  const storage = new Map<string, string>([['creative_dna_admin_refresh_token', 'existing-refresh']]);
  const stateWrites: string[] = [];
  const deps = {
    fetch: fetcher, token: 'existing.user.jwt',
    sessionStorage: { getItem: (key: string) => storage.get(key) || null, setItem: (key: string, value: string) => storage.set(key, value) },
    setToken: (value: string) => stateWrites.push(value), setRefreshToken: (value: string) => stateWrites.push(value),
    setMessage: () => {}, logout: () => storage.clear(),
  };
  const factory = new Function('deps', 'const {fetch, token, sessionStorage, setToken, setRefreshToken, setMessage, logout} = deps;\n' + code);
  return { ...factory(deps), storage, stateWrites };
}
test('private-panel refresh does not start after cancellation', async () => {
  let calls = 0; const h = helpers((async () => { calls++; return Response.json({}); }) as typeof fetch);
  const abort = new AbortController(); abort.abort();
  assert.equal(await h.refreshSession(abort.signal), ''); assert.equal(calls, 0);
});
test('a late refresh after logout cannot restore tokens in storage or component state', async () => {
  let complete!: (response: Response) => void;
  const response = new Promise<Response>(resolve => { complete = resolve; });
  const h = helpers((async () => response) as typeof fetch);
  const pending = h.refreshSession(); h.storage.clear();
  complete(Response.json({ access_token: 'new.user.jwt', refresh_token: 'new-refresh' }));
  assert.equal(await pending, ''); assert.equal(h.storage.size, 0); assert.deepEqual(h.stateWrites, []);
});
test('cancelled panel request carries AbortSignal into refresh and does not replay reads', async () => {
  let calls = 0, refreshSignal: AbortSignal | null | undefined, complete!: (response: Response) => void;
  const response = new Promise<Response>(resolve => { complete = resolve; });
  const abort = new AbortController();
  const h = helpers((async (url, init) => {
    calls++;
    if (String(url) !== '/api/admin/refresh') return new Response('{}', { status: 401 });
    refreshSignal = init?.signal; abort.abort(); return response;
  }) as typeof fetch);
  const pending = h.authFetch('/api/member/creative-references/reference.test', { signal: abort.signal });
  complete(Response.json({ access_token: 'new.user.jwt', refresh_token: 'new-refresh' }));
  assert.equal((await pending).status, 401); assert.equal(refreshSignal, abort.signal); assert.equal(calls, 2); assert.deepEqual(h.stateWrites, []);
});
