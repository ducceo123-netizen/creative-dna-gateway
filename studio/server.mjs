import { createServer } from 'node:http';
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
const taskFields=['title','brand','workflow','source_url','brief','content','feedback','status'];
function cleanTask(input){
 if(!input||typeof input!=='object')throw Error('Task payload required');
 const v={};
 for(const f of taskFields)v[f]=typeof input[f]==='string'?input[f].trim():'';
 if(!v.title||v.title.length>180||v.brief.length>12000||v.content.length>50000||v.feedback.length>20000||v.source_url.length>2000)throw Error('Invalid task text length');
 if(!['PawfectHouse','GiftSoul','SoulPrise'].includes(v.brand)||!['Onepage','LDP','Scale Store Brand','UGC'].includes(v.workflow)||!['Draft','In progress','In review','Approved'].includes(v.status))throw Error('Invalid workflow, brand or status');
 if(v.source_url&&!/^https:\/\//i.test(v.source_url))throw Error('Only public HTTPS source URLs are accepted');
 return v;
}
createServer(async(req,res)=>{
  const path = new URL(req.url||'/', 'http://localhost').pathname;
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method==='GET'&&(path==='/'||path==='/index.html')){
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"});return res.end(webApp);
  }
  if(req.method==='GET'&&path==='/api/status')return json(res,200,{app:'UID Brands Studio',version:'0.2',aiConfigured:aiEnabled,cloudConfigured:cloudEnabled,mode:cloudEnabled?'authenticated-cloud':'local-workspace'});
  if(path.startsWith('/api/auth/')||path==='/api/tasks'||path.startsWith('/api/tasks/')){
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
