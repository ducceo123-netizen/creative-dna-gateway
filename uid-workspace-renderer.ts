import { createHash } from 'node:crypto';
import { bindOnepageUiTemplate, getOnepageUiTemplate } from './onepage-ui-template.ts';
import { buildWorkspaceReviewManifest } from './uid-workspace-review.ts';
import { workspaceObjectKey } from './uid-workspace-artifacts.ts';
import type { WorkspacePreview } from './uid-workspace-preview.ts';
import type { WorkspaceStageContext } from './uid-workspace-runner.ts';
import type { WorkspaceRuntimeServices } from './uid-workspace-runtime.ts';

/** Minimal structural Playwright interface. The deployment supplies the actual
 * reviewed Chromium launcher. No executable discovery, download, implicit browser
 * session, credential reuse, sandbox disabling or environment-driven activation. */
export interface WorkspaceCapturePage {
  route(pattern:string,handler:(route:{abort():Promise<void>})=>Promise<void>):Promise<void>;
  setDefaultTimeout(milliseconds:number):void;
  setContent(html:string,options:{waitUntil:'load';timeout:number}):Promise<void>;
  evaluate<T>(fn:()=>T|Promise<T>):Promise<T>;
  screenshot(options:{type:'png';fullPage:true;animations:'disabled';caret:'hide';timeout:number}):Promise<Uint8Array>;
}
export interface WorkspaceCaptureBrowser {
  newContext(options:{viewport:{width:number;height:number};deviceScaleFactor:1;javaScriptEnabled:false;serviceWorkers:'block';acceptDownloads:false;ignoreHTTPSErrors:false;bypassCSP:false;permissions:[];reducedMotion:'reduce'}):Promise<{newPage():Promise<WorkspaceCapturePage>;close():Promise<void>}>;
  close():Promise<void>;
}
export type WorkspaceRendererOptions = {
  /** This review is a deployment prerequisite, not proof supplied by a caller. */
  browser?: {review_ref:string;sandboxed:true;launch(options:{headless:true;chromiumSandbox:true;args:[]}):Promise<WorkspaceCaptureBrowser>};
  timeoutMs?:number;
};
const sha=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
async function closeBounded(close:()=>Promise<void>){let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([Promise.resolve().then(close).catch(()=>undefined),new Promise<void>(resolve=>{timer=setTimeout(resolve,1000);})]);}finally{if(timer)clearTimeout(timer);}}
function fail(code:string):never{throw new Error(code);}
const viewports=[{name:'desktop',width:1440,height:1000},{name:'mobile',width:390,height:844},{name:'798',width:798,height:1000},{name:'799',width:799,height:1000}] as const;
/** Rebind current approved content and exact manifest asset hashes. Ignore caller
 * preview scripts/markup: only hash-verified embedded raster bytes are reused. */
