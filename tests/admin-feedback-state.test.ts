import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildSync } from 'esbuild';

/**
 * Exercise the whole production component, including its real queue loader,
 * session helpers, lifecycle effects, and governance assessment. Only React's
 * host hooks/JSX, unrelated child panels/icons, and browser transport are mocked.
 * Deferred reads deliberately ignore AbortSignal to test the component's own
 * late-result guards. All requests use synthetic data and no real network.
 */
const componentCode = buildSync({
  entryPoints: ['src/components/AdminFeedback.tsx'], bundle: true,
  format: 'cjs', platform: 'node', jsx: 'automatic', write: false,
  external: ['react', 'react/jsx-runtime', 'lucide-react', './GovernancePanel', './PrivateReferencePanel', './FeedbackReviewPanel'],
}).outputFiles[0].text;

type Node = { type: string | symbol | ((props: any) => Node); props: Record<string, any>; key?: string };
type Effect = { create: () => void | (() => void); cleanup?: () => void; deps?: unknown[] };
type RequestCall = {
  url: string; init: RequestInit;
  resolve: (response: Response) => void; reject: (error: Error) => void;
};
type Proposal = {
  id: string; status: string; brand_name: string; branch_title: string;
  branch_slug: string; submitted_by_name: string; raw_feedback: string; proposed_content_md: string;
};

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() { for (let i = 0; i < 40; i++) await Promise.resolve(); }
function descendants(value: any): Node[] {
  if (Array.isArray(value)) return value.flatMap(descendants);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  return [value, ...descendants(value.props.children)];
}
function textOf(value: any): string {
  if (Array.isArray(value)) return value.map(textOf).join('');
  if (value === null || value === undefined || typeof value === 'boolean') return '';
  if (typeof value === 'object') return textOf(value.props.children);
  return String(value);
}
function proposal(id = 'synthetic-pending', status = 'pending'): Proposal {
  return {
    id, status, brand_name: 'Synthetic Brand', branch_title: `Synthetic branch ${id}`,
    branch_slug: 'synthetic-branch', submitted_by_name: 'Synthetic reviewer',
    raw_feedback: `Synthetic feedback ${id}`, proposed_content_md: `Synthetic proposed rule ${id}`,
  };
}
const page = (proposals: Proposal[] = []) => Response.json({ proposals });
const emptyPattern = /Không có feedback phù hợp/;

