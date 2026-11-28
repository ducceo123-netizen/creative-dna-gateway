/** Optional offline-reviewed OAuth setup. Never imported by server startup.
 * Default CLI mode only validates existing isolated users/clients. Explicit
 * --apply installs SQL policy only; it never registers clients, enables Auth,
 * creates users, sends mail, or writes a production connection.
 */
import { readFile, open, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { boundedId, hash, safeJson, V2Error } from './core.ts';
import { isolatedHttps } from './auth.ts';
import { readPgConnectionConfig, type PgPoolLike } from './postgres-store.ts';

export const OAUTH_TEST_REF='muyyitsvkkjzjojetynr';
export const OAUTH_TEST_ORIGIN='https://uid-brands-architecture-v2-test.onrender.com';
const standardScopes=z.enum(['openid','email','profile','phone','offline_access']);
const schema=z.object({
  projectRef:z.literal(OAUTH_TEST_REF),origin:z.literal(OAUTH_TEST_ORIGIN),
  clients:z.array(z.object({clientId:z.uuid(),redirectUris:z.array(z.string().max(2048)).min(1).max(10)}).strict()).min(1).max(10),
  members:z.record(z.uuid(),z.object({owner:z.string().min(1).max(150),role:z.enum(['operator','reviewer'])}).strict()),
  requiredScopes:z.array(standardScopes).min(1).max(5),requireRefresh:z.boolean().default(true),
}).strict();
export type OAuthActivationInput=z.infer<typeof schema>;
export function parseOAuthActivation(raw:unknown):OAuthActivationInput{
  const parsed=schema.parse(safeJson(raw,32_000));
  if(!Object.keys(parsed.members).length||Object.keys(parsed.members).length>100||!Object.values(parsed.members).some(x=>x.role==='reviewer'))throw new V2Error('OAUTH_IDENTITY_REQUIRED','Explicit existing isolated members including a reviewer are required.');
  for(const member of Object.values(parsed.members))boundedId(member.owner,'owner');
  if(new Set(parsed.clients.map(x=>x.clientId)).size!==parsed.clients.length||new Set(parsed.requiredScopes).size!==parsed.requiredScopes.length||!parsed.requiredScopes.includes('openid'))throw new V2Error('OAUTH_CONFIG','Unique clients and explicit openid scope are required.');
  const allCallbacks=parsed.clients.flatMap(x=>x.redirectUris);
  if(new Set(allCallbacks).size>10)throw new V2Error('OAUTH_CONFIG','At most ten exact OAuth callbacks are supported.');
  for(const client of parsed.clients){
    if(new Set(client.redirectUris).size!==client.redirectUris.length)throw new V2Error('OAUTH_CONFIG','Duplicate callback.');
    for(const value of client.redirectUris){const url=isolatedHttps(value,'Observed OAuth callback');if(url.href!==value||url.origin===parsed.origin||/[{}*]/.test(value))throw new V2Error('OAUTH_CONFIG','Use exact observed external HTTPS callbacks without placeholders.');}
  }
  return parsed;
}
export function oauthActivationConfiguration(raw:unknown){
  const input=parseOAuthActivation(raw),issuer=`https://${input.projectRef}.supabase.co/auth/v1`;
  return {
    authPatch:{site_url:input.origin,oauth_server_enabled:true,oauth_server_authorization_path:'/oauth/consent',oauth_server_allow_dynamic_registration:false,hook_custom_access_token_enabled:true,hook_custom_access_token_uri:'pg-functions://postgres/uid_brands_v2_oauth/custom_access_token_hook'},
    runtimeEnvironment:{V2_AUTH_MODE:'jwt',V2_PUBLIC_ORIGIN:input.origin,V2_JWT_ISSUER:issuer,V2_JWKS_URL:issuer+'/.well-known/jwks.json',V2_JWT_AUDIENCE:input.origin+'/api/mcp',V2_MEMBERS_JSON:JSON.stringify(input.members),V2_OAUTH_CLIENT_IDS_JSON:JSON.stringify(input.clients.map(x=>x.clientId)),V2_OAUTH_REQUIRED_SCOPES_JSON:JSON.stringify(input.requiredScopes),V2_OAUTH_UI_ENABLED:'true',V2_OAUTH_PROJECT_REF:input.projectRef,V2_OAUTH_REDIRECT_URIS_JSON:JSON.stringify([...new Set(input.clients.flatMap(x=>x.redirectUris))])},
    requiredAdditionalEnvironmentNames:['V2_MODE','V2_SUPABASE_PUBLISHABLE_KEY'],
  };
}

/** Pool must be constructed from the same validated admin environment. Inject a
 * local PostgreSQL pool only in tests. Real project identity is checked again
 * through the exact connection hostname/user before any setup SQL executes. */
export async function prepareOAuthPolicy(pool:PgPoolLike,raw:unknown,adminEnv:NodeJS.ProcessEnv,apply=false){
  const input=parseOAuthActivation(raw),connection=readPgConnectionConfig(adminEnv,'migration');
  const expectedUser=connection.host.endsWith('.pooler.supabase.com')?`postgres.${OAUTH_TEST_REF}`:'postgres';
  if(adminEnv.V2_DATABASE_PROJECT_REF!==OAUTH_TEST_REF||connection.user!==expectedUser||!connection.ssl.ca)throw new V2Error('ISOLATION_REQUIRED','Optional OAuth setup requires the exact isolated project administrator and trusted CA.');
  const sql=await readFile(new URL('./migrations/002_optional_oauth_hook.sql',import.meta.url),'utf8'),inputHash=hash(input),client=await pool.connect();
  try{
    await client.query(apply?'BEGIN':'BEGIN READ ONLY');
    const owner=(await client.query('SELECT current_user AS role')).rows[0];
    if(owner?.role!=='postgres')throw new V2Error('ISOLATION_REQUIRED','OAuth setup requires the isolated project administrator.');
    // Read metadata and exact, supplied identity IDs only. Never fetch user
    // email/password hashes or OAuth client secrets.
    const subjects=Object.keys(input.members);
    const existing=(await client.query("SELECT id::text AS id FROM auth.users WHERE id=ANY($1::uuid[]) AND aud='authenticated' AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=now()) AND email_confirmed_at IS NOT NULL AND coalesce(encrypted_password,'')<>'' AND NOT coalesce(is_anonymous,false)",[subjects])).rows;
    if(existing.length!==subjects.length)throw new V2Error('OAUTH_IDENTITY_REQUIRED','Every configured member must already have an active confirmed password account in the isolated project. No account was created.');
    const registered=(await client.query('SELECT id::text AS id,redirect_uris,grant_types FROM auth.oauth_clients WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL',[input.clients.map(x=>x.clientId)])).rows;
    for(const expected of input.clients){
      const actual=registered.find(x=>x.id===expected.clientId),redirects=actual?.redirect_uris?.split(',');
      const grants=actual?.grant_types?.split(',');
      if(!actual||!Array.isArray(redirects)||redirects.length!==expected.redirectUris.length||expected.redirectUris.some(x=>!redirects.includes(x))||!grants?.includes('authorization_code')||input.requireRefresh&&!grants.includes('refresh_token'))throw new V2Error('OAUTH_CLIENT_REQUIRED','Existing OAuth client callbacks and grants must exactly match the reviewed configuration. No client was registered.');
    }
    let replay=false;
    const installed=(await client.query("SELECT to_regclass('uid_brands_v2_oauth.policy') AS policy")).rows[0]?.policy;
    if(installed){
      const prior=(await client.query('SELECT input_hash FROM uid_brands_v2_oauth.policy WHERE singleton')).rows[0];
      if(prior?.input_hash!==inputHash)throw new V2Error('OAUTH_POLICY_CONFLICT','An existing OAuth policy differs. Review an explicit revision instead of overwriting it.');
      replay=true;
    }
    if(apply&&!replay){
      await client.query("SELECT set_config('uid_brands_v2.oauth_project_ref',$1,true)",[input.projectRef]);
      await client.query(sql);
      await client.query('INSERT INTO uid_brands_v2_oauth.policy(singleton,project_ref,resource_url,required_scopes,input_hash) VALUES(true,$1,$2,$3,$4)',[input.projectRef,input.origin+'/api/mcp',input.requiredScopes,inputHash]);
      for(const row of input.clients)await client.query('INSERT INTO uid_brands_v2_oauth.approved_clients(client_id,redirect_uris) VALUES($1,$2)',[row.clientId,row.redirectUris]);
      for(const subject of subjects)await client.query('INSERT INTO uid_brands_v2_oauth.approved_subjects(subject) VALUES($1)',[subject]);
    }
    await client.query('COMMIT');
    return {schemaVersion:'uid.v2.oauth-policy-setup/1',projectRef:input.projectRef,applied:apply,replay,inputHash,migrationHash:hash(sql),memberCount:subjects.length,clientCount:input.clients.length,authConfigurationChanged:false,...oauthActivationConfiguration(input)};
  }catch(error){try{await client.query('ROLLBACK');}catch{}throw error;}finally{client.release();}
}

async function privateJson(path:string){const info=await stat(path);if(!info.isFile()||(info.mode&0o077)!==0||info.size>64*1024)throw new V2Error('PRIVATE_CONFIG_REQUIRED','Setup input files must be private bounded regular JSON files.');return JSON.parse(await readFile(path,'utf8'));}
async function main(){
  const args=process.argv.slice(2),apply=args.includes('--apply');
  if(args.length!==(apply?7:6)||args.some((a,i)=>i%2===0&&a!=='--apply'&&!['--input','--admin-env','--output'].includes(a)))throw new V2Error('USAGE','Use --input private.json --admin-env private-env.json --output private-result.json [--apply].');
  const value=(name:string)=>{const i=args.indexOf(name);if(i<0||!args[i+1]||args[i+1].startsWith('--'))throw new V2Error('USAGE','Missing setup argument.');return args[i+1];};
  const input=await privateJson(value('--input')),env=await privateJson(value('--admin-env'));
  const {Pool}=await import('pg');const pool=new Pool(readPgConnectionConfig(env,'migration'));
  // Reserve an exclusive private receipt before any possible SQL mutation.
  const output=await open(value('--output'),'wx',0o600);
  try{const result=await prepareOAuthPolicy(pool,input,env,apply);await output.writeFile(JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({projectRef:result.projectRef,applied:result.applied,replay:result.replay,inputHash:result.inputHash,authConfigurationChanged:false}));}finally{await output.close();await pool.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(JSON.stringify({error:error instanceof V2Error?error.code:'OAUTH_SETUP_FAILED',credentialsPrinted:false}));process.exitCode=1;});
