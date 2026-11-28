import {createHash} from "node:crypto";
import {evaluateOnepageProductTypeScope, PRODUCT_TYPE_SCOPE_VERSION} from "./supabase/functions/_shared/onepage-product-type-scope.ts";
import type {NamedProduct, NamedProductSourceResolution} from "./uid-onepage-source-resolution.ts";

export const STOREFRONT_SOURCE_VERSION="uid-onepage-storefront-source/2026-11-28.v1";
const domains={pawfecthouse:"pawfecthouse.com",giftsoul:"giftsoul.co",soulprise:"soulprise.co"} as const;
export function onepageStorefrontSourceUrl(brand:string):string|null {
  const key=typeof brand==="string"?brand.normalize("NFKC").trim().toLowerCase():"";
  return Object.prototype.hasOwnProperty.call(domains,key)?`https://${domains[key as keyof typeof domains]}/api/2026-10/graphql.json`:null;
}
export const STOREFRONT_SOURCE_LIMITS=Object.freeze({timeoutMs:15000,requestTimeoutMs:5000,maxPages:21,
  maxProducts:2000,maxMatches:2000,maxPageBytes:2*1024*1024,maxTotalBytes:10*1024*1024});
type Limits={[Key in keyof typeof STOREFRONT_SOURCE_LIMITS]:number};
type Result={result:NamedProductSourceResolution;fallback_allowed:boolean};
const query="query UIDExactProductType($filter: String!, $after: String) { products(first: 100, query: $filter, sortKey: ID, after: $after) { nodes { id handle title productType } pageInfo { hasNextPage endCursor } } }";
const normalize=(s:string)=>s.normalize("NFKC").trim().replace(/\s+/g," ");
const digest=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
export function onepageStorefrontProductTypeFilter(type:string):string {
  // GraphQL variables protect GraphQL syntax; this separate quoting protects
  // Shopify's search syntax inside the variable. Never append caller syntax.
  return `product_type:"${normalize(type).replace(/[\\":()]/g,"\\$&")}"`;
}
class SourceFailure extends Error {
  constructor(readonly code:string,readonly retryable=false,readonly unsupported=false,readonly retryAfterMs?:number){super(code);}
}
function asProduct(value:unknown,host:string):NamedProduct {
  if(!value||typeof value!=="object"||Array.isArray(value))throw new SourceFailure("INVALID_STOREFRONT_PRODUCT");
  const p=value as Record<string,unknown>;
  const id=typeof p.id==="string"?/^gid:\/\/shopify\/Product\/([1-9]\d{0,29})$/.exec(p.id)?.[1]:null;
  if(!id||typeof p.title!=="string"||!p.title.trim()||p.title.length>2000||typeof p.handle!=="string"||p.handle.length>255||
    !/^[a-z0-9][a-z0-9-]*$/i.test(p.handle)||typeof p.productType!=="string"||p.productType.length>160)
    throw new SourceFailure("INVALID_STOREFRONT_PRODUCT");
  return {id,title:p.title,product_type:p.productType,url:`https://${host}/products/${p.handle}`};
}