function setup(options: { authenticated?: boolean; refreshToken?: boolean; mockMutationUrl?: string } = {}) {
  const slots: any[] = [], effects: Effect[] = [], effectQueue: Effect[] = [];
  const requests: { url: string; init: RequestInit }[] = [], calls: RequestCall[] = [], loginCalls: RequestCall[] = [], mutationCalls: RequestCall[] = [];
  const confirmations: string[] = [];
  const storage = new Map<string, string>();
  if (options.authenticated !== false) storage.set('creative_dna_admin_token', 'synthetic.access.jwt');
  if (options.refreshToken) storage.set('creative_dna_admin_refresh_token', 'synthetic.refresh');
  const deadlines=new Map<number,()=>void>();let deadlineId=0;
  const intervals = new Map<number, { run: () => void; ms: number }>();
  const windowListeners = new Map<string, Set<() => void>>(), documentListeners = new Map<string, Set<() => void>>();
  let cursor = 0, tree: Node, mounted = true, scheduled = false, timerId = 0;
  let stateWrites = 0, lateStateWrites = 0, governanceRenders = 0;
  const snapshots: string[] = [];
  const document = {
    visibilityState: 'visible',
    addEventListener: (name: string, listener: () => void) => addListener(documentListeners, name, listener),
    removeEventListener: (name: string, listener: () => void) => documentListeners.get(name)?.delete(listener),
  };
  function addListener(target: Map<string, Set<() => void>>, name: string, listener: () => void) {
    if (!target.has(name)) target.set(name, new Set());
    target.get(name)!.add(listener);
  }
  function fetcher(url: string, init: RequestInit = {}) {
    requests.push({ url, init });
    if (url === '/api/admin/feedback' || url === '/api/admin/login') {
      const result = deferred<Response>();
      (url === '/api/admin/feedback' ? calls : loginCalls).push({ url, init, resolve: result.resolve, reject: result.reject });
      return result.promise;
    }
    if (options.mockMutationUrl && url === options.mockMutationUrl) {
      assert.equal(init.method, 'POST');
      const result = deferred<Response>();
      mutationCalls.push({ url, init, resolve: result.resolve, reject: result.reject });
      return result.promise;
    }
    const auxiliaryReads: Record<string, unknown> = {
      '/api/admin/team': { members: [] }, '/api/routes': { routes: [] }, '/api/branch-guides': { guides: [] },
    };
    assert.ok(url in auxiliaryReads, `Unexpected request (including all mutations): ${url}`);
    assert.equal(init.method || 'GET', url === '/api/routes' ? 'POST' : 'GET');
    return Promise.resolve(Response.json(auxiliaryReads[url]));
  }
  const jsx = (type: Node['type'], props: Node['props'], key?: string) => ({ type, props, key });
  const GovernancePanel = () => {
    governanceRenders++;
    return jsx('governance-panel-stub', { children: 'Synthetic governance panel' });
  };
  const PrivateReferencePanel = () => jsx('private-reference-panel-stub', {});
  const hooks = {
    useState(initial: any) {
      const index = cursor++;
      if (!(index in slots)) {
        const slot = { value: typeof initial === 'function' ? initial() : initial, set: (value: any) => {
          stateWrites++;
          if (!mounted) { lateStateWrites++; return; }
          const next = typeof value === 'function' ? value(slot.value) : value;
          if (Object.is(next, slot.value)) return;
          slot.value = next;
          if (!scheduled) {
            scheduled = true;
            queueMicrotask(() => { scheduled = false; if (mounted) render(); });
          }
        } };
        slots[index] = slot;
      }
      return [slots[index].value, slots[index].set];
    },
    useRef(initial: any) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useMemo(create: () => any, deps: unknown[]) {
      const index = cursor++, previous = slots[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) slots[index] = { value: create(), deps };
      return slots[index].value;
    },
    useEffect(create: Effect['create'], deps?: unknown[]) {
      const index = cursor++, previous: Effect | undefined = slots[index];
      if (!previous || !deps || deps.some((value, i) => !Object.is(value, previous.deps?.[i]))) {
        previous?.cleanup?.();
        const effect = { create, deps }; slots[index] = effect;
        if (previous) effects.splice(effects.indexOf(previous), 1, effect); else effects.push(effect);
        effectQueue.push(effect);
      }
    },
  };
  const module = { exports: {} as { AdminFeedback: (props: any) => Node } };
  vm.runInNewContext(componentCode, {
    module, exports: module.exports,
    require: (name: string) => {
      if (name === 'react') return hooks;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: Symbol.for('Fragment') };
      if (name === './GovernancePanel') return { GovernancePanel };
      if (name === './PrivateReferencePanel') return { PrivateReferencePanel };
      if (name === './FeedbackReviewPanel') return { FeedbackReviewPanel: (props:any) => jsx('feedback-review-panel-stub', { ...props, children: props.path }), ResolvedFeedbackAudit: (props:any) => jsx('resolved-feedback-audit-stub',props) };
      if (name === 'lucide-react') return new Proxy({}, { get: (_target, icon) => `icon-${String(icon)}` });
      throw new Error('Unexpected component dependency: ' + name);
    },
    Error, AbortController, Response, setTimeout:(run:()=>void)=>{const id=++deadlineId;deadlines.set(id,run);return id;}, clearTimeout:(id:number)=>deadlines.delete(id), fetch: fetcher, document,
    sessionStorage: {
      getItem: (key: string) => storage.get(key) || null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    window: {
      setInterval: (run: () => void, ms: number) => { const id = ++timerId; intervals.set(id, { run, ms }); return id; },
      clearInterval: (id: number) => intervals.delete(id),
      addEventListener: (name: string, listener: () => void) => addListener(windowListeners, name, listener),
      removeEventListener: (name: string, listener: () => void) => windowListeners.get(name)?.delete(listener),
    },
    confirm: (message: string) => {
      assert.ok(options.mockMutationUrl, 'Only the explicitly mocked mutation scenario may ask for confirmation');
      confirmations.push(message); return true;
    },
  }, { filename: 'AdminFeedback.bundle.cjs' });
  function materialize(value: any): any {
    if (Array.isArray(value)) return value.map(materialize);
    if (!value || typeof value !== 'object' || !('props' in value)) return value;
    if (typeof value.type === 'function') return materialize(value.type(value.props));
    return { ...value, props: { ...value.props, children: materialize(value.props.children) } };
  }
  function render() {
    cursor = 0;
    tree = materialize(module.exports.AdminFeedback({ onBack: () => {} }));
    snapshots.push(textOf(tree));
    for (const effect of effectQueue.splice(0)) effect.cleanup = effect.create() || undefined;
  }
  function unmount() { if (!mounted) return; mounted = false; for (const effect of effects) effect.cleanup?.(); }
  function all(type: Node['type']) { return descendants(tree).filter(node => node.type === type); }
  function button(label: string) {
    const node = all('button').find(node => (textOf(node) === label || node.props['aria-label'] === label || node.props['data-status-filter'] === label));
    assert.ok(node, 'Missing button: ' + label); return node;
  }
  function click(label: string) { const node = button(label); assert.ok(!node.props.disabled, label + ' is disabled'); node.props.onClick({currentTarget:{focus:()=>{}}}); }
  function change(placeholder: string, value: string) {
    const node = all('input').find(node => node.props.placeholder === placeholder);
    assert.ok(node, 'Missing input: ' + placeholder); node.props.onChange({ target: { value } });
  }
  function queue() {
    const node = all('section').find(node => node.props['aria-label'] === 'Feedback proposals');
    assert.ok(node, 'Missing labelled feedback region'); return node;
  }
  function event(target: Map<string, Set<() => void>>, name: string) { for (const listener of target.get(name) || []) listener(); }
  render();
  return {
    strictEffects:()=>{for(const effect of effects)effect.cleanup?.();for(const effect of effects)effect.cleanup=effect.create()||undefined;},
    timeout:()=>{for(const run of [...deadlines.values()])run();},
    all, button, click, change, queue, calls, loginCalls, mutationCalls, confirmations, requests, snapshots, storage, intervals, unmount,
    fullText: () => textOf(tree), open: (id = 'synthetic-action') => click(`Mở feedback: Synthetic feedback ${id}`), text: () => textOf(queue()), alerts: () => descendants(queue()).filter(node => node.props.role === 'alert').map(textOf),
    statuses: () => descendants(queue()).filter(node => node.props.role === 'status').map(textOf),
    poll: () => { for (const interval of intervals.values()) if (interval.ms === 10000) interval.run(); },
    focus: () => event(windowListeners, 'focus'),
    visibility: (value: string) => { document.visibilityState = value; event(documentListeners, 'visibilitychange'); },
    toggleAdvanced: (open: boolean) => {
      const details = all('details').find(node => textOf(node).includes('Nâng cao · Knowledge Governance')); assert.ok(details);
      details.props.onToggle({ currentTarget: { open } });
    },
    get stateWrites() { return stateWrites; }, get lateStateWrites() { return lateStateWrites; },
    get governanceRenders() { return governanceRenders; },
    get listeners() { return [...windowListeners.values(), ...documentListeners.values()].reduce((sum, value) => sum + value.size, 0); },
    replayStrictModeEffects() {
      for (const effect of effects) effect.cleanup?.();
      for (const effect of effects) effect.cleanup = effect.create() || undefined;
    },
  };
}

