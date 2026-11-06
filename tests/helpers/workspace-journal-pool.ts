import type { WorkspaceSqlPool } from '../../uid-workspace-store.ts';

/** Deterministic SQL-protocol FAKE. Emulates row updates and one global lock to
 * test adapter atomic state logic. Does not parse PostgreSQL, execute RLS, prove
 * actual advisory-lock semantics or validate any unapplied migration. */
export function journalPool() {
  const rows = new Map<string, { state: unknown; revision: number }>();
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  let tail = Promise.resolve(); let loseCommit = false;
  const members = new Map<string, boolean>();
  const ownerJobs = new Set<string>();
  const key = (table: string, scope: string) => table.replaceAll('"', '') + ':' + scope;
  const pool: WorkspaceSqlPool = { async connect() {
    let unlock: (() => void) | undefined;
    let pending = new Map<string, { state: unknown; revision: number }>();
    function releaseLock() { unlock?.(); unlock = undefined; }
    return {
      async query(sql, values = []) {
        statements.push({ sql, values: structuredClone(values) });
        if (sql.startsWith('SELECT pg_advisory_xact_lock')) {
          const before = tail; tail = new Promise<void>(resolve => { unlock = resolve; }); await before;
          return { rows: [] };
        }
        if (sql.startsWith('SELECT allowed FROM')) return { rows: [{ allowed: members.get(String(values[0])) === true }] };
        if (sql.startsWith('SELECT owner_id FROM')) return { rows: [...ownerJobs].filter(owner => (values[0] === null || owner > String(values[0])) && members.get(owner)).sort().slice(0, Number(values[1])).map(owner_id => ({ owner_id })) };
        const table = sql.match(/(?:FROM|INTO|UPDATE) ("[a-z0-9_]+"\."[a-z0-9_]+")/)?.[1];
        if (sql.startsWith('SELECT state, revision FROM') && table) {
          const row = rows.get(key(table, String(values[0]))); return { rows: row ? [structuredClone(row)] : [] };
        }
        if ((sql.startsWith('UPDATE ') || sql.startsWith('INSERT INTO ')) && table) {
          const rowKey = key(table, String(values[0])); const current = pending.get(rowKey) ?? rows.get(rowKey);
          if (sql.startsWith('UPDATE ') && (!current || current.revision !== values[2])) return { rows: [] };
          if (sql.startsWith('INSERT INTO ') && current) throw new Error('duplicate_key');
          const row = { state: JSON.parse(String(values[1])), revision: (current?.revision ?? 0) + 1 };
          pending.set(rowKey, row); return { rows: [{ revision: row.revision }] };
        }
        if (sql === 'COMMIT') {
          for (const [k, row] of pending) rows.set(k, row); pending.clear(); releaseLock();
          if (loseCommit) { loseCommit = false; throw new Error('lost_commit_acknowledgment'); }
        }
        if (sql === 'ROLLBACK') { pending.clear(); releaseLock(); }
        return { rows: [] };
      },
      release() { releaseLock(); },
    };
  } };
  return { pool, statements, members, ownerJobs,
    seed(table: string, scope: string, state: unknown) { rows.set(key(table, scope), { state: structuredClone(state), revision: 1 }); },
    read<T>(table: string, scope: string): T | undefined { const row = rows.get(key(table, scope)); return row ? structuredClone(row.state) as T : undefined; },
    loseNextCommit() { loseCommit = true; },
  };
}
