import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { File } from 'node:buffer';
import vm from 'node:vm';
import { buildSync } from 'esbuild';
import { png, jpeg, webp } from './fixtures/reference-synthetic.ts';
import { decodeLibraryNotes, MAX_LIBRARY_IMAGE_BYTES, type LibraryRecord } from '../supabase/functions/_shared/reference-library-contract.ts';

/**
 * Execute the whole production component and its bundled image/catalog validators.
 * Only React's host hooks/JSX, browser decoding, object URLs, and request transport
 * are substituted. This is a deterministic behavior harness, not browser/layout QA.
 * State commits are batched into microtasks so two clicks can precede a render.
 */
const componentCode = buildSync({
  entryPoints: ['src/components/PrivateReferencePanel.tsx'], bundle: true,
  format: 'cjs', platform: 'node', jsx: 'automatic', write: false,
  external: ['react', 'react/jsx-runtime'],
}).outputFiles[0].text;

type Node = { type: string | symbol; props: Record<string, any>; key?: string };
type RequestCall = {
  url: string; init: RequestInit; resolve: (response: Response) => void;
  reject: (error: Error) => void;
};
type Effect = { create: () => void | (() => void); cleanup?: () => void; deps?: unknown[] };
type Bitmap = { width: number; height: number; close: () => void };
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function until(check: () => boolean, label: string) {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > deadline) assert.fail('Timed out waiting for ' + label);
    await new Promise<void>(resolve => setTimeout(resolve, 1));
  }
}
async function flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
function children(value: any): Node[] {
  if (Array.isArray(value)) return value.flatMap(children);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  return [value, ...children(value.props.children)];
}
function textOf(value: any): string {
  if (Array.isArray(value)) return value.map(textOf).join('');
  if (value === null || value === undefined || typeof value === 'boolean') return '';
  if (typeof value === 'object') return textOf(value.props.children);
  return String(value);
}
function file(bytes = png, name = 'fixture.png', type = 'image/png') {
  return new File([Buffer.from(bytes)], name, { type });
}
const idA = '11111111-1111-4111-8111-111111111111';
const idB = '22222222-2222-4222-8222-222222222222';
const idC = '33333333-3333-4333-8333-333333333333';
function record(id = idA, patch: Partial<LibraryRecord> = {}): LibraryRecord {
  return {
    id, filename: 'fixture.png', case_title: 'Synthetic case', brand: '', material: '', caption: '', why_good: '',
    mime_type: 'image/png', byte_length: png.length, width: 2, height: 2,
    sha256: createHash('sha256').update(png).digest('hex'), created_at: '2026-10-11T00:00:00.000Z', ...patch,
  };
}
function page(references: LibraryRecord[] = [], canUpload = true, nextOffset: number | null = null) {
  return Response.json({ schema: 'uid-reference-library/1', references, can_upload: canUpload, next_offset: nextOffset });
}