test('feedback queue starts in loading, never claims empty before its first successful response', async t => {
  const ui = setup(); t.after(ui.unmount);
  assert.match(ui.snapshots[0], /Đang tải feedback/);
  assert.doesNotMatch(ui.snapshots[0], emptyPattern);
  await flush();
  assert.equal(ui.calls.length, 1);
  assert.equal(ui.calls[0].init.headers && (ui.calls[0].init.headers as Record<string, string>).Authorization, 'Bearer synthetic.access.jwt');
  assert.equal(ui.calls[0].init.signal?.aborted, false);
  assert.equal(ui.queue().props['aria-busy'], true);
  assert.equal(ui.button('Refresh').props.disabled, true);
  assert.deepEqual(ui.alerts(), []);
  assert.match(ui.statuses().join(''), /Đang tải feedback/);
  assert.doesNotMatch(ui.text(), emptyPattern);
  assert.equal(ui.all('article').length, 0);
});

test('a successful empty response alone permits the pending-filter empty state', async t => {
  const ui = setup(); t.after(ui.unmount);
  ui.calls[0].resolve(page()); await flush();
  assert.match(ui.text(), emptyPattern);
  assert.equal(ui.queue().props['aria-busy'], false);
  assert.equal(ui.button('Refresh').props.disabled, false);
  assert.deepEqual(ui.statuses(), []); assert.deepEqual(ui.alerts(), []);
  ui.click('all'); await flush();
  assert.match(ui.text(), emptyPattern);
  assert.equal(ui.calls.length, 1, 'Changing a filter does not reload or mutate feedback');
});

test('initial HTTP, transport, parse, and malformed-payload failures are explicit rather than empty', async t => {
  const examples = [
    { name: 'server error', response: () => Response.json({ error: 'Synthetic upstream unavailable' }, { status: 503 }), expected: /Synthetic upstream unavailable/ },
    { name: 'unauthorized', response: () => Response.json({}, { status: 401 }), expected: /Phiên admin đã hết hạn/ },
    { name: 'forbidden', response: () => Response.json({}, { status: 403 }), expected: /chưa có quyền admin/ },
    { name: 'missing proposals', response: () => Response.json({}), expected: /Dữ liệu feedback trả về không hợp lệ/ },
    { name: 'null payload', response: () => Response.json(null), expected: /Dữ liệu feedback trả về không hợp lệ/ },
    { name: 'non-array proposals', response: () => Response.json({ proposals: {} }), expected: /Dữ liệu feedback trả về không hợp lệ/ },
    { name: 'null proposal', response: () => Response.json({ proposals: [null] }), expected: /Dữ liệu feedback trả về không hợp lệ/ },
    { name: 'missing proposal status', response: () => Response.json({ proposals: [{ id: 'synthetic' }] }), expected: /Dữ liệu feedback trả về không hợp lệ/ },
    { name: 'invalid proposal ID', response: () => Response.json({ proposals: [{ id: 17, status: 'pending' }] }), expected: /Dữ liệu feedback trả về không hợp lệ/ },
    { name: 'invalid JSON', response: () => new Response('synthetic non-JSON'), expected: /JSON|Unexpected token/ },
    { name: 'transport rejection', error: new Error('Synthetic network failure'), expected: /Synthetic network failure/ },
  ];
  for (const example of examples) await t.test(example.name, async t => {
    const ui = setup(); t.after(ui.unmount);
    if (example.error) ui.calls[0].reject(example.error); else ui.calls[0].resolve(example.response!());
    await flush();
    assert.equal(ui.alerts().length, 1);
    assert.match(ui.alerts()[0], /Chưa tải được feedback\. Chưa thể xác nhận danh sách có trống hay không/);
    assert.match(ui.alerts()[0], example.expected);
    assert.doesNotMatch(ui.text(), emptyPattern);
    assert.deepEqual(ui.statuses(), []);
    assert.equal(ui.button('Thử lại').props.disabled, false);
    assert.equal(ui.button('Refresh').props.disabled, false);
    assert.equal(ui.queue().props['aria-busy'], false);
  });
});

