/** LOCAL QA SYNTHETIC ONLY. Bundles the real API with no runner/provider/auth integration. */
import express from 'express';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createWorkspaceRouter } from '../../uid-workspace-api.ts';
import { FileWorkspaceStore, type WorkspaceRecord, type WorkspaceArtifact } from '../../uid-workspace-store.ts';
import { createWorkspaceTask } from '../../uid-workspace-task.ts';
import { buildWorkspacePreview } from '../../uid-workspace-preview.ts';
import { getOnepageUiTemplate } from '../../onepage-ui-template.ts';

const ROOT = path.resolve(process.cwd());
const PORT = Number(process.env.PORT || 4318);
if (!Number.isSafeInteger(PORT) || PORT < 1024 || PORT > 65535) throw new Error('Invalid local port');
const origin = `http://127.0.0.1:${PORT}`;
const OWNER = 'synthetic-qa-owner';
const TOKEN = 'synthetic.qa.local'; // Fixed test sentinel, not a real credential.
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const aliases: Record<string, string> = { occasion_story_01:'occasion_01', occasion_story_02:'occasion_02', occasion_story_01_mobile:'detail_main' };
const template = getOnepageUiTemplate();
const store = new FileWorkspaceStore(path.join(ROOT, 'qa-state'), { environment: 'development', maxBytes: 64*1024*1024 });
const now = new Date().toISOString();
const before = new Date(Date.now() - 3600_000).toISOString();

async function fixture(taskId: string, revision = 'current'): Promise<WorkspaceRecord> {
  const contentRevision = `qa-content-${revision}`;
  const text = Object.fromEntries(template.text_slots.map(slot => {
    const index = Number(slot.split('_').at(-1));
    const titles = ['A thoughtful sample, made for QA', 'Small details, clearly displayed', 'A simple test of every section', 'Preview the details', 'Made to inspect', 'Check every angle', 'Compare each revision', 'A sample for the moment', 'Bring the layout together', 'Keep the details in view', 'Know before you review', 'Made for local testing', 'Ready for a closer look'];
    return [slot, slot.startsWith('title') ? titles[index-1] + (revision === 'before' ? ' · Before' : '') : 'Synthetic QA copy for interface testing only. No real product claims, production output, or AI execution.'];
  }));
  const canonicalSlots = [...new Set(template.asset_slots.map(slot => aliases[slot] || slot))];
  const files: WorkspaceArtifact[] = [];
  const source: Record<string, any> = {};
  for (const slot of template.asset_slots) {
    const canonical = aliases[slot] || slot;
    const filename = `${revision}-${canonical}.png`;
    const bytes = await readFile(path.join(ROOT, 'fixtures', filename));
    const revision_id = `qa-${revision}-${canonical}`;
    source[slot] = { canonical_slot: canonical, artifact_revision: revision_id, sha256: sha(bytes), mime_type: 'image/png', bytes };
    if (!files.some(file => file.revision_id === revision_id)) files.push({ artifact_id: revision_id, revision_id, filename,
      media_type: 'image/png', size_bytes: bytes.length, sha256: sha(bytes), content_revision: contentRevision,
      kind: 'image', verification: 'verified', storage_key: filename, width: canonical === 'banner_desktop' ? 1280 : 640,
      height: canonical === 'banner_desktop' ? 600 : canonical === 'banner_mobile' ? 760 : 640 });
  }
  const preview = buildWorkspacePreview({ task_id: taskId, content_revision: contentRevision,
    canonical_hash: sha('LOCAL QA canonical synthetic fixture'), text, artifacts: source });
  const snapshot = { snapshot_id: `qa-snapshot-${revision}`, canonical_version: template.version,
    content_revision: contentRevision, content_digest: sha(JSON.stringify(text)),
    assets: canonicalSlots.map(slot => ({ asset_id: `qa-${slot}`, canonical_slot: slot, revision_id: `qa-${revision}-${slot}`, content_revision: contentRevision, label: `SYNTHETIC QA ${slot}` })) };
  return { owner_id: OWNER, task: { ...createWorkspaceTask(taskId, snapshot), stage: 'review', state_version: 4 },
    brief: { brand: 'PawfectHouse', material: 'onepage', source_url: 'https://example.com/synthetic-qa', title: 'QA · Onepage preview & files', requirements: 'LOCAL QA SYNTHETIC ONLY. These are deterministic fixture images, not a real product or AI output.' },
    created_at: before, updated_at: now, artifacts: files, review_manifest: preview.manifest, preview,
    content: { revision: contentRevision, slots: text }, actions: [], events: [{ sequence: 1, type: 'synthetic_fixture_seeded', created_at: before,
      data: { message: 'LOCAL QA SYNTHETIC ONLY · Fixture loaded. No AI/provider call has run.' } }],
    quality: [{ name: 'Local fixture integrity', status: 'passed', detail: 'PNG byte checksums and canonical template binding verified. This does not mean AI or EO checks passed.' },
      { name: 'Production / AI / EO approval', status: 'blocked', detail: 'Not run. Synthetic visual test only.' }], references: [], runs: [] };
}