function setup(options: { decode?: (selected: File) => Promise<Bitmap> } = {}) {
  const slots: any[] = [], effects: Effect[] = [], calls: RequestCall[] = [];
  const blobs: { url: string; blob: Blob }[] = [], revoked: string[] = [], decoded: File[] = [];
  const digests: Promise<ArrayBuffer>[] = [];
  let cursor = 0, tree: Node, mounted = true, scheduled = false, lateStateWrites = 0, closedBitmaps = 0, uuids = 0;
  const effectQueue: Effect[] = [];
  const request = (url: string, init: RequestInit = {}) => {
    const result = deferred<Response>(); calls.push({ url, init, resolve: result.resolve, reject: result.reject });
    return result.promise;
  };
  const jsx = (type: Node['type'], props: Node['props'], key?: string) => ({ type, props, key });
  const hooks = {
    useState(initial: any) {
      const index = cursor++;
      if (!(index in slots)) {
        const slot = { value: typeof initial === 'function' ? initial() : initial, set: (value: any) => {
          if (!mounted) { lateStateWrites++; return; }
          const next = typeof value === 'function' ? value(slot.value) : value;
          if (Object.is(next, slot.value)) return;
          slot.value = next;
          if (!scheduled) { scheduled = true; queueMicrotask(() => { scheduled = false; if (mounted) render(); }); }
        } };
        slots[index] = slot;
      }
      return [slots[index].value, slots[index].set];
    },
    useRef(initial: any) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
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
  const module = { exports: {} as { PrivateReferencePanel: (props: any) => Node } };
  vm.runInNewContext(componentCode, {
    module, exports: module.exports,
    require: (name: string) => {
      if (name === 'react') return hooks;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: Symbol.for('Fragment') };
      throw new Error('Unexpected component dependency: ' + name);
    },
    // Shared constructors make host-origin transport/decode errors behave like browser errors.
    Error, ArrayBuffer, Uint8Array, Uint32Array, DataView, Blob, AbortController,
    crypto: {
      subtle: { digest: (algorithm: string, bytes: ArrayBuffer) => {
        const result = webcrypto.subtle.digest(algorithm, bytes); digests.push(result); return result;
      } },
      randomUUID: () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++uuids).padStart(12, '0')}`,
    },
    URL: {
      createObjectURL(blob: Blob) { const url = `blob:synthetic-private-${blobs.length + 1}`; blobs.push({ url, blob }); return url; },
      revokeObjectURL(url: string) { revoked.push(url); },
    },
    createImageBitmap: async (selected: File) => {
      decoded.push(selected);
      return options.decode ? options.decode(selected) : { width: 2, height: 2, close: () => { closedBitmaps++; } };
    },
  }, { filename: 'PrivateReferencePanel.bundle.cjs' });
  function render() {
    cursor = 0; tree = module.exports.PrivateReferencePanel({ request });
    for (const effect of effectQueue.splice(0)) effect.cleanup = effect.create() || undefined;
  }
  function unmount() { if (!mounted) return; mounted = false; for (const effect of effects) effect.cleanup?.(); }
  function all(type: string) { return children(tree).filter(node => node.type === type); }
  function button(label: string) {
    const found = all('button').find(node => textOf(node) === label);
    assert.ok(found, 'Missing button: ' + label); return found;
  }
  function click(label: string) { const found = button(label); assert.ok(!found.props.disabled, label + ' is disabled'); found.props.onClick(); }
  function field(label: string) {
    const found = all('label').find(node => textOf(node).startsWith(label));
    assert.ok(found, 'Missing field label: ' + label);
    const control = children(found.props.children).find(node => node.type === 'input' || node.type === 'textarea');
    assert.ok(control); return control;
  }
  function change(label: string, value: string) { const control = field(label); assert.ok(!control.props.disabled); control.props.onChange({ target: { value } }); }
  function select(files: File[]) {
    const picker = all('input').find(node => node.props.type === 'file'); assert.ok(picker, 'No authorized file picker');
    assert.ok(!picker.props.disabled);
    const target = { files, value: 'C:\\fakepath\\fixture.png' }; picker.props.onChange({ target });
    assert.equal(target.value, '', 'The picker resets so the same file can be selected again');
  }
  async function idle() { await flush(); await until(() => !button('Tải lại thư viện').props.disabled, 'component idle'); }
  async function requestCount(count: number) { await until(() => calls.length >= count, `${count} requests`); assert.equal(calls.length, count); }
  render();
  return {
    calls, blobs, revoked, decoded, all, button, click, field, change, select, idle, requestCount, unmount,
    text: () => textOf(tree), status: () => all('p').filter(node => node.props.role === 'status').map(textOf),
    get lateStateWrites() { return lateStateWrites; }, get closedBitmaps() { return closedBitmaps; }, get uuids() { return uuids; },
    async settleDigests() { await flush(); await Promise.all(digests); await flush(); },
    replayStrictModeEffects() {
      for (const effect of effects) effect.cleanup?.();
      for (const effect of effects) effect.cleanup = effect.create() || undefined;
    },
  };
}
async function ready(canUpload = true, references: LibraryRecord[] = [], nextOffset: number | null = null, options: Parameters<typeof setup>[0] = {}) {
  const ui = setup(options); ui.calls[0].resolve(page(references, canUpload, nextOffset)); await flush(); return ui;
}

test('UI loads an optional empty library and exposes upload only after admin authorization', async t => {
  const ui = setup(); t.after(ui.unmount);
  assert.match(ui.text(), /Đang tải thư viện riêng/);
  assert.equal(ui.all('input').length, 0);
  assert.equal(ui.calls.length, 1); assert.equal(ui.calls[0].url, '/api/member/creative-references');
  assert.equal(ui.calls[0].init.signal?.aborted, false);
  ui.calls[0].resolve(page([], false)); await flush();
  assert.match(ui.text(), /Thư viện chưa có ảnh/); assert.match(ui.text(), /Admin có thể thêm case/);
  assert.match(ui.text(), /Chưa có ảnh vẫn tiếp tục được công việc/);
  assert.equal(ui.all('input').length, 0); assert.equal(ui.all('img').length, 0);
  ui.click('Tải lại thư viện'); ui.calls[1].resolve(page()); await ui.idle();
  const picker = ui.all('input').find(node => node.props.type === 'file')!;
  assert.equal(picker.props.accept, 'image/png,image/jpeg,image/webp'); assert.equal(picker.props.multiple, true);
  assert.match(ui.text(), /Thêm case đầu tiên/); assert.deepEqual(ui.status(), []);
});

test('UI fails closed for denied sessions and invalid catalog responses', async t => {
  for (const [response, expected] of [
    [new Response('{}', { status: 401 }), /Phiên đăng nhập đã hết hạn/],
    [new Response('{}', { status: 403 }), /chưa có quyền UID/],
    [Response.json({ references: [], can_upload: true }), /INVALID_LIBRARY_PAGE/],
  ] as const) {
    await t.test(String(response.status) + ' ' + expected.source, async t => {
      const ui = setup(); t.after(ui.unmount); ui.calls[0].resolve(response); await flush();
      assert.match(ui.status().join(''), expected); assert.equal(ui.all('input').length, 0);
      assert.equal(ui.all('img').length, 0); assert.equal(ui.calls.length, 1);
    });
  }
});

test('UI stages PNG, JPEG and WebP locally, closes decoders, and cancels every preview', async t => {
  const ui = await ready(); t.after(ui.unmount);
  const selected = [file(), file(jpeg, 'fixture.jpg', 'image/jpeg'), file(webp, 'fixture.webp', 'image/webp')];
  ui.select(selected); await ui.idle();
  assert.equal(ui.calls.length, 1, 'Selection never sends private image bytes');
  assert.deepEqual(ui.decoded, selected); assert.equal(ui.closedBitmaps, 3);
  assert.deepEqual(ui.all('img').map(node => node.props.alt), selected.map(item => item.name));
  assert.equal(ui.blobs.length, 3);
  for (let i = 0; i < selected.length; i++) {
    assert.equal(ui.blobs[i].blob.type, selected[i].type);
    assert.deepEqual(new Uint8Array(await ui.blobs[i].blob.arrayBuffer()), new Uint8Array(await selected[i].arrayBuffer()));
  }
  ui.click('Bỏ chọn'); await flush();
  assert.deepEqual(ui.revoked, ui.blobs.map(item => item.url)); assert.equal(ui.all('img').length, 0);
  assert.equal(ui.all('textarea').length, 0); assert.equal(ui.calls.length, 1);
  ui.select([selected[0]]); await ui.idle(); assert.equal(ui.uuids, 4, 'A fresh selection gets a fresh operation UUID');
});

test('UI rejects unsupported, empty, oversized, spoofed, truncated and excessive selections before upload', async t => {
  const invalid = [
    { name: 'unsupported MIME', files: [file(png, 'fixture.svg', 'image/svg+xml')] },
    { name: 'empty file', files: [file(new Uint8Array())] },
    { name: 'over 5 MB', files: [file(new Uint8Array(MAX_LIBRARY_IMAGE_BYTES + 1))] },
    { name: 'spoofed JPEG', files: [file(png, 'fixture.jpg', 'image/jpeg')] },
    { name: 'truncated PNG', files: [file(png.subarray(0, 30))] },
    { name: 'eleven images', files: Array.from({ length: 11 }, () => file()) },
  ];
  for (const example of invalid) await t.test(example.name, async t => {
    const ui = await ready(); t.after(ui.unmount); ui.select(example.files); await ui.idle();
    assert.equal(ui.status().length, 1); assert.equal(ui.all('img').length, 0); assert.equal(ui.calls.length, 1);
    assert.equal(ui.decoded.length, 0); assert.equal(ui.blobs.length, 0);
  });
});

test('UI validates decoded dimensions and rejects browser decoding failures', async t => {
  for (const mismatch of [false, true]) await t.test(mismatch ? 'dimension mismatch' : 'decode rejected', async t => {
    let closed = 0;
    const ui = await ready(true, [], null, { decode: async () => {
      if (!mismatch) throw new Error('Synthetic decoder rejection');
      return { width: 9, height: 2, close() { closed++; } };
    } });
    t.after(ui.unmount); ui.select([file()]); await ui.idle();
    assert.match(ui.status().join(''), mismatch ? /Kích thước ảnh giải mã không khớp/ : /Synthetic decoder rejection/);
    assert.equal(ui.blobs.length, 0); assert.equal(ui.calls.length, 1); assert.equal(closed, mismatch ? 1 : 0);
  });
});

test('UI permits EXIF-style JPEG transposition but not unrelated JPEG or WebP dimension changes', async t => {
  // Change only the dimensions in synthetic raster headers. Browser decoding is
  // stubbed, so these are parser/decoded-dimension fixtures, not real EXIF files.
  const rectangularJpeg = jpeg.slice();
  const sof = rectangularJpeg.findIndex((byte, index) => byte === 0xff && rectangularJpeg[index + 1] === 0xc0);
  assert.ok(sof > 0); new DataView(rectangularJpeg.buffer).setUint16(sof + 7, 3);
  const rectangularWebp = webp.slice(); new DataView(rectangularWebp.buffer).setUint16(26, 3, true);
  for (const example of [
    { name: 'transposed JPEG', bytes: rectangularJpeg, mime: 'image/jpeg', width: 2, height: 3, accepted: true },
    { name: 'different JPEG dimensions', bytes: rectangularJpeg, mime: 'image/jpeg', width: 2, height: 4, accepted: false },
    { name: 'transposed WebP', bytes: rectangularWebp, mime: 'image/webp', width: 2, height: 3, accepted: false },
  ]) await t.test(example.name, async t => {
    let closed = 0;
    const ui = await ready(true, [], null, { decode: async () => ({ width: example.width, height: example.height, close() { closed++; } }) });
    t.after(ui.unmount); ui.select([file(example.bytes, 'synthetic-raster', example.mime)]); await ui.idle();
    assert.equal(closed, 1); assert.equal(ui.all('img').length, example.accepted ? 1 : 0);
    if (example.accepted) assert.deepEqual(ui.status(), []);
    else assert.match(ui.status().join(''), /Kích thước ảnh giải mã không khớp/);
    assert.equal(ui.calls.length, 1);
  });
});

test('UI rejects same-content duplicates and rolls back only the failed new selection', async t => {
  const ui = await ready(); t.after(ui.unmount);
  ui.select([file(webp, 'keep.webp', 'image/webp')]); await ui.idle();
  const retained = ui.all('img')[0].props.src;
  ui.select([file(), file(png, 'same-bytes-different-name.png')]); await ui.idle();
  assert.match(ui.status().join(''), /Có ảnh trùng/);
  assert.deepEqual(ui.all('img').map(node => node.props.src), [retained]);
  assert.deepEqual(ui.revoked, [ui.blobs[1].url], 'The partial new batch is released, not the prior selection');
  ui.select([]); await ui.idle(); assert.equal(ui.all('img')[0].props.src, retained);
  ui.select([file(jpeg, 'replacement.jpg', 'image/jpeg')]); await ui.idle();
  assert.ok(ui.revoked.includes(retained)); assert.equal(ui.all('img')[0].props.alt, 'replacement.jpg');
  assert.equal(ui.calls.length, 1);
});

test('UI guards a double upload click before rerender and disables mutation controls while saving', async t => {
  const ui = await ready(); t.after(ui.unmount); ui.select([file()]); await ui.idle();
  const click = ui.button('Lưu vào thư viện').props.onClick; click(); click(); await flush();
  assert.equal(ui.calls.length, 2, 'Only one POST is dispatched for two same-turn clicks');
  const upload = ui.calls[1], id = upload.url.split('/').at(-1)!;
  assert.equal(upload.init.method, 'POST'); assert.match(id, /^[a-f0-9-]{36}$/);
  assert.equal(ui.button('Bỏ chọn').props.disabled, true); assert.equal(ui.button('Đang xử lý…').props.disabled, true);
  assert.equal(ui.field('Tên case').props.disabled, true);
  assert.equal(ui.all('input').find(node => node.props.type === 'file')!.props.disabled, true);
  assert.deepEqual(new Uint8Array(upload.init.body as ArrayBuffer), png);
  upload.resolve(Response.json({ reference_id: id, status: 'STORED_AND_VERIFIED' })); await ui.requestCount(3);
  ui.calls[2].resolve(page([record(id)])); await ui.idle();
  assert.equal(ui.calls.filter(call => call.init.method === 'POST').length, 1);
  assert.match(ui.status().join(''), /Đã lưu và xác minh 1 ảnh/);
  assert.equal(ui.all('img').length, 0); assert.equal(ui.all('article').length, 1);
  assert.deepEqual(ui.revoked, [ui.blobs[0].url]);
});

test('UI retries an uncertain committed upload with the same UUID, bytes and original notes after edits', async t => {
  const ui = await ready(); t.after(ui.unmount); ui.select([file(png, 'Ảnh case.png')]); await ui.idle();
  ui.change('Tên case', 'Case đã chọn'); ui.change('Brand', 'Original brand'); ui.change('Điểm bạn thấy tốt', 'Ánh sáng rõ'); await flush();
  ui.click('Lưu vào thư viện'); const first = ui.calls[1], id = first.url.split('/').at(-1)!;
  const metadata = new Headers(first.init.headers).get('X-Reference-Metadata')!;
  const original = decodeLibraryNotes(metadata); assert.equal(original.case_title, 'Case đã chọn');
  const committed = record(id, original);
  first.reject(new Error('Connection lost after commit')); await ui.requestCount(3);
  ui.calls[2].resolve(page([committed])); await ui.idle();
  assert.match(ui.text(), /Thử lại giữ nguyên ảnh, ghi chú và mã/); assert.equal(ui.all('img').length, 1);
  assert.equal(ui.calls.filter(call => call.init.method === 'POST').length, 1, 'No automatic write replay');
  ui.change('Tên case', 'An edited different case'); ui.change('Brand', 'Changed brand'); ui.change('Điểm bạn thấy tốt', 'Changed note'); await flush();
  ui.click('Lưu vào thư viện'); const retry = ui.calls[3];
  assert.equal(retry.url, first.url); assert.equal(retry.init.body, first.init.body);
  assert.equal(new Headers(retry.init.headers).get('X-Reference-Metadata'), metadata);
  assert.equal(ui.uuids, 1); assert.equal(ui.blobs.length, 1);
  retry.resolve(Response.json({ reference_id: id, status: 'ALREADY_STORED' })); await ui.requestCount(5);
  ui.calls[4].resolve(page([committed])); await ui.idle();
  assert.equal(ui.all('article').length, 1); assert.equal(ui.all('img').length, 0);
  assert.match(ui.status().join(''), /Đã lưu và xác minh 1 ảnh/);
  ui.select([file(jpeg, 'next.jpg', 'image/jpeg')]); await ui.idle();
  assert.equal(ui.field('Tên case').props.value, '', 'Successful completion clears edited notes');
});

test('UI keeps pending images when a nominally successful upload has an unverified receipt', async t => {
  for (const receipt of [{ reference_id: idB, status: 'STORED_AND_VERIFIED' }, { status: 'ACCEPTED' }]) await t.test(JSON.stringify(receipt), async t => {
    const ui = await ready(); t.after(ui.unmount); ui.select([file()]); await ui.idle(); ui.click('Lưu vào thư viện');
    ui.calls[1].resolve(Response.json(receipt)); await ui.requestCount(3); ui.calls[2].resolve(page()); await ui.idle();
    assert.match(ui.status().join(''), /Chưa xác minh được lần tải lên/); assert.equal(ui.all('img').length, 1);
    assert.equal(ui.revoked.length, 0); assert.ok(ui.button('Lưu vào thư viện'));
  });
});

test('UI ignores stale initial responses and rejections after a newer refresh', async t => {
  for (const outcome of ['page', 'network rejection', 'delayed parsed body'] as const) await t.test(outcome, async t => {
    const ui = setup(); t.after(ui.unmount); const oldBody = deferred<any>();
    if (outcome === 'delayed parsed body') { ui.calls[0].resolve({ ok: true, json: () => oldBody.promise } as Response); await flush(); }
    ui.click('Tải lại thư viện'); ui.calls[1].resolve(page([record(idB, { filename: 'latest.png' })], true)); await ui.idle();
    if (outcome === 'network rejection') ui.calls[0].reject(new Error('Obsolete request failed'));
    else if (outcome === 'page') ui.calls[0].resolve(page([record(idA, { filename: 'stale.png' })], false));
    else oldBody.resolve({ schema: 'uid-reference-library/1', references: [record(idA)], can_upload: false, next_offset: null });
    await flush();
    assert.match(ui.text(), /latest.png/); assert.doesNotMatch(ui.text(), /stale.png/);
    assert.equal(ui.all('article').length, 1); assert.ok(ui.all('input').some(node => node.props.type === 'file'));
    assert.deepEqual(ui.status(), []);
  });
});

test('UI ignores obsolete initial JSON parse errors after a newer refresh succeeds', async t => {
  const ui = setup(); t.after(ui.unmount); const oldBody = deferred<any>();
  ui.calls[0].resolve({ ok: true, json: () => oldBody.promise } as Response); await flush();
  ui.click('Tải lại thư viện'); ui.calls[1].resolve(page([record(idB)])); await ui.idle();
  oldBody.reject(new Error('Obsolete body parse failed')); await flush();
  assert.deepEqual(ui.status(), [], 'A stale initial body error must not replace current successful status');
  assert.equal(ui.all('article').length, 1);
});

test('UI suppresses StrictMode first-mount abort errors and keeps the replacement request live', async t => {
  for (const stage of ['fetch', 'body'] as const) await t.test(stage, async t => {
    const ui = setup(); t.after(ui.unmount); const oldBody = deferred<any>();
    if (stage === 'body') { ui.calls[0].resolve({ ok: true, json: () => oldBody.promise } as Response); await flush(); }
    ui.replayStrictModeEffects(); assert.equal(ui.calls.length, 2);
    assert.equal(ui.calls[0].init.signal?.aborted, true); assert.equal(ui.calls[1].init.signal?.aborted, false);
    assert.notEqual(ui.calls[0].init.signal, ui.calls[1].init.signal);
    ui.calls[1].resolve(page([record(idB)])); await flush();
    if (stage === 'fetch') ui.calls[0].reject(new Error('Synthetic abort'));
    else oldBody.reject(new Error('Synthetic body abort'));
    await flush(); assert.deepEqual(ui.status(), []); assert.equal(ui.all('article').length, 1);
  });
});

test('UI merges pagination by ID, updates overlapping records, and filters the loaded metadata', async t => {
  const ui = await ready(false, [record(idA, { filename: 'first.png' }), record(idB, { filename: 'before.png' })], 20);
  t.after(ui.unmount); const click = ui.button('Tải thêm ảnh').props.onClick; click(); click(); await flush();
  assert.equal(ui.calls.length, 2); assert.equal(ui.calls[1].url, '/api/member/creative-references?offset=20');
  ui.calls[1].resolve(page([record(idB, { filename: 'updated.png', why_good: 'Soft lighting' }), record(idC, { filename: 'third.png', brand: 'Third brand' })], false));
  await ui.idle();
  assert.deepEqual(ui.all('h4').map(textOf), ['first.png', 'updated.png', 'third.png']);
  assert.equal(ui.all('article').length, 3); assert.equal(ui.all('button').some(node => textOf(node) === 'Tải thêm ảnh'), false);
  ui.change('Tìm trong các ảnh đã tải', 'LIGHTING'); await flush();
  assert.deepEqual(ui.all('h4').map(textOf), ['updated.png']);
  ui.change('Tìm trong các ảnh đã tải', 'third brand'); await flush();
  assert.deepEqual(ui.all('h4').map(textOf), ['third.png']);
  ui.change('Tìm trong các ảnh đã tải', ''); await flush(); assert.equal(ui.all('article').length, 3);
});

test('UI verifies private preview bytes before creating a URL and cleans previews on unmount', async t => {
  const ui = await ready(true, [record()]); t.after(ui.unmount);
  ui.click('Xem ảnh riêng tư'); assert.equal(ui.calls[1].url, '/api/member/creative-references/' + idA);
  const corrupt = png.slice(); corrupt[corrupt.length - 1] ^= 1;
  ui.calls[1].resolve(new Response(corrupt as BodyInit)); await ui.idle();
  assert.match(ui.status().join(''), /không khớp dữ liệu/); assert.equal(ui.blobs.length, 0);
  ui.click('Xem ảnh riêng tư'); ui.calls[2].resolve(new Response(png as BodyInit)); await ui.idle();
  assert.equal(ui.all('img').length, 1); assert.equal(ui.all('img')[0].props.src, ui.blobs[0].url);
  ui.select([file(jpeg, 'pending.jpg', 'image/jpeg')]); await ui.idle(); assert.equal(ui.all('img').length, 2);
  ui.unmount(); assert.deepEqual(ui.revoked, ui.blobs.map(item => item.url));
  assert.ok(ui.calls.every(call => call.init.signal?.aborted)); assert.equal(ui.lateStateWrites, 0);
  ui.unmount(); assert.equal(ui.revoked.length, 2, 'Repeated cleanup does not double-revoke');
});

test('UI aborts initial and preview requests and ignores their late results after unmount', async t => {
  await t.test('initial request', async () => {
    const ui = setup(); ui.unmount(); assert.equal(ui.calls[0].init.signal?.aborted, true);
    ui.calls[0].resolve(page([record()])); await flush(); assert.equal(ui.lateStateWrites, 0); assert.equal(ui.blobs.length, 0);
  });
  await t.test('private image request', async () => {
    const ui = await ready(false, [record()]); ui.click('Xem ảnh riêng tư'); await flush(); ui.unmount();
    assert.equal(ui.calls[1].init.signal?.aborted, true); ui.calls[1].resolve(new Response(png as BodyInit));
    await ui.settleDigests();
    assert.equal(ui.blobs.length, 0); assert.equal(ui.lateStateWrites, 0);
  });
});

test('UI closes a late decoder without creating a preview or writing state after unmount', async () => {
  const decode = deferred<Bitmap>(); let closed = 0;
  const ui = await ready(true, [], null, { decode: () => decode.promise });
  ui.select([file()]); await until(() => ui.decoded.length === 1, 'decoder start'); ui.unmount();
  decode.resolve({ width: 2, height: 2, close() { closed++; } });
  await until(() => closed === 1, 'late decoder close'); await ui.settleDigests();
  assert.equal(ui.blobs.length, 0); assert.equal(ui.calls.length, 1); assert.equal(ui.lateStateWrites, 0);
});

test('UI does not start a recovery catalog request after an aborted upload unmounts', async () => {
  const ui = await ready(); ui.select([file()]); await ui.idle(); ui.click('Lưu vào thư viện'); await flush();
  ui.unmount(); assert.equal(ui.calls[1].init.signal?.aborted, true);
  ui.calls[1].reject(new Error('Synthetic upload abort')); await flush();
  assert.equal(ui.calls.length, 2, 'Unmount must not dispatch another request with the already aborted signal');
  assert.deepEqual(ui.revoked, [ui.blobs[0].url]); assert.equal(ui.lateStateWrites, 0);
});