test('successful data renders real proposal content and filters pending, merged, and all locally', async t => {
  const ui = setup(); t.after(ui.unmount);
  ui.calls[0].resolve(page([proposal(), proposal('synthetic-merged', 'merged')])); await flush();
  assert.equal(ui.all('article').length, 1);
  assert.match(ui.text(), /Synthetic branch synthetic-pending/);
  assert.match(ui.text(), /Synthetic reviewer/);
  assert.match(ui.text(), /Synthetic feedback synthetic-pending/);
  assert.doesNotMatch(ui.text(), /Synthetic proposed rule/, 'Canonical payload is only rendered after opening detail');
  assert.doesNotMatch(ui.text(), /Synthetic branch synthetic-merged/);
  assert.doesNotMatch(ui.text(), emptyPattern);
  ui.click('merged'); await flush();
  assert.equal(ui.all('article').length, 1); assert.match(ui.text(), /Synthetic branch synthetic-merged/);
  ui.click('all'); await flush();
  assert.equal(ui.all('article').length, 2); assert.deepEqual(ui.alerts(), []);
  assert.equal(ui.calls.length, 1);
});

test('poll failure keeps the last successful rows with a stale warning, and retry success replaces rows and clears it', async t => {
  const ui = setup(); t.after(ui.unmount);
  ui.calls[0].resolve(page([proposal('synthetic-old')])); await flush();
  ui.poll(); await flush();
  assert.equal(ui.calls.length, 2);
  assert.match(ui.statuses().join(''), /Đang cập nhật feedback/);
  assert.match(ui.text(), /Synthetic branch synthetic-old/);
  ui.calls[1].reject(new Error('Synthetic polling failure')); await flush();
  assert.equal(ui.all('article').length, 1);
  assert.match(ui.text(), /Synthetic branch synthetic-old/);
  assert.match(ui.alerts().join(''), /Đang giữ kết quả lần tải thành công gần nhất/);
  assert.match(ui.alerts().join(''), /Synthetic polling failure/);
  assert.doesNotMatch(ui.text(), emptyPattern);
  ui.click('Thử lại'); await flush();
  assert.equal(ui.calls.length, 3);
  assert.equal(ui.button('Đang thử lại…').props.disabled, true);
  assert.equal(ui.button('Refresh').props.disabled, true);
  assert.match(ui.text(), /Synthetic branch synthetic-old/);
  ui.calls[2].resolve(page([proposal('synthetic-fresh')])); await flush();
  assert.equal(ui.all('article').length, 1);
  assert.match(ui.text(), /Synthetic branch synthetic-fresh/);
  assert.doesNotMatch(ui.text(), /Synthetic branch synthetic-old|Synthetic polling failure/);
  assert.deepEqual(ui.alerts(), []); assert.deepEqual(ui.statuses(), []);
  assert.equal(ui.queue().props['aria-busy'], false);
});

test('failure after a successful empty response is stale, and retry-to-empty clears the error', async t => {
  const ui = setup(); t.after(ui.unmount);
  ui.calls[0].resolve(page()); await flush();
  ui.poll(); await flush();
  assert.doesNotMatch(ui.text(), emptyPattern, 'An in-progress recheck is not presented as a newly verified empty queue');
  ui.calls[1].resolve(Response.json({ proposals: 'invalid' })); await flush();
  assert.match(ui.alerts().join(''), /Đang giữ kết quả lần tải thành công gần nhất/);
  assert.doesNotMatch(ui.text(), emptyPattern);
  ui.click('Thử lại'); ui.calls[2].resolve(page()); await flush();
  assert.match(ui.text(), emptyPattern);
  assert.deepEqual(ui.alerts(), []);
});

test('duplicate polls, focus, visibility, and same-render refresh clicks never overlap queue requests', async t => {
  const ui = setup(); t.after(ui.unmount);
  ui.poll(); ui.focus(); ui.visibility('visible');
  assert.equal(ui.calls.length, 1, 'An in-flight initial request owns the queue synchronously');
  ui.calls[0].resolve(page([proposal()])); await flush();
  const refresh = ui.button('Refresh').props.onClick;
  refresh(); refresh(); ui.poll(); ui.focus(); ui.visibility('visible');
  assert.equal(ui.calls.length, 2, 'The request ref guards duplicate clicks before a disabled-state render');
  await flush(); assert.equal(ui.button('Refresh').props.disabled, true);
  ui.calls[1].resolve(page()); await flush();
  ui.visibility('hidden'); ui.poll();
  assert.equal(ui.calls.length, 2, 'Background tabs do not poll');
  ui.visibility('visible');
  assert.equal(ui.calls.length, 3, 'Returning to the visible tab rechecks the queue');
  ui.calls[2].resolve(page()); await flush();
});