async function readPage(endpoint:string,filter:string,after:string|null,fetcher:typeof fetch,limits:Limits,deadline:number,budget:{bytes:number}) {
  const remaining=Math.min(limits.requestTimeoutMs,deadline-performance.now());
  if(remaining<=0)throw new SourceFailure("STOREFRONT_TIMEOUT",true);
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined,response:Response|undefined;
  try {
    return await Promise.race([
      (async()=>{
        response=await fetcher(endpoint,{method:"POST",credentials:"omit",redirect:"manual",cache:"no-store",signal:controller.signal,
          headers:{"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({query,variables:{filter,after}})});
        if(controller.signal.aborted){void response.body?.cancel().catch(()=>{});throw new SourceFailure("STOREFRONT_TIMEOUT",true);}
        if(response.redirected||(response.url&&response.url!==endpoint)||(response.status>=300&&response.status<400))throw new SourceFailure("STOREFRONT_REDIRECT_REJECTED");
        if(!response.ok) {
          const afterHeader=response.headers.get("retry-after"),number=afterHeader?Number(afterHeader):NaN;
          const delay=Number.isFinite(number)?Math.max(1000,Math.min(60000,number*1000)):undefined;
          throw new SourceFailure(response.status===429?"STOREFRONT_RATE_LIMITED":"STOREFRONT_HTTP_ERROR",response.status===429||response.status>=500,[401,403,404,405,501].includes(response.status),delay);
        }
        if(!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type")||""))throw new SourceFailure("INVALID_STOREFRONT_CONTENT_TYPE");
        const actualVersion=response.headers.get("x-shopify-api-version");
        if(actualVersion&&actualVersion.trim()!=="2026-10")throw new SourceFailure("STOREFRONT_VERSION_MISMATCH");
        const size=Number(response.headers.get("content-length"));
        if(Number.isFinite(size)&&size>limits.maxPageBytes)throw new SourceFailure("STOREFRONT_PAGE_BYTE_LIMIT");
        if(!response.body)throw new SourceFailure("INVALID_STOREFRONT_RESPONSE");
        reader=response.body.getReader();const chunks:Uint8Array[]=[];let bytes=0;
        try {
          for(;;){const next=await reader.read();if(controller.signal.aborted)throw new SourceFailure("STOREFRONT_TIMEOUT",true);if(next.done)break;
            bytes+=next.value.byteLength;budget.bytes+=next.value.byteLength;
            if(bytes>limits.maxPageBytes)throw new SourceFailure("STOREFRONT_PAGE_BYTE_LIMIT");
            if(budget.bytes>limits.maxTotalBytes)throw new SourceFailure("STOREFRONT_TOTAL_BYTE_LIMIT");chunks.push(next.value);}
        }finally{void reader.cancel().catch(()=>{});reader.releaseLock();reader=undefined;}
        const buffer=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.byteLength;}
        let data:any;try{data=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(buffer));}catch{throw new SourceFailure("INVALID_STOREFRONT_JSON");}
        if(!data||typeof data!=="object"||Array.isArray(data))throw new SourceFailure("INVALID_STOREFRONT_RESPONSE");
        if(data.errors!==undefined&&(!Array.isArray(data.errors)||data.errors.length)) {
          const unsupported=!data.data?.products&&Array.isArray(data.errors)&&data.errors.length>0&&data.errors.every((e:any)=>["ACCESS_DENIED","UNAUTHORIZED","SHOP_NOT_FOUND"].includes(e?.extensions?.code));
          throw new SourceFailure("STOREFRONT_GRAPHQL_ERRORS",false,unsupported);
        }
        const connection=data.data?.products;
        if(!connection||!Array.isArray(connection.nodes)||connection.nodes.length>100||!connection.pageInfo||typeof connection.pageInfo.hasNextPage!=="boolean")
          throw new SourceFailure("INVALID_STOREFRONT_RESPONSE");
        const hasNext=connection.pageInfo.hasNextPage,cursor=connection.pageInfo.endCursor;
        if(cursor!==null&&(typeof cursor!=="string"||!/^[A-Za-z0-9+/_=-]{1,2048}$/.test(cursor)))throw new SourceFailure("INVALID_STOREFRONT_CURSOR");
        if(hasNext&&(!cursor||!connection.nodes.length))throw new SourceFailure("INCOMPLETE_STOREFRONT_PAGINATION");
        const products=connection.nodes.map((node:unknown)=>asProduct(node,new URL(endpoint).hostname));
        if(performance.now()>deadline)throw new SourceFailure("STOREFRONT_TIMEOUT",true);
        return {products,hasNext,cursor:cursor as string|null,bytes,sha256:digest(buffer)};
      })(),
      new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();void reader?.cancel().catch(()=>{});reject(new SourceFailure("STOREFRONT_TIMEOUT",true));},remaining);}),
    ]);
  }catch(error){if(error instanceof SourceFailure)throw error;throw new SourceFailure("STOREFRONT_FETCH_UNAVAILABLE",true);}
  finally{if(timer)clearTimeout(timer);controller.abort();void reader?.cancel().catch(()=>{});if(response?.body&&!response.body.locked)void response.body.cancel().catch(()=>{});}
}

