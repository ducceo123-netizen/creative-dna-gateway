/** Explicit opt-in disposable PostgreSQL 16/17 integration contract.
 * Run with node --import tsx. --self-test is offline and never imports pg.
 * No migration runner, credentials discovery, provider request or live service.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MARKER = 'UID_WORKSPACE_DISPOSABLE_TEST_ONLY_v1';
const DATABASE = 'uid_workspace_test';
const ADMIN = 'uid_workspace_test_admin';
const TEST_PASSWORD = 'uid-workspace-disposable-test'; // Public fixture, never a real secret.
const SCHEMA = 'uid_workspace_test';
const ROLES = ['uw_test_store', 'uw_test_budget', 'uw_test_login', 'uw_test_worker', 'uw_test_browser'];
const sql = readFileSync(new URL('./workspace_fixture.sql', import.meta.url), 'utf8');
const draft = readFileSync(new URL('../../docs/uid-workspace/runtime-schema.draft.sql', import.meta.url), 'utf8');

function safeConfig(env) {
  if (env.UID_WORKSPACE_PG_TEST_DISPOSABLE !== 'yes') throw Error('DISPOSABLE_TEST_OPT_IN_REQUIRED');
  if (env.PGDATABASE !== DATABASE || env.PGUSER !== ADMIN) throw Error('EXACT_TEST_DATABASE_AND_ADMIN_REQUIRED');
  if (!['127.0.0.1', '::1'].includes(env.PGHOST)) throw Error('NUMERIC_LOOPBACK_HOST_REQUIRED');
  if (!/^\d{4,5}$/.test(env.PGPORT ?? '') || Number(env.PGPORT) < 1024 || Number(env.PGPORT) > 65535) throw Error('EXPLICIT_TEST_PORT_REQUIRED');
  // Do not inherit connection strings, libpq options, service files or remote module URLs.
  // Password/env credentials are not read: the driver always gets fixed fixture data.
  for (const key of ['DATABASE_URL', 'PGDATABASE_URL', 'PGSERVICE', 'PGSERVICEFILE', 'PGOPTIONS', 'PGHOSTADDR', 'PGPASSFILE']) {
    if (env[key]) throw Error('AMBIENT_CONNECTION_OVERRIDE_FORBIDDEN');
  }
  if (env.UID_TEST_PG_MAJOR && !['16', '17'].includes(env.UID_TEST_PG_MAJOR)) throw Error('POSTGRES_16_OR_17_REQUIRED');
  const module = env.UID_TEST_PG_MODULE || 'pg';
  if (module !== 'pg' && (!isAbsolute(module) || !/\.(?:mjs|cjs|js)$/.test(module))) throw Error('LOCAL_PG_MODULE_REQUIRED');
  return { host: env.PGHOST, port: Number(env.PGPORT), database: DATABASE, user: ADMIN,
    password: TEST_PASSWORD, ssl: false, options: '', application_name: 'uid-workspace-disposable-test',
    connectionTimeoutMillis: 5000, statement_timeout: 15000, query_timeout: 20000,
    idle_in_transaction_session_timeout: 20000, module, major: env.UID_TEST_PG_MAJOR };
}
function workerFunctions() {
  const names = ['uid_workspace_discover_owners', 'uid_workspace_authorize_owner'];
  return names.map(name => {
    const start = draft.indexOf(`CREATE FUNCTION private.${name}(`);
    assert.notEqual(start, -1, `Draft function missing: ${name}`);
    const end = draft.indexOf('\n$$;', start);
    assert.notEqual(end, -1, `Draft function terminator missing: ${name}`);
    return draft.slice(start, end + 4)
      .replaceAll('private.uid_workspace_owner_state', `${SCHEMA}.owner_state`)
      .replaceAll('public.creative_dna_team_members', `${SCHEMA}.team_members`)
      .replaceAll(`private.${name}`, `${SCHEMA}.${name}`);
  });
}
function functionPermissions() {
  return ['uid_workspace_discover_owners(text, integer)', 'uid_workspace_authorize_owner(text)'].map(signature => `
    ALTER FUNCTION ${SCHEMA}.${signature} OWNER TO uw_test_directory_owner;
    REVOKE ALL ON FUNCTION ${SCHEMA}.${signature} FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION ${SCHEMA}.${signature} TO uw_test_worker;`).join('\n');
}
const goodEnv = { UID_WORKSPACE_PG_TEST_DISPOSABLE: 'yes', PGDATABASE: DATABASE, PGUSER: ADMIN, PGHOST: '127.0.0.1', PGPORT: '55432' };
async function selfTest() {
  assert.equal(safeConfig(goodEnv).database, DATABASE);
  assert.equal(safeConfig({ ...goodEnv, PGHOST: '::1' }).host, '::1');
  let rejected = 0;
  for (const change of [
    { UID_WORKSPACE_PG_TEST_DISPOSABLE: undefined }, { UID_WORKSPACE_PG_TEST_DISPOSABLE: 'true' },
    { PGDATABASE: 'postgres' }, { PGDATABASE: 'production' }, { PGUSER: 'postgres' },
    ...['localhost', '10.0.0.1', 'db.example.com', '/tmp', '127.0.0.1.evil.test', ''].map(PGHOST => ({ PGHOST })),
    ...['', '5432abc', '0', '1023', '65536'].map(PGPORT => ({ PGPORT })),
    ...['DATABASE_URL', 'PGDATABASE_URL', 'PGSERVICE', 'PGSERVICEFILE', 'PGOPTIONS', 'PGHOSTADDR', 'PGPASSFILE'].map(key => ({ [key]: 'test-override' })),
    { UID_TEST_PG_MAJOR: '15' }, { UID_TEST_PG_MODULE: 'https://example.test/pg.mjs' }, { UID_TEST_PG_MODULE: './pg.js' },
  ]) { assert.throws(() => safeConfig({ ...goodEnv, ...change })); rejected++; }
  assert.ok(sql.startsWith('-- DISPOSABLE TEST CLUSTER ONLY.'));
  assert.match(sql, /shobj_description/);
  assert.match(sql, /Fresh empty test database/);
  assert.equal((sql.match(/FORCE ROW LEVEL SECURITY/g) || []).length, 4);
  assert.ok(!/\bDROP\s+(?:DATABASE|SCHEMA|ROLE|TABLE)\b/i.test(sql));
  assert.ok(!/\bCOMMIT\s*;/i.test(sql), 'Fixture remains one atomic transaction until functions/grants installed');
  for (const definition of workerFunctions()) {
    assert.match(definition, /SECURITY DEFINER SET search_path = pg_catalog/);
    assert.ok(!definition.includes('private.') && !definition.includes('public.'), 'Only fixture objects referenced');
  }
  const { createWorkspaceRuntime } = await import('../../uid-workspace-runtime.ts');
  const runtime = createWorkspaceRuntime();
  assert.equal(runtime.readiness().ready, false);
  assert.equal((await runtime.tick()).status, 'disabled');
  console.log(`PASS offline safety checks (${rejected} rejected configurations), fixture structure, draft function relocation, default-disabled runtime`);
  console.log('NOT RUN: real PostgreSQL, RLS, concurrency, SQL function execution and process reopen. No database/module connection attempted.');
}

function reserved(value) { assert.equal(value.status, 'reserved'); return value; }
const hash = value => createHash('sha256').update(value).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function eventually(check, message) {
  const until = Date.now() + 4000;
  while (Date.now() < until) { if (await check()) return; await sleep(20); }
  assert.fail(message);
}
async function loadAdapters() {
  const [store, budget, provider, runtime, task, fixtures, openai] = await Promise.all([
    import('../../uid-workspace-store.ts'), import('../../uid-workspace-budget.ts'),
    import('../../uid-workspace-provider-budget.ts'), import('../../uid-workspace-runtime.ts'),
    import('../../uid-workspace-task.ts'), import('../helpers/workspace-provider-fixture.ts'), import('../../uid-workspace-openai.ts'),
  ]);
  return { ...store, ...budget, ...provider, ...runtime, ...task, ...fixtures, ...openai };
}
async function runDatabase(config, reopenOnly = false) {
  // No driver is imported until all config guards pass. Inject an already installed
  // local pg module, matching existing repo SQL runners; never install/download it.
  const imported = await import(config.module === 'pg' ? 'pg' : pathToFileURL(config.module).href);
  const pg = imported.default ?? imported;
  const { module: _module, major, ...connectionConfig } = config;
  const admin = new pg.Client(connectionConfig);
  const pools = [];
  const resources = new Set();
  const realPools = [];
  let initialized = false;
  const pass = name => console.log(`PASS ${name}`);
  const a = await loadAdapters();
  const ownerConfig = { schemaReviewed: true, schemaVersion: 'uid-workspace-owner-state-v1', qualifiedTable: `${SCHEMA}.owner_state` };
  const textPricing = { evidence_ref: 'fixture-text-pricing', model: a.WORKSPACE_OPENAI_MODEL, verified_at: a.before, expires_at: a.later,
    max_input_tokens_per_utf8_byte: 1, protocol_input_token_overhead: 100, max_input_tokens: 10000, max_output_tokens: 1000,
    tiers: [{ through_input_tokens: 10000, input_microusd_per_million: 2_000_000, output_microusd_per_million: 8_000_000 }] };
  const textConfig = { schemaReviewed: true, schemaVersion: 'uid-workspace-budget-v1', qualifiedTable: `${SCHEMA}.budget_journal`, pricing: textPricing, now: () => a.NOW };
  const imageConfig = requests => ({ ...textConfig, pricing: [a.pricing], verifiedBounds: requests.map(a.boundFor) });
  const directoryConfig = { schemaReviewed: true, schemaVersion: 'uid-workspace-worker-directory-v1',
    discoverFunction: `${SCHEMA}.uid_workspace_discover_owners`, authorizeFunction: `${SCHEMA}.uid_workspace_authorize_owner` };
  const loginConfig = namespace => ({ schemaReviewed: true, schemaVersion: 'uid-workspace-login-v1', qualifiedTable: `${SCHEMA}.login_journal`,
    namespace, clientLimit: 3, accountLimit: 2, windowMs: 10000, reservationMs: 1000, maxRecords: 100, now: () => a.NOW });
  const textRequest = (project, overrides = {}) => ({ authorization_id: 'alice-task-one-auth', owner_id: 'alice', task_id: 'task-one', project_id: project,
    operation_id: 'text-one', request_sha256: 'f'.repeat(64), client_request_id: 'text-request', model: a.WORKSPACE_OPENAI_MODEL, maximum_cost_microusd: 3000,
    request_bytes: 400, input_utf8_bytes: 200, max_output_tokens: 100, reasoning_effort: 'high', budget_authorization_ref: 'task-one-budget',
    global_budget_authorization_ref: 'global-approved', user_quota_authorization_ref: 'alice-quota', capability_verification_ref: 'text-capability', ...overrides });
  const attempt = (attempt_id, account = 'account-a', client = 'client-a') => ({ attempt_id, account_key: hash(account), client_key: hash(client) });
  const ownerRecord = (owner, status = 'queued') => ({ owner_id: owner,
    task: a.createWorkspaceTask(`task-${owner}`, { snapshot_id: 'fixture-snapshot', canonical_version: 'fixture-version', content_revision: 'fixture-content', content_digest: hash('fixture'), assets: [] }),
    brief: { brand: 'PawfectHouse', material: 'onepage', source_url: 'https://example.test/fixture' },
    created_at: a.before, updated_at: a.before, actions: [{ action_id: `action-${owner}`, idempotency_key: `action-${owner}`, fingerprint: 'fixture', type: 'start', status,
      expected_state_version: 0, content_revision: 'fixture-content', created_at: a.before, actor_id: owner, payload: {} }],
    events: [], artifacts: [], review_manifest: null, preview: null, content: null, quality: [] });
  function poolFor(role, label, max = 4) {
    assert.ok(ROLES.includes(role));
    const pool = new pg.Pool({ ...connectionConfig, user: role, application_name: `uw-test-${label}`, max, idleTimeoutMillis: 2000 });
    pool.on('error', () => {}); // Query paths still propagate errors; don't print connection details.
    pools.push(pool); realPools.push(pool);
    return pool;
  }
  async function withConnection(pool, fn) { const c = await pool.connect(); try { return await fn(c); } finally { c.release(); } }
  async function transaction(pool, context, value, fn) {
    return withConnection(pool, async c => {
      await c.query('BEGIN');
      try {
        await c.query('SELECT set_config($1, $2, true)', [context, value]);
        const result = await fn(c); await c.query('COMMIT'); return result;
      } catch (error) { await c.query('ROLLBACK'); throw error; }
    });
  }
  // Controlled fault injection loses only the JS acknowledgment AFTER PostgreSQL
  // has acknowledged COMMIT. No pretend SQL engine; not a network/crash simulation.
  function loseCommitOnce(pool) {
    let armed = true;
    return { async connect() {
      const c = await pool.connect();
      return { release: () => c.release(), async query(text, values) {
        const result = await c.query(text, values);
        if (text === 'COMMIT' && armed) { armed = false; throw Error('TEST_LOST_COMMIT_ACK'); }
        return result;
      } };
    } };
  }
  async function provision(project, mutate = () => {}) {
    const state = a.fixtureState(); state.project_id = project; mutate(state);
    await admin.query(`INSERT INTO ${SCHEMA}.budget_journal (project_id, state, revision) VALUES ($1, $2::jsonb, 1)`, [project, JSON.stringify(state)]);
    return state;
  }
  const budgetState = async project => (await admin.query(`SELECT state, revision FROM ${SCHEMA}.budget_journal WHERE project_id = $1`, [project])).rows[0];
  try {
    await admin.connect();
    const meta = (await admin.query(`SELECT current_database() AS database, current_user AS username,
      current_setting('server_version_num')::integer AS version,
      pg_catalog.shobj_description((SELECT oid FROM pg_catalog.pg_database WHERE datname = current_database()), 'pg_database') AS marker`)).rows[0];
    assert.equal(meta.database, DATABASE); assert.equal(meta.username, ADMIN); assert.equal(meta.marker, MARKER, 'Database must be explicitly marked disposable before ANY DDL');
    const version = Math.floor(meta.version / 10000); assert.ok([16, 17].includes(version)); if (major) assert.equal(String(version), major);
    if (!reopenOnly) {
      await admin.query("SELECT set_config('uid.workspace_disposable_test', 'yes', false)");
      await admin.query(sql);
      for (const definition of workerFunctions()) await admin.query(definition);
      await admin.query(functionPermissions());
      await admin.query('COMMIT'); initialized = true;
    }
    const storeA = poolFor('uw_test_store', 'store-a');
    const storeB = poolFor('uw_test_store', 'store-b');
    const budgetA = poolFor('uw_test_budget', 'budget-a');
    const budgetB = poolFor('uw_test_budget', 'budget-b');
    const loginA = poolFor('uw_test_login', 'login-a');
    const loginB = poolFor('uw_test_login', 'login-b');
    const worker = poolFor('uw_test_worker', 'worker');
    const browser = poolFor('uw_test_browser', 'browser');
    const store = new a.PostgresWorkspaceStore(storeA, ownerConfig);
    const second = new a.PostgresWorkspaceStore(storeB, ownerConfig);
    const text = new a.PostgresWorkspaceBudget(budgetA, textConfig);
    const directory = new a.PostgresWorkspaceWorkerDirectory(worker, directoryConfig);
    if (reopenOnly) {
      assert.equal(await store.read('reopen-owner', s => s.creations[0].idempotency_key), 'committed-once');
      const r = a.budgetRequest({ project_id: 'reopen-project' });
      const image = new a.PostgresWorkspaceProviderBudget(budgetB, imageConfig([r]));
      assert.equal((await image.reserve(r)).status, 'duplicate');
      assert.equal((await budgetState('reopen-project')).state.operations[0].state, 'held');
      assert.equal((await new a.PostgresWorkspaceLoginLimiter(loginA, loginConfig('reopen-login')).begin(attempt('reopen-attempt'))).allowed, false);
      assert.equal(await directory.authorizeOwner('worker-a'), true);
      pass('new Node process, new PostgreSQL sessions read committed owner/action, provider hold, login fence and membership');
      return;
    }
    console.log(`Disposable PostgreSQL ${version}; test role logins use fixed synthetic fixture passwords only`);
    // Authentic role logins, not a superuser SET ROLE wrapper.
    for (const pool of realPools) await withConnection(pool, async c => {
      const role = (await c.query(`SELECT current_user AS name, session_user AS session, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb
        FROM pg_catalog.pg_roles WHERE rolname = current_user`)).rows[0];
      assert.equal(role.name, role.session); assert.equal(role.rolsuper, false); assert.equal(role.rolbypassrls, false);
      assert.equal(role.rolcreaterole, false); assert.equal(role.rolcreatedb, false);
      assert.equal((await c.query(`SELECT count(*)::int AS n FROM pg_catalog.pg_auth_members WHERE member = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user)`)).rows[0].n, 0);
    });
    const [c1, c2] = await Promise.all([storeA.connect(), storeB.connect()]);
    try { assert.notEqual((await c1.query('SELECT pg_backend_pid() AS pid')).rows[0].pid, (await c2.query('SELECT pg_backend_pid() AS pid')).rows[0].pid); }
    finally { c1.release(); c2.release(); }
    for (const table of ['owner_state', 'budget_journal', 'login_journal', 'team_members']) {
      const r = (await admin.query('SELECT relrowsecurity, relforcerowsecurity, pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid = $1::regclass', [`${SCHEMA}.${table}`])).rows[0];
      assert.equal(r.relrowsecurity, true); assert.equal(r.relforcerowsecurity, true); assert.equal(r.owner, 'uw_test_schema_owner');
    }
    pass('separate backend PIDs, actual least-privilege role logins, forced RLS and non-runtime table ownership');

    await store.transaction('alice', s => s.tasks.push(ownerRecord('alice')));
    await store.transaction('bob', s => s.tasks.push(ownerRecord('bob')));
    await withConnection(storeA, async c => {
      assert.equal((await c.query(`SELECT * FROM ${SCHEMA}.owner_state`)).rowCount, 0, 'Absent context sees no owners');
    });
    await transaction(storeA, 'uid.workspace_owner_id', 'alice', async c => {
      assert.deepEqual((await c.query(`SELECT owner_id FROM ${SCHEMA}.owner_state`)).rows.map(r => r.owner_id), ['alice']);
      assert.equal((await c.query(`UPDATE ${SCHEMA}.owner_state SET revision = revision + 1 WHERE owner_id = 'bob'`)).rowCount, 0);
    });
    await assert.rejects(() => transaction(storeA, 'uid.workspace_owner_id', 'alice', c => c.query(
      `INSERT INTO ${SCHEMA}.owner_state (owner_id, state, revision) VALUES ('other', $1::jsonb, 1)`,
      [JSON.stringify({ owner_id: 'other', tasks: [], creations: [] })])), { code: '42501' });
    await assert.rejects(() => transaction(storeA, 'uid.workspace_owner_id', 'alice', c => c.query(
      `UPDATE ${SCHEMA}.owner_state SET owner_id = 'other', state = jsonb_set(state, '{owner_id}', '"other"') WHERE owner_id = 'alice'`)), { code: '42501' });
    const singleton = poolFor('uw_test_store', 'context-reuse', 1);
    for (const rollback of [false, true]) await withConnection(singleton, async c => {
      await c.query('BEGIN'); await c.query("SELECT set_config('uid.workspace_owner_id', 'alice', true)");
      assert.equal((await c.query(`SELECT * FROM ${SCHEMA}.owner_state`)).rowCount, 1);
      await c.query(rollback ? 'ROLLBACK' : 'COMMIT');
      const context = (await c.query("SELECT current_setting('uid.workspace_owner_id', true) AS owner")).rows[0].owner;
      assert.ok(context === '' || context === null);
      assert.equal((await c.query(`SELECT * FROM ${SCHEMA}.owner_state`)).rowCount, 0, 'Reused session cannot retain owner context');
    });
    for (const pool of [browser, worker, budgetA, loginA]) await assert.rejects(() => pool.query(`SELECT * FROM ${SCHEMA}.owner_state`), { code: '42501' });
    await assert.rejects(() => storeA.query(`DELETE FROM ${SCHEMA}.owner_state`), { code: '42501' });
    pass('owner SELECT/INSERT/UPDATE RLS, WITH CHECK, missing context and COMMIT/ROLLBACK pool reuse, browser/worker denial');

    // First INSERT contention plus monotonically appended state under actual locks.
    await Promise.all(Array.from({ length: 24 }, (_, index) => (index % 2 ? store : second).transaction('race-owner', s => {
      const n = s.creations.length; s.creations.push({ idempotency_key: `key-${n}`, fingerprint: `hash-${n}`, task_id: `task-${n}` });
    })));
    const entries = await store.read('race-owner', s => s.creations);
    assert.equal(entries.length, 24); assert.equal(new Set(entries.map(e => e.idempotency_key)).size, 24);
    assert.equal(Number((await admin.query(`SELECT revision FROM ${SCHEMA}.owner_state WHERE owner_id = 'race-owner'`)).rows[0].revision), 24);
    await assert.rejects(() => store.transaction('race-owner', s => { s.creations.length = 0; throw Error('TEST_ROLLBACK'); }), /TEST_ROLLBACK/);
    await assert.rejects(() => store.transaction('race-owner', async s => { s.creations.length = 0; }), /ASYNC_TRANSACTION_FORBIDDEN/);
    assert.equal(await second.read('race-owner', s => s.creations.length), 24);
    // Two stale application CAS commands contend. Exactly one commits all three
    // pieces (task version, action and event); the loser mutates nothing.
    const actionRace = () => s => {
      const r = s.tasks[0]; if (r.task.state_version !== 0) return 'conflict';
      r.task = { ...r.task, state_version: 1 }; r.actions.push({ ...r.actions[0], action_id: 'cas-action', idempotency_key: 'cas-key' });
      r.events.push({ sequence: 1, type: 'cas', created_at: a.before, data: {} }); return 'committed';
    };
    assert.deepEqual((await Promise.all([store.transaction('alice', actionRace()), second.transaction('alice', actionRace())])).sort(), ['committed', 'conflict']);
    const record = await store.read('alice', s => s.tasks[0]); assert.equal(record.task.state_version, 1); assert.equal(record.actions.length, 2); assert.equal(record.events.length, 1);
    await transaction(storeA, 'uid.workspace_owner_id', 'race-owner', async c => {
      const rev = (await c.query(`SELECT revision FROM ${SCHEMA}.owner_state WHERE owner_id = 'race-owner'`)).rows[0].revision;
      const update = `UPDATE ${SCHEMA}.owner_state SET revision = revision + 1 WHERE owner_id = 'race-owner' AND revision = $1 RETURNING revision`;
      assert.equal((await c.query(update, [rev])).rowCount, 1); assert.equal((await c.query(update, [rev])).rowCount, 0);
    });
    pass('cross-connection first INSERT, serialized state/event/action mutation, rollback, async callback refusal and stale revision CAS');

    // Deterministic advisory contention: observe a blocked backend, not just a sleep.
    const holder = await storeA.connect(); resources.add(holder);
    await holder.query('BEGIN'); await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['advisory-owner']);
    let done = false;
    const waiting = second.transaction('advisory-owner', s => s.creations.push({ idempotency_key: 'after-lock', fingerprint: 'fixture', task_id: 'fixture' })).finally(() => { done = true; });
    try {
      await eventually(async () => (await admin.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = 'uw-test-store-b' AND wait_event = 'advisory'")).rows[0].n > 0, 'Competing store connection did not wait on the advisory lock');
      assert.equal(done, false);
    } finally { await holder.query('ROLLBACK'); holder.release(); resources.delete(holder); await waiting; }
    pass('observed real advisory transaction lock wait and rollback release');

    await assert.rejects(() => new a.PostgresWorkspaceStore(loseCommitOnce(storeA), ownerConfig).transaction('reopen-owner', s => s.creations.push({ idempotency_key: 'committed-once', fingerprint: 'fixture', task_id: 'fixture' })), /STORE_OUTCOME_UNKNOWN/);
    assert.equal(await second.read('reopen-owner', s => s.creations.length), 1);
    pass('controlled lost COMMIT acknowledgment retains durable owner identity without retry');

    for (const mode of ['global', 'owner', 'task']) {
      const project = `quota-${mode}`;
      await provision(project, state => { if (mode === 'global') state.global.cap_microusd = 5000; if (mode === 'owner') state.owners[0].cap_microusd = 5000; if (mode === 'task') state.tasks[0].cap_microusd = 5000; });
      const r = a.budgetRequest({ project_id: project });
      const image = new a.PostgresWorkspaceProviderBudget(budgetB, imageConfig([r]));
      const tr = mode === 'global' ? textRequest(project, { owner_id: 'bob', authorization_id: 'bob-task-one-auth', user_quota_authorization_ref: 'bob-quota' })
        : mode === 'owner' ? textRequest(project, { task_id: 'task-two', authorization_id: 'alice-task-two-auth', budget_authorization_ref: 'task-two-budget' }) : textRequest(project);
      assert.deepEqual((await Promise.all([text.reserve(tr), image.reserve(r)])).map(x => x.status).sort(), ['denied', 'reserved']);
      const { state } = await budgetState(project); assert.equal(state.operations.length, 1); assert.equal(state.operations[0].request.maximum_cost_microusd, 3000);
    }
    assert.equal((await text.reserve(textRequest('not-provisioned'))).status, 'denied');
    assert.equal((await admin.query(`SELECT 1 FROM ${SCHEMA}.budget_journal WHERE project_id = 'not-provisioned'`)).rowCount, 0);
    await assert.rejects(() => budgetA.query(`INSERT INTO ${SCHEMA}.budget_journal(project_id,state,revision) VALUES ('forbidden', '{}', 1)`), { code: '42501' });
    await withConnection(budgetA, async c => assert.equal((await c.query(`SELECT * FROM ${SCHEMA}.budget_journal`)).rowCount, 0));
    await transaction(budgetA, 'uid.workspace_budget_project', 'quota-global', async c => {
      assert.deepEqual((await c.query(`SELECT project_id FROM ${SCHEMA}.budget_journal`)).rows.map(r => r.project_id), ['quota-global']);
      assert.equal((await c.query(`UPDATE ${SCHEMA}.budget_journal SET revision = revision + 1 WHERE project_id = 'quota-task'`)).rowCount, 0);
    });
    pass('real concurrent text/image global, member and task quota ceilings, project RLS and no runtime grant provisioning');

    await provision('reopen-project');
    const imageRequest = a.budgetRequest({ project_id: 'reopen-project' });
    const image = new a.PostgresWorkspaceProviderBudget(budgetB, imageConfig([imageRequest]));
    await assert.rejects(() => new a.PostgresWorkspaceProviderBudget(loseCommitOnce(budgetA), imageConfig([imageRequest])).reserve(imageRequest), /BUDGET_OUTCOME_UNKNOWN/);
    assert.equal((await image.reserve(imageRequest)).status, 'duplicate');
    const reservation = (await budgetState('reopen-project')).state.operations[0].reservation_id;
    const intents = await Promise.all([image.markSubmissionIntent({ ...imageRequest, reservation_id: reservation }), new a.PostgresWorkspaceProviderBudget(budgetA, imageConfig([imageRequest])).markSubmissionIntent({ ...imageRequest, reservation_id: reservation })]);
    assert.equal(intents.filter(r => r.ok).length, 1);
    assert.equal((await image.releaseBeforeSubmit({ ...imageRequest, reservation_id: reservation })).released, false);
    assert.equal((await image.reconcile({ reservation_id: reservation, operation_id: imageRequest.operation_id, request_sha256: imageRequest.request_sha256, client_request_id: imageRequest.client_request_id, outcome: 'unknown' })).status, 'held');
    assert.equal((await image.reserve({ ...imageRequest, request_sha256: 'b'.repeat(64) })).status, 'conflict');
    assert.equal((await text.reserve(textRequest('reopen-project', { operation_id: imageRequest.operation_id }))).status, 'conflict');
    pass('provider COMMIT uncertainty, duplicate/conflict fences, single submission intent and unresolved hold survive independent adapters');

    await provision('admission', state => {
      state.tasks = []; state.owners[0].task_policy = { ...state.owners[0], policy_id: 'fixture-policy', data_authorization_ref: 'fixture-data', data_destination: a.WORKSPACE_OPENAI_ENDPOINT,
        model: a.WORKSPACE_OPENAI_MODEL, capability_verification_ref: 'text-capability', maximum_task_cap_microusd: 10000, maximum_request_cost_microusd: 3000,
        task_grant_ttl_ms: 60000, maximum_admitted_tasks: 1, allowed_brands: ['PawfectHouse'], allowed_materials: ['onepage'], allowed_source_origins: ['https://example.test'] };
    });
    const scope = { brand: 'PawfectHouse', material: 'onepage', source_url: 'https://example.test/product' };
    const textB = new a.PostgresWorkspaceBudget(budgetB, textConfig);
    assert.deepEqual((await Promise.all([text.admitTask('admission', 'alice', 'new-task', scope, 'text-capability'), textB.admitTask('admission', 'alice', 'new-task', scope, 'text-capability')])).map(r => r.status).sort(), ['admitted', 'already_admitted']);
    assert.equal((await textB.admitTask('admission', 'alice', 'other-task', scope, 'text-capability')).status, 'not_admitted');
    assert.equal((await budgetState('admission')).state.tasks.length, 1);
    assert.equal((await budgetState('admission')).state.operations.length, 0);
    pass('concurrent task admission is idempotent, policy-bounded and does not spend');

    const limiter = new a.PostgresWorkspaceLoginLimiter(loginA, loginConfig('parallel-login'));
    const limiterB = new a.PostgresWorkspaceLoginLimiter(loginB, loginConfig('parallel-login'));
    const attempts = await Promise.all(Array.from({ length: 6 }, (_, index) => (index % 2 ? limiter : limiterB).begin(attempt(`attempt-${index}`, 'same-account', `client-${index}`))));
    assert.equal(attempts.filter(x => x.allowed).length, 2);
    const clientConfig = { ...loginConfig('client-cap'), accountLimit: 10, clientLimit: 2 };
    const clientCap = new a.PostgresWorkspaceLoginLimiter(loginA, clientConfig), clientCapB = new a.PostgresWorkspaceLoginLimiter(loginB, clientConfig);
    assert.equal((await Promise.all(Array.from({ length: 4 }, (_, index) => (index % 2 ? clientCap : clientCapB).begin(attempt(`client-attempt-${index}`, `account-${index}`, 'same-client'))))).filter(x => x.allowed).length, 2);
    await assert.rejects(() => new a.PostgresWorkspaceLoginLimiter(loseCommitOnce(loginA), loginConfig('reopen-login')).begin(attempt('reopen-attempt')), /LOGIN_LIMITER_OUTCOME_UNKNOWN/);
    assert.equal((await new a.PostgresWorkspaceLoginLimiter(loginB, loginConfig('reopen-login')).begin(attempt('reopen-attempt'))).allowed, false);
    await transaction(loginA, 'uid.workspace_login_namespace', 'parallel-login', async c => {
      assert.deepEqual((await c.query(`SELECT namespace FROM ${SCHEMA}.login_journal`)).rows.map(r => r.namespace), ['parallel-login']);
      assert.equal((await c.query(`UPDATE ${SCHEMA}.login_journal SET revision = revision + 1 WHERE namespace = 'reopen-login'`)).rowCount, 0);
    });
    const lateConfig = loginConfig('late-login'); let now = a.NOW; lateConfig.now = () => now;
    const late = new a.PostgresWorkspaceLoginLimiter(loginA, lateConfig); await late.begin(attempt('late-attempt')); now += 1001;
    await assert.rejects(() => late.finish('late-attempt', 'success'), /LOGIN_RESERVATION_EXPIRED/);
    assert.equal((await admin.query(`SELECT state FROM ${SCHEMA}.login_journal WHERE namespace = 'late-login'`)).rows[0].state.reservations[0].outcome, 'unavailable');
    pass('cross-connection login first INSERT/account/client limits, namespace RLS, commit uncertainty and durable late-expiry denial');

    const members = [ ['worker-a', 'contributor', true], ['worker-b', 'admin', true], ['worker-inactive', 'admin', false], ['worker-viewer', 'viewer', true],
      ['worker-duplicate', 'contributor', true], ['worker-duplicate', 'admin', true], ['worker-idle', 'contributor', true] ];
    for (const values of members) await admin.query(`INSERT INTO ${SCHEMA}.team_members VALUES ($1, $2, $3)`, values);
    for (const owner of [...new Set(members.map(r => r[0])), 'worker-missing']) await store.transaction(owner, s => s.tasks.push(ownerRecord(owner, owner === 'worker-idle' ? 'succeeded' : 'queued')));
    assert.deepEqual(await directory.discover(null, 1), ['worker-a']);
    assert.deepEqual(await directory.discover('worker-a', 1), ['worker-b']); assert.deepEqual(await directory.discover('worker-b', 1), []);
    for (const owner of ['worker-inactive', 'worker-viewer', 'worker-duplicate', 'worker-missing']) assert.equal(await directory.authorizeOwner(owner), false);
    assert.equal(await directory.authorizeOwner('worker-a'), true); assert.equal(await directory.authorizeOwner('worker-idle'), true);
    await admin.query(`UPDATE ${SCHEMA}.team_members SET is_active = false WHERE user_id = 'worker-b'`);
    assert.equal(await directory.authorizeOwner('worker-b'), false); assert.deepEqual(await directory.discover('worker-a', 10), []);
    for (const pool of [browser, storeA, budgetA, loginA]) await assert.rejects(() => pool.query(`SELECT * FROM ${SCHEMA}.uid_workspace_authorize_owner('worker-a')`), { code: '42501' });
    await assert.rejects(() => worker.query(`SELECT * FROM ${SCHEMA}.team_members`), { code: '42501' });
    await assert.rejects(() => worker.query('SET ROLE uw_test_directory_owner'), { code: '42501' });
    for (const limit of [0, 101, null]) await assert.rejects(() => worker.query(`SELECT * FROM ${SCHEMA}.uid_workspace_discover_owners(NULL, $1::integer)`, [limit]), /INVALID_WORKER_CURSOR/, `RPC must reject limit ${limit}`);
    for (const signature of ['uid_workspace_discover_owners(text,integer)', 'uid_workspace_authorize_owner(text)']) {
      const fn = (await admin.query('SELECT prosecdef, proconfig, pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE oid = $1::regprocedure', [`${SCHEMA}.${signature}`])).rows[0];
      assert.equal(fn.prosecdef, true); assert.deepEqual(fn.proconfig, ['search_path=pg_catalog']); assert.equal(fn.owner, 'uw_test_directory_owner');
    }
    pass('narrow worker functions, sorted pagination, active contributor/admin membership, duplicate/missing/revoked denial and SQL argument bounds');

    // Real fresh application process; no simulated in-memory restart and no server
    // restart claim. The parent closes its client pools before the child connects.
    await Promise.all(pools.map(pool => pool.end())); pools.length = 0;
    await new Promise((resolve, reject) => {
      const env = { ...goodEnv, PGHOST: config.host, PGPORT: String(config.port), UID_TEST_PG_MODULE: config.module, ...(major ? { UID_TEST_PG_MAJOR: major } : {}) };
      const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), '--reopen-child'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
      const timer = setTimeout(() => { child.kill('SIGTERM'); reject(Error('PROCESS_REOPEN_TIMEOUT')); }, 30000);
      let output = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', () => {});
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', code => { clearTimeout(timer); if (code !== 0) reject(Error('PROCESS_REOPEN_FAILED')); else { process.stdout.write(output); resolve(); } });
    });
    pass('PostgreSQL workspace integration contract complete; no provider or live service contacted');
  } finally {
    for (const c of resources) { await c.query('ROLLBACK').catch(() => {}); c.release(); }
    await admin.query('ROLLBACK').catch(() => {});
    await Promise.all(pools.map(pool => pool.end()));
    await admin.end().catch(() => {});
    if (initialized) console.log('Fixture retained in the disposable cluster for inspection. Destroy the entire throwaway cluster; runner never drops existing objects.');
  }
}

try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--self-test') await selfTest();
  else if (args.length === 0 || args.length === 1 && args[0] === '--reopen-child') await runDatabase(safeConfig(process.env), args[0] === '--reopen-child');
  else throw Error('USAGE: node --import tsx tests/sql/uid_workspace_runtime.mjs [--self-test]');
} catch (error) {
  // Only synthetic fixture values exist here. Still avoid raw connection errors,
  // stack paths or driver configuration in output. Assertion messages are useful.
  console.error(error?.code === 'ERR_ASSERTION' ? `FAIL contract: ${error.message}` : `FAIL ${/^[A-Z0-9_ :\-\[\].]+$/.test(error?.message ?? '') ? error.message : 'DISPOSABLE_POSTGRES_CONTRACT_FAILED'}`);
  process.exitCode = 1;
}