test('login loads the authenticated queue once, and a signed-out view never claims the queue is empty', async t => {
  const ui = setup({ authenticated: false }); t.after(ui.unmount);
  await flush();
  assert.equal(ui.calls.length, 0); assert.equal(ui.intervals.size, 0);
  assert.equal(ui.button('Refresh').props.disabled, true);
  assert.match(ui.text(), /Đăng nhập bằng tài khoản admin/);
  assert.doesNotMatch(ui.text(), emptyPattern);
  ui.change('Admin email', 'synthetic@example.invalid'); ui.change('Password', 'synthetic-test-only'); await flush();
  ui.click('Sign in');
  assert.equal(ui.loginCalls.length, 1);
  ui.loginCalls[0].resolve(Response.json({ access_token: 'synthetic.new.jwt', refresh_token: 'synthetic.new.refresh' })); await flush();
  assert.equal(ui.calls.length, 1, 'The session effect is the only initial queue loader after login');
  assert.match(ui.text(), /Đang tải feedback/);
  ui.calls[0].resolve(page()); await flush();
  assert.equal(ui.calls.length, 1); assert.match(ui.text(), emptyPattern);
});

test('logout and unmount abort a queue read and ignore both late success and late failure', async t => {
  for (const finish of ['success', 'failure'] as const) for (const leave of ['logout', 'unmount'] as const) {
    await t.test(`${leave}: late ${finish}`, async t => {
      const ui = setup({ refreshToken: true }); t.after(ui.unmount);
      // Auxiliary team/guide reads are unrelated to the queue and settle first.
      await flush();
      const request = ui.calls[0];
      assert.equal(ui.intervals.size, 2); assert.equal(ui.listeners, 2);
      if (leave === 'logout') ui.click('Sign out'); else ui.unmount();
      await flush();
      assert.equal(request.init.signal?.aborted, true);
      assert.equal(ui.intervals.size, 0); assert.equal(ui.listeners, 0);
      const writes = ui.stateWrites;
      if (finish === 'success') request.resolve(page([proposal('synthetic-late')]));
      else request.reject(new Error('Synthetic late rejection'));
      await flush();
      assert.equal(ui.stateWrites, writes, 'Cancelled queue completions must not write success, error, or finally state');
      assert.equal(ui.lateStateWrites, 0);
      if (leave === 'logout') {
        assert.equal(ui.storage.size, 0);
        assert.equal(ui.all('article').length, 0);
        assert.match(ui.text(), /Đăng nhập bằng tài khoản admin/);
        assert.doesNotMatch(ui.text(), /synthetic-late|Synthetic late rejection/);
      }
    });
  }
});

test('cancellation while JSON decoding is pending also prevents late queue state writes', async t => {
  const ui = setup(); t.after(ui.unmount); await flush();
  const body = deferred<{ proposals: Proposal[] }>();
  ui.calls[0].resolve({ ok: true, status: 200, json: () => body.promise } as Response);
  await flush(); ui.unmount();
  const writes = ui.stateWrites;
  body.resolve({ proposals: [proposal('synthetic-late-body')] }); await flush();
  assert.equal(ui.stateWrites, writes); assert.equal(ui.lateStateWrites, 0);
});

test('Strict Mode effect replay cancels the previous queue generation without overwriting newer results', async t => {
  const ui = setup(); t.after(ui.unmount); await flush();
  const old = ui.calls[0];
  ui.replayStrictModeEffects(); await flush();
  assert.equal(old.init.signal?.aborted, true);
  assert.equal(ui.calls.length, 2); assert.equal(ui.intervals.size, 2); assert.equal(ui.listeners, 2);
  ui.calls[1].resolve(page([proposal('synthetic-new-generation')])); await flush();
  const writes = ui.stateWrites;
  old.resolve(page([proposal('synthetic-old-generation')])); await flush();
  assert.equal(ui.stateWrites, writes);
  assert.match(ui.text(), /Synthetic branch synthetic-new-generation/);
  assert.doesNotMatch(ui.text(), /Synthetic branch synthetic-old-generation/);
  assert.equal(ui.button('Refresh').props.disabled, false);
});

