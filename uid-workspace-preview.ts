import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { bindOnepageUiTemplate, getOnepageUiTemplate } from './onepage-ui-template.ts';
import { buildWorkspaceReviewManifest, type WorkspaceReviewManifest } from './uid-workspace-review.ts';

const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const id = z.string().min(1).max(200).refine(value => value.trim() === value);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const metadata = z.object({ canonical_slot: id, artifact_revision: id, sha256: hash, mime_type: z.enum(['image/png','image/jpeg','image/webp']) }).strict();
export type WorkspacePreviewArtifact = z.infer<typeof metadata> & { bytes: Uint8Array };
export type WorkspacePreviewInput = {
  task_id: string; content_revision: string; template_version?: string; canonical_hash: string;
  text: Record<string,string>; faq_count?: number; artifacts: Record<string,WorkspacePreviewArtifact>;
};
export type WorkspacePreview = { html:string; manifest:WorkspaceReviewManifest; channel_nonce:string; canonical:{html:string;css:string}; status:'PREVIEW_REQUIRES_VISUAL_QA' };

const aliases: Record<string,string> = { occasion_story_01:'occasion_01', occasion_story_02:'occasion_02', occasion_story_01_mobile:'detail_main' };
const sectionClasses: Record<string,string> = {
  'uid-product-content__banner':'banner', 'uid-product-content__benefits':'benefits',
  'uid-product-content__details':'details', 'uid-occasions-media':'occasion_media', 'uid-occasions-items':'occasion_icons',
  'uid-product-good-to-know':'gtk', 'uid-product-content-faqs':'faq',
};
function rasterSignature(bytes:Buffer,mime:string) {
  return mime === 'image/png' ? bytes.length >= 24 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : mime === 'image/jpeg' ? bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : bytes.length >= 16 && bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP';
}

/** Trusted worker boundary: authorize owner and load current approved snapshot first.
 * Bytes must already have passed the worker's decoder and policy checks. Signature
 * and checksum checks here defend binding integrity; they are NOT pixel/EO review.
 * Never accept this input as a browser-authored completed task or approval.
 */