async function seed() {
  const exists = await store.read(OWNER, state => state.tasks.length > 0);
  if (exists) return;
  const current = await fixture('qa-preview-current');
  const old = await fixture('qa-preview-current', 'before');
  current.revision_history = [{ revision_id: old.task.snapshot.snapshot_id, captured_at: before, action_id: 'qa-history-seed', snapshot: old.task.snapshot,
    content: old.content, review_manifest: old.review_manifest, preview: old.preview, artifact_ids: old.artifacts.map(a=>a.artifact_id) }];
  current.artifacts.push(...old.artifacts);
  const downloadName = 'LOCAL-QA-SYNTHETIC-README.txt';
  const download = Buffer.from('LOCAL QA SYNTHETIC ONLY\nThis file proves real download bytes. No AI, paid provider, production deployment, real product data or EO approval.\n');
  await writeFile(path.join(ROOT, 'fixtures', downloadName), download);
  current.artifacts.push({ artifact_id: 'qa-download-readme', revision_id: 'qa-download-v1', filename: downloadName, media_type: 'text/plain', size_bytes: download.length,
    sha256: sha(download), content_revision: current.task.snapshot.content_revision, kind: 'document', verification: 'verified', storage_key: downloadName });
  const content = structuredClone(current);
  content.task = { ...content.task, task_id: 'qa-content-review', stage: 'content_review', snapshot: { ...content.task.snapshot, assets: [] } };
  content.brief.title = 'QA · Duyệt nội dung'; content.preview = null; content.review_manifest = null; content.artifacts = []; content.revision_history = [];
  const unknown = structuredClone(content);
  unknown.task = { ...unknown.task, task_id: 'qa-recovery-unknown', stage: 'unknown', interruption: { resume_stage: 'assets', operation_id: 'synthetic-only', reason: 'Synthetic unknown-state test. Nothing was submitted.' } };
  unknown.brief.title = 'QA · Trạng thái cần đối soát';
  unknown.runs = [{ run_id:'qa-unknown-run',action_id:'qa-unknown-action',stage:'assets',operation_id:'synthetic-only',expected_state_version:4,snapshot_id:unknown.task.snapshot.snapshot_id,
    content_revision:unknown.task.snapshot.content_revision,fence:1,status:'unknown',lease_owner:'qa-fixture',lease_expires_at:before,created_at:before,updated_at:before,reason:'SYNTHETIC TEST ONLY; no provider submitted' }];
  const draft = structuredClone(content);
  draft.task = { ...draft.task, task_id: 'qa-draft', stage: 'draft', state_version:0 }; draft.content = null; draft.brief.title = 'QA · Brief nháp đã lưu';
  await store.transaction(OWNER, state => { state.tasks.push(current, content, unknown, draft); });
}