test('each simulated mutation forces a new queue read and an older poll cannot overwrite it', async t => {
  // These responses are generated only by the in-memory mock transport. No
  // external API is contacted and no real review, merge, or deletion is made.
  const examples = [
    { action: 'reject', status: 'pending', label: 'Reject', path: 'synthetic-action/review', finalStatus: 'rejected', message: /Rejected\. Canonical DNA was not changed/ },
    { action: 'delete', status: 'rejected', label: 'Delete all rejected (1)', path: 'delete-all', finalStatus: '', message: /Deleted 1 rejected feedback proposal/ },
  ];
  for (const example of examples) await t.test(example.action, async t => {
    const mutationUrl = '/api/admin/feedback/' + example.path;
    const ui = setup({ mockMutationUrl: mutationUrl }); t.after(ui.unmount);
    const previous = proposal('synthetic-action', example.status);
    ui.calls[0].resolve(page([previous])); await flush();
    ui.click(example.action === 'delete' ? 'rejected' : 'all'); await flush();
    ui.poll(); await flush();
    const oldPoll = ui.calls[1];
    assert.equal(oldPoll.init.signal?.aborted, false);
    if (example.action === 'reject') { ui.open(); await flush(); }
    ui.click(example.label); await flush();
    assert.equal(ui.mutationCalls.length, 1); assert.equal(ui.mutationCalls[0].url, mutationUrl);
    if (example.action === 'accept' || example.action === 'reject') {
      assert.equal(JSON.parse(String(ui.mutationCalls[0].init.body)).decision, example.action);
    }
    assert.equal(ui.confirmations.length, example.action === 'merge' || example.action === 'delete' ? 1 : 0);
    ui.mutationCalls[0].resolve(Response.json({ merged_nodes: 1, deleted_count: 1, proposal:{id:previous.id,status:"rejected"} })); await flush();
    assert.equal(ui.calls.length, 3, 'The post-mutation reload replaces the older in-flight poll');
    assert.equal(oldPoll.init.signal?.aborted, true);
    assert.equal(ui.queue().props['aria-busy'], true);
    assert.equal(ui.button('Refresh').props.disabled, true);
    const writes = ui.stateWrites;
    oldPoll.resolve(page([proposal('synthetic-stale-action', example.status)])); await flush();
    assert.equal(ui.stateWrites, writes, 'Even an uncancellable stale poll cannot finish the current loading state');
    assert.doesNotMatch(ui.text(), /Synthetic branch synthetic-stale-action/);
    const current = example.finalStatus ? [proposal('synthetic-action-result', example.finalStatus)] : [];
    ui.calls[2].resolve(page(current)); await flush();
    assert.equal(ui.queue().props['aria-busy'], false); assert.equal(ui.button('Refresh').props.disabled, false);
    assert.deepEqual(ui.alerts(), []);
    assert.match(ui.snapshots.at(-1)!, example.message, 'The silent post-mutation refresh preserves the action result');
    assert.equal(ui.all('article').length, current.length);
    if (current.length) assert.match(ui.text(), /Synthetic branch synthetic-action-result/);
    else assert.match(ui.text(), emptyPattern);
  });
});

test('both pending review paths open an detail-drawer panel without a mutation or legacy merge action', async t => {
  for (const [label,path] of [['Xem & duyệt','merge'],['Đã có trong quy chuẩn','covered']]) await t.test(path, async t => {
    const ui=setup(); t.after(ui.unmount);
    ui.calls[0].resolve(page([proposal('synthetic-action'),proposal('legacy','accepted')]));await flush();
    ui.open();await flush();
    ui.click(label);await flush();
    const panels=ui.all('feedback-review-panel-stub');assert.equal(panels.length,1);
    assert.equal(panels[0].props.path,path);assert.equal(panels[0].props.proposal.id,'synthetic-action');
    assert.equal(ui.calls.length,1);assert.equal(ui.mutationCalls.length,0);
    assert.equal(ui.button(label).props.disabled,true,'An open review cannot be replaced by a repeated click');
    panels[0].props.onClose();await flush();assert.equal(ui.all('feedback-review-panel-stub').length,0);
    ui.click('all');await flush();ui.open('legacy');await flush();assert.match(ui.fullText(),/Legacy accepted · Chỉ xem/);
    assert.doesNotMatch(ui.text(),/Finish legacy merge|Accept & Merge|Passed evaluation ID/);
  });
});

test('a completed detail-drawer review forces queue refresh, ignores older poll and preserves its result', async t => {
  const ui=setup();t.after(ui.unmount);
  ui.calls[0].resolve(page([proposal('synthetic-action')]));await flush();
  ui.open();await flush();ui.click('Xem & duyệt');await flush();ui.poll();await flush();
  const oldPoll=ui.calls[1];
  ui.all('feedback-review-panel-stub')[0].props.onComplete('Synthetic review completed',{status:'merged'});await flush();
  assert.equal(oldPoll.init.signal?.aborted,true);assert.equal(ui.calls.length,3);
  assert.equal(ui.all('feedback-review-panel-stub').length,0);
  oldPoll.resolve(page([proposal('stale-action')]));await flush();
  assert.doesNotMatch(ui.text(),/Synthetic branch stale-action/);
  ui.calls[2].resolve(page([proposal('synthetic-action','merged')]));await flush();
  assert.match(ui.snapshots.at(-1)!,/Synthetic review completed/);
  assert.equal(ui.queue().props['aria-busy'],false);
});

test('filter switch and logout remove the detail-drawer review; proposal updates change its remount key', async t => {
  const ui=setup();t.after(ui.unmount);
  const p=proposal('synthetic-action');ui.calls[0].resolve(page([p]));await flush();
  ui.open();await flush();ui.click('Xem & duyệt');await flush();
  const source=ui.all('feedback-review-panel-stub')[0];
  ui.poll();ui.calls[1].resolve(page([{...p,proposed_content_md:'Changed proposal content'}]));await flush();
  assert.equal(ui.all('feedback-review-panel-stub')[0].props.proposal.proposed_content_md,'Changed proposal content');
  ui.click('all');await flush();assert.equal(ui.all('feedback-review-panel-stub').length,0);
  ui.open();await flush();ui.click('Xem & duyệt');await flush();ui.click('Sign out');await flush();
  assert.equal(ui.all('feedback-review-panel-stub').length,0);
});

