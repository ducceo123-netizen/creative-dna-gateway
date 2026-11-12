import { createServer } from 'node:http';
import { scanPublicSource } from './research.mjs';
import {resolveGatewayDNA} from './creative-dna.mjs';
import {packZip} from './zip.mjs';
import {freshPipeline,recordStage,nextPipelineStage,validateSelectedSlots,textStage,generateProductMaterial,visionReview,pipelineExport,PIPELINE_STAGES} from './orchestrator.mjs';
import {inspectPublicEvidence,cleanDeliverable,qaSummary} from './hybrid.mjs';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 10000);
const maxBody = 80000;
const webApp = await readFile(join(here, 'index.html'));
function json(res, status, value) { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value)); }
function readBody(req) { return new Promise((resolve,reject)=>{let text='';req.on('data',c=>{text+=c;if(text.length>maxBody){reject(new Error('body_too_large'));req.destroy();}});req.on('end',()=>{try{resolve(JSON.parse(text));}catch{reject(new Error('invalid_json'));}});req.on('error',reject);}); }
const aiEnabled = Boolean(process.env.OPENAI_API_KEY && process.env.STUDIO_ACCESS_TOKEN);
const taskAiEnabled = process.env.STUDIO_AI_EXECUTOR_ENABLED==='true' && Boolean(process.env.OPENAI_API_KEY);
const PLAN_GATEWAY_APPROVED=false; // Explicit release gate: never infer approval from account authentication.
const EXECUTION_MODES=['hybrid_bridge','api_auto','chatgpt_connect'];
function executionCatalog(){
 return [
  {id:'hybrid_bridge',label:'Hybrid Bridge',status:'available',description:'ChatGPT handoff via UID Brands MCP; no OpenAI API charges.'},
  {id:'api_auto',label:'API Auto',status:taskAiEnabled?'available':'setup_required',description:'Optional metered API executor; requires owner-controlled server credentials and per-run confirmation.'},
  {id:'chatgpt_connect',label:'ChatGPT Connect',status:PLAN_GATEWAY_APPROVED?'available':'awaiting_approval',description:'ChatGPT Plan Usage integration; not approved for hosted Studio.'}
 ];
}
const stageLocks=new Set(); // Per-task stage serialization on single-instance Render service.
const apiUserLocks=new Set(); // Serializes budget reservations for a user on this instance.
const boundedQuota=(v,defaultValue,max)=>Math.max(1,Math.min(max,Number.isFinite(Number(v))?Number(v):defaultValue));
const MAX_API_CALLS_PER_DAY=boundedQuota(process.env.STUDIO_DAILY_MAX_API_CALLS,16,100);
const MAX_IMAGE_CALLS_PER_DAY=boundedQuota(process.env.STUDIO_DAILY_MAX_IMAGE_CALLS,8,32);
async function reserveApiQuota(uid,token,{image=false}={}){
 const day=new Date().toISOString().slice(0,10);
 const path='/rest/v1/studio_ai_usage_daily?user_id=eq.'+uid+'&day=eq.'+day+'&select=attempted_calls,attempted_images&limit=1';
 const p=await sb(path,{token});if(!p.ok)throw Error('Unable to confirm daily API usage');
 const previous=p.data?.[0]||{attempted_calls:0,attempted_images:0};
 if(previous.attempted_calls>=MAX_API_CALLS_PER_DAY||(image&&previous.attempted_images>=MAX_IMAGE_CALLS_PER_DAY))
  throw Error('Daily API cap reached. No new paid request was started.');
 const payload={user_id:uid,day,attempted_calls:previous.attempted_calls+1,
   attempted_images:previous.attempted_images+(image?1:0),updated_at:new Date().toISOString()};
 const saved=await sb('/rest/v1/studio_ai_usage_daily?on_conflict=user_id,day',{
   method:'POST',token,body:payload,prefer:'resolution=merge-duplicates,return=representation'});
 if(!saved.ok)throw Error('Could not reserve a daily API call safely');
 return {calls_left:Math.max(0,MAX_API_CALLS_PER_DAY-payload.attempted_calls),
   images_left:Math.max(0,MAX_IMAGE_CALLS_PER_DAY-payload.attempted_images)};
}

const handoffTokens=new Map(); // ephemeral one-time capability: only a task owner can issue it
const handoffHash=token=>createHash('sha256').update(token).digest('hex');
function clearExpiredHandoffs(){
 const now=Date.now();
 for(const [key,item] of handoffTokens)if(item.expires<now)handoffTokens.delete(key);
}

const supabaseUrl=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const supabaseKey=process.env.SUPABASE_PUBLISHABLE_KEY||'';
const cloudEnabled=Boolean(supabaseUrl&&supabaseKey);
async function sb(path,{method='GET',token,body,prefer}={}){
  if(!cloudEnabled)throw Error('Cloud sync is not configured');
  const headers={'apikey':supabaseKey,'Content-Type':'application/json'};
  if(token)headers.Authorization='Bearer '+token;
  if(prefer)headers.Prefer=prefer;
  const upstream=await fetch(supabaseUrl+path,{method,headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(12000)});
  const result=await upstream.json().catch(()=>null);
  return {status:upstream.status,ok:upstream.ok,data:result};
}
const companyEmail = email=>typeof email==='string' && /^[a-z0-9._%+-]+@happyuid[.]com$/i.test(email.trim());
async function companySignupSettings(){
 const response=await fetch(supabaseUrl+'/auth/v1/settings',{headers:{apikey:supabaseKey,'Accept':'application/json'},signal:AbortSignal.timeout(8500),redirect:'error'});
 if(!response.ok)throw Error('Auth configuration unavailable');
 const settings=await response.json();
 // Fail closed unless email ownership is verified by Supabase prior to role grant.
 return settings?.mailer_autoconfirm===false && settings?.disable_signup===false && settings?.external?.email===true;
}
async function member(token){
  const user=await sb('/auth/v1/user',{token});
  if(!user.ok||!user.data?.id)return null;
  const query='?select=role,is_active,auto_provisioned&user_id=eq.'+encodeURIComponent(user.data.id)+'&is_active=eq.true&limit=1';
  const role=await sb('/rest/v1/creative_dna_team_members'+query,{token});
  if(!role.ok||!Array.isArray(role.data)||!role.data.length)return null;
  if(role.data[0].auto_provisioned && (!companyEmail(user.data.email)||!user.data.email_confirmed_at))return null;
  return {id:user.data.id,email:user.data.email,role:role.data[0].role};
}
function authorized(req){const header=req.headers.authorization||'';return /^Bearer [^\s]+$/.test(header)?header.slice(7):null;}
function failure(res,error){return json(res,error==='body_too_large'?413:400,{error:String(error).slice(0,180)});}

const ATTACH_BUCKET='studio-attachments';
const ATTACH_MAX_SIZE=8*1024*1024;
const ATTACH_EXT=Object.freeze({
 png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',
 pdf:'application/pdf',txt:'text/plain',md:'text/markdown',csv:'text/csv',
 docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
 xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
});
function attachmentInfo(name){
 if(typeof name!=='string'||name.length>130||!name.trim())throw Error('Invalid attachment name');
 const safe=name.replace(/[^\p{L}\p{N}._ -]/gu,'_').replace(/^[ .]+/,'').slice(0,100);
 const ext=safe.split('.').at(-1)?.toLowerCase();
 if(!safe||!Object.hasOwn(ATTACH_EXT,ext))throw Error('Unsupported file format');
 return {safe,ext,mime:ATTACH_EXT[ext]};
}
function fileSignatureOK(bytes,ext){
 const has=(arr,at=0)=>arr.every((v,i)=>bytes[at+i]===v);
 if(bytes.length<1)return false;
 if(ext==='png')return has([137,80,78,71,13,10,26,10]);
 if(ext==='jpg'||ext==='jpeg')return has([255,216,255]);
 if(ext==='gif')return has([71,73,70,56,55])||has([71,73,70,56,57]);
 if(ext==='webp')return has([82,73,70,70])&&has([87,69,66,80],8);
 if(ext==='pdf')return has([37,80,68,70,45]);
 if(ext==='docx'||ext==='xlsx')return has([80,75,3,4]);
 if(ext==='txt'||ext==='md'||ext==='csv')return !bytes.includes(0)&&new TextDecoder('utf-8',{fatal:true}).decode(bytes).length>=0;
 return false;
}
async function readAttachment(req){
 const length=Number(req.headers['content-length']||0);
 if(length>ATTACH_MAX_SIZE)return null;
 let count=0;const pieces=[];
 for await(const chunk of req){count+=chunk.length;if(count>ATTACH_MAX_SIZE)return null;pieces.push(chunk);}
 return Buffer.concat(pieces);
}
async function storageCall(path,{method='GET',token,body,mime='application/json'}={}){
 const response=await fetch(supabaseUrl+'/storage/v1/'+path,{
  method,headers:{apikey:supabaseKey,Authorization:'Bearer '+token,...(body?{'Content-Type':mime}:{})},
  body,signal:AbortSignal.timeout(20000),redirect:'error'
 });
 return response;
}
function attachmentFolder(uid,taskId){return uid+'/'+taskId+'/';}
async function listAttachments(uid,taskId,token){
 const response=await storageCall('object/list/'+ATTACH_BUCKET,{method:'POST',token,body:JSON.stringify({prefix:attachmentFolder(uid,taskId),limit:100,offset:0,sortBy:{column:'name',order:'asc'}})});
 if(!response.ok)throw Error('Could not list private attachments');
 const objects=await response.json();
 return (Array.isArray(objects)?objects:[]).filter(x=>/^[0-9a-f-]{36}--/.test(x.name)).map(x=>({id:x.name,name:x.name.replace(/^[0-9a-f-]{36}--/,''),size:x.metadata?.size||null,mime:x.metadata?.mimetype||null,created_at:x.created_at||null}));
}