export function buildWorkspaceCaptureDocument(context:WorkspaceStageContext,preview:WorkspacePreview){
  const record=context.record,manifest=preview.manifest;
  const {index_id,...body}=manifest;
  if(context.owner_id!==record.owner_id||!record.content||manifest.task_id!==record.task.task_id||manifest.content_revision!==record.task.snapshot.content_revision
    ||record.content.revision!==manifest.content_revision||record.review_manifest?.index_id!==index_id||buildWorkspaceReviewManifest(body).index_id!==index_id)fail('RENDER_SCOPE_MISMATCH');
  const template=getOnepageUiTemplate(manifest.template_version);
  const images=manifest.elements.filter(entry=>entry.kind==='image');
  const text=manifest.elements.filter(entry=>entry.kind==='text');
  if(text.some(entry=>!Object.hasOwn(record.content!.slots,entry.slot)||sha(record.content!.slots[entry.slot])!==entry.text_hash))fail('RENDER_COPY_CHANGED');
  const assets=Object.fromEntries(images.map(entry=>[entry.slot,`workspace-assets/${entry.slot}/${entry.sha256}`]));
  const faqCount=Object.keys(record.content.slots).filter(key=>/^faq_question_\d+$/.test(key)).length;
  const bound=bindOnepageUiTemplate(manifest.template_version,{text:record.content.slots,assets,...(template.post_story_section==='faq'?{faq_count:faqCount}:{})});
  const expectedHash=sha(JSON.stringify({html:bound.sha256.html,css:bound.sha256.css,artifacts:images}));
  if(expectedHash!==manifest.render_hash||bound.html!==preview.canonical.html||bound.css!==preview.canonical.css)fail('RENDER_CANONICAL_MISMATCH');
  if(typeof preview.html!=='string'||Buffer.byteLength(preview.html)>96*1024*1024)fail('RENDER_INPUT_TOO_LARGE');
  const data=new Map<string,{uri:string;bytes:Buffer;mime:string}>();let total=0;
  for(const match of preview.html.matchAll(/data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)/g)){
    const bytes=Buffer.from(match[2],'base64'),digest=sha(bytes);
    if(!bytes.length||bytes.length>8*1024*1024)fail('RENDER_RASTER_LIMIT');
    if(!data.has(digest)){total+=bytes.length;if(total>64*1024*1024||data.size>=32)fail('RENDER_RASTER_LIMIT');data.set(digest,{uri:match[0],bytes,mime:match[1]});}
  }
  let html=bound.html;
  for(const entry of images){
    const raster=data.get(entry.sha256);
    const retained=record.artifacts.find(a=>a.kind==='image'&&a.verification==='verified'&&a.revision_id===entry.artifact_revision&&a.sha256===entry.sha256&&a.content_revision===manifest.content_revision);
    if(!raster||!retained||raster.mime!==retained.media_type||raster.bytes.length!==retained.size_bytes)fail('RENDER_RASTER_MISMATCH');
    html=html.split(`"${assets[entry.slot]}"`).join(`"${raster.uri}"`);
  }
  const csp="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'";
  html=html.replace('<head>',`<head><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer">`).replace('<link rel="stylesheet" href="styles.css">',`<style>${bound.css}</style>`);
  if(/<(?:script|iframe|object|embed)\b/i.test(html)||/(?:src|href|srcset)\s*=\s*["'](?:https?:|\/\/)/i.test(html))fail('RENDER_EXTERNAL_CONTENT');
  return{html,html_sha256:sha(html),source_rasters:[...data.values()].map(({bytes,mime})=>({bytes,mime})),manifest};
}
export function createWorkspaceBrowserRenderer(services:Pick<WorkspaceRuntimeServices,'writeRunArtifact'>,options:WorkspaceRendererOptions={}){
  const timeout=options.timeoutMs??45000;
  if(!Number.isSafeInteger(timeout)||timeout<1000||timeout>120000)fail('RENDER_TIMEOUT_INVALID');
  const config=options.browser;
  function readiness(){const ready=Boolean(config?.sandboxed===true&&typeof config.launch==='function'&&config.review_ref?.trim()&&services.writeRunArtifact);return{ready,blockers:ready?[]:[{code:'SANDBOXED_BROWSER_NOT_CONFIGURED',message:'A reviewed sandboxed Chromium renderer and durable artifact writer are required.'}]};}
  async function renderMapping(context:WorkspaceStageContext,preview:WorkspacePreview){
    if(!readiness().ready)fail('SANDBOXED_BROWSER_NOT_CONFIGURED');
    if(context.signal.aborted)fail('RENDER_CANCELLED');
    const started=Date.now();
    const captureDocument=buildWorkspaceCaptureDocument(context,preview);
    let browser:WorkspaceCaptureBrowser|undefined;let timedOut=false;let timer:ReturnType<typeof setTimeout>|undefined;
    const stop=()=>{void browser?.close().catch(()=>undefined);};context.signal.addEventListener('abort',stop,{once:true});
    const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{timedOut=true;stop();reject(new Error('RENDER_DEADLINE_EXCEEDED'));},Math.max(0,timeout-(Date.now()-started)));});
    async function write(bytes:Uint8Array,mediaType:string){
      if(timedOut||context.signal.aborted)fail('RENDER_CANCELLED');
      const digest=sha(bytes),identity={owner_id:context.owner_id,task_id:context.record.task.task_id,storage_key:workspaceObjectKey(context.owner_id,context.record.task.task_id,digest),sha256:digest,size_bytes:bytes.byteLength,media_type:mediaType};
      const stored=await services.writeRunArtifact(context,identity,(async function*(){yield bytes;})());
      if(stored.sha256!==digest||stored.size_bytes!==bytes.byteLength||stored.storage_key!==identity.storage_key)fail('RENDER_CUSTODY_MISMATCH');
      return stored;
    }
    const operation=async()=>{
      const {preflightAsset}=await import('./uid-asset-preflight.ts');
      for(const raster of captureDocument.source_rasters){if(context.signal.aborted)fail('RENDER_CANCELLED');if(timedOut||Date.now()-started>=timeout)fail('RENDER_DEADLINE_EXCEEDED');const decoded=await preflightAsset(raster.bytes);if(('image/'+decoded.format)!==raster.mime)fail('RENDER_RASTER_DECODE_MISMATCH');}
      if(context.signal.aborted)fail('RENDER_CANCELLED');if(timedOut||Date.now()-started>=timeout)fail('RENDER_DEADLINE_EXCEEDED');
      browser=await config!.launch({headless:true,chromiumSandbox:true,args:[]});
      if(timedOut||context.signal.aborted){await closeBounded(()=>browser!.close());fail('RENDER_CANCELLED');}
      const captures=[];let mapping:Uint8Array|undefined;
      for(const viewport of viewports){
        if(timedOut||context.signal.aborted)fail('RENDER_CANCELLED');
        const session=await browser.newContext({viewport:{width:viewport.width,height:viewport.height},deviceScaleFactor:1,javaScriptEnabled:false,serviceWorkers:'block',acceptDownloads:false,ignoreHTTPSErrors:false,bypassCSP:false,permissions:[],reducedMotion:'reduce'});
        try{
          const page=await session.newPage();let externalRequests=0;
          await page.route('**/*',async route=>{externalRequests++;await route.abort();});page.setDefaultTimeout(Math.min(timeout,15000));
          await page.setContent(captureDocument.html,{waitUntil:'load',timeout:Math.min(timeout,15000)});
          const layout=await page.evaluate(async()=>{
            await document.fonts.ready;
            await Promise.all([...document.images].map(image=>image.decode()));
            const root=document.documentElement,body=document.body;
            return{width:Math.max(root.scrollWidth,body.scrollWidth),height:Math.max(root.scrollHeight,body.scrollHeight),viewport:innerWidth,
              images:[...document.images].map(image=>({width:image.naturalWidth,height:image.naturalHeight,complete:image.complete})),
              font_status:document.fonts.status,font_families:[...new Set([...document.querySelectorAll('[data-text-slot]')].map(element=>getComputedStyle(element).fontFamily))]};
          });
          if(externalRequests)fail('RENDER_EXTERNAL_REQUEST_BLOCKED');
          if(!Number.isSafeInteger(layout.width)||!Number.isSafeInteger(layout.height)||layout.width!==viewport.width||layout.viewport!==viewport.width
            ||layout.height<viewport.height||layout.height>20000||layout.width*layout.height>32_000_000||layout.images.length===0||layout.images.some(image=>!image.complete||image.width<1||image.height<1)||layout.font_status!=='loaded')fail('RENDER_LAYOUT_NOT_READY');
          const png=await page.screenshot({type:'png',fullPage:true,animations:'disabled',caret:'hide',timeout:Math.min(timeout,15000)});
          if(timedOut||context.signal.aborted)fail('RENDER_CANCELLED');
          const decoded=await preflightAsset(Buffer.from(png));
          if(decoded.format!=='png'||decoded.width!==layout.width||decoded.height!==layout.height)fail('RENDER_CAPTURE_MISMATCH');
          const stored=await write(png,'image/png');
          captures.push({viewport:viewport.name,width:layout.width,height:layout.height,font_families:layout.font_families,identity:stored});
          if(viewport.name==='desktop')mapping=png;
        }finally{await closeBounded(()=>session.close());}
      }
      const receipt=Buffer.from(JSON.stringify({schema_version:1,owner_id:context.owner_id,task_id:context.record.task.task_id,snapshot_id:context.record.task.snapshot.snapshot_id,
        content_revision:preview.manifest.content_revision,render_hash:preview.manifest.render_hash,index_id:preview.manifest.index_id,template_version:preview.manifest.template_version,
        canonical_hash:preview.manifest.canonical_hash,html_sha256:captureDocument.html_sha256,browser_review_ref:config!.review_ref,captures,technical_capture:'PASSED_NOT_VISUAL_QC',semantic_qc:false,eo_parity:false}));
      const evidence=await write(receipt,'application/json');
      return{bytes:mapping!,evidence_refs:[`render:${evidence.sha256}:${evidence.size_bytes}`],captures};
    };
    try{return await Promise.race([operation(),deadline]);}
    finally{if(timer)clearTimeout(timer);context.signal.removeEventListener('abort',stop);if(browser)await closeBounded(()=>browser!.close());}
  }
  return{readiness,renderMapping};
}