test('advanced Governance starts collapsed, mounts on first opening, and stays mounted on closing', async t => {
  const ui = setup(); t.after(ui.unmount);
  ui.calls[0].resolve(page([proposal()])); await flush();
  const details = ui.all('details').filter(node => textOf(node).includes('Nâng cao · Knowledge Governance')); assert.equal(details.length, 1);
  assert.ok(!details[0].props.open, 'Native details has no initial open attribute');
  assert.match(textOf(details[0]), /Nâng cao · Knowledge Governance/);
  assert.equal(ui.governanceRenders, 0); assert.equal(ui.all('governance-panel-stub').length, 0);
  assert.equal(ui.all('article').length, 1, 'Reading feedback does not require opening advanced tools');
  ui.toggleAdvanced(true); await flush();
  assert.ok(ui.governanceRenders > 0); assert.equal(ui.all('governance-panel-stub').length, 1);
  ui.toggleAdvanced(false); await flush();
  const renders = ui.governanceRenders;
  assert.equal(ui.all('governance-panel-stub').length, 1, 'Closing native details retains the child and its form state');
  ui.click('all'); await flush();
  assert.ok(ui.governanceRenders >= renders);
  assert.equal(ui.all('governance-panel-stub').length, 1);
  assert.equal(ui.calls.length, 1, 'Opening advanced tools does not reload the feedback queue');
  ui.toggleAdvanced(true); await flush(); ui.click('Sign out'); await flush();
  assert.equal(ui.all('details').length, 0); assert.equal(ui.all('governance-panel-stub').length, 0);
  const loggedOutRenders = ui.governanceRenders;
  ui.change('Admin email', 'synthetic@example.invalid'); ui.change('Password', 'synthetic-test-only'); await flush();
  ui.click('Sign in');
  ui.loginCalls[0].resolve(Response.json({ access_token: 'synthetic.next-session.jwt' })); await flush();
  assert.equal(ui.all('details').length, 3); assert.equal(ui.all('governance-panel-stub').length, 0);
  assert.equal(ui.governanceRenders, loggedOutRenders, 'A new authenticated session starts with advanced tools unloaded again');
  ui.calls[1].resolve(page()); await flush();
});

test('compact rows defer details and guarded actions until explicitly opened, then close without mutation', async t => {
  const ui=setup();t.after(ui.unmount);ui.calls[0].resolve(page([proposal('synthetic-action')]));await flush();
  assert.equal(ui.all('dialog').length,0);assert.doesNotMatch(ui.fullText(),/Database Payload|Synthetic proposed rule|Ghi chú từ chối/);
  ui.open();await flush();assert.equal(ui.all('dialog').length,1);assert.match(ui.fullText(),/Synthetic proposed rule/);
  assert.equal(ui.mutationCalls.length,0);assert.equal(ui.calls.length,1);
  ui.click('Đóng chi tiết feedback');await flush();assert.equal(ui.all('dialog').length,0);
  assert.equal(ui.all('article').length,1);assert.equal(ui.mutationCalls.length,0);
});

test('drawer close and Escape remain available during a submitted review without claiming cancellation', async t => {
  for(const escape of [false,true])await t.test(escape?'Escape':'Close',async t=>{
    const ui=setup();t.after(ui.unmount);ui.calls[0].resolve(page([proposal('synthetic-action')]));await flush();
    ui.open();await flush();ui.click('Xem & duyệt');await flush();
    ui.all('feedback-review-panel-stub')[0].props.onBusyChange(true);await flush();
    if(escape){let prevented=false;ui.all('dialog')[0].props.onCancel({preventDefault:()=>{prevented=true;}});assert.equal(prevented,true);}
    else ui.click('Đóng chi tiết feedback');
    await flush();assert.equal(ui.all('dialog').length,0);assert.equal(ui.mutationCalls.length,0);
  });
});

test('brand grouping, search, material filters and collapsed groups are read-only', async t=>{
  const ui=setup();t.after(ui.unmount);
  ui.calls[0].resolve(page([{...proposal('synthetic-action'),brand_name:'PawfectHouse'},{...proposal('other'),brand_name:'GiftSoul'}]));await flush();
  const search=ui.all('input').find(node=>node.props['aria-label']==='Tìm feedback');assert.ok(search);
  search.props.onChange({target:{value:'other'}});await flush();assert.equal(ui.all('article').length,1);assert.match(ui.text(),/Synthetic feedback other/);
  search.props.onChange({target:{value:''}});await flush();assert.equal(ui.all('article').length,2);
  const group=ui.all('button').find(node=>node.props['aria-controls']?.includes('pawfecthouse'));assert.ok(group);
  group.props.onClick();await flush();assert.equal(ui.all('article').length,1);
  assert.equal(ui.calls.length,1);assert.equal(ui.mutationCalls.length,0);
});

test('poll updates cannot remount the active review during mutation, including terminal status changes', async t => {
  for(const nextStatus of ['pending','merged','resolved']) await t.test(nextStatus,async t=>{
    const ui=setup();t.after(ui.unmount);const original=proposal('synthetic-action');
    ui.calls[0].resolve(page([original]));await flush();ui.open();await flush();ui.click('Xem & duyệt');await flush();
    const originalPanel=ui.all('feedback-review-panel-stub')[0];originalPanel.props.onBusyChange(true);await flush();
    ui.poll();ui.calls[1].resolve(page([{...original,status:nextStatus,proposed_content_md:'New proposal after poll'}]));await flush();
    const stillActive=ui.all('feedback-review-panel-stub')[0];assert.ok(stillActive);
    assert.equal(stillActive.props.proposal.proposed_content_md,original.proposed_content_md);
    assert.equal(stillActive.props.proposal.status,'pending');
    assert.equal(!!!!ui.button('Đóng chi tiết feedback').props.disabled,false);
    originalPanel.props.onBusyChange(false);await flush();
    assert.equal(!!ui.button('Đóng chi tiết feedback').props.disabled,false);
    ui.click('Đóng chi tiết feedback');await flush();assert.equal(ui.all('dialog').length,0);
    assert.equal(ui.mutationCalls.length,0);
  });
});