const STORES=Object.freeze({PawfectHouse:'https://pawfecthouse.com',GiftSoul:'https://giftsoul.co',SoulPrise:'https://soulprise.co'});
const taskFields=['title','brand','workflow','source_url','brief','content','feedback','status'];
const searchCache=new Map();
async function searchCatalog(brand,query){
 const domain=STORES[brand]; if(!domain)throw Error('Unsupported brand');
 const clean=String(query||'').trim();
 if(clean.length<2||clean.length>150)throw Error('Search name must be 2–150 characters');
 const cacheKey=brand+'|'+clean.toLowerCase();
 const cached=searchCache.get(cacheKey);if(cached&&cached.expires>Date.now())return cached.results;
 const url=new URL('/search/suggest.json',domain);
 url.searchParams.set('q',clean);
 url.searchParams.set('resources[type]','product,collection');
 url.searchParams.set('resources[limit]','10');
 url.searchParams.set('resources[limit_scope]','each');
 const response=await fetch(url,{redirect:'error',headers:{'Accept':'application/json','User-Agent':'UIDBrandsStudio/1.0'},signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw Error('Store search unavailable ('+response.status+')');
 if(Number(response.headers.get('content-length')||0)>300000)throw Error('Store response too large');
 const body=await response.text();if(body.length>300000)throw Error('Store response too large');
 const jsonData=JSON.parse(body);
 const found=jsonData?.resources?.results||{};
 const results=[];
 for(const [key,type] of [['collections','collection'],['products','product']]){
  for(const item of (Array.isArray(found[key])?found[key]:[]).slice(0,10)){
   if(typeof item.title!=='string'||typeof item.url!=='string')continue;
   const resultUrl=new URL(item.url,domain);
   if(resultUrl.origin!==domain||!['/collections/','/products/'].some(prefix=>resultUrl.pathname.startsWith(prefix)))continue;
   if((type==='collection'&&!resultUrl.pathname.startsWith('/collections/'))||(type==='product'&&!resultUrl.pathname.startsWith('/products/')))continue;
   results.push({type,title:item.title.slice(0,180),url:resultUrl.origin+resultUrl.pathname});
  }
 }
 const dedup=[...new Map(results.map(x=>[x.url,x])).values()];
 if(searchCache.size>100)searchCache.delete(searchCache.keys().next().value);
 searchCache.set(cacheKey,{expires:Date.now()+180000,results:dedup});
 return dedup;
}
function cleanTask(input){
 if(!input||typeof input!=='object')throw Error('Task payload required');
 const v={};
 for(const f of taskFields)v[f]=typeof input[f]==='string'?input[f].trim():'';
 if(!v.title||v.title.length>180||v.brief.length>12000||v.content.length>50000||v.feedback.length>20000||v.source_url.length>2000)throw Error('Invalid task text length');
 if(!['PawfectHouse','GiftSoul','SoulPrise'].includes(v.brand)||!['Onepage','LDP','Scale Store Brand','UGC'].includes(v.workflow)||!['Draft','In progress','In review','Approved'].includes(v.status))throw Error('Invalid workflow, brand or status');
 if(v.source_url.length>2000)throw Error('Source is too long');
 if(v.source_url.includes('://')){
  let parsed;try{parsed=new URL(v.source_url);}catch{throw Error('Invalid source URL');}
  if(parsed.protocol!=='https:'||parsed.username||parsed.password)throw Error('Source URL must be HTTPS without credentials');
 }
 return v;
}
createServer(async(req,res)=>{
  const path = new URL(req.url||'/', 'http://localhost').pathname;
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method==='GET'&&(path==='/'||path==='/index.html')){
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' https://cdn.shopify.com; connect-src 'self'; img-src 'self' data: blob:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"});return res.end(webApp);
  }
  if(req.method==='GET'&&path==='/api/onepage/policy') {
    // One canonical runtime policy lives at the existing UID Brands gateway.
    // This studio endpoint only proxies a bounded public manifest; no secrets or task data forwarded.
    try {
      const response=await fetch('https://uid-brands-gateway-preview.onrender.com/api/onepage-ui-template/2026-10-11.v3/manifest.json',{
        method:'GET',redirect:'error',headers:{'Accept':'application/json'},signal:AbortSignal.timeout(10000)
      });
      if(!response.ok)return json(res,502,{error:'Shared Onepage gateway unavailable',upstream_status:response.status});
      if(Number(response.headers.get('content-length')||0)>250000)return json(res,502,{error:'Shared contract exceeds size limit'});
      const body=await response.text();
      if(body.length>250000)return json(res,502,{error:'Shared contract exceeds size limit'});
      const manifest=JSON.parse(body);
      const qc=manifest?.production_qc_contract;
      if(!qc||typeof qc.schema_version!=='string'||qc.scope!=='onepage-system'||!qc.image_gates||!qc.content_choice)
        return json(res,502,{error:'Shared Onepage contract missing or incompatible'});
      return json(res,200,{source:'uid-brands-gateway-preview',version:qc.schema_version,contract:qc});
    }catch{return json(res,502,{error:'Shared Onepage policy currently unavailable'});}
  }

  if(req.method==='GET'&&path==='/api/onepage/template-source'){
    // Exact versioned, publicly published UID Brands HTML/CSS; do not reconstruct or let callers supply templates.
    const origin='https://uid-brands-gateway-preview.onrender.com/api/onepage-ui-template/2026-10-11.v3/';
    const items=[['manifest.json',500000],['template.html',2500000],['styles.css',1600000]];
    try{
      const values=await Promise.all(items.map(async([name,limit])=>{
        const response=await fetch(origin+name,{redirect:'error',headers:{Accept:name.endsWith('json')?'application/json':'text/plain'},signal:AbortSignal.timeout(14000)});
        if(!response.ok)throw Error('Canonical '+name+' unavailable ('+response.status+')');
        if(Number(response.headers.get('content-length')||0)>limit)throw Error('Canonical '+name+' exceeds approved limit');
        const body=await response.text();
        if(body.length>limit)throw Error('Canonical '+name+' exceeds limit');
        return body;
      }));
      const manifest=JSON.parse(values[0]),html=values[1],css=values[2];
      if(!Array.isArray(manifest.asset_slots)||!Array.isArray(manifest.text_slots)||!html.includes('{{')||manifest.version!=='2026-10-11.v3')throw Error('Canonical template contract incompatible');
      if(createHash('sha256').update(html).digest('hex')!==manifest.sha256?.html||
        createHash('sha256').update(css).digest('hex')!==manifest.sha256?.css)throw Error('Canonical Onepage template hash mismatch');
      return json(res,200,{version:manifest.version,html,css,asset_slots:manifest.asset_slots,text_slots:manifest.text_slots,
        sha256:manifest.sha256,source:'UID Brands Gateway immutable template'});
    }catch(e){return json(res,502,{error:'Canonical Onepage template unavailable: '+String(e.message).slice(0,170)});}
  }
  if(req.method==='GET'&&path==='/api/status')return json(res,200,{app:'UID Brands Studio',version:'0.3',aiConfigured:aiEnabled,taskAiEnabled,cloudConfigured:cloudEnabled,mode:cloudEnabled?'authenticated-cloud':'local-workspace'});

  if(path==='/api/hybrid-sync'&&req.method==='POST'){
    if(!cloudEnabled)return json(res,503,{error:'Cloud sync unavailable'});
    try{
      const input=await readBody(req);
      const handoff=String(input?.handoff_token||'');
      const content=String(input?.content||'').trim();
      if(!/^[A-Za-z0-9_-]{43}$/.test(handoff)||content.length<12||content.length>50000)return json(res,422,{error:'Valid handoff token and bounded content required'});
      clearExpiredHandoffs();
      const key=handoffHash(handoff),cap=handoffTokens.get(key);
      if(!cap||cap.busy||cap.expires<Date.now())return json(res,403,{error:'Handoff expired, already used, or invalid. Generate a fresh handoff in Studio.'});
      cap.busy=true;
      try{
        const owner=await member(cap.token);
        if(!owner||owner.id!==cap.owner||!['admin','contributor'].includes(owner.role))throw Error('Owner session no longer authorized');
        const tr=await sb('/rest/v1/studio_tasks?id=eq.'+cap.task+'&select=id,owner_id&limit=1',{token:cap.token});
        if(!tr.ok||tr.data?.[0]?.owner_id!==cap.owner)throw Error('Task is unavailable');
        const prior=await sb('/rest/v1/studio_deliverables?task_id=eq.'+cap.task+'&select=materials,evidence&limit=1',{token:cap.token});
        if(!prior.ok)throw Error('Could not retrieve existing work');
        const previous=prior.data?.[0]||{};
        const result=await sb('/rest/v1/studio_deliverables?on_conflict=task_id',{
          method:'POST',token:cap.token,prefer:'resolution=merge-duplicates,return=representation',
          body:{task_id:cap.task,owner_id:cap.owner,source:'manual_chatgpt',content,
            materials:previous.materials||[],evidence:previous.evidence||[],qa:{},updated_at:new Date().toISOString()}
        });
        if(!result.ok)throw Error('Sync database operation failed');
        handoffTokens.delete(key);
        return json(res,200,{synced:true,task_id:cap.task,updated_at:result.data?.[0]?.updated_at||new Date().toISOString(),status:'review_required',note:'Text received; verify materials and QA in Studio. No publishing.'});
      }catch(e){cap.busy=false;return json(res,409,{error:String(e.message||'Sync could not be confirmed').slice(0,180)});}
    }catch(e){return failure(res,e?.message||'Invalid handoff');}
  }
  if(path.startsWith('/api/auth/')||path==='/api/tasks'||path.startsWith('/api/tasks/')||path==='/api/catalog/search'||path==='/api/execution/modes'){
    if(!cloudEnabled)return json(res,503,{error:'Cloud auth is not configured'});
    try {
      if(path==='/api/auth/signup'&&req.method==='POST'){
        const data=await readBody(req);
        if(!companyEmail(data?.email)||typeof data?.password!=='string'||data.password.length<12||data.password.length>200)
          return json(res,422,{error:'Use a @happyuid.com email and a password of at least 12 characters'});
        let enabled=false;
        try{enabled=await companySignupSettings();}catch{}
        if(!enabled)return json(res,503,{error:'Company signup is unavailable until Supabase email confirmation is enabled and verified'});
        const signup=await sb('/auth/v1/signup',{method:'POST',body:{email:data.email.trim().toLowerCase(),password:data.password}});
        if(!signup.ok){
          // No account enumeration. Keep signup/confirm messaging generic.
          if(signup.status===429)return json(res,429,{error:'Too many requests. Try again later.'});
          return json(res,422,{error:'Signup could not be completed. Check password policy or contact your administrator.'});
        }
        return json(res,202,{message:'If registration is available, please check your @happyuid.com inbox for a confirmation email, then sign in.',requiresConfirmation:true});
      }
      if(path==='/api/auth/login'&&req.method==='POST'){
        const data=await readBody(req);
        if(typeof data?.email!=='string'||typeof data?.password!=='string'||data.email.length>254||data.password.length>200)return json(res,400,{error:'Valid email and password required'});
        const login=await sb('/auth/v1/token?grant_type=password',{method:'POST',body:{email:data.email,password:data.password}});
        if(!login.ok)return json(res,401,{error:'Invalid credentials or sign-in not available'});
        const team=await member(login.data.access_token);
        if(!team)return json(res,403,{error:'Account is not an active UID Brands team member'});
        return json(res,200,{access_token:login.data.access_token,refresh_token:login.data.refresh_token,expires_in:login.data.expires_in,user:team});
      }
      if(path==='/api/auth/refresh'&&req.method==='POST'){
        const data=await readBody(req);
        if(typeof data?.refresh_token!=='string'||data.refresh_token.length>3000)return json(res,400,{error:'Invalid refresh token'});
        const renewed=await sb('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:data.refresh_token}});
        if(!renewed.ok)return json(res,401,{error:'Session expired'});
        const team=await member(renewed.data.access_token);
        if(!team)return json(res,403,{error:'Team membership inactive'});
        return json(res,200,{access_token:renewed.data.access_token,refresh_token:renewed.data.refresh_token,expires_in:renewed.data.expires_in,user:team});
      }
      const token=authorized(req);
      if(!token)return json(res,401,{error:'Login required'});
      const team=await member(token);
      if(!team)return json(res,403,{error:'Team access denied'});
      if(path==='/api/auth/me'&&req.method==='GET')return json(res,200,{user:team});
      const writable=team.role==='admin'||team.role==='contributor';
      if(path==='/api/execution/modes'&&(req.method==='GET'||req.method==='PUT')){
        const readPreference=async()=>{
          const p=await sb('/rest/v1/studio_execution_preferences?user_id=eq.'+team.id+'&select=mode,updated_at&limit=1',{token});
          if(!p.ok)throw Error('Could not load execution mode');
          return p.data?.[0]?.mode||'hybrid_bridge';
        };
        if(req.method==='GET'){
          const mode=await readPreference();
          return json(res,200,{selectedMode:mode,modes:executionCatalog(),planGatewayApproved:PLAN_GATEWAY_APPROVED});
        }
        const body=await readBody(req);
        const mode=String(body?.mode||'');
        if(!EXECUTION_MODES.includes(mode))return json(res,422,{error:'Unsupported execution mode'});
        if(mode==='chatgpt_connect'&&!PLAN_GATEWAY_APPROVED)
          return json(res,409,{error:'ChatGPT Connect is awaiting OpenAI approval. Select Hybrid Bridge or API Auto instead.',mode:'chatgpt_connect'});
        if(!writable)return json(res,403,{error:'Read-only member'});
        const r=await sb('/rest/v1/studio_execution_preferences?on_conflict=user_id',{
          method:'POST',token,prefer:'resolution=merge-duplicates,return=representation',
          body:{user_id:team.id,mode,updated_at:new Date().toISOString()}
        });
        if(!r.ok)return json(res,502,{error:'Could not save execution mode'});
        return json(res,200,{selectedMode:mode,modes:executionCatalog(),persisted:true});
      }
      if(path==='/api/catalog/search'&&req.method==='GET'){
        const params=new URL(req.url,'http://localhost').searchParams;
        const brand=params.get('brand'), query=params.get('q');
        try {const results=await searchCatalog(brand,query);return json(res,200,{brand,query,results,method:'Shopify storefront predictive search',automatedAi:false});}
        catch(error){return json(res,502,{error:'Cannot search this storefront at the moment',detail:String(error.message).slice(0,150)});}
      }
      if(path==='/api/tasks'&&req.method==='GET'){
        const list=await sb('/rest/v1/studio_tasks?select=*&order=updated_at.desc&limit=200',{token});
        return json(res,list.ok?200:502,list.ok?{tasks:list.data}:{error:'Could not read tasks'});
      }
      if(path==='/api/tasks'&&req.method==='POST'){
        if(!writable)return json(res,403,{error:'Read-only member'});
        const data=cleanTask(await readBody(req));
        const id=randomUUID();
        const record={...data,id,owner_id:team.id,revision:1};
        const created=await sb('/rest/v1/studio_tasks',{method:'POST',token,body:record,prefer:'return=representation'});
        if(!created.ok)return json(res,502,{error:'Could not create task'});
        const item=created.data?.[0];
        const version=await sb('/rest/v1/studio_task_versions',{method:'POST',token,body:{task_id:id,owner_id:team.id,revision:1,snapshot:item},prefer:'return=minimal'});
        return json(res,201,{task:item,versionSaved:version.ok});
      }

      const attachmentsMatch=path.match(/^\/api\/tasks\/([0-9a-f-]{36})\/attachments(?:\/([0-9a-f-]{36}--[^/]+))?$/);
      if(attachmentsMatch){
        const taskId=attachmentsMatch[1],objectName=attachmentsMatch[2];
        const owner=await sb('/rest/v1/studio_tasks?id=eq.'+taskId+'&select=id,owner_id&limit=1',{token});
        if(!owner.ok)return json(res,502,{error:'Cannot verify task ownership'});
        if(owner.data?.[0]?.owner_id!==team.id)return json(res,404,{error:'Task not found'});
        if(!objectName && req.method==='GET'){
          try{return json(res,200,{attachments:await listAttachments(team.id,taskId,token)});}
          catch{return json(res,502,{error:'Could not load task attachments'});}
        }
        if(!objectName && req.method==='POST'){
          if(!writable)return json(res,403,{error:'Read-only member'});
          const original=new URL(req.url,'http://localhost').searchParams.get('name');
          let info;try{info=attachmentInfo(original);}catch(e){return json(res,422,{error:e.message});}
          if(req.headers['content-type']?.split(';')[0]!==info.mime)return json(res,415,{error:'File content type does not match extension'});
          const listed=await listAttachments(team.id,taskId,token);
          if(listed.length>=8)return json(res,422,{error:'Maximum 8 attachments per task'});
          const bytes=await readAttachment(req);
          if(!bytes)return json(res,413,{error:'File exceeds 8 MB'});
          if(!fileSignatureOK(bytes,info.ext))return json(res,422,{error:'File content does not match supported format'});
          const id=randomUUID()+'--'+info.safe,storagePath=attachmentFolder(team.id,taskId)+id;
          const upstream=await storageCall('object/'+ATTACH_BUCKET+'/'+storagePath,{method:'POST',token,body:bytes,mime:info.mime});
          if(!upstream.ok)return json(res,502,{error:'Private attachment upload failed',upstream_status:upstream.status});
          return json(res,201,{attachment:{id,name:info.safe,size:bytes.length,mime:info.mime}});
        }
        if(objectName && ['GET','DELETE'].includes(req.method)){
          // Only owner-scoped, listed objects may be read or deleted.
          const listed=await listAttachments(team.id,taskId,token);
          if(!listed.some(f=>f.id===objectName))return json(res,404,{error:'Attachment not found'});
          if(req.method==='DELETE'&&!writable)return json(res,403,{error:'Read-only member'});
          const response=await storageCall('object/'+ATTACH_BUCKET+'/'+attachmentFolder(team.id,taskId)+encodeURIComponent(objectName),{method:req.method,token});
          if(!response.ok)return json(res,502,{error:'Attachment storage operation failed'});
          if(req.method==='DELETE')return json(res,200,{deleted:true});
          const buffer=Buffer.from(await response.arrayBuffer());
          if(buffer.byteLength>ATTACH_MAX_SIZE)return json(res,502,{error:'Attachment exceeds permitted size'});
          const ext=objectName.split('.').at(-1).toLowerCase(),mime=ATTACH_EXT[ext]||'application/octet-stream';
          res.writeHead(200,{'Content-Type':mime,'Content-Length':buffer.length,'Content-Disposition':'attachment; filename="'+objectName.replace(/^[0-9a-f-]{36}--/,'').replace(/[^\x20-\x7E]/g,'_').replace(/"/g,'_')+'"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
          return res.end(buffer);
        }
        return json(res,405,{error:'Unsupported attachment operation'});
      }


      const handoffMatch=path.match(/^\/api\/tasks\/([0-9a-f-]{36})\/handoff$/);
      if(handoffMatch&&req.method==='POST'){
        if(!writable)return json(res,403,{error:'Read-only member'});
        const taskId=handoffMatch[1];
        const tr=await sb('/rest/v1/studio_tasks?id=eq.'+taskId+'&select=id,owner_id&limit=1',{token});
        if(!tr.ok)return json(res,502,{error:'Could not verify task'});
        if(tr.data?.[0]?.owner_id!==team.id)return json(res,404,{error:'Task not found'});
        clearExpiredHandoffs();
        // Reissuing a handoff for the same owner/task invalidates the older token.
        for(const [key,cap] of handoffTokens)if(cap.owner===team.id&&cap.task===taskId&&!cap.busy)handoffTokens.delete(key);
        if(handoffTokens.size>=150)return json(res,429,{error:'Handoff capacity reached; retry later'});
        let existing=0;for(const cap of handoffTokens.values())if(cap.owner===team.id)existing++;
        if(existing>=8)return json(res,429,{error:'Too many active handoffs. Let existing links expire.'});
        const handoff_token=randomBytes(32).toString('base64url');
        const expires=Date.now()+45*60*1000;
        handoffTokens.set(handoffHash(handoff_token),{task:taskId,owner:team.id,token,expires,busy:false});
        return json(res,201,{handoff_token,expires_at:new Date(expires).toISOString(),method:'UID Brands ChatGPT MCP sync',note:'One use. Treat this token as task-scoped write permission; never paste into public pages or research sources. Invalid after Studio restart.'});
      }

      const onepageBindingsMatch=path.match(/^\/api\/tasks\/([0-9a-f-]{36})\/onepage-bindings$/);
      if(onepageBindingsMatch){
        const taskId=onepageBindingsMatch[1];
        const tr=await sb('/rest/v1/studio_tasks?id=eq.'+taskId+'&select=id,owner_id,workflow&limit=1',{token});
        if(!tr.ok)return json(res,502,{error:'Could not verify task'});
        if(tr.data?.[0]?.owner_id!==team.id||tr.data[0].workflow!=='Onepage')return json(res,404,{error:'Onepage task not found'});
        const endpoint='/rest/v1/studio_onepage_asset_bindings';
        if(req.method==='GET'){
          const data=await sb(endpoint+'?task_id=eq.'+taskId+'&select=bindings,updated_at&limit=1',{token});
          return json(res,data.ok?200:502,data.ok?{bindings:data.data?.[0]?.bindings||{},updated_at:data.data?.[0]?.updated_at||null}:{error:'Could not load Onepage bindings'});
        }
        if(req.method==='PUT'){
          if(!writable)return json(res,403,{error:'Read-only user'});
          const input=await readBody(req);
          const bindings=input?.bindings;
          if(!bindings||typeof bindings!=='object'||Array.isArray(bindings)||Object.keys(bindings).length>80)
            return json(res,422,{error:'Invalid template asset mapping'});
          const manifestResponse=await fetch('https://uid-brands-gateway-preview.onrender.com/api/onepage-ui-template/2026-10-11.v3/manifest.json',{
            redirect:'error',headers:{Accept:'application/json'},signal:AbortSignal.timeout(10000)});
          if(!manifestResponse.ok)return json(res,502,{error:'Canonical template manifest unavailable'});
          const manifest=await manifestResponse.json();
          const allowed=new Set(Array.isArray(manifest?.asset_slots)?manifest.asset_slots:[]);
          if(!allowed.size||Object.keys(bindings).some(key=>!allowed.has(key)))
            return json(res,422,{error:'Binding contains an unknown canonical Onepage slot'});
          const files=await listAttachments(team.id,taskId,token);
          const verified=new Set(files.map(x=>x.id));
          if(Object.values(bindings).some(fileId=>typeof fileId!=='string'||(fileId&&!verified.has(fileId))))
            return json(res,422,{error:'All selected bindings must be real attachments in this task'});
          const updated=await sb(endpoint+'?on_conflict=task_id',{method:'POST',token,
            prefer:'resolution=merge-duplicates,return=representation',
            body:{task_id:taskId,owner_id:team.id,bindings,updated_at:new Date().toISOString()}});
          return json(res,updated.ok?200:502,updated.ok?{bindings:updated.data?.[0]?.bindings||{}}:{error:'Could not persist Onepage bindings'});
        }
        return json(res,405,{error:'Unsupported Onepage binding method'});
      }
      const sectionFeedbackMatch=path.match(/^\/api\/tasks\/([0-9a-f-]{36})\/section-feedback(?:\/([0-9a-f-]{36}))?$/);
      if(sectionFeedbackMatch){
        const taskId=sectionFeedbackMatch[1],feedbackId=sectionFeedbackMatch[2];
        const check=await sb('/rest/v1/studio_tasks?id=eq.'+taskId+'&select=id,owner_id&limit=1',{token});
        if(!check.ok)return json(res,502,{error:'Cannot verify task'});
        if(check.data?.[0]?.owner_id!==team.id)return json(res,404,{error:'Task not found'});
        const endpoint='/rest/v1/studio_section_feedback';
        if(req.method==='GET'&&!feedbackId){
          const data=await sb(endpoint+'?task_id=eq.'+taskId+'&select=id,section_id,group_name,note,status,created_at&order=created_at.asc&limit=150',{token});
          return json(res,data.ok?200:502,data.ok?{feedback:data.data}:{error:'Feedback unavailable'});
        }
        if(req.method==='POST'&&!feedbackId){
          if(!writable)return json(res,403,{error:'Read-only member'});
          const input=await readBody(req);
          const section_id=String(input.section_id||''),group_name=String(input.group_name||'General').trim(),note=String(input.note||'').trim();
          if(!/^[a-z0-9_-]{2,40}$/.test(section_id)||group_name.length<1||group_name.length>80||note.length<1||note.length>2000)return json(res,422,{error:'Invalid feedback section, group or text'});
          const result=await sb(endpoint,{method:'POST',token,prefer:'return=representation',body:{task_id:taskId,owner_id:team.id,section_id,group_name,note,status:'open'}});
          return json(res,result.ok?201:502,result.ok?{feedback:result.data[0]}:{error:'Feedback could not be saved'});
        }
        if(req.method==='PATCH'&&feedbackId){
          if(!writable)return json(res,403,{error:'Read-only member'});
          const input=await readBody(req);
          if(!['open','resolved'].includes(input.status))return json(res,422,{error:'Invalid review status'});
          const response=await sb(endpoint+'?id=eq.'+feedbackId+'&task_id=eq.'+taskId,{method:'PATCH',token,prefer:'return=representation',body:{status:input.status}});
          if(!response.ok)return json(res,502,{error:'Feedback could not be updated'});
          if(!response.data?.length)return json(res,404,{error:'Feedback not found'});
          return json(res,200,{feedback:response.data[0]});
        }
        return json(res,405,{error:'Unsupported section feedback operation'});
      }
      // Manual Hybrid export: authenticated, owner-scoped and free of paid AI execution.
      const hybridExportMatch=path.match(/^\/api\/tasks\/([0-9a-f-]{36})\/hybrid-export$/);
      if(hybridExportMatch&&req.method==='GET'){
        const taskId=hybridExportMatch[1];
        const own=await sb('/rest/v1/studio_tasks?id=eq.'+taskId+'&select=id,owner_id,title,brand,workflow,source_url,brief&limit=1',{token});
        if(!own.ok)return json(res,502,{error:'Could not verify task for export'});
        const task=own.data?.[0];
        if(!task||task.owner_id!==team.id)return json(res,404,{error:'Task not found'});
        const result=await sb('/rest/v1/studio_deliverables?task_id=eq.'+taskId+
          '&select=content,materials,evidence,qa,source,updated_at&limit=1',{token});
        if(!result.ok)return json(res,502,{error:'Could not retrieve Hybrid deliverable'});
        const deliverable=result.data?.[0]||{};
        const materialSlots=Array.isArray(deliverable.materials)?deliverable.materials:[];
        const available=await listAttachments(team.id,taskId,token);
        const byId=new Map(available.map(x=>[x.id,x]));
        const entries=[
          {name:'content.md',bytes:Buffer.from(String(deliverable.content||''),'utf8')},
          {name:'qa.json',bytes:Buffer.from(JSON.stringify({status:'human_review_required',checks:deliverable.qa||{}},null,2),'utf8')}
        ];
        const warnings=[],included=[];
        for(const item of materialSlots.slice(0,24)){
          const slot=String(item?.slot||''),fileId=String(item?.file_id||'');
          if(!/^[a-z0-9_-]{2,36}$/i.test(slot)){warnings.push('Unsafe material slot ignored');continue;}
          if(!fileId){warnings.push('Unmapped slot: '+slot);continue;}
          const file=byId.get(fileId);
          if(!file){warnings.push('Missing private material for slot '+slot);continue;}
          const extension=file.name.split('.').at(-1).toLowerCase();
          if(!/^(png|jpg|jpeg|webp|gif|pdf|txt|md|csv|docx|xlsx)$/.test(extension)){
            warnings.push('Unsupported file type for '+slot);continue;
          }
          const response=await storageCall('object/'+ATTACH_BUCKET+'/'+attachmentFolder(team.id,taskId)+encodeURIComponent(file.id),{method:'GET',token});
          if(!response.ok)return json(res,502,{error:'Could not read mapped material: '+slot});
          if(Number(response.headers.get('content-length')||0)>ATTACH_MAX_SIZE)return json(res,422,{error:'Mapped material exceeds ZIP limit'});
          const bytes=Buffer.from(await response.arrayBuffer());
          if(bytes.length>ATTACH_MAX_SIZE)return json(res,422,{error:'Mapped material exceeds ZIP limit'});
          const name='materials/'+slot+'.'+extension;
          entries.push({name,bytes});included.push({slot,name,original_name:file.name});
        }
        const manifest={
          schema:'uid-studio-hybrid-draft-v1',exported_at:new Date().toISOString(),
          task:{id:task.id,title:task.title,brand:task.brand,workflow:task.workflow,source_url:task.source_url},
          source:deliverable.source||'manual_chatgpt',materials:included,
          evidence:deliverable.evidence||[],warnings,
          approval:'NOT APPROVED: Verify PDP fidelity, content, actual material dimensions and desktop/mobile rendering. No publishing.'
        };
        entries.unshift({name:'manifest.json',bytes:Buffer.from(JSON.stringify(manifest,null,2),'utf8')});
        let zip;
        try{zip=packZip(entries);}catch(e){return json(res,422,{error:'Cannot package Hybrid draft: '+String(e.message).slice(0,150)});}
        res.writeHead(200,{'Content-Type':'application/zip','Content-Length':zip.length,
          'Content-Disposition':'attachment; filename="uid-studio-'+taskId+'-hybrid-draft.zip"',
          'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
        return res.end(zip);
      }
      const pipelineMatch=path.match(/^\/api\/tasks\/([0-9a-f-]{36})\/pipeline(?:\/(start|next|export|history|preview))?$/);
      if(pipelineMatch){
        const taskId=pipelineMatch[1],action=pipelineMatch[2]||'current';
        const ownerResult=await sb('/rest/v1/studio_tasks?id=eq.'+taskId+'&select=id,owner_id,brand,workflow,source_url,title,brief,revision&limit=1',{token});
        if(!ownerResult.ok)return json(res,502,{error:'Cannot verify pipeline task'});
        const task=ownerResult.data?.[0];
        if(!task||task.owner_id!==team.id)return json(res,404,{error:'Task not found'});
        const getPipeline=async()=>{
          const p=await sb('/rest/v1/studio_pipeline_runs?task_id=eq.'+taskId+'&select=*&limit=1',{token});
          if(!p.ok)throw Error('Cannot load pipeline');
          return p.data?.[0]||null;
        };
        const savePipeline=async(next,prior)=>{
          const payload={task_id:taskId,owner_id:team.id,run_id:next.run_id,stage:next.stage,status:next.status,
            state:next.state,revision:next.revision,updated_at:next.updated_at};
          let out;
          if(prior){
            // Optimistic revision gate avoids an old operation overwriting a newer step.
            out=await sb('/rest/v1/studio_pipeline_runs?task_id=eq.'+taskId+'&run_id=eq.'+prior.run_id+'&revision=eq.'+prior.revision,{
              method:'PATCH',token,prefer:'return=representation',body:payload});
          }else{
            out=await sb('/rest/v1/studio_pipeline_runs',{method:'POST',token,prefer:'return=representation',body:payload});
          }
          if(!out.ok||!out.data?.length)throw Error('Pipeline changed concurrently; refresh before retrying');
          const run=out.data[0];
          const history=await sb('/rest/v1/studio_pipeline_snapshots',{method:'POST',token,
            body:{task_id:taskId,owner_id:team.id,run_id:next.run_id,revision:next.revision,snapshot:{stage:next.stage,status:next.status,state:next.state,updated_at:next.updated_at}},
            prefer:'return=minimal'});
          return {run,versionSaved:history.ok};
        };
        if(action==='current'&&req.method==='GET'){
          const run=await getPipeline();
          return json(res,200,{run,configured:taskAiEnabled,stages:PIPELINE_STAGES});
        }
        if(action==='history'&&req.method==='GET'){
          const list=await sb('/rest/v1/studio_pipeline_snapshots?task_id=eq.'+taskId+'&select=run_id,revision,created_at,snapshot&order=created_at.desc&limit=60',{token});
          return json(res,list.ok?200:502,list.ok?{history:list.data}:{error:'Cannot load pipeline history'});
        }
        if(action==='export'&&req.method==='GET'){
          const run=await getPipeline();
          if(!run?.state?.export||run.stage!=='complete')return json(res,409,{error:'Export stage has not completed'});
          const pack=pipelineExport({task,run});
          if(new URL(req.url,'http://localhost').searchParams.get('format')==='zip'){
            const entries=[
              {name:'manifest.json',bytes:Buffer.from(JSON.stringify(pack,null,2),'utf8')},
              {name:'content.md',bytes:Buffer.from(String(run.state?.content||''),'utf8')},
              {name:'vision-qa.json',bytes:Buffer.from(JSON.stringify(run.state?.vision||{status:'not_available'},null,2),'utf8')}
            ];
            const files=[...(run.state?.materials||[]).map(x=>({id:x.file_id,name:'materials/'+x.slot+'.jpg'})),
              ...Object.entries(run.state?.overalls||{}).map(([view,id])=>({id,name:'overall-'+view+'.jpg'}))];
            for(const file of files){
              if(!/^[0-9a-f-]{36}--[a-z0-9_.-]+$/.test(file.id))return json(res,409,{error:'Invalid private material reference in pipeline'});
              const bytes=await storageCall('object/'+ATTACH_BUCKET+'/'+attachmentFolder(team.id,taskId)+encodeURIComponent(file.id),{method:'GET',token});
              if(!bytes.ok)return json(res,502,{error:'Could not read asset for export'});
              if(Number(bytes.headers.get('content-length')||0)>8*1024*1024)return json(res,502,{error:'Asset exceeds export file size limit'});
              const b=Buffer.from(await bytes.arrayBuffer());
              if(b.length>8*1024*1024)return json(res,502,{error:'Asset exceeds export file size limit'});
              entries.push({name:file.name,bytes:b});
            }
            let zip;try{zip=packZip(entries);}catch(e){return json(res,422,{error:e.message});}
            res.writeHead(200,{'Content-Type':'application/zip','Content-Length':zip.length,
              'Content-Disposition':'attachment; filename="uid-studio-'+taskId+'-draft.zip"',
              'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
            return res.end(zip);
          }
          const data=Buffer.from(JSON.stringify(pack,null,2),'utf8');
          res.writeHead(200,{'Content-Type':'application/json; charset=utf-8',
            'Content-Disposition':'attachment; filename="uid-studio-'+taskId+'-pipeline.json"',
            'Content-Length':data.length,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
          return res.end(data);
        }

        if(action==='preview'&&req.method==='POST'){
          if(!writable)return json(res,403,{error:'Read-only member'});
          if(stageLocks.has(taskId))return json(res,409,{error:'Cannot upload preview while a stage is executing'});
          const run=await getPipeline();
          if(!run||run.stage!=='vision_qa')return json(res,409,{error:'Preview capture is only available at Vision QA stage'});
          const view=new URL(req.url,'http://localhost').searchParams.get('view');
          if(!['desktop','mobile'].includes(view))return json(res,422,{error:'Expected desktop or mobile preview'});
          if(req.headers['content-type']?.split(';')[0]!=='image/jpeg')return json(res,415,{error:'JPEG preview required'});
          const bytes=await readAttachment(req);
          if(!bytes||bytes.length<1000||!fileSignatureOK(bytes,'jpg'))return json(res,422,{error:'Invalid or oversized JPEG preview'});
          stageLocks.add(taskId);
          try{
            const id=randomUUID()+'--overall-'+view+'.jpg';
            const path=attachmentFolder(team.id,taskId)+id;
            const result=await storageCall('object/'+ATTACH_BUCKET+'/'+path,{method:'POST',token,body:bytes,mime:'image/jpeg'});
            if(!result.ok)throw Error('Could not persist structural screenshot');
            const state={...run.state,overalls:{...(run.state?.overalls||{}),[view]:id}};
            const updated=recordStage(run,{stage:run.stage,state,detail:'Structural '+view+' composite screenshot saved for Vision QA'});
            const saved=await savePipeline(updated,run);
            return json(res,201,{...saved,view,note:'A composited layout preview, NOT a rendered live storefront'});
          }finally{stageLocks.delete(taskId);}
        }
        if(action==='start'&&req.method==='POST'){
          if(!writable)return json(res,403,{error:'Read-only user'});
          if(stageLocks.has(taskId))return json(res,409,{error:'Another pipeline step is already processing'});
          const existing=await getPipeline();
          const requested=await readBody(req);
          if(existing&&existing.stage!=='complete')return json(res,409,{error:'An unfinished pipeline exists. Resume it before starting another run.'});
          if(existing&&requested?.reset_completed!==true)return json(res,409,{error:'This pipeline has completed. Explicitly confirm a new revision run.'});
          let slots;try{slots=validateSelectedSlots(requested?.slots);}catch(e){return json(res,422,{error:e.message});}
          const fresh=freshPipeline({runId:randomUUID(),slots});
          if(existing)fresh.revision=existing.revision+1; // CAS revision, run ID rotates; old immutable snapshots remain
          const saved=await savePipeline(fresh,existing);
          return json(res,201,{...saved,configured:taskAiEnabled});
        }
        if(action==='next'&&req.method==='POST'){
          if(!writable)return json(res,403,{error:'Read-only user'});
          if(stageLocks.has(taskId))return json(res,409,{error:'This task is already executing a stage; do not retry a paid request'});
          const data=await readBody(req);
          if(data?.acknowledge_metered_api!==true)return json(res,422,{error:'Explicit confirmation of potential API charges required for every requested stage'});
          const pref=await sb('/rest/v1/studio_execution_preferences?user_id=eq.'+team.id+'&select=mode&limit=1',{token});
          if(!pref.ok||pref.data?.[0]?.mode!=='api_auto')return json(res,409,{error:'Select API Auto first'});
          stageLocks.add(taskId);
          let heldApiLock=false;
          try {
            const prior=await getPipeline();
            if(!prior)return json(res,404,{error:'Start a pipeline first'});
            if(prior.stage==='complete')return json(res,409,{error:'Pipeline already completed'});
            const chargeable=prior.stage==='content'||prior.stage==='vision_qa'||
              (prior.stage==='materials'&&(prior.state?.next_material||0)<(prior.state?.selected_slots||[]).length);
            if(chargeable){
              if(!taskAiEnabled)throw Error('OpenAI API executor is not enabled. No paid call attempted');
              if(apiUserLocks.has(team.id))throw Error('A paid task request is already executing for this user');
              apiUserLocks.add(team.id);heldApiLock=true;
              await reserveApiQuota(team.id,token,{image:prior.stage==='materials'});
            }
            let state=structuredClone(prior.state||{}),next=prior.stage,detail='',paid=false;
            const existingResearch=await sb('/rest/v1/studio_research_packs?task_id=eq.'+taskId+'&select=snapshot&limit=1',{token});
            if(!existingResearch.ok)throw Error('Cannot load research');
            const snapshot=existingResearch.data?.[0]?.snapshot;
            if(prior.stage==='research'){
              if(!String(task.source_url||'').trim())throw Error('Provide a real collection/PDP URL before research');
              const research=snapshot?.task_source===task.source_url&&snapshot?.product_count>0?snapshot:await scanPublicSource(task.brand,task.source_url);
              if(!research.product_count)throw Error('No actual product data found; research blocked');
              state.research={task_source:research.task_source,scanned_at:research.scanned_at,
                product_count:research.product_count,warnings:research.warnings,
                products:research.products.slice(0,16)};
              const saved=await sb('/rest/v1/studio_research_packs?on_conflict=task_id',{method:'POST',token,prefer:'resolution=merge-duplicates,return=representation',
                body:{task_id:taskId,owner_id:team.id,source_url:research.task_source,snapshot:research,updated_at:new Date().toISOString()}});
              if(!saved.ok)throw Error('Research captured but database save failed');
              next=nextPipelineStage(prior.stage);detail='Shopify product data captured; external customer reviews still unverified';
            }else if(prior.stage==='creative_dna'){
              state.dna=await resolveGatewayDNA({task,research:state.research});
              next=nextPipelineStage(prior.stage);
              detail='Gateway tools resolved: '+state.dna.tools.map(x=>x.name).join(', ')+'; policy gates retained';
            }else if(prior.stage==='content'){
              if(!taskAiEnabled)throw Error('API executor not configured. No paid call attempted');
              paid=true;
              const priorDeliverable=await sb('/rest/v1/studio_deliverables?task_id=eq.'+taskId+'&select=evidence,materials&limit=1',{token});
              if(!priorDeliverable.ok)throw Error('Cannot load existing evidence');
              const original=priorDeliverable.data?.[0]||{};
              const output=await textStage({task,research:state.research,dna:state.dna,evidence:original.evidence||[]});
              state.content=output.content;state.plan=output.plan;
              state.calls=(state.calls||0)+1;
              state.usage=[...(state.usage||[]),{stage:'content',model:output.model,usage:output.usage}].slice(-20);
              const d=await sb('/rest/v1/studio_deliverables?on_conflict=task_id',{
                method:'POST',token,prefer:'resolution=merge-duplicates,return=representation',
                body:{task_id:taskId,owner_id:team.id,source:'api_executor',content:output.content,
                  materials:original.materials||[],evidence:original.evidence||[],qa:{},updated_at:new Date().toISOString()}});
              if(!d.ok)throw Error('Content generated but could not be saved; do not rerun until usage is checked');
              next=nextPipelineStage(prior.stage);detail='AI content and material prompt plan saved';
            }else if(prior.stage==='materials'){
              if(!taskAiEnabled)throw Error('API executor not configured. No paid call attempted');
              if(!state.research?.products?.length)throw Error('Verified PDP product reference missing');
              const slots=state.selected_slots||[];
              if((state.next_material||0)>=slots.length){next=nextPipelineStage(prior.stage);detail='Material slots completed';}
              else{
                const index=state.next_material||0,slot=slots[index];
                // Vary real collection products where available to avoid repeated artwork; use actual PDPs only.
                const product=state.research.products[index%state.research.products.length];
                paid=true;
                const result=await generateProductMaterial({slot,plan:state.plan,product});
                const id=randomUUID()+'--ai-'+slot+'.jpg',storagePath=attachmentFolder(team.id,taskId)+id;
                const upstream=await storageCall('object/'+ATTACH_BUCKET+'/'+storagePath,{
                  method:'POST',token,body:result.bytes,mime:'image/jpeg'});
                if(!upstream.ok)throw Error('Image generated but private asset upload failed. Check usage before regenerating');
                const mapped={slot,file_id:id,reference:result.reference,product_source:product.url,
                  model:result.model,generated_at:new Date().toISOString(),status:'generated_draft_unapproved'};
                state.materials=[...(state.materials||[]),mapped];
                state.next_material=index+1;state.calls=(state.calls||0)+1;
                state.usage=[...(state.usage||[]),{stage:'materials',slot,model:result.model,usage:result.usage}].slice(-20);
                // Persist mapping in existing unified deliverable without overwriting content or evidence.
                const prev=await sb('/rest/v1/studio_deliverables?task_id=eq.'+taskId+'&select=content,evidence,materials&limit=1',{token});
                if(!prev.ok)throw Error('Image saved but deliverable mapping failed to load');
                const d=prev.data?.[0]||{};
                const others=(Array.isArray(d.materials)?d.materials:[]).filter(x=>x.slot!==slot);
                const updated=await sb('/rest/v1/studio_deliverables?on_conflict=task_id',{
                  method:'POST',token,prefer:'resolution=merge-duplicates,return=representation',
                  body:{task_id:taskId,owner_id:team.id,source:'api_executor',content:d.content||state.content,
                    evidence:d.evidence||[],materials:[...others,{slot,file_id:id,notes:'AI-generated draft; physical product QA required'}],qa:{},updated_at:new Date().toISOString()}});
                if(!updated.ok)throw Error('Asset saved but deliverable mapping failed; inspect task files before retry');
                if(state.next_material>=slots.length)next=nextPipelineStage(prior.stage);
                detail='AI reference-guided '+slot+' saved as private draft ('+state.next_material+'/'+slots.length+')';
              }
            }else if(prior.stage==='vision_qa'){
              if(!taskAiEnabled)throw Error('API executor not configured. No paid call attempted');
              const visual=state.materials?.slice(0,2)||[];
              if(!visual.length)throw Error('No generated image assets for Vision QA');
              if(!state.overalls?.desktop||!state.overalls?.mobile)throw Error('Both structural desktop and mobile screenshots must be captured before Vision QA');
              const images=[];
              for(const view of ['desktop','mobile']){
                const id=state.overalls[view];
                const response=await storageCall('object/'+ATTACH_BUCKET+'/'+attachmentFolder(team.id,taskId)+encodeURIComponent(id),{method:'GET',token});
                if(!response.ok)throw Error('Cannot access '+view+' overall preview');
                const bytes=Buffer.from(await response.arrayBuffer());
                if(bytes.length>6*1024*1024)throw Error(view+' preview exceeds 6MB');
                images.push({slot:'overall_'+view,mime:'image/jpeg',bytes});
              }
              for(const item of visual){
                const response=await storageCall('object/'+ATTACH_BUCKET+'/'+attachmentFolder(team.id,taskId)+encodeURIComponent(item.file_id),{method:'GET',token});
                if(!response.ok)throw Error('Cannot access generated material for QA');
                const bytes=Buffer.from(await response.arrayBuffer());
                if(bytes.length>6*1024*1024)throw Error('Visual QA asset exceeds 6MB');
                images.push({slot:item.slot,mime:'image/jpeg',bytes});
              }
              paid=true;const report=await visionReview({task,content:state.content,images});
              state.vision=report;state.calls=(state.calls||0)+1;
              state.usage=[...(state.usage||[]),{stage:'vision_qa',model:report.model,usage:report.usage}].slice(-20);
              // Never automatically mark human QC gates complete.
              next=nextPipelineStage(prior.stage);
              detail='AI inspected structural desktop/mobile composites and '+visual.length+' source images; live storefront and product fidelity still require human review';
            }else if(prior.stage==='export'){
              state.export={ready:true,generated_at:new Date().toISOString(),
                type:'application/json',note:'Export draft includes creative content and private asset IDs; it is NOT a public image ZIP or approved storefront render'};
              next='complete';detail='Versioned JSON handoff ready; human approval still required';
            }else return json(res,409,{error:'Unknown pipeline stage'});
            const final=recordStage(prior,{stage:next,status:next==='complete'?'needs_review':'ready',state,detail});
            const saved=await savePipeline(final,prior);
            return json(res,200,{...saved,detail,paid,readyForReview:final.stage==='complete'});
          }catch(error){
            // Fail closed, do not mark failed work as completed; preserve stage for explicit retry.
            const prior=await getPipeline();
            if(prior&&prior.stage!=='complete'){
              const blocked=recordStage(prior,{stage:prior.stage,status:'blocked',
                state:{...prior.state,warnings:[...(prior.state.warnings||[]),String(error.message||'Step failed').slice(0,280)].slice(-30)},
                detail:'Blocked: '+String(error.message||'Step failed')});
              try{await savePipeline(blocked,prior);}catch{}
            }
            return json(res,502,{error:String(error.message||'Pipeline stage failed').slice(0,290),
              status:'blocked',note:'Stage did not advance. Timed-out API calls may still be charged; inspect usage before retrying.'});
          }finally{stageLocks.delete(taskId);if(heldApiLock)apiUserLocks.delete(team.id);}
        }
        return json(res,405,{error:'Unsupported pipeline method'});
      }
      const hybridMatch=path.match(/^\/api\/tasks\/([0-9a-f-]{36})\/(deliverable|external-evidence|execute)$/);
      if(hybridMatch){
        const taskId=hybridMatch[1],action=hybridMatch[2];
        const tr=await sb('/rest/v1/studio_tasks?id=eq.'+taskId+'&select=id,owner_id,brand,workflow,title,brief,source_url,revision&limit=1',{token});
        if(!tr.ok)return json(res,502,{error:'Could not verify task'});
        const task=tr.data?.[0];
        if(!task||task.owner_id!==team.id)return json(res,404,{error:'Task not found'});
        const readDeliverable=async()=>{
          const d=await sb('/rest/v1/studio_deliverables?task_id=eq.'+taskId+'&select=*&limit=1',{token});
          if(!d.ok)throw Error('Could not load deliverable');
          return d.data?.[0]||null;
        };
        const writeDeliverable=async payload=>{
          const previous=await readDeliverable();
          const clean=cleanDeliverable(payload);
          // Limit references to actual task attachments (no fabricated file IDs).
          const files=await listAttachments(team.id,taskId,token);
          if(clean.materials.some(x=>x.file_id&&!files.some(f=>f.id===x.file_id)))throw Error('A material points to a missing task attachment');
          const p={...clean,task_id:taskId,owner_id:team.id,updated_at:new Date().toISOString()};
          const saved=await sb('/rest/v1/studio_deliverables?on_conflict=task_id',{method:'POST',token,body:p,prefer:'resolution=merge-duplicates,return=representation'});
          if(!saved.ok)throw Error('Could not save deliverable');
          return {deliverable:saved.data?.[0]||p,previous};
        };
        if(action==='deliverable'&&req.method==='GET'){
          const d=await readDeliverable();
          return json(res,200,{deliverable:d,quality:qaSummary(d),aiExecutionAvailable:taskAiEnabled});
        }
        if(action==='deliverable'&&req.method==='PUT'){
          if(!writable)return json(res,403,{error:'Read-only member'});
          const input=await readBody(req);
          // AI execution flag is server-owned, never client-controlled.
          const output=await writeDeliverable({...input,source:'manual_chatgpt'});
          return json(res,200,{deliverable:output.deliverable,quality:qaSummary(output.deliverable)});
        }
        if(action==='external-evidence'&&req.method==='POST'){
          if(!writable)return json(res,403,{error:'Read-only member'});
          const input=await readBody(req);
          const evidence=await inspectPublicEvidence(input?.url);
          const prev=await readDeliverable();
          const existing=Array.isArray(prev?.evidence)?prev.evidence:[];
          const merged=[...existing.filter(x=>x.url!==evidence.url),evidence].slice(-16);
          const out=await writeDeliverable({content:prev?.content||'',materials:prev?.materials||[],evidence:merged,qa:prev?.qa||{},source:'manual_chatgpt'});
          return json(res,200,{evidence,deliverable:out.deliverable,quality:qaSummary(out.deliverable)});
        }
        if(action==='execute'&&req.method==='POST'){
          return json(res,410,{error:'Legacy single-step AI endpoint retired. Use the versioned pipeline under API Auto; no paid request was started.'});
        }
        return json(res,405,{error:'Unsupported deliverable method'});
      }
      const researchMatch=path.match(/^\/api\/tasks\/([0-9a-f-]{36})\/research$/);
      if(researchMatch&&(req.method==='GET'||req.method==='POST')){
        const taskId=researchMatch[1];
        const tasksResponse=await sb('/rest/v1/studio_tasks?id=eq.'+taskId+'&select=id,owner_id,brand,workflow,source_url,title,brief&limit=1',{token});
        if(!tasksResponse.ok)return json(res,502,{error:'Unable to verify task ownership'});
        const task=tasksResponse.data?.[0];
        if(!task||task.owner_id!==team.id)return json(res,404,{error:'Task not found'});
        if(req.method==='GET'){
          const saved=await sb('/rest/v1/studio_research_packs?task_id=eq.'+taskId+'&select=task_id,snapshot,updated_at&limit=1',{token});
          return json(res,saved.ok?200:502,saved.ok?{research:saved.data?.[0]||null}:{error:'Cannot read research snapshot'});
        }
        if(!writable)return json(res,403,{error:'Read-only member'});
        if(!String(task.source_url||'').trim())return json(res,422,{error:'Task needs a direct product or collection URL before scanning'});
        try{
          const snapshot=await scanPublicSource(task.brand,task.source_url);
          const saved=await sb('/rest/v1/studio_research_packs?on_conflict=task_id',{method:'POST',token,
           body:{task_id:taskId,owner_id:team.id,source_url:snapshot.task_source,snapshot,updated_at:new Date().toISOString()},
           prefer:'resolution=merge-duplicates,return=representation'});
          if(!saved.ok)return json(res,502,{error:'Research collected but could not be saved securely'});
          return json(res,200,{research:saved.data?.[0]||{task_id:taskId,snapshot},autoAi:false});
        }catch(error){
          return json(res,422,{error:'Storefront research unavailable',detail:String(error.message||'Scan failed').slice(0,180)});
        }
      }
      const versionMatch=path.match(/^\/api\/tasks\/([0-9a-f-]{36})\/versions$/);
      if(versionMatch&&req.method==='GET'){
        const records=await sb('/rest/v1/studio_task_versions?task_id=eq.'+versionMatch[1]+'&select=revision,snapshot,created_at&order=revision.desc&limit=40',{token});
        return json(res,records.ok?200:502,records.ok?{versions:records.data}:{error:'Could not read version history'});
      }
      const match=path.match(/^\/api\/tasks\/([0-9a-f-]{36})$/);
      if(match){
        const id=match[1];
        if(req.method==='DELETE'){
          if(!writable)return json(res,403,{error:'Read-only member'});
          const current=await sb('/rest/v1/studio_tasks?id=eq.'+id+'&select=id,owner_id&limit=1',{token});
          if(!current.ok)return json(res,502,{error:'Could not verify task before deletion'});
          if(!current.data?.length||current.data[0].owner_id!==team.id)return json(res,404,{error:'Task not found'});
          // Remove private objects before the task row; RLS requires a valid owning task.
          const files=await listAttachments(team.id,id,token);
          for(const file of files){
            const removed=await storageCall('object/'+ATTACH_BUCKET+'/'+attachmentFolder(team.id,id)+encodeURIComponent(file.id),{method:'DELETE',token});
            if(!removed.ok)return json(res,502,{error:'Could not clean up task attachment before deletion'});
          }
          const deleted=await sb('/rest/v1/studio_tasks?id=eq.'+id,{method:'DELETE',token,prefer:'return=representation'});
          return json(res,deleted.ok?200:502,deleted.ok?{deleted:Array.isArray(deleted.data)&&deleted.data.length>0}:{error:'Could not delete task'});
        }
        if(req.method==='PATCH'){
          if(!writable)return json(res,403,{error:'Read-only member'});
          const input=await readBody(req);
          const prev=input?.revision;
          if(!Number.isSafeInteger(prev)||prev<1)return json(res,400,{error:'Current revision required'});
          const data=cleanTask(input);
          const updated=await sb('/rest/v1/studio_tasks?id=eq.'+id+'&revision=eq.'+prev,{method:'PATCH',token,body:{...data,revision:prev+1,updated_at:new Date().toISOString()},prefer:'return=representation'});
          if(!updated.ok)return json(res,502,{error:'Could not update task'});
          if(!updated.data?.length)return json(res,409,{error:'Task changed elsewhere. Refresh before saving.'});
          const item=updated.data[0];
          const version=await sb('/rest/v1/studio_task_versions',{method:'POST',token,body:{task_id:id,owner_id:team.id,revision:prev+1,snapshot:item},prefer:'return=minimal'});
          return json(res,200,{task:item,versionSaved:version.ok});
        }
      }
      return json(res,405,{error:'Unsupported method'});
    } catch(e) {return failure(res,e?.message||'Request error');}
  }
  if(req.method==='POST'&&path==='/api/ai/content'){
    if(!aiEnabled)return json(res,503,{error:'AI executor is not configured. Set OPENAI_API_KEY and STUDIO_ACCESS_TOKEN in this separate Render service.'});
    if(req.headers.authorization!=='Bearer '+process.env.STUDIO_ACCESS_TOKEN)return json(res,401,{error:'Studio access token required.'});
    try{
      const body=await readBody(req);
      if(!body||typeof body.brief!=='string'||body.brief.length<8||body.brief.length>12000)return json(res,400,{error:'Brief must contain 8–12000 characters.'});
      const workflow=['Onepage','LDP','Scale Store Brand','UGC'].includes(body.workflow)?body.workflow:'Onepage';
      const brand=['PawfectHouse','GiftSoul','SoulPrise'].includes(body.brand)?body.brand:'PawfectHouse';
      const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Authorization':'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.STUDIO_MODEL||'gpt-4.1-mini',store:false,instructions:'You assist with ecommerce design research and copy. Never pretend to have inspected a website, screenshot, product or live source unless its contents were supplied. Do not invent product variants or material claims. Generate a structured draft with headings: Research assumptions, Content Draft, Visual Brief, QA Checklist. Distinguish assumptions from verified facts. Do not publish or change merchant data.',input:'Brand: '+brand+'\nWorkflow: '+workflow+'\nBrief:\n'+body.brief}) ,signal:AbortSignal.timeout(60000)});
      const data=await response.json();
      if(!response.ok)return json(res,502,{error:'AI provider error',detail:String(data?.error?.message||'Upstream request failed').slice(0,300)});
      const output=(data.output||[]).flatMap(i=>(i.content||[]).filter(c=>c.type==='output_text').map(c=>c.text)).join('\n').trim();
      return json(res,200,{output,model:data.model||null,usage:data.usage||null});
    }catch(e){return json(res,500,{error:String(e?.message||'Unexpected error').slice(0,250)});}
  }
  json(res,404,{error:'Not found'});
}).listen(port,'0.0.0.0',()=>console.log('UID Brands Studio listening on '+port));