/** Documented tokenless Storefront query, independently exact-filtered again.
 * Completeness concerns the eligible public query connection only. It does not
 * establish parity with the unfiltered JSON catalog or private/admin channels.
 * No Storefront token, customer identity, mutation, or caller endpoint is used.
 */
export async function resolveOnepageStorefrontSource(input:{brand:string;product_line:string},fetcher:typeof fetch=fetch,overrides:Partial<Limits>={},
  executePage?:<T>(work:()=>Promise<T>,deadline:number)=>Promise<T>):Promise<Result> {
  const started=performance.now(),observed_at=new Date().toISOString();
  const brand=typeof input?.brand==="string"?normalize(input.brand).toLowerCase():"";
  const line=typeof input?.product_line==="string"?normalize(input.product_line):"";
  const endpoint=onepageStorefrontSourceUrl(brand),filter=onepageStorefrontProductTypeFilter(line);
  const limits={...STOREFRONT_SOURCE_LIMITS,...overrides};const budget={bytes:0};
  const products:NamedProduct[]=[],pages:NamedProductSourceResolution["evidence"]["pages"]=[],ids=new Set<string>(),urls=new Set<string>(),cursors=new Set<string>(),alternatives=new Set<string>();
  let failure:SourceFailure|undefined,complete=false,after:string|null=null,requested=0;
  try {
    if(!endpoint||!line||line.length>160)throw new SourceFailure("INVALID_NAMED_PRODUCT_INPUT");
    if(!overrides||typeof overrides!=="object"||Array.isArray(overrides)||Object.keys(overrides).some(key=>!Object.prototype.hasOwnProperty.call(STOREFRONT_SOURCE_LIMITS,key))||
      Object.entries(limits).some(([key,value])=>!Number.isInteger(value)||value<1||value>STOREFRONT_SOURCE_LIMITS[key as keyof typeof STOREFRONT_SOURCE_LIMITS]))throw new SourceFailure("INVALID_SCAN_LIMITS");
    for(let page=1;page<=limits.maxPages&&!complete;page++) {
      requested++;
      const work=()=>readPage(endpoint,filter,after,fetcher,limits,started+limits.timeoutMs,budget);
      const current=await (executePage?executePage(work,started+limits.timeoutMs):work());
      if(ids.size+current.products.length>limits.maxProducts)throw new SourceFailure("STOREFRONT_PRODUCT_LIMIT");
      const pageIds=new Set<string>(),pageUrls=new Set<string>();
      for(const product of current.products) {
        if(ids.has(product.id)||urls.has(product.url)||pageIds.has(product.id)||pageUrls.has(product.url))throw new SourceFailure("DUPLICATE_STOREFRONT_PRODUCT");
        pageIds.add(product.id);pageUrls.add(product.url);
      }
      if(current.cursor&&cursors.has(current.cursor))throw new SourceFailure("STOREFRONT_CURSOR_DID_NOT_ADVANCE");
      const scoped=evaluateOnepageProductTypeScope({brand,requested_product_type:line,scan_complete:true,has_more_pages:false,products:current.products});
      if(scoped.issues.some(issue=>issue!=="NO_EXACT_PRODUCT_TYPE_MATCH"))throw new SourceFailure("STOREFRONT_SCOPE_EVALUATOR_REJECTED");
      const matches="products" in scoped?scoped.products:[];
      if(products.length+matches.length>limits.maxMatches)throw new SourceFailure("EXACT_MATCH_POOL_LIMIT");
      for(const product of current.products){ids.add(product.id);urls.add(product.url);
        if(normalize(product.product_type).toLowerCase()!==line.toLowerCase()&&product.product_type.trim()&&alternatives.size<30)alternatives.add(product.product_type.trim());}
      products.push(...matches);pages.push({page,count:current.products.length,bytes:current.bytes,sha256:current.sha256});
      if(current.cursor)cursors.add(current.cursor);after=current.cursor;complete=!current.hasNext;
    }
    if(!complete)throw new SourceFailure("STOREFRONT_PAGE_LIMIT");
    if(!products.length)throw new SourceFailure("NO_EXACT_PRODUCT_TYPE_MATCH");
    const scope=evaluateOnepageProductTypeScope({brand,requested_product_type:line,scan_complete:true,has_more_pages:false,products});
    if(scope.status!=="MATCHED_REQUIRES_HOST_PDP_REVIEW")throw new SourceFailure("STOREFRONT_SCOPE_EVALUATOR_REJECTED");
  }catch(error){failure=error instanceof SourceFailure?error:new SourceFailure(
    (error as {code?:string})?.code==="CATALOG_CALL_BUDGET_EXHAUSTED"?"STOREFRONT_TIMEOUT":"STOREFRONT_FETCH_UNAVAILABLE",true);}
  const resolved=complete&&!failure;
  return {fallback_allowed:!!failure?.unsupported&&pages.length===0,result:{schema_version:STOREFRONT_SOURCE_VERSION,status:resolved?"RESOLVED":"BLOCKED",brand,
    scan_id:null,scan_expires_at:null,next_action:resolved?"CONTINUE_PDP_RESEARCH":"RESOLVE_CATALOG_BLOCKER",source_url:endpoint,source_type:"collection",requested_product_type:line,
    match_policy:"SHOPIFY_PRODUCT_TYPE_EXACT",title_contains_fallback:false,catalog_complete:complete,scan_complete:complete,has_more_pages:!complete,
    whole_store_scan_complete:false,visibility_scope:"PUBLIC_TOKENLESS_STOREFRONT_QUERY",
    publication_note:"Complete means the fully paginated eligible public tokenless Storefront product-type query. Parity with the unfiltered JSON catalog or other publication channels is not established; no private/admin inventory or whole-store download is claimed.",
    source_verified_by_server:resolved,pdp_review_required:true,pixels_inspected:false,matched_count:products.length,matched_product_type:products[0]?.product_type||null,
    products,product_ids:products.map(p=>p.id),available_product_types:[...alternatives],issues:failure?[failure.code]:[],retryable:failure?.retryable||false,retry_after_ms:failure?.retryAfterMs??null,
    evidence:{catalog_url:endpoint,page_count:pages.length,requested_pages:requested,scanned_count:ids.size,bytes:budget.bytes,call_bytes:budget.bytes,observed_at,
      elapsed_ms:Math.round(performance.now()-started),pages,evaluator_version:PRODUCT_TYPE_SCOPE_VERSION,pagination:"STOREFRONT_CURSOR_UNTIL_HAS_NEXT_FALSE",transactional_snapshot:false,
      authority:"TOKENLESS_STOREFRONT_EXACT_TYPE_QUERY",query_filter:filter,api_version:"2026-10"},
    recovery:{action:resolved?"CONTINUE_PDP_RESEARCH":failure?.code==="NO_EXACT_PRODUCT_TYPE_MATCH"?"CLARIFY_EXACT_PRODUCT_TYPE":failure?.retryable?"RETRY_CATALOG_SCAN":"REVIEW_CATALOG_LIMIT",
      note:resolved?"Inspect every matched PDP and its actual materials/media before creative work. This verified public query scope is not pixel research."
      :"Do not use a partial queried pool as final scope. Retry transient failures without narrowing the brief; do not invent matches or infer a storefront collection URL."},
  }};
}
