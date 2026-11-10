import { createServer } from 'node:http';
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
createServer(async(req,res)=>{
  const path = new URL(req.url||'/', 'http://localhost').pathname;
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method==='GET'&&(path==='/'||path==='/index.html')){
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"});return res.end(webApp);
  }
  if(req.method==='GET'&&path==='/api/status')return json(res,200,{app:'UID Brands Studio',version:'0.1',aiConfigured:aiEnabled,mode:aiEnabled?'protected-ai':'local-workspace'});
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