test('a successful action notice is associated with its feedback and never appears in another drawer',async t=>{
 const ui=setup();t.after(ui.unmount);ui.calls[0].resolve(page([proposal('synthetic-action'),proposal('other')]));await flush();
 ui.open();await flush();ui.click('Xem & duyệt');await flush();
 ui.all('feedback-review-panel-stub')[0].props.onComplete('Synthetic A-only completion');await flush();
 assert.match(textOf(ui.all('dialog')[0]),/Synthetic A-only completion/);
 ui.calls[1].resolve(page([proposal('synthetic-action','merged'),proposal('other')]));await flush();
 ui.click('Đóng chi tiết feedback');await flush();ui.open('other');await flush();
 assert.doesNotMatch(textOf(ui.all('dialog')[0]),/Synthetic A-only completion/);
});


test('screenshot ancillary sections each start independently collapsed and reference data loads on demand',async t=>{
 const ui=setup();t.after(ui.unmount);ui.calls[0].resolve(page([proposal()]));await flush();
 const tools=ui.all('details');assert.equal(tools.length,3);assert.ok(tools.every(node=>!node.props.open));
 for(const title of ['Admin access','Reference Library','Nâng cao · Knowledge Governance']){
   assert.ok(ui.all('summary').some(node=>textOf(node).includes(title)),title);
 }
 assert.equal(ui.all('private-reference-panel-stub').length,0);
 const library=tools.find(node=>textOf(node).includes('Reference Library'));assert.ok(library);
 library.props.onToggle({currentTarget:{open:true}});await flush();assert.equal(ui.all('private-reference-panel-stub').length,1);
 library.props.onToggle({currentTarget:{open:false}});await flush();assert.equal(ui.all('private-reference-panel-stub').length,1,'Closing preserves the reference session and unfinished form');
 assert.equal(ui.calls.length,1);assert.equal(ui.mutationCalls.length,0);
});


test('hung inbox read releases busy state on deadline, allows retry, and ignores late prior response',async t=>{
 const ui=setup();t.after(ui.unmount);await flush();ui.timeout();await flush();
 assert.match(ui.alerts().join(' '),/timed out/);assert.equal(ui.button('Thử lại').props.disabled,false);
 ui.click('Thử lại');assert.equal(ui.calls.length,2);ui.calls[1].resolve(page([proposal('fresh')]));await flush();
 ui.calls[0].resolve(page([proposal('old')]));await flush();assert.match(ui.text(),/fresh/);assert.doesNotMatch(ui.text(),/Synthetic feedback old/);
});

test('removed Live UI admin editor never loads or saves guide configuration',async t=>{
 const ui=setup();t.after(ui.unmount);ui.calls[0].resolve(page());await flush();
 assert.doesNotMatch(ui.fullText(),/Branch Visual Guide|Save Live UI|CSS selector/);
 assert.equal(ui.requests.some(call=>call.url.includes('branch-guide')),false);
});


test('StrictMode effect replay renews auth lifetime and login still works',async t=>{
 const ui=setup({authenticated:false});t.after(ui.unmount);ui.strictEffects();
 ui.change('Admin email','synthetic@example.invalid');ui.change('Password','synthetic-only');await flush();ui.click('Sign in');
 assert.equal(ui.loginCalls.length,1);assert.equal(ui.loginCalls[0].init.signal?.aborted,false);
 ui.loginCalls[0].resolve(Response.json({access_token:'new.synthetic'}));await flush();assert.equal(ui.calls.length,1);
});

test('malformed reject success stays unknown and blocks repeat submission',async t=>{
 const ui=setup({mockMutationUrl:'/api/admin/feedback/synthetic-action/review'});t.after(ui.unmount);
 ui.calls[0].resolve(page([proposal('synthetic-action')]));await flush();ui.open();await flush();ui.click('Reject');
 ui.mutationCalls[0].resolve(Response.json({}));await flush();ui.click('Reject');await flush();
 assert.equal(ui.mutationCalls.length,1);assert.match(ui.fullText(),/chưa rõ|Chưa xác nhận/);
});


test('logout then relogin still aborts current session when admin unmounts',async t=>{
 const ui=setup();t.after(ui.unmount);ui.calls[0].resolve(page());await flush();ui.click('Sign out');await flush();
 ui.change('Admin email','synthetic@example.invalid');ui.change('Password','synthetic-only');await flush();ui.click('Sign in');
 const request=ui.loginCalls[0];ui.unmount();assert.equal(request.init.signal?.aborted,true);
 request.resolve(Response.json({access_token:'must-not-return'}));await flush();assert.equal(ui.storage.get('creative_dna_admin_token'),undefined);
});