export function buildWorkspacePreview(input:WorkspacePreviewInput):WorkspacePreview {
  id.parse(input.task_id); id.parse(input.content_revision); hash.parse(input.canonical_hash);
  const source = getOnepageUiTemplate(input.template_version);
  if (!input.artifacts || Object.keys(input.artifacts).length !== source.asset_slots.length || source.asset_slots.some(slot => !Object.hasOwn(input.artifacts,slot))) throw new Error('PREVIEW_ASSETS_MUST_MATCH_TEMPLATE');
  let total = 0;
  const assets:Record<string,string> = {}, inline:Record<string,string> = {};
  const elements:WorkspaceReviewManifest['elements'] = [];
  const imageElements = new Map<string,WorkspaceReviewManifest['elements'][number]>();
  const children = new Map<string,string[]>();
  const add = (element:WorkspaceReviewManifest['elements'][number],section:string|undefined) => {
    if (!section) throw new Error('UNKNOWN_CANONICAL_SECTION');
    elements.push(element); children.set(section,[...(children.get(section) ?? []),element.id]);
  };
  for (const slot of source.asset_slots) {
    const { bytes:raw,...rest } = input.artifacts[slot]; const entry = metadata.parse(rest);
    if (entry.canonical_slot !== (aliases[slot] ?? slot)) throw new Error('CANONICAL_ASSET_ALIAS_MISMATCH');
    if (!(raw instanceof Uint8Array)) throw new Error('PREVIEW_BYTES_REQUIRED');
    const bytes = Buffer.from(raw); total += bytes.length;
    if (!bytes.length || bytes.length > 8*1024*1024 || total > 64*1024*1024) throw new Error('PREVIEW_SIZE_LIMIT');
    if (digest(bytes) !== entry.sha256 || !rasterSignature(bytes,entry.mime_type)) throw new Error('PREVIEW_ARTIFACT_INTEGRITY');
    assets[slot] = `workspace-assets/${slot}/${entry.sha256}`;
    inline[assets[slot]] = `data:${entry.mime_type};base64,${bytes.toString('base64')}`;
    imageElements.set(slot,{id:`image:${slot}`,kind:'image',slot,canonical_slot:entry.canonical_slot,artifact_revision:entry.artifact_revision,sha256:entry.sha256});
  }
  const bound = bindOnepageUiTemplate(input.template_version,{text:input.text,assets,...(input.faq_count === undefined ? {} : {faq_count:input.faq_count})});
  // Binder enforces exact slot inventory and escapes copy. Only its pinned source
  // is annotated; never parse or execute model-authored HTML/CSS.
  let html = bound.html;
  if (/<(?:script|base|iframe|object|embed|form)\b/i.test(html) || /<[^>]+\son[a-z]+\s*=/i.test(html)) throw new Error('UNSAFE_CANONICAL_TEMPLATE');
  // Canonical sections are determined by real DIV ancestry, not asset names:
  // occasion_story_01_mobile is physically in Product Details in both templates.
  // This limited tokenizer handles only the immutable escaped template, never
  // arbitrary caller HTML. No DIV tags can occur in escaped bound text/attributes.
  const ancestry:Array<string|undefined> = [];
  const marked = new Set<string>(), seenImages = new Set<string>(), seenTexts = new Set<string>();
  html = html.replace(/<\/?[a-z][^>]*>/gi,(tag:string) => {
    if (/^<\/div\s*>$/i.test(tag)) { if (!ancestry.length) throw new Error('INVALID_CANONICAL_ANCESTRY'); ancestry.pop(); return tag; }
    if (/^<\//.test(tag)) return tag;
    let current = ancestry.at(-1);
    if (/^<div(?:\s|>)/i.test(tag)) {
      const classes = tag.match(/\bclass="([^"]*)"/)?.[1] ?? '';
      const section = classes.split(/\s+/).map(name => sectionClasses[name]).find(Boolean);
      if (section) {
        if (marked.has(section)) throw new Error('DUPLICATE_CANONICAL_SECTION');
        marked.add(section); current = section;
        tag = tag.replace(/>$/,` data-workspace-section="section:${section}" tabindex="0">`);
      }
      ancestry.push(current);
    }
    const textSlot = tag.match(/\bdata-text-slot="([a-z0-9_]+)"/)?.[1];
    const imageSlot = tag.match(/\bdata-asset-slot="([a-z0-9_]+)"/)?.[1];
    if (textSlot) {
      if (seenTexts.has(textSlot) || !Object.hasOwn(input.text,textSlot)) throw new Error('INVALID_CANONICAL_TEXT_BINDING');
      seenTexts.add(textSlot);
      add({id:`text:${textSlot}`,kind:'text',slot:textSlot,text_hash:digest(input.text[textSlot])},current);
      tag = tag.replace(/>$/,` data-workspace-element="text:${textSlot}" tabindex="0">`);
    }
    if (imageSlot && imageSlot !== 'ui_checkmark') {
      if (seenImages.has(imageSlot) || !imageElements.has(imageSlot)) throw new Error('INVALID_CANONICAL_IMAGE_BINDING');
      seenImages.add(imageSlot); add(imageElements.get(imageSlot)!,current);
      tag = tag.replace(/>$/,` data-workspace-element="image:${imageSlot}"${tag.startsWith('<img') ? ' tabindex="0"' : ''}>`);
    }
    return tag;
  });
  if (ancestry.length || seenImages.size !== source.asset_slots.length || seenTexts.size !== Object.keys(input.text).length) throw new Error('INVALID_CANONICAL_ANCESTRY');
  for (const [section,ids] of children) elements.push({id:`section:${section}`,kind:'section',children:ids});
  const render_hash = digest(JSON.stringify({html:bound.sha256.html,css:bound.sha256.css,artifacts:elements.filter(e=>e.kind==='image')}));
  const manifest = buildWorkspaceReviewManifest({task_id:input.task_id,content_revision:input.content_revision,template_version:source.version,canonical_hash:input.canonical_hash,render_hash,elements});
  for (const [reference,data] of Object.entries(inline)) html = html.split(`"${reference}"`).join(`"${data}"`);
  const channel_nonce = randomBytes(24).toString('hex');
  const context = JSON.stringify({channel_nonce,index_id:manifest.index_id,render_hash,ids:elements.map(e=>e.id)}).replace(/</g,'\\u003c');
  const runtime = `(()=>{
    const c=${context},ids=new Set(c.ids),selected=new Set();let mode='element';
    const emit=(type,extra)=>parent.postMessage({type,channel_nonce:c.channel_nonce,index_id:c.index_id,render_hash:c.render_hash,...extra},'*');
    const displayedImage=el=>{
      if(el.tagName!=='IMG')return el;
      const picture=el.closest('picture');
      return picture&&[...picture.querySelectorAll('source[data-workspace-element]')].find(s=>!s.media||matchMedia(s.media).matches)||el;
    };
    const target=node=>{
      if(!(node instanceof Element))return null;
      if(mode==='section')return node.closest('[data-workspace-section]');
      const el=node.closest('[data-workspace-element]');return el&&displayedImage(el);
    };
    const select=e=>{
      const el=target(e.target),element_id=el&&(el.dataset.workspaceElement||el.dataset.workspaceSection);
      if(!ids.has(element_id))return;
      e.preventDefault();e.stopPropagation();emit('uid-workspace-selection',{element_id,viewport_width:innerWidth});
    };
    document.addEventListener('click',select,true);
    document.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')select(e)},true);
    const highlight=()=>document.querySelectorAll('[data-workspace-element],[data-workspace-section]').forEach(el=>{
      // SOURCE has no rendered box. Resolve the visible source while painting its
      // sibling IMG once, so the later IMG pass cannot erase a mobile selection.
      if(el.tagName==='SOURCE')return;
      const displayed=displayedImage(el),active=selected.has(displayed.dataset.workspaceElement||displayed.dataset.workspaceSection);
      el.style.outline=active?'3px solid #4f46e5':'';el.style.outlineOffset=active?'2px':'';
    });
    addEventListener('message',e=>{
      if(e.source!==parent||!e.data||e.data.channel_nonce!==c.channel_nonce)return;
      const d=e.data;
      if(d.type==='uid-workspace-mode'&&['element','section'].includes(d.mode))mode=d.mode;
      if(d.type==='uid-workspace-highlight'&&Array.isArray(d.element_ids)&&d.element_ids.length<=600){
        selected.clear();d.element_ids.filter(id=>typeof id==='string'&&ids.has(id)).forEach(id=>selected.add(id));highlight();
      }
    });
    addEventListener('resize',highlight);
    let last=0;const height=()=>{const h=Math.ceil(document.documentElement.scrollHeight);if(h!==last){last=h;emit('uid-workspace-height',{height:Math.min(h,100000)})}};
    new ResizeObserver(height).observe(document.documentElement);addEventListener('load',height);height();
  })();`;

  const csp = `default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'nonce-${channel_nonce}'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  html = html.replace('<head>',`<head><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer">`)
    .replace('<link rel="stylesheet" href="styles.css">',`<style>${bound.css}</style>`)
    .replace('</body>',`<script nonce="${channel_nonce}">${runtime}</script></body>`);
  return {html,manifest,channel_nonce,canonical:{html:bound.html,css:bound.css},status:'PREVIEW_REQUIRES_VISUAL_QA'};
}
