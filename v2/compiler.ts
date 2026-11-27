/** Fixed read-only public compiler adapter. Never imports the writable legacy server. */
import { z } from 'zod';
import { assertSafeJson, createSnapshot, type Packet } from './rules.ts';

export const CANONICAL_COMPILER_URL='https://uid-brands-gateway-preview.onrender.com/api/tools/compile_onepage_job';
export const CANONICAL_COMPILE_TIMEOUT_MS=90_000;
export const MAX_CANONICAL_RESPONSE_BYTES=4_000_000;
export const compileInputSchema=z.object({
  brand:z.enum(['pawfecthouse','giftsoul','soulprise']),
  source_url:z.string().max(2000).optional(),
  source_type:z.enum(['auto','product','collection']).optional(),
  product_line:z.string().trim().min(1).max(160).optional(),
  theme:z.string().max(120).optional(),
  research:z.unknown().optional(),
}).strict();
export type CompileInput=z.infer<typeof compileInputSchema>;
const domains={pawfecthouse:'pawfecthouse.com',giftsoul:'giftsoul.co',soulprise:'soulprise.co'};
/** This adapter is for public-source research only; private reference transport is a separate, disabled capability. */
function rejectPrivatePayload(value:unknown,depth=0):void {
  if(depth>64)throw new Error('RESEARCH_DEPTH_LIMIT');
  if(typeof value==='string') {
    if(/^(?:data:|file:)/i.test(value))throw new Error('PRIVATE_OR_BINARY_RESEARCH_UNSUPPORTED');
    if(/^https?:\/\//i.test(value)) {
      let url:URL;try{url=new URL(value);}catch{return;}
      if(url.username||url.password||[...url.searchParams.keys()].some(k=>/^(?:access_token|refresh_token|token|key|api_key|apikey|signature|sig|x-amz-signature|x-goog-signature)$/i.test(k)))throw new Error('CREDENTIAL_IN_RESEARCH_URL');
    }
    return;
  }
  if(Array.isArray(value)){for(const item of value)rejectPrivatePayload(item,depth+1);return;}
  if(value&&typeof value==='object')for(const [key,item] of Object.entries(value)) {
    if(/^(?:authorization|access_token|refresh_token|service_role_key|api_key|apikey|secret|password|data_base64|dataBase64|image_base64|bytes|binary|credentials)$/i.test(key))throw new Error('PRIVATE_OR_BINARY_RESEARCH_UNSUPPORTED');
    if(/^(?:visibility|access|source_access|permission)$/i.test(key)&&typeof item==='string'&&/^(?:private|team|member|members|members_only|authenticated|internal|restricted)$/i.test(item))throw new Error('PRIVATE_REFERENCE_ADAPTER_NOT_CONFIGURED');
    if(/^(?:private|is_private)$/i.test(key)&&item===true)throw new Error('PRIVATE_REFERENCE_ADAPTER_NOT_CONFIGURED');
    rejectPrivatePayload(item,depth+1);
  }
}
export function validateCompileInput(value: unknown): CompileInput {
  const input=compileInputSchema.parse(value);
  if(input.source_url) {
    let url:URL;
    try{url=new URL(input.source_url);}catch{throw new Error('INVALID_SOURCE_URL');}
    if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||
      ![domains[input.brand],'www.'+domains[input.brand]].includes(url.hostname)||
      !/^\/(products|collections)\/[a-zA-Z0-9][a-zA-Z0-9_-]*\/?$/.test(url.pathname))throw new Error('SOURCE_OUTSIDE_BRAND_SCOPE');
    if(input.source_type==='product'&&!url.pathname.startsWith('/products/'))throw new Error('SOURCE_TYPE_URL_MISMATCH');
    if(input.source_type==='collection'&&!url.pathname.startsWith('/collections/'))throw new Error('SOURCE_TYPE_URL_MISMATCH');
  }
  if(input.source_url)rejectPrivatePayload(input.source_url);
  if(input.research!==undefined){assertSafeJson(input.research);if(Buffer.byteLength(JSON.stringify(input.research))>180_000)throw new Error('RESEARCH_INPUT_TOO_LARGE');rejectPrivatePayload(input.research);}
  return input;
}
async function boundedJson(response:Response) {
  const declared=Number(response.headers.get('content-length')||0);
  if(declared>MAX_CANONICAL_RESPONSE_BYTES)throw new Error('CANONICAL_RESPONSE_TOO_LARGE');
  if(!response.body)throw new Error('CANONICAL_RESPONSE_EMPTY');
  const reader=response.body.getReader(),parts:Uint8Array[]=[];
  let size=0;
  try {
    for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>MAX_CANONICAL_RESPONSE_BYTES)throw new Error('CANONICAL_RESPONSE_TOO_LARGE');parts.push(value);}
  } catch(error){await reader.cancel().catch(()=>{});throw error;}
  finally{reader.releaseLock();}
  let packet:unknown;
  try{packet=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw new Error('CANONICAL_RESPONSE_INVALID_JSON');}
  assertSafeJson(packet);
  if(!packet||typeof packet!=='object'||Array.isArray(packet))throw new Error('CANONICAL_RESPONSE_INVALID');
  return packet as Packet;
}
export async function compileCanonical(rawInput:CompileInput, fetcher:typeof fetch=fetch):Promise<Packet> {
  const input=validateCompileInput(rawInput);
  let response:Response;
  try {
    response=await fetcher(CANONICAL_COMPILER_URL,{
      method:'POST',redirect:'error',cache:'no-store',
      headers:{'Content-Type':'application/json','Accept':'application/json','User-Agent':'UID-Brands-Architecture-V2/0.1 read-only-compiler'},
      body:JSON.stringify(input),signal:AbortSignal.timeout(CANONICAL_COMPILE_TIMEOUT_MS),
    });
  } catch {throw new Error('CANONICAL_READ_UNAVAILABLE');}
  if(!response.ok) {await response.body?.cancel().catch(()=>{});throw new Error('CANONICAL_READ_HTTP_'+response.status);}
  const packet=await boundedJson(response);
  if(packet.resolved?.brand!==input.brand||packet.resolved?.branch!=='onepage-system')throw new Error('CANONICAL_ROUTE_MISMATCH');
  if(packet.dynamic_job?.source_url!==(input.source_url||null))throw new Error('CANONICAL_SOURCE_MISMATCH');
  if(input.product_line&&!input.source_url){const scope=packet.named_product_scope;if(!scope||scope.requested_product_type!==input.product_line||scope.match_policy!=='SHOPIFY_PRODUCT_TYPE_EXACT'||scope.requires_store_catalog_scan!==true||scope.no_title_or_handle_contains_fallback!==true||scope.evaluator!=='evaluate_onepage_product_type_scope')throw new Error('CANONICAL_NAMED_SCOPE_MISMATCH');}
  if(!Array.isArray(packet.execution)||!Array.isArray(packet.assets)||!packet.hard_gates)throw new Error('CANONICAL_RESPONSE_INVALID');
  return packet;
}
export async function compileSnapshot(input:CompileInput, baselineCommit:string, fetcher:typeof fetch=fetch) {
  const packet=await compileCanonical(input,fetcher);
  return createSnapshot(packet,{
    sourceUrl:CANONICAL_COMPILER_URL,observedAt:new Date().toISOString(),baselineCommit,
    sourceRevision:packet.creative_quality_contract?.revision??'unavailable',visibility:'public',
    privateReferences:'NOT_REQUESTED_NO_BEARER_FORWARDING',
  });
}