async function main() {
  await mkdir(path.join(ROOT, 'fixtures'), { recursive:true });
  await seed();
  // srcdoc inherits the parent's CSP as well as its own canonical CSP. Permit
  // only the exact server-seeded preview nonces, not arbitrary inline scripts.
  const previewNonces = await store.read(OWNER, state => [...new Set(state.tasks.flatMap(record =>
    [record.preview?.channel_nonce, ...(record.revision_history ?? []).map(revision => revision.preview?.channel_nonce)].filter((nonce): nonce is string => Boolean(nonce))))]);
  const nonceSources = previewNonces.map(nonce => `'nonce-${nonce}'`).join(' ');
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    if (!['127.0.0.1', '::ffff:127.0.0.1', '::1'].includes(req.socket.remoteAddress || '') || req.headers['x-forwarded-for'] || req.headers.forwarded) return res.status(403).send('LOCAL QA LOOPBACK ONLY');
    if (![ `127.0.0.1:${PORT}`, `localhost:${PORT}` ].includes(req.headers.host || '')) return res.status(403).send('LOCAL QA HOST REQUIRED');
    res.setHeader('Referrer-Policy', 'no-referrer');
    // Outbound connects are forbidden. Official Polaris is the sole external UI script.
    res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self' https://cdn.shopify.com ${nonceSources}; style-src 'self' 'unsafe-inline' https://cdn.shopify.com; img-src 'self' data: blob:; font-src 'self' data: https://cdn.shopify.com; connect-src 'self'; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'`);
    next();
  });
  app.use('/api/workspace', createWorkspaceRouter({ environment:'development', publicOrigin:origin, store,
    verifyToken: async token => token === TOKEN ? {id:OWNER} : null,
    verifyMembership: async () => ({active:true,role:'contributor'}),
    executionReadiness: () => ({ready:false,blockers:[{code:'LOCAL_QA_NO_EXECUTION',message:'LOCAL QA SYNTHETIC ONLY. AI/provider execution is disabled.'}]}),
    readArtifact: async (_record, artifact) => {
      if (path.basename(artifact.storage_key) !== artifact.storage_key) throw new Error('Invalid fixture path');
      return readFile(path.join(ROOT, 'fixtures', artifact.storage_key));
    },
  }));
  app.get('/qa', (_req, res) => res.type('html').send('<h1>LOCAL QA SYNTHETIC ONLY</h1><p>No provider, production, paid request, or real product data.</p><ul><li><a href="/workspace">Dashboard</a></li><li><a href="/workspace?task=qa-preview-current">Preview / files / history</a></li><li><a href="/workspace?task=qa-content-review">Content review</a></li><li><a href="/workspace?task=qa-recovery-unknown">Unknown / recovery</a></li></ul>'));
  const index = (await readFile(path.join(ROOT,'ui','index.html'),'utf8')).replace('<body>', '<body><div style="position:fixed;left:0;right:0;bottom:0;z-index:2147483647;background:#fff4ce;color:#462f00;font:600 11px/1.5 system-ui;text-align:center;padding:5px;border-top:1px solid #d8b850;pointer-events:none">LOCAL QA SYNTHETIC ONLY · No AI/provider · No production · Fixture images are not products</div>');
  app.use(express.static(path.join(ROOT,'ui'), {index:false}));
  app.get(['/', '/workspace', '/workspace/*'], (_req,res) => {
    res.cookie('uid_workspace_session',TOKEN,{httpOnly:true,sameSite:'strict',path:'/api/workspace',maxAge:3600000});
    res.type('html').send(index);
  });
  app.listen(PORT,'127.0.0.1',()=>console.log(`LOCAL QA SYNTHETIC ONLY\n${origin}/workspace?task=qa-preview-current\nNo provider, production integration or outgoing task data. Ctrl+C to stop.`));
}
main().catch(error => { console.error(error); process.exitCode=1; });
