import { createHash } from 'node:crypto';

export type PreviewIdentity = {
  jobId: string; contentRevision: number; inputHash: string; boundHtmlHash: string; templateVersion: string;
  assetHashes: Record<string, string>; text: Record<string, string>;
};

// Escaping JSON prevents a copy field from terminating the non-executable data element.
const scriptJson = (value: unknown) => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

/** Offline review controls are outside the unchanged canonical template. The only
 * output action is copying a prompt; this file cannot submit, approve or train.
 */
export function previewReviewHtml(identity: PreviewIdentity): string {
  const script = `"use strict";
const identity = JSON.parse(document.getElementById('identity').textContent);
const target = document.getElementById('target');
const notes = [];
document.getElementById('version').textContent = 'Job ' + identity.jobId + ' · revision ' + identity.contentRevision + ' · template ' + identity.templateVersion;
for (const [label, kind, values] of [['Overall layout', 'overall', ['overall']], ['Images', 'asset', Object.keys(identity.assetHashes)], ['Copy', 'text', Object.keys(identity.text)]]) {
  const group = document.createElement('optgroup'); group.label = label;
  for (const key of values) { const option = document.createElement('option'); option.value = kind + ':' + key; option.textContent = key; group.append(option); }
  target.append(group);
}
function describe() {
  const [kind, key] = target.value.split(':');
  document.getElementById('current').textContent = kind === 'asset' ? 'Current SHA-256: ' + identity.assetHashes[key] : kind === 'text' ? 'Current copy: ' + identity.text[key] : 'Review the overall layout, relationships and story.';
}
target.addEventListener('change', describe); describe();
function update() {
  const list = document.getElementById('notes'); list.replaceChildren();
  for (const [index, item] of notes.entries()) {
    const row = document.createElement('li'); const text = document.createElement('span'); text.textContent = item.target + ': ' + item.note;
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove'; remove.addEventListener('click', () => { notes.splice(index, 1); update(); }); row.append(text, remove); list.append(row);
  }
  const { text, ...binding } = identity;
  const envelope = { schemaVersion: 'uid.v2.grouped-feedback/1', ...binding, feedback: notes };
  document.getElementById('prompt').value = 'Apply this grouped Onepage feedback in the same conversation. First reload the job and compare jobId, contentRevision, inputHash, boundHtmlHash, templateVersion and every asset SHA-256 with the current server state. If any differ, stop and request a fresh preview. This feedback does not authorize approval, training, publishing or automatic execution. Preserve all canonical rules and rerun affected gates.\\n\\n' + JSON.stringify(envelope, null, 2);
  document.getElementById('copy').disabled = notes.length === 0;
}
document.getElementById('add').addEventListener('click', () => {
  const note = document.getElementById('note').value.trim(); if (!note) return;
  const [kind, key] = target.value.split(':');
  notes.push({ target: target.value, note, ...(kind === 'asset' ? { currentSha256: identity.assetHashes[key] } : kind === 'text' ? { currentText: identity.text[key] } : {}) });
  document.getElementById('note').value = ''; update();
});
document.getElementById('copy').addEventListener('click', async () => {
  const prompt = document.getElementById('prompt'); prompt.focus(); prompt.select();
  try { await navigator.clipboard.writeText(prompt.value); document.getElementById('status').textContent = 'Prompt copied. Paste it into the same conversation.'; }
  catch { document.getElementById('status').textContent = 'Prompt selected. Copy it manually and paste into the same conversation.'; }
});
for (const width of [1440, 390]) document.getElementById('width-' + width).addEventListener('click', () => { document.getElementById('preview').style.width = width + 'px'; });
update();`;
  const scriptHash = createHash('sha256').update(script).digest('base64');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src 'self' file:; style-src 'unsafe-inline'; script-src 'sha256-${scriptHash}'; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'">
<title>Onepage V2 review</title><style>
*{box-sizing:border-box}body{margin:0;color:#17252b;background:#f4f6f8;font:16px/1.5 system-ui,sans-serif}header,main{padding:20px;max-width:1600px;margin:auto}h1{font-size:26px;margin:0}h2{font-size:20px}button,select,textarea{font:inherit}button{padding:8px 14px;cursor:pointer}button:disabled{cursor:default}label{display:block;margin-top:12px;font-weight:600}select,textarea{width:100%;padding:8px}textarea{min-height:110px}#version,#current{overflow-wrap:anywhere}#version{font-size:13px}.toolbar{display:flex;gap:8px;margin:12px 0}.preview-scroll{overflow:auto;max-width:100%;border:1px solid #aebac1;background:#fff}iframe{display:block;border:0;width:1440px;height:78vh}.feedback{background:white;border:1px solid #cad4da;padding:18px;margin-top:24px}#current{white-space:pre-wrap;font-size:13px}li{margin:10px 0;white-space:pre-wrap;overflow-wrap:anywhere}li button{margin-left:12px}#prompt{min-height:220px;font:12px/1.5 monospace}#status{min-height:24px}
</style></head><body><header><h1>Onepage preview and grouped feedback</h1><p id="version"></p><p>Open <strong>review.html</strong> from the extracted folder. The page below uses the exact canonical HTML, CSS and verified assets. This local snapshot cannot detect later revisions.</p><p>Group notes by target, copy the prompt, and paste it into the same conversation. Copying does not send feedback, approve delivery, train, or publish.</p></header>
<main><div class="toolbar"><button id="width-1440" type="button">Desktop 1440px</button><button id="width-390" type="button">Mobile 390px</button></div><div class="preview-scroll"><iframe id="preview" src="index.html" title="Exact canonical Onepage preview" sandbox="allow-same-origin"></iframe></div>
<section class="feedback"><h2>Grouped feedback</h2><label for="target">Target</label><select id="target"></select><p id="current"></p><label for="note">Requested change</label><textarea id="note" maxlength="12000"></textarea><button id="add" type="button">Add note</button><ol id="notes"></ol><label for="prompt">Feedback prompt</label><textarea id="prompt" readonly></textarea><button id="copy" type="button" disabled>Copy feedback prompt</button><p id="status" role="status"></p></section></main>
<script id="identity" type="application/json">${scriptJson(identity)}</script><script>${script}</script></body></html>`;
}
