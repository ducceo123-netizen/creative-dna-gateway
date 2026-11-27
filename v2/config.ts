import { readFileSync, existsSync, realpathSync, mkdirSync } from 'node:fs';
import { resolve, isAbsolute, parse } from 'node:path';
import { V2Error } from './core.ts';
const forbiddenKeys = ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_SECRET_KEYS', 'CREATIVE_DNA_FEEDBACK_UPSTREAM_URL', 'CREATIVE_DNA_ADMIN_UPSTREAM_URL', 'DATABASE_URL'];
export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  for (const key of forbiddenKeys) if (env[key]) throw new V2Error('ISOLATION_REQUIRED', `Remove ${key}; the V2 local store cannot use production write credentials.`);
  if (env.V2_MODE !== 'isolated-test') throw new V2Error('ISOLATION_REQUIRED', 'V2_MODE must explicitly be isolated-test.');
  const store=env.V2_STORE||'sqlite';
  if(!['sqlite','postgres'].includes(store))throw new V2Error('CONFIG','V2_STORE must be sqlite or postgres.');
  let dataDir:string|undefined;
  if(store==='sqlite'){
  if (!env.V2_DATA_DIR || !isAbsolute(env.V2_DATA_DIR)) throw new V2Error('ISOLATION_REQUIRED', 'V2_DATA_DIR must be an absolute, isolated local directory.');
    dataDir = resolve(env.V2_DATA_DIR);
  if (dataDir === parse(dataDir).root || /(?:^|\/)(?:\.git|supabase)(?:\/|$)/.test(dataDir)) throw new V2Error('ISOLATION_REQUIRED', 'V2_DATA_DIR is not isolated.');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  if (realpathSync(dataDir) !== dataDir) throw new V2Error('ISOLATION_REQUIRED', 'Symlinked data directories are unsupported.');
  // Render Free filesystem is ephemeral. Never label it durable or silently lose resumable jobs.
  if (env.RENDER) {
    const mount = env.V2_PERSISTENT_MOUNT;
    if (!mount || !isAbsolute(mount) || !(dataDir === mount || dataDir.startsWith(mount + '/')) || !existsSync('/proc/self/mountinfo')) throw new V2Error('DURABLE_STORE_REQUIRED', 'Render requires a verified persistent V2 mount; Free ephemeral storage cannot host resumable V2 jobs.');
    const mounts = readFileSync('/proc/self/mountinfo', 'utf8').split('\n').map(line => line.split(' ')[4]);
    if (!mounts.includes(mount) || mount === '/') throw new V2Error('DURABLE_STORE_REQUIRED', 'Configured V2 persistent mount was not found.');
  }
  }
  const origin = env.V2_PUBLIC_ORIGIN || 'http://127.0.0.1:4318';
  const parsed = new URL(origin);
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/' || parsed.hostname.endsWith('.') || ['uid-brands-gateway-preview.onrender.com', 'uid-brands-lean-v2.onrender.com', 'uid-brands-studio-webapp.onrender.com'].includes(parsed.hostname)) throw new V2Error('ISOLATION_REQUIRED', 'V2 must have a distinct origin.');
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname))) throw new V2Error('TLS_REQUIRED', 'Nonlocal V2 endpoints require HTTPS.');
  const port = Number(env.PORT || 4318);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new V2Error('CONFIG', 'Invalid port.');
  return { store, dataDir, database: dataDir?resolve(dataDir, 'v2.sqlite'):undefined, origin: parsed.origin, port };
}
