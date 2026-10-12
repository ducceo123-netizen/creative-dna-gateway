import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildSync } from 'esbuild';

// Execute the real component with deterministic React hooks and a deferred,
// read-only request transport. This covers state transitions, not browser layout.
const componentCode = buildSync({
  entryPoints: ['src/components/GovernancePanel.tsx'], bundle: true,
  format: 'cjs', platform: 'node', jsx: 'automatic', write: false,
  external: ['react', 'react/jsx-runtime'],
}).outputFiles[0].text;

type Node = { type: string | symbol; props: Record<string, any> };
type Call = { resolve: (response: Response) => void; reject: (error: Error) => void };
function nodes(value: any): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  return [value, ...nodes(value.props.children)];
}
function textOf(value: any): string {
  if (Array.isArray(value)) return value.map(textOf).join('');
  if (value === null || value === undefined || typeof value === 'boolean') return '';
  if (typeof value === 'object') return textOf(value.props.children);
  return String(value);
}
async function flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
function registry(baselines = 0, evaluations = 0, snapshots = 0) {
  return {
    baselines: Array.from({ length: baselines }, (_, id) => ({ id })),
    evaluations: Array.from({ length: evaluations }, (_, id) => ({ id })),
    snapshots: Array.from({ length: snapshots }, (_, id) => ({ id })),
    brands: [{ id: 'test-brand', name: 'Test brand' }],
  };
}
function setup() {
  const slots: any[] = [], calls: Call[] = [], effects: (() => void)[] = [];
  let cursor = 0, tree: Node, scheduled = false;
  const hooks = {
    useState(initial: any) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], (value: any) => {
        const next = typeof value === 'function' ? value(slots[index]) : value;
        if (Object.is(next, slots[index])) return;
        slots[index] = next;
        if (!scheduled) { scheduled = true; queueMicrotask(() => { scheduled = false; render(); }); }
      }];
    },
    useEffect(create: () => void, deps: unknown[]) {
      const index = cursor++, previous = slots[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous[i]))) {
        slots[index] = deps; effects.push(create);
      }
    },
  };
  const jsx = (type: Node['type'], props: Node['props']) => ({ type, props });
  const module = { exports: {} as { GovernancePanel: (props: any) => Node } };
  vm.runInNewContext(componentCode, {
    module, exports: module.exports, Error,
    require(name: string) {
      if (name === 'react') return hooks;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      throw Error('Unexpected dependency: ' + name);
    },
  });
  function request(url: string, init: RequestInit) {
    assert.equal(url, '/api/admin/governance/governance_list');
    assert.equal(init.method, 'POST'); assert.equal(init.body, '{}');
    return new Promise<Response>((resolve, reject) => calls.push({ resolve, reject }));
  }
  function render() {
    cursor = 0; tree = module.exports.GovernancePanel({ request });
    for (const create of effects.splice(0)) create();
  }
  function button(label: string) {
    const found = nodes(tree).find(node => node.type === 'button' && textOf(node) === label);
    assert.ok(found, 'Missing button: ' + label); return found;
  }
  render();
  return {
    calls, button,
    text: () => textOf(tree),
    counts: () => nodes(tree).filter(node => node.type === 'strong').slice(0, 3).map(textOf),
    alerts: () => nodes(tree).filter(node => node.props.role === 'alert').map(textOf),
    click(label: string) { const found = button(label); assert.ok(!found.props.disabled); found.props.onClick(); },
  };
}

test('counts stay unknown while loading, and confirmed empty lists display zero', async () => {
  const ui = setup();
  assert.deepEqual(ui.counts(), ['—', '—', '—']);
  assert.match(ui.text(), /Loading governance data/);
  assert.equal(ui.button('Loading…').props.disabled, true);
  assert.equal(ui.calls.length, 1);
  ui.calls[0].resolve(Response.json(registry())); await flush();
  assert.deepEqual(ui.counts(), ['0', '0', '0']);
  assert.equal(ui.button('Refresh').props.disabled, false);
  assert.equal(ui.alerts().length, 0);
  assert.doesNotMatch(ui.text(), /Loading governance data/);
});

test('initial failure keeps counts unavailable and Retry clears the error on success', async () => {
  const ui = setup();
  ui.calls[0].resolve(Response.json({ error: 'Registry is offline' }, { status: 503 })); await flush();
  assert.deepEqual(ui.counts(), ['—', '—', '—']);
  assert.match(ui.alerts().join(''), /Counts are unavailable.*Registry is offline/);
  ui.click('Retry'); await flush();
  assert.equal(ui.calls.length, 2);
  assert.deepEqual(ui.counts(), ['—', '—', '—']);
  ui.calls[1].resolve(Response.json(registry(2, 3, 4))); await flush();
  assert.deepEqual(ui.counts(), ['2', '3', '4']);
  assert.equal(ui.alerts().length, 0);
  assert.doesNotMatch(ui.text(), /Registry is offline|Counts are unavailable/);
  assert.equal(ui.button('Refresh').props.disabled, false);
});

test('failed refresh preserves previous data with a stale warning until successful retry', async () => {
  const ui = setup();
  ui.calls[0].resolve(Response.json(registry(2, 3, 4))); await flush();
  ui.click('Refresh'); await flush();
  assert.deepEqual(ui.counts(), ['2', '3', '4']);
  assert.match(ui.text(), /Refreshing governance data/);
  ui.calls[1].reject(Error('Network unavailable')); await flush();
  assert.deepEqual(ui.counts(), ['2', '3', '4']);
  assert.match(ui.alerts().join(''), /previously loaded governance data.*out of date.*Network unavailable/);
  assert.match(ui.text(), /Test brand/);
  ui.click('Retry'); await flush();
  assert.equal(ui.alerts().length, 1, 'Stale warning remains until a refresh succeeds');
  ui.calls[2].resolve(Response.json(registry())); await flush();
  assert.deepEqual(ui.counts(), ['0', '0', '0']);
  assert.equal(ui.alerts().length, 0);
  assert.equal(ui.button('Refresh').props.disabled, false);
});

test('an incomplete success payload is not mistaken for an empty registry', async () => {
  const ui = setup();
  ui.calls[0].resolve(Response.json({})); await flush();
  assert.deepEqual(ui.counts(), ['—', '—', '—']);
  assert.match(ui.alerts().join(''), /Incomplete governance registry response/);
  ui.click('Retry'); await flush();
  ui.calls[1].resolve(Response.json(registry(1, 2, 3))); await flush();
  ui.click('Refresh'); await flush();
  ui.calls[2].resolve(Response.json({ ...registry(), snapshots: null })); await flush();
  assert.deepEqual(ui.counts(), ['1', '2', '3']);
  assert.match(ui.alerts().join(''), /out of date.*Incomplete governance registry response/);
});
