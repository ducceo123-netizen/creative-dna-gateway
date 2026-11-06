import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { FileWorkspaceStore, MemoryWorkspaceStore } from '../uid-workspace-store.ts';

test('development file store survives restart, isolates owners and serializes separate instances', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'uid-workspace-store-'));
  try {
    const first = new FileWorkspaceStore(directory, { environment: 'test' });
    const second = new FileWorkspaceStore(directory, { environment: 'test' });
    await Promise.all(Array.from({ length: 20 }, (_, index) => (index % 2 ? first : second).transaction('alice', state => {
      const count = state.creations.length;
      state.creations.push({ idempotency_key: 'k' + count, fingerprint: 'f' + count, task_id: 't' + count });
    })));
    const restarted = new FileWorkspaceStore(directory, { environment: 'test' });
    const entries = await restarted.read('alice', state => state.creations);
    assert.equal(entries.length, 20); assert.equal(new Set(entries.map(entry => entry.idempotency_key)).size, 20);
    assert.deepEqual(await restarted.read('bob', state => state.creations), []);
    assert.equal((await readdir(directory)).some(name => name.endsWith('.tmp') || name.endsWith('.lock')), false);
    assert.equal(first.productionReady, false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('throwing transactions roll back fully and memory store never leaks mutable references', async () => {
  const store = new MemoryWorkspaceStore();
  await assert.rejects(() => store.transaction('alice', state => { state.creations.push({ idempotency_key: 'x', fingerprint: 'x', task_id: 'x' }); throw new Error('rollback'); }));
  assert.deepEqual(await store.read('alice', state => state.creations), []);
  const result = await store.transaction('alice', state => { state.creations.push({ idempotency_key: 'x', fingerprint: 'x', task_id: 'x' }); return state; });
  result.creations.length = 0;
  assert.equal(await store.read('alice', state => state.creations.length), 1);
});

test('corrupt store, stale lock and wrong owner fail closed, with no silent reset or reclaim', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'uid-workspace-store-'));
  try {
    const store = new FileWorkspaceStore(directory, { environment: 'test', lockTimeoutMs: 20 });
    const key = createHash('sha256').update('alice').digest('hex');
    const filename = path.join(directory, key + '.json');
    await writeFile(filename, '{broken', { mode: 0o600 });
    await assert.rejects(() => store.transaction('alice', () => {}), /STORE_CORRUPT/);
    assert.equal(await readFile(filename, 'utf8'), '{broken');
    await writeFile(filename, JSON.stringify({ version: 1, state: { owner_id: 'bob', tasks: [], creations: [] } }));
    await assert.rejects(() => store.read('alice', () => null), /STORE_CORRUPT/);
    await rm(filename);
    await mkdir(path.join(directory, key + '.lock'));
    await assert.rejects(() => store.transaction('alice', () => {}), /STORE_BUSY/);
    assert.ok((await readdir(directory)).includes(key + '.lock'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('local adapter requires an explicit environment and private absolute directory', async () => {
  assert.throws(() => new FileWorkspaceStore('relative', { environment: 'test' }), /LOCAL_STORE_NOT_ALLOWED/);
  assert.throws(() => new FileWorkspaceStore('/tmp/test', { environment: 'production' as any }), /LOCAL_STORE_NOT_ALLOWED/);
});

import { PostgresWorkspaceStore, type WorkspaceSqlConnection, type WorkspaceSqlPool } from '../uid-workspace-store.ts';
function fakeSqlPool(options: { commitFailure?: boolean } = {}) {
  let row: { state: unknown; revision: number } | undefined;
  const statements: Array<{ sql: string; values?: unknown[] }> = [];
  let released = 0;
  const pool: WorkspaceSqlPool = { async connect() {
    let pending = row ? structuredClone(row) : undefined;
    const connection: WorkspaceSqlConnection = {
      async query(sql, values) {
        statements.push({ sql, values });
        if (sql.startsWith('SELECT state,')) return { rows: pending ? [structuredClone(pending)] : [] };
        if (sql.startsWith('INSERT INTO')) {
          pending = { state: JSON.parse(values![1] as string), revision: 1 }; return { rows: [{ revision: 1 }] };
        }
        if (sql.startsWith('UPDATE ')) {
          if (!pending || values![2] !== pending.revision) return { rows: [] };
          pending = { state: JSON.parse(values![1] as string), revision: pending.revision + 1 }; return { rows: [{ revision: pending.revision }] };
        }
        if (sql === 'COMMIT') {
          row = pending;
          if (options.commitFailure) throw new Error('connection_lost_after_commit');
        }
        if (sql === 'ROLLBACK') pending = row ? structuredClone(row) : undefined;
        return { rows: [] };
      },
      release() { released++; },
    };
    return connection;
  } };
  return { pool, statements, released: () => released, saved: () => row };
}
const sqlConfig = { schemaReviewed: true as const, schemaVersion: 'uid-workspace-owner-state-v1' as const, qualifiedTable: 'private.uid_workspace_owner_state' };

test('Postgres adapter binds owner context, serializes writes and uses revision CAS in one transaction', async () => {
  const fake = fakeSqlPool(); const store = new PostgresWorkspaceStore(fake.pool, sqlConfig);
  await store.transaction('alice', state => state.creations.push({ idempotency_key: 'k', fingerprint: 'f', task_id: 't' }));
  await store.transaction('alice', state => state.creations.push({ idempotency_key: 'k2', fingerprint: 'f2', task_id: 't2' }));
  assert.equal(await store.read('alice', state => state.creations.length), 2);
  const context = fake.statements.filter(entry => entry.sql.includes("set_config('uid.workspace_owner_id'"));
  assert.equal(context.length, 3); assert.deepEqual(context[0].values, ['alice']);
  assert.equal(fake.statements.filter(entry => entry.sql.startsWith('SELECT pg_advisory_xact_lock')).length, 2);
  assert.equal(fake.statements.filter(entry => entry.sql.endsWith('FOR UPDATE')).length, 2);
  const update = fake.statements.find(entry => entry.sql.startsWith('UPDATE '))!;
  assert.match(update.sql, /WHERE owner_id = \$1 AND revision = \$3 RETURNING revision/);
  assert.equal(update.values![0], 'alice'); assert.equal(update.values![2], 1);
  assert.equal(fake.statements.filter(entry => entry.sql === 'COMMIT').length, 3);
  assert.equal(fake.released(), 3);
  assert.equal(store.productionReady, true);
});

test('Postgres adapter rolls back callback failure and classifies lost COMMIT as unknown', async () => {
  const fake = fakeSqlPool(); const store = new PostgresWorkspaceStore(fake.pool, sqlConfig);
  await assert.rejects(() => store.transaction('alice', state => { state.creations.push({ idempotency_key: 'k', fingerprint: 'f', task_id: 't' }); throw new Error('reject-action'); }), /reject-action/);
  assert.equal(fake.saved(), undefined); assert.equal(fake.statements.at(-1)!.sql, 'ROLLBACK');
  assert.equal(fake.released(), 1);
  const uncertain = fakeSqlPool({ commitFailure: true }); const uncertainStore = new PostgresWorkspaceStore(uncertain.pool, sqlConfig);
  await assert.rejects(() => uncertainStore.transaction('alice', state => state.creations.push({ idempotency_key: 'known-key', fingerprint: 'f', task_id: 't' })), /STORE_OUTCOME_UNKNOWN/);
  assert.equal((uncertain.saved()!.state as any).creations[0].idempotency_key, 'known-key');
  assert.equal(uncertain.released(), 1);
});

test('Postgres adapter rejects unreviewed schema, unsafe identifiers and cross-owner loaded state', async () => {
  const fake = fakeSqlPool();
  assert.throws(() => new PostgresWorkspaceStore(fake.pool, { ...sqlConfig, schemaReviewed: false as any }), /POSTGRES_SCHEMA_NOT_APPROVED/);
  assert.throws(() => new PostgresWorkspaceStore(fake.pool, { ...sqlConfig, qualifiedTable: 'private.x;DROP TABLE x' }), /POSTGRES_SCHEMA_NOT_APPROVED/);
  const store = new PostgresWorkspaceStore(fake.pool, sqlConfig);
  await store.transaction('alice', () => {});
  await assert.rejects(() => store.read('bob', state => state), /STORE_CORRUPT/);
});
