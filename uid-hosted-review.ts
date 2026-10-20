/** Repository-owned, immutable review delivery. No network fetches or upload endpoint. */
import {createHash} from 'node:crypto';
import {readFileSync, realpathSync, mkdirSync, writeFileSync, existsSync} from 'node:fs';
import path from 'node:path';
import type {Application} from 'express';
import express from 'express';
import {getTemplateFile} from './onepage-ui-template.ts';
import {PREVIEW_SCRIPT} from './uid-ldp-html-preview.ts';
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const segment=(v:unknown)=>{if(typeof v!=='string'||! /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(v))throw Error('UNSAFE_IDENTITY_SEGMENT');return v;};
export type DeliveryInput={kind:'ldp'|'onepage';identity:{type:'task'|'outcome';id:string};content_version:string;render_hash:string;entry:string;publication_authorized:true;assets:Array<{source_url:string;path:string;checksum:string}>;styles?:string[]};
function contained(root:string,file:string){if(!file||path.isAbsolute(file)||file.split(/[\\/]/).some(x=>x==='..'||x==='.'||!x)||! /^[A-Za-z0-9_./-]+$/.test(file))throw Error('UNSAFE_BUNDLE_PATH');const target=realpathSync(path.join(root,file));if(!target.startsWith(realpathSync(root)+path.sep))throw Error('BUNDLE_SYMLINK_ESCAPE');return target;}
const attr=(s:string)=>s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,'&#39;');
export function prepareHostedReview(input:DeliveryInput,sourceRoot:string,repoRoot:string){
 if(input.publication_authorized!==true)throw Error('EXPLICIT_PUBLICATION_AUTHORITY_REQUIRED');
 if(!['ldp','onepage'].includes(input.kind)||!['task','outcome'].includes(input.identity?.type))throw Error('INVALID_REVIEW_IDENTITY');
 segment(input.identity.id);
 if(typeof input.content_version!=='string'||!input.content_version.trim()||input.content_version.length>160)throw Error('INVALID_CONTENT_VERSION');
 const versionSegment='v-'+hash(input.content_version).slice(0,20);
 if(!/^(?:sha256:)?[a-f0-9]{64}$/.test(input.render_hash))throw Error('INVALID_RENDER_HASH');
 let html=readFileSync(contained(sourceRoot,input.entry),'utf8');
 if(Buffer.byteLength(html)>4_000_000)throw Error('HTML_TOO_LARGE');
 const manifestId=input.kind==='ldp'?'manifest':'onepage-review-manifest';
 const manifests=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
 const manifestScript=manifests.find(m=>new RegExp(`\\bid=["']${manifestId}["']`).test(m[1]));
 if(!manifestScript||! /\btype=["']application\/json["']/.test(manifestScript[1]))throw Error('MISSING_REVIEW_MANIFEST');
 const manifest=JSON.parse(manifestScript[2]);
 const manifestIdentity=manifest.task_id ? {type:'task',id:manifest.task_id} : {type:'outcome',id:manifest.outcome_id};
 if(manifest.schema_version!==`uid-${input.kind}-preview/1`||manifestIdentity.type!==input.identity.type||manifestIdentity.id!==input.identity.id||manifest.content_version!==input.content_version||manifest.render_hash!==input.render_hash)throw Error('STALE_OR_MISMATCHED_REVIEW');
 const canonicalCss=input.kind==='onepage'&&manifest.template_version?getTemplateFile(manifest.template_version,'styles.css')?.body:undefined;
 const canonicalHtml=input.kind==='onepage'&&manifest.template_version?getTemplateFile(manifest.template_version,'template.html')?.body:undefined;
 const trustedDataImages=new Set([...String(canonicalHtml||'').matchAll(/\bsrc=["'](data:[^"']+)["']/g)].map(m=>m[1]));
 const safeCss=(css:string)=>css===canonicalCss||(!/\\|@import|url\s*\(|expression\s*\(/i.test(css)&&css.length<500_000);
 const runtime=input.kind==='ldp'?PREVIEW_SCRIPT:readFileSync(path.join(repoRoot,'public/onepage-review.js'),'utf8');
 let executableCount=0;const scriptHashes:string[]=[];
 for(const m of manifests){if(m===manifestScript)continue;if(m[2]!==runtime||/\bsrc\s*=/i.test(m[1]))throw Error('UNTRUSTED_REVIEW_SCRIPT');executableCount++;scriptHashes.push(`'sha256-${createHash('sha256').update(m[2]).digest('base64')}'`);}
 if(executableCount!==1)throw Error('EXACT_REVIEW_RUNTIME_REQUIRED');
 // Strip scripts before markup checks: their trusted source legitimately contains HTML strings.
 const markup=html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,'');
 if(/<(?:iframe|object|embed|base|form|svg|math)\b|\son[a-z]+\s*=|(?:javascript|vbscript):|\bsrcdoc\s*=|http-equiv\s*=\s*["']refresh/i.test(markup))throw Error('UNSAFE_REVIEW_MARKUP');
 const files=new Map<string,Buffer>();const assets=manifest.asset_manifest;
 if(!Array.isArray(assets)||!assets.length||!Array.isArray(input.assets))throw Error('ACTUAL_ASSETS_REQUIRED');
 const mappings=new Map(input.assets.map(a=>[a.source_url,a]));
 if(mappings.size!==input.assets.length)throw Error('DUPLICATE_ASSET_SOURCE');
 const used=new Set<string>();
 const renderedSources=[...markup.matchAll(/<(?:img|source)\b[^>]*\b(?:src|srcset)\s*=\s*(["'])(.*?)\1/gi)].map(m=>m[2]);
 const hostedAssets=assets.map((a:any)=>({...a}));
 for(const a of assets){const mapped=mappings.get(a.file_url);if(!mapped||mapped.checksum!==a.checksum||!/^sha256:[a-f0-9]{64}$/.test(a.checksum))throw Error('EXACT_ASSET_MAPPING_REQUIRED');if(!renderedSources.includes(a.file_url)&&!renderedSources.includes(attr(a.file_url)))throw Error('MANIFEST_ASSET_NOT_RENDERED');
  if(/^https?:/.test(a.file_url)){const u=new URL(a.file_url);if(u.protocol!=='https:'||u.search||u.username||u.password)throw Error('PERSISTENT_PUBLIC_ASSET_REFERENCE_REQUIRED');}
  used.add(a.file_url);const bytes=readFileSync(contained(sourceRoot,mapped.path));if(bytes.length>20_000_000||'sha256:'+hash(bytes)!==a.checksum)throw Error('ASSET_CHECKSUM_MISMATCH');
  // Raster-only, with magic validation; SVG can execute in independent navigation.
  const ext=path.extname(mapped.path).toLowerCase();const valid=(ext==='.png'&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))||(['.jpg','.jpeg'].includes(ext)&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)||(ext==='.webp'&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP');if(!valid)throw Error('RASTER_ASSET_REQUIRED');
  const dest=`assets/${hash(bytes)}${ext}`;files.set(dest,bytes);
  // Update only rendered image attributes. Preserve the original canonical inventory in JSON.
  for(const hosted of hostedAssets)if(hosted.file_url===a.file_url)hosted.hosted_file_url=dest;
  html=html.replace(/(<(?:img|source)\b[^>]*\b(?:src|srcset)\s*=\s*)(["'])(.*?)\2/gi,(all,start,quote,url)=>url===a.file_url||url===attr(a.file_url)?`${start}${quote}${dest}${quote}`:all);
 }
 if(used.size!==mappings.size)throw Error('UNUSED_ASSET_MAPPING');
 for(const cssPath of input.styles||[]){if(!cssPath.endsWith('.css'))throw Error('CSS_ONLY');const css=readFileSync(contained(sourceRoot,cssPath),'utf8');if(!safeCss(css))throw Error('EXTERNAL_CSS_DEPENDENCY_NOT_ALLOWED');files.set(cssPath,Buffer.from(css));}
 const cleanMarkup=html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,'');
 if(/\s(?:style|src|srcset|href)\s*=\s*[^\s"'][^\s>]*/i.test(cleanMarkup))throw Error('QUOTED_RESOURCE_ATTRIBUTES_REQUIRED');
 for(const style of cleanMarkup.matchAll(/\sstyle\s*=\s*(["'])(.*?)\1/gi))if(!safeCss(style[2]))throw Error('UNTRUSTED_STYLE_ATTRIBUTE');
 for(const m of cleanMarkup.matchAll(/\b(src|href|srcset)\s*=\s*(["'])(.*?)\2/gi)){if(['src','srcset'].includes(m[1].toLowerCase())&&!files.has(m[3])&&!trustedDataImages.has(m[3]))throw Error('UNPACKAGED_IMAGE');if(m[1].toLowerCase()==='href'&&!m[3].startsWith('#')&&!/^https:\/\//.test(m[3])&&!files.has(m[3]))throw Error('UNPACKAGED_REFERENCE');}
 if(/<link\b[^>]*href\s*=\s*["']https?:/i.test(cleanMarkup))throw Error('REMOTE_STYLE_NOT_ALLOWED');
 for(const style of cleanMarkup.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi))if(!safeCss(style[1]))throw Error('UNTRUSTED_INLINE_STYLE');
 const hostedManifest={...manifest,asset_manifest:hostedAssets};
 html=html.replace(manifestScript[0],manifestScript[0].replace(manifestScript[2],()=>JSON.stringify(hostedManifest).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026')));
 // Header policy is authoritative; retain compiler meta CSP only if compatible with local images.
 html=html.replace(/<meta\b[^>]*http-equiv\s*=\s*["']Content-Security-Policy["'][^>]*>/gi,'');
 files.set('index.html',Buffer.from(html));
 const receipt={schema_version:'uid-hosted-review/1',kind:input.kind,identity:input.identity,content_version:input.content_version,render_hash:input.render_hash,source_manifest:manifest,files:[...files].map(([name,bytes])=>({path:name,sha256:hash(bytes)})).sort((a,b)=>a.path.localeCompare(b.path)),script_hashes:scriptHashes};
 const bundleHash=hash(JSON.stringify(receipt));const relative=`reviews/${input.kind}/${input.identity.type}/${input.identity.id}/${versionSegment}/${bundleHash}`;
 return {files,receipt,bundleHash,relative,urlPath:`/${relative}/index.html`};
}
export function writeHostedReview(prepared:ReturnType<typeof prepareHostedReview>,publicRoot:string){
 const root=path.resolve(publicRoot);mkdirSync(root,{recursive:true});
 // Refuse existing symlink ancestors, including public/, before writes.
 for(let p=root;;p=path.dirname(p)){if(existsSync(p)&&realpathSync(p)!==p)throw Error('OUTPUT_SYMLINK_NOT_ALLOWED');if(path.dirname(p)===p)break;}
 const target=path.join(root,prepared.relative);if(existsSync(target))throw Error('IMMUTABLE_REVIEW_ALREADY_EXISTS');
 for(const part of prepared.relative.split('/')){ /* validation also protects manually supplied prepared values */ segment(part); }
 for(let p=path.dirname(target);p.startsWith(root);p=path.dirname(p)){if(existsSync(p)&&realpathSync(p)!==p)throw Error('OUTPUT_SYMLINK_NOT_ALLOWED');if(p===root)break;}
 mkdirSync(target,{recursive:true});for(const [name,bytes] of prepared.files){const dest=path.join(target,name);mkdirSync(path.dirname(dest),{recursive:true});writeFileSync(dest,bytes,{flag:'wx'});}writeFileSync(path.join(target,'delivery.json'),JSON.stringify(prepared.receipt,null,2),{flag:'wx'});return prepared.urlPath;
}
/** Install before static/SPAs. Unknown reviews are genuine 404s, not SPA fallback. */
export function registerHostedReviews(app:Application,root=path.join(process.cwd(),'dist','reviews')){
 app.use('/reviews',(req,res,next)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','public, max-age=31536000, immutable');
  // An opaque origin: review JS cannot access gateway cookies/storage or APIs.
  res.setHeader('Content-Security-Policy',"sandbox allow-scripts allow-downloads; default-src 'none'; img-src 'self' data:; font-src data:; style-src 'self' 'unsafe-inline'; script-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  if(req.path.endsWith('/index.html')){try{const full=path.resolve(root,'.'+req.path);if(!full.startsWith(path.resolve(root)+path.sep))throw Error();const receipt=JSON.parse(readFileSync(path.join(path.dirname(full),'delivery.json'),'utf8'));if(!Array.isArray(receipt.script_hashes)||!receipt.script_hashes.every((v:unknown)=>typeof v==='string'&&/^'sha256-[A-Za-z0-9+/]{43}='$/.test(v)))throw Error();res.setHeader('Content-Security-Policy',`sandbox allow-scripts allow-downloads; default-src 'none'; img-src 'self' data:; font-src data:; style-src 'self' 'unsafe-inline'; script-src ${receipt.script_hashes.join(' ')}; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);}catch{return res.setHeader('Cache-Control','no-store').status(404).send('Review not found');}}
  next();
 },express.static(root,{index:false,redirect:false,fallthrough:true}),(_req,res)=>res.setHeader('Cache-Control','no-store').status(404).send('Review not found'));
}
