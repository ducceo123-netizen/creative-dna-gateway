// Real UID Brands Gateway read-only tool adapter, constrained to canonical known host/routes.
// Never pass user JWTs or private task attachments to public Gateway endpoints.
const ORIGIN='https://uid-brands-gateway-preview.onrender.com';
const MANIFEST='/api/onepage-ui-template/2026-10-11.v3/manifest.json';
async function boundedGateway(path,payload=null){
 const response=await fetch(ORIGIN+path,{method:payload?'POST':'GET',redirect:'error',
  headers:{Accept:'application/json',...(payload?{'Content-Type':'application/json'}:{})},
  body:payload?JSON.stringify(payload):undefined,signal:AbortSignal.timeout(14000)});
 const raw=await response.text();
 if(raw.length>300000)throw Error('Gateway response exceeds 300 KB');
 let data;try{data=JSON.parse(raw);}catch{throw Error('Gateway returned malformed JSON');}
 if(!response.ok)throw Error('Gateway '+path+' returned '+response.status+': '+String(data?.error||'upstream blocked').slice(0,150));
 return data;
}
function compact(value,max=4200){
 try{return JSON.stringify(value).slice(0,max);}catch{return '';}
}
export async function resolveGatewayDNA({task,research}){
 const source_type=research?.type||'auto';
 const context={source_url:task.source_url,source_type,brand:task.brand,
  research:{source_url:task.source_url,
   products:(research?.products||[]).slice(0,8).map(p=>({title:p.title,url:p.url,variantCount:p.variantCount}))}};
 const branch=task.workflow==='Onepage'?'onepage-system':task.workflow==='LDP'?'LDP':task.workflow;
 const result=await boundedGateway('/api/tools/resolve_creative_dna',{brand:task.brand,branch,...context});
 const out={source:ORIGIN,branch,brand:task.brand,tools:[{name:'resolve_creative_dna',status:'completed'}],
   resolved:compact({brand:result.brand,branch:result.branch,resolved:result.resolved,route:result.route,gates:result.research_gate||result.research},5200)};
 if(task.workflow==='Onepage'){
  const compiled=await boundedGateway('/api/tools/compile_onepage_job',{brand:task.brand,
    source_url:task.source_url,source_type,theme:String(task.title||'').slice(0,120),research:context.research});
  out.tools.push({name:'compile_onepage_job',status:'completed'});
  out.compile=compact({status:compiled.status,plan:compiled.plan,creative_dna:compiled.creative_dna,
    required_inputs:compiled.required_inputs,blocked:compiled.blocked,diagnostics:compiled.diagnostics},5200);
  const manifest=await boundedGateway(MANIFEST);
  const qc=manifest?.production_qc_contract;
  if(!qc?.schema_version||qc.scope!=='onepage-system')throw Error('Canonical Onepage manifest missing');
  out.tools.push({name:'get_onepage_ui_template_manifest',status:'completed'});
  out.version=qc.schema_version;out.content_choice=qc.content_choice||null;
  out.image_gates=qc.image_gates||null;out.scope=qc.scope;
 }else{
  out.version=String(result?.schema_version||result?.version||'').slice(0,80)||null;
  out.scope=branch;
  out.note='Creative DNA resolver used; Onepage compiler not applicable to this workflow';
 }
 return out;
}
