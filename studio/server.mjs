import { createServer } from 'node:http';
import { scanPublicSource } from './research.mjs';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 10000);
const maxBody = 24000;
const webApp = await readFile(join(here, 'index.html'));
function json(res, status, value) { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value)); }
function readBody(req) { return new Promise((resolve,reject)=>{let text='';req.on('data',c=>{text+=c;if(text.length>maxBody){reject(new Error('body_too_large'));req.destroy();}});req.on('end',()=>{try{resolve(JSON.parse(text));}catch{reject(new Error('invalid_json'));}});req.on('error',reject);}); }
const aiEnabled = Boolean(process.env.OPENAI_API_KEY && process.env.STUDIO_ACCESS_TOKEN);
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
async function member(token){
  const user=await sb('/auth/v1/user',{token});
  if(!user.ok||!user.data?.id)return null;
  const query='?select=role,is_active&user_id=eq.'+encodeURIComponent(user.data.id)+'&is_active=eq.true&limit=1';
  const role=await sb('/rest/v1/creative_dna_team_members'+query,{token});
  if(!role.ok||!Array.isArray(role.data)||!role.data.length)return null;
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
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' https://cdn.shopify.com; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"});return res.end(webApp);
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
  if(req.method==='GET'&&path==='/api/status')return json(res,200,{app:'UID Brands Studio',version:'0.2',aiConfigured:aiEnabled,cloudConfigured:cloudEnabled,mode:cloudEnabled?'authenticated-cloud':'local-workspace'});
  if(path.startsWith('/api/auth/')||path==='/api/tasks'||path.startsWith('/api/tasks/')||path==='/api/catalog/search'){
    if(!cloudEnabled)return json(res,503,{error:'Cloud auth is not configured'});
    try {
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
