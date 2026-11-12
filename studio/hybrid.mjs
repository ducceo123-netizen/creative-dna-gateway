// Hybrid evidence/deliverable contract. Never mistake collected snippets for inspected reviews or generated materials.
const ALLOWED_SOURCES=new Set(['trustpilot.com','www.trustpilot.com','etsy.com','www.etsy.com','reddit.com','www.reddit.com','old.reddit.com','amazon.com','www.amazon.com','pinterest.com','www.pinterest.com']);
const QA_ITEMS=Object.freeze([
 ['product_truth','PDP, gallery, variants and actual construction verified'],
 ['evidence','Buyer insight supported by a dated, attributable source'],
 ['content_choice','Good To Know vs FAQs chosen from research'],
 ['design_diversity','Real artwork examples diversified across sections'],
 ['physical_fidelity','Product proportions, hands and interactions reviewed'],
 ['desktop','Desktop overall preview checked'],
 ['mobile','Mobile overall preview, typography and contrast checked'],
 ['icons','EO icon consistency and legibility checked']
]);
function canonicalExternalUrl(raw){
 const input=String(raw||'').trim();
 if(input.length>1400||!/^https:\/\//i.test(input))throw Error('Use a direct HTTPS review or competitor URL');
 const u=new URL(input);
 if(!ALLOWED_SOURCES.has(u.hostname.toLowerCase())||u.port||u.username||u.password||u.hash)throw Error('Unsupported external evidence domain');
 if(/(?:^|\/)(?:\.|%2e){1,2}(?:\/|$)/i.test(input))throw Error('Invalid source path');
 if(!u.pathname||u.pathname==='/')throw Error('Paste a specific source page, not just a homepage');
 u.search='';
 return u.href;
}
function htmlMeta(html,key){
 const tags=String(html||'').match(/<meta\b[^>]*>/gi)||[];
 for(const tag of tags){
  const attr=k=>{const match=tag.match(new RegExp('\\b'+k+'\\s*=\\s*(?:"([^"]*)"|\\x27([^\\x27]*)\\x27)','i'));return match?(match[1]??match[2]):'';};
  if(attr('name').toLowerCase()===key||attr('property').toLowerCase()===key)return attr('content').replace(/\s+/g,' ').slice(0,500);
 }
 return '';
}
async function inspectPublicEvidence(raw,fetcher=fetch){
 const url=canonicalExternalUrl(raw),checked_at=new Date().toISOString();
 try{
  const response=await fetcher(url,{method:'GET',redirect:'error',headers:{Accept:'text/html','User-Agent':'UIDBrandsStudio/1.0 (Evidence source checker)'},signal:AbortSignal.timeout(8500)});
  if(!response.ok)throw Error('Source returned '+response.status);
  if(!String(response.headers.get('content-type')||'').includes('text/html'))throw Error('Not an HTML page');
  if(Number(response.headers.get('content-length')||0)>300000)throw Error('Page exceeds evidence metadata limit');
  const text=await response.text();
  if(text.length>300000)throw Error('Page exceeds evidence metadata limit');
  const title=(htmlMeta(text,'og:title')||text.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]||'').replace(/\s+/g,' ').trim().slice(0,200);
  const description=htmlMeta(text,'og:description')||htmlMeta(text,'description');
  if(!title&&!description)throw Error('No usable public metadata');
  return {url,title,description,checked_at,status:'metadata_only',source_type:'external_public',limitations:'Page metadata only. No customer review, image, claims or buyer sentiment has been verified.'};
 }catch(e){
  return {url,title:'',description:'',checked_at,status:'unavailable',source_type:'external_public',limitations:String(e.message||'Access blocked').slice(0,160)+'. Do not infer review content.'};
 }
}
function cleanDeliverable(input){
 if(!input||typeof input!=='object')throw Error('Deliverable payload required');
 const content=String(input.content||'').trim(),source=input.source==='api_executor'?'api_executor':'manual_chatgpt';
 if(content.length>50000)throw Error('Content exceeds 50,000 characters');
 const materials=Array.isArray(input.materials)?input.materials:[];
 if(materials.length>24)throw Error('Too many material slots');
 const cleanMaterials=materials.map(x=>{
  const slot=String(x?.slot||'').trim(),file_id=String(x?.file_id||'').trim(),notes=String(x?.notes||'').trim();
  if(!/^[a-z0-9_-]{2,36}$/i.test(slot)||file_id.length>150||notes.length>600)throw Error('Invalid material slot');
  return {slot,file_id,notes,status:file_id?'linked':'planned'};
 });
 const evidence=Array.isArray(input.evidence)?input.evidence:[];
 if(evidence.length>16)throw Error('Too many evidence links');
 const cleanEvidence=evidence.map(x=>{
  const url=canonicalExternalUrl(x.url),status=x.status==='metadata_only'?'metadata_only':'unavailable';
  return {url,title:String(x.title||'').slice(0,200),description:String(x.description||'').slice(0,500),checked_at:String(x.checked_at||'').slice(0,50),status,limitations:String(x.limitations||'').slice(0,220)};
 });
 const qa={};
 for(const [key] of QA_ITEMS)qa[key]=input.qa?.[key]===true;
 return {content,source,materials:cleanMaterials,evidence:cleanEvidence,qa};
}
function qaSummary(deliverable){
 const qa=deliverable?.qa||{},checked=QA_ITEMS.filter(([id])=>qa[id]===true).length;
 const attachments=Array.isArray(deliverable?.materials)?deliverable.materials.filter(x=>x.file_id):[];
 const sourceCount=(deliverable?.evidence||[]).filter(x=>x.status==='metadata_only').length;
 return {checked,total:QA_ITEMS.length,ready:checked===QA_ITEMS.length && !!String(deliverable?.content||'').trim() && attachments.length>0 && sourceCount>0,
  missing:QA_ITEMS.filter(([id])=>qa[id]!==true).map(([,text])=>text),
  note:'Checklist is human-attested; it is not automatic image inspection or proof of claim accuracy.'};
}
export {QA_ITEMS,canonicalExternalUrl,inspectPublicEvidence,cleanDeliverable,qaSummary};
