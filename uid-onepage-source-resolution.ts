import {createHash, randomBytes} from "node:crypto";
import {evaluateOnepageProductTypeScope, PRODUCT_TYPE_SCOPE_VERSION} from "./supabase/functions/_shared/onepage-product-type-scope.ts";

export const NAMED_PRODUCT_SOURCE_VERSION = "uid-onepage-named-source/2026-11-28.v1";
// Exact same verified public origins as uid-eo-store-scanner.ts. No caller URL,
// redirect, suggestion search, title match, or inferred collection is accepted.
const BRAND_DOMAINS = {pawfecthouse:"pawfecthouse.com", giftsoul:"giftsoul.co", soulprise:"soulprise.co"} as const;
export const NAMED_PRODUCT_SCAN_LIMITS = Object.freeze({
  timeoutMs:15_000, requestTimeoutMs:5_000, concurrency:4, maxPages:101,
  maxProducts:25_000, maxMatches:2_000, maxPageBytes:8*1024*1024, maxTotalBytes:128*1024*1024,
});
type ScanBounds = {[Key in keyof typeof NAMED_PRODUCT_SCAN_LIMITS]:number};
export type NamedProductScanLimits = Partial<ScanBounds>;
export type NamedProduct = {id:string; title:string; product_type:string; url:string};
type PageReceipt = {page:number; count:number; bytes:number; sha256:string};
export type NamedProductSourceResolution = {
  schema_version:string; status:"RESOLVED"|"BLOCKED"|"IN_PROGRESS"; brand:string;
  scan_id:string|null; scan_expires_at:string|null;
  next_action:"CONTINUE_CATALOG_SCAN"|"CONTINUE_PDP_RESEARCH"|"RESOLVE_CATALOG_BLOCKER";
  source_url:string|null; source_type:"collection"; requested_product_type:string;
  match_policy:"SHOPIFY_PRODUCT_TYPE_EXACT"; title_contains_fallback:false;
  catalog_complete:boolean; scan_complete:boolean; has_more_pages:boolean;
  source_verified_by_server:boolean; pdp_review_required:true; pixels_inspected:false;
  matched_count:number; matched_product_type:string|null; products:NamedProduct[];
  product_ids:string[]; available_product_types:string[]; issues:string[]; retryable:boolean;
  retry_after_ms:number|null;
  evidence:{catalog_url:string|null; page_count:number; requested_pages:number; scanned_count:number;
    bytes:number; call_bytes:number; observed_at:string; elapsed_ms:number; pages:PageReceipt[]; evaluator_version:string;
    pagination:"SEQUENTIAL_PAGE_NUMBERS_UNTIL_EMPTY"; transactional_snapshot:false};
  recovery:{action:"CONTINUE_PDP_RESEARCH"|"CONTINUE_CATALOG_SCAN"|"RETRY_CATALOG_SCAN"|"RESTART_CATALOG_SCAN"|"CLARIFY_EXACT_PRODUCT_TYPE"|"CORRECT_INPUT"|"REVIEW_CATALOG_LIMIT";
    note:string};
};
class CatalogFailure extends Error {
  constructor(readonly code:string, readonly retryable=true, readonly retryAfterMs?:number) {super(code);}
}
const hash = (bytes:Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const normalized = (s:string) => s.normalize("NFKC").trim().replace(/\s+/g," ").toLocaleLowerCase("en-US");
const own = (object:object,key:string) => Object.prototype.hasOwnProperty.call(object,key);
export function onepageCatalogSourceUrl(brand:string):string|null {
  const key=typeof brand==="string"?brand.normalize("NFKC").trim().toLowerCase():"";
  return own(BRAND_DOMAINS,key)?`https://${BRAND_DOMAINS[key as keyof typeof BRAND_DOMAINS]}/products.json`:null;
}

function productRow(value:unknown, host:string):NamedProduct {
  if (!value || typeof value!=="object" || Array.isArray(value)) throw new CatalogFailure("INVALID_CATALOG_PRODUCT");
  const p=value as Record<string,unknown>;
  const id=typeof p.id==="number" && Number.isSafeInteger(p.id) && p.id>0 ? String(p.id)
    : typeof p.id==="string" && /^[1-9]\d{0,29}$/.test(p.id) ? p.id : null;
  if (!id || typeof p.title!=="string" || !p.title.trim() || p.title.length>2000 ||
    typeof p.product_type!=="string" || p.product_type.length>160 ||
    typeof p.handle!=="string" || p.handle.length>255 || !/^[a-z0-9][a-z0-9-]*$/i.test(p.handle))
    throw new CatalogFailure("INVALID_CATALOG_PRODUCT");
  // An explicitly empty Shopify type is a valid nonmatch; a missing type is not.
  return {id,title:p.title,product_type:p.product_type,url:`https://${host}/products/${p.handle}`};
}

async function fetchPage(url:string, page:number, fetcher:typeof fetch,
  limits:ScanBounds, deadline:number, budget:{bytes:number;previousBytes:number;maxSessionBytes:number}):Promise<{rows:NamedProduct[]; receipt:PageReceipt}> {
  const remaining=Math.min(limits.requestTimeoutMs,deadline-performance.now());
  if (remaining<=0) throw new CatalogFailure("CATALOG_CALL_BUDGET_EXHAUSTED");
  const timeoutCode=remaining<limits.requestTimeoutMs?"CATALOG_CALL_BUDGET_EXHAUSTED":"CATALOG_REQUEST_TIMEOUT";
  const controller=new AbortController();
  let response:Response|undefined;
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  let timer:ReturnType<typeof setTimeout>|undefined;
  let timedOut=false;
  try {
    return await Promise.race([
      (async()=>{
        response=await fetcher(url,{method:"GET",redirect:"manual",credentials:"omit",cache:"no-store",
          signal:controller.signal,headers:{Accept:"application/json","User-Agent":"UID-Brands-Exact-Product-Scope/1.0"}});
        if(controller.signal.aborted) {void response.body?.cancel().catch(()=>{});throw new CatalogFailure(timeoutCode);}
        if(response.redirected || (response.url && response.url!==url) || (response.status>=300 && response.status<400))
          throw new CatalogFailure("CATALOG_REDIRECT_REJECTED",false);
        if(!response.ok) {
          const after=response.headers.get("retry-after");
          const parsed=after?(Number.isFinite(Number(after))?Number(after)*1000:Date.parse(after)-Date.now()):NaN;
          const retryAfter=Number.isFinite(parsed)?Math.max(1000,Math.min(60_000,parsed)):undefined;
          throw new CatalogFailure(response.status===429?"CATALOG_RATE_LIMITED":"CATALOG_HTTP_ERROR",true,retryAfter);
        }
        if(!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type")||""))
          throw new CatalogFailure("INVALID_CATALOG_CONTENT_TYPE");
        const declared=Number(response.headers.get("content-length"));
        if(Number.isFinite(declared) && declared>limits.maxPageBytes) throw new CatalogFailure("CATALOG_PAGE_BYTE_LIMIT",false);
        if(!response.body) throw new CatalogFailure("INVALID_CATALOG_RESPONSE");
        reader=response.body.getReader();
        const chunks:Uint8Array[]=[];let size=0;
        // Like readBoundedReferenceBytes, but with a shared budget across the
        // concurrent pages and an externally cancellable reader for body stalls.
        try {
          for(;;) {
            const {value,done}=await reader.read();
            if(controller.signal.aborted) throw new CatalogFailure(timeoutCode);
            if(done) break;
            size+=value.byteLength;budget.bytes+=value.byteLength;
            if(size>limits.maxPageBytes) throw new CatalogFailure("CATALOG_PAGE_BYTE_LIMIT",false);
            if(budget.previousBytes+budget.bytes>budget.maxSessionBytes) throw new CatalogFailure("CATALOG_SESSION_BYTE_LIMIT",false);
            if(budget.bytes>limits.maxTotalBytes) throw new CatalogFailure("CATALOG_TOTAL_BYTE_LIMIT",false);
            chunks.push(value);
          }
        } finally {void reader.cancel().catch(()=>{});reader.releaseLock();reader=undefined;}
        const bytes=new Uint8Array(size);let offset=0;
        for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
        let body:unknown;
        try {body=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}
        catch {throw new CatalogFailure("INVALID_CATALOG_JSON");}
        if(!body || typeof body!=="object" || Array.isArray(body) || !Array.isArray((body as any).products) || (body as any).products.length>250)
          throw new CatalogFailure("INVALID_CATALOG_RESPONSE");
        const rows=(body as {products:unknown[]}).products.map(p=>productRow(p,new URL(url).hostname));
        if(performance.now()>deadline) throw new CatalogFailure("CATALOG_CALL_BUDGET_EXHAUSTED");
        return {rows,receipt:{page,count:rows.length,bytes:size,sha256:hash(bytes)}};
      })(),
      new Promise<never>((_,reject)=>{timer=setTimeout(()=>{
        timedOut=true;controller.abort();void reader?.cancel().catch(()=>{});reject(new CatalogFailure(timeoutCode));
      },remaining);}),
    ]);
  } catch(error) {
    if(error instanceof CatalogFailure) throw error;
    throw new CatalogFailure(timedOut?timeoutCode:"CATALOG_FETCH_UNAVAILABLE");
  } finally {
    if(timer)clearTimeout(timer);controller.abort();void reader?.cancel().catch(()=>{});
    if(response?.body && !response.body.locked) void response.body.cancel().catch(()=>{});
  }
}

type ParsedPage={rows:NamedProduct[];receipt:PageReceipt};
type ScanSession={
  id:string;brand:string;line:string;catalog:string|null;expiresAt:number;observedAt:string;limits:ScanBounds;
  products:NamedProduct[];pages:PageReceipt[];types:Map<string,string>;ids:Set<string>;urls:Set<string>;
  pending:Map<number,ParsedPage>;nextPage:number;requestedPages:number;bytes:number;complete:boolean;
  inFlight?:Promise<NamedProductSourceResolution>;
};
export type NamedProductSourceInput={brand:string;product_line:string;scan_id?:string};
type ResolverOptions={now?:()=>number;sessionTtlMs?:number;maxSessions?:number;maxSessionBytes?:number;requestStartIntervalMs?:number};
const isBudgetPause=(code?:string)=>code==="CATALOG_CALL_BUDGET_EXHAUSTED" || code==="CATALOG_TOTAL_BYTE_LIMIT";
const requiresRestart=(code?:string)=>["DUPLICATE_CATALOG_PRODUCT","INCONSISTENT_CATALOG_PAGINATION","CATALOG_SCOPE_EVALUATOR_REJECTED"].includes(code||"");

function resultFor(s:ScanSession,failure:CatalogFailure|undefined,callBytes:number,elapsedMs:number):NamedProductSourceResolution {
  const resolved=s.complete && !failure, paused=!s.complete && isBudgetPause(failure?.code), issue=failure?.code;
  const action=resolved?"CONTINUE_PDP_RESEARCH":paused?"CONTINUE_CATALOG_SCAN":issue==="NO_EXACT_PRODUCT_TYPE_MATCH"?"CLARIFY_EXACT_PRODUCT_TYPE"
    :requiresRestart(issue)?"RESTART_CATALOG_SCAN"
    :issue==="INVALID_NAMED_PRODUCT_INPUT" || issue==="INVALID_SCAN_LIMITS"?"CORRECT_INPUT"
    :failure?.retryable?"RETRY_CATALOG_SCAN":"REVIEW_CATALOG_LIMIT";
  return {schema_version:NAMED_PRODUCT_SOURCE_VERSION,status:resolved?"RESOLVED":paused?"IN_PROGRESS":"BLOCKED",brand:s.brand,
    scan_id:s.id||null,scan_expires_at:s.id?new Date(s.expiresAt).toISOString():null,
    next_action:resolved?"CONTINUE_PDP_RESEARCH":paused?"CONTINUE_CATALOG_SCAN":"RESOLVE_CATALOG_BLOCKER",
    source_url:s.catalog,source_type:"collection",requested_product_type:s.line,match_policy:"SHOPIFY_PRODUCT_TYPE_EXACT",
    title_contains_fallback:false,catalog_complete:s.complete,scan_complete:s.complete,has_more_pages:!s.complete,
    source_verified_by_server:resolved,pdp_review_required:true,pixels_inspected:false,
    matched_count:s.products.length,matched_product_type:s.products[0]?.product_type||null,products:s.products,
    product_ids:s.products.map(p=>p.id),available_product_types:[...s.types.values()],issues:issue?[issue]:[],retryable:paused||failure?.retryable||false,
    retry_after_ms:failure?.retryAfterMs??null,
    evidence:{catalog_url:s.catalog,page_count:s.pages.length,requested_pages:s.requestedPages,scanned_count:s.ids.size,
      bytes:s.bytes,call_bytes:callBytes,observed_at:s.observedAt,elapsed_ms:Math.round(elapsedMs),pages:s.pages,evaluator_version:PRODUCT_TYPE_SCOPE_VERSION,
      pagination:"SEQUENTIAL_PAGE_NUMBERS_UNTIL_EMPTY",transactional_snapshot:false},
    recovery:{action,note:resolved?"Inspect every matched PDP and its actual material/media before creative work; catalog metadata is not visual research."
      :paused?"Continue this server-owned scan automatically with the same brand, product_line and scan_id. Do not ask the member to continue and do not treat the partial pool as complete."
      :requiresRestart(issue)?"The observed catalog pages are inconsistent. This cursor was invalidated; start a fresh scan with the same brief and no scan_id. Never certify this partial snapshot."
      :s.complete?"No exact Shopify product_type matched. Use observed candidate types to clarify the intended family; never broaden by title or handle."
      :"Catalog verification is incomplete. Preserve the brief; never use a partial pool as final scope. Retry a transient failure with the same scan_id. An unavailable/expired cursor requires a new scan."},
  };
}

/** Server-owned, bounded public-metadata sessions. No caller rows, proof, page
 * numbers or URLs are accepted. Cursor possession permits only reading this
 * public inventory; exact brand/type binding prevents cross-scope reuse.
 * Public pagination is not a transactional snapshot. A full terminal-empty scan
 * is still mandatory. No canonical database, media, or private data is cached.
 * Factory options and limits are server-only, principally for deterministic tests.
 */
export function createOnepageNamedProductSourceResolver(options:ResolverOptions={}) {
  const now=options.now||Date.now, ttl=options.sessionTtlMs??300_000, capacity=options.maxSessions??4;
  const maxSessionBytes=options.maxSessionBytes??512*1024*1024;
  const startInterval=options.requestStartIntervalMs??500;
  if(!Number.isInteger(ttl)||ttl<1||ttl>300_000||!Number.isInteger(capacity)||capacity<1||capacity>4||
    !Number.isInteger(maxSessionBytes)||maxSessionBytes<1||maxSessionBytes>512*1024*1024||
    !Number.isInteger(startInterval)||startInterval<0||startInterval>1000) throw new Error("INVALID_SCAN_CACHE_CONFIG");
  const sessions=new Map<string,ScanSession>();
  let activeFetches=0,nextStartAt=0,dispatchTimer:ReturnType<typeof setTimeout>|undefined;
  const fetchQueue:Array<()=>void>=[];
  const drain=()=>{
    if(dispatchTimer){clearTimeout(dispatchTimer);dispatchTimer=undefined;}
    while(activeFetches<4&&fetchQueue.length) {
      const wait=nextStartAt-performance.now();
      if(wait>0){dispatchTimer=setTimeout(drain,wait);return;}
      fetchQueue.shift()!();
    }
  };
  // A shared semaphore bounds network/body memory across every active session.
  // Queue wait consumes the existing call deadline; timed-out waiters are removed.
  function withFetchSlot<T>(work:()=>Promise<T>,deadline:number):Promise<T> {
    return new Promise<T>((resolve,reject)=>{
      let timer:ReturnType<typeof setTimeout>|undefined,waiting=true;
      const run=()=>{
        if(!waiting)return;waiting=false;if(timer)clearTimeout(timer);
        if(performance.now()>=deadline){reject(new CatalogFailure("CATALOG_CALL_BUDGET_EXHAUSTED"));return;}
        activeFetches++;nextStartAt=performance.now()+startInterval;
        Promise.resolve().then(work).then(resolve,reject).finally(()=>{activeFetches--;drain();});
      };
      fetchQueue.push(run);
      timer=setTimeout(()=>{
        if(!waiting)return;waiting=false;const at=fetchQueue.indexOf(run);if(at>=0)fetchQueue.splice(at,1);
        reject(new CatalogFailure("CATALOG_CALL_BUDGET_EXHAUSTED"));drain();
      },Math.max(0,deadline-performance.now()));
      drain();
    });
  }
  const prune=()=>{for(const [id,s] of sessions)if(s.expiresAt<=now())sessions.delete(id);};
  return async function resolve(input:NamedProductSourceInput,fetcher:typeof fetch=fetch,overrides:NamedProductScanLimits={}):Promise<NamedProductSourceResolution> {
    prune();
    const started=performance.now();
    const brand=typeof input?.brand==="string"?input.brand.normalize("NFKC").trim().toLowerCase():"";
    const line=typeof input?.product_line==="string"?input.product_line.trim():"";
    const limits={...NAMED_PRODUCT_SCAN_LIMITS,...overrides};
    let s:ScanSession={id:"",brand,line,catalog:onepageCatalogSourceUrl(brand),expiresAt:now()+ttl,observedAt:new Date(now()).toISOString(),limits,
      products:[],pages:[],types:new Map(),ids:new Set(),urls:new Set(),pending:new Map(),nextPage:1,requestedPages:0,bytes:0,complete:false};
    const reject=(code:string,retryable=false)=>structuredClone(resultFor(s,new CatalogFailure(code,retryable),0,performance.now()-started));
    if(!s.catalog||!line||line.length>160) return reject("INVALID_NAMED_PRODUCT_INPUT");
    if(!overrides||typeof overrides!=="object"||Array.isArray(overrides)||Object.keys(overrides).some(key=>!own(NAMED_PRODUCT_SCAN_LIMITS,key))||
      Object.entries(limits).some(([key,value])=>!Number.isInteger(value)||value<1||value>NAMED_PRODUCT_SCAN_LIMITS[key as keyof typeof NAMED_PRODUCT_SCAN_LIMITS]))
      return reject("INVALID_SCAN_LIMITS");
    if(input.scan_id!==undefined) {
      if(typeof input.scan_id!=="string"||!/^[a-f0-9]{64}$/.test(input.scan_id))return reject("CATALOG_SCAN_UNAVAILABLE");
      const found=sessions.get(input.scan_id);
      if(!found||found.brand!==brand||normalized(found.line)!==normalized(line))return reject("CATALOG_SCAN_UNAVAILABLE");
      s=found;
      if(s.inFlight)return structuredClone(await s.inFlight);
    } else {
      // Completed cache entries may yield to new work. Never evict an in-flight
      // or unfinished scan: an evicted completion cursor honestly restarts.
      if(sessions.size>=capacity)for(const [id,old] of sessions)if(old.complete&&!old.inFlight){sessions.delete(id);break;}
      if(sessions.size>=capacity)return reject("CATALOG_SCAN_CAPACITY",true);
      s.id=randomBytes(32).toString("hex");sessions.set(s.id,s);
    }
    const work=(async()=>{
      const budget={bytes:0,previousBytes:s.bytes,maxSessionBytes},deadline=started+s.limits.timeoutMs;
      let failure:CatalogFailure|undefined;
      try {
        while(!s.complete && s.nextPage<=s.limits.maxPages) {
          if(s.expiresAt<=now())throw new CatalogFailure("CATALOG_SCAN_EXPIRED");
          if(s.bytes>=maxSessionBytes)throw new CatalogFailure("CATALOG_SESSION_BYTE_LIMIT",false);
          if(performance.now()>=deadline)throw new CatalogFailure("CATALOG_CALL_BUDGET_EXHAUSTED");
          const numbers=Array.from({length:Math.min(s.limits.concurrency,s.limits.maxPages-s.nextPage+1)},(_,i)=>s.nextPage+i).filter(page=>!s.pending.has(page));
          s.requestedPages+=numbers.length;
          const outcomes=await Promise.allSettled(numbers.map(page=>withFetchSlot(()=>fetchPage(`${s.catalog}?limit=250&page=${page}`,page,fetcher,s.limits,deadline,budget),deadline)));
          const failures=new Map<number,unknown>();
          outcomes.forEach((result,i)=>{if(result.status==="fulfilled")s.pending.set(numbers[i],result.value);else failures.set(numbers[i],result.reason);});
          if(s.expiresAt<=now())throw new CatalogFailure("CATALOG_SCAN_EXPIRED");
          for(;;) {
            const page=s.pending.get(s.nextPage);
            if(!page){if(failures.has(s.nextPage))throw failures.get(s.nextPage);break;}
            const {rows,receipt}=page;
            if(!rows.length) {
              if([...s.pending].some(([number,p])=>number>s.nextPage&&p.rows.length>0))throw new CatalogFailure("INCONSISTENT_CATALOG_PAGINATION",false);
              s.pages.push(receipt);s.nextPage++;s.complete=true;s.pending.clear();break;
            }
            if(s.ids.size+rows.length>s.limits.maxProducts)throw new CatalogFailure("CATALOG_PRODUCT_LIMIT",false);
            const ids=new Set<string>(),urls=new Set<string>();
            for(const row of rows) {
              if(s.ids.has(row.id)||s.urls.has(row.url)||ids.has(row.id)||urls.has(row.url))throw new CatalogFailure("DUPLICATE_CATALOG_PRODUCT",false);
              ids.add(row.id);urls.add(row.url);
            }
            const scoped=evaluateOnepageProductTypeScope({brand:s.brand,requested_product_type:s.line,scan_complete:true,has_more_pages:false,products:rows});
            if(scoped.issues.some(issue=>issue!=="NO_EXACT_PRODUCT_TYPE_MATCH"))throw new CatalogFailure("CATALOG_SCOPE_EVALUATOR_REJECTED",false);
            const matches="products" in scoped?scoped.products:[];
            if(s.products.length+matches.length>s.limits.maxMatches)throw new CatalogFailure("EXACT_MATCH_POOL_LIMIT",false);
            // Commit a whole validated page atomically, so retries never inherit
            // half a page or skip the first unaccepted page after an error.
            for(const row of rows) {
              s.ids.add(row.id);s.urls.add(row.url);const type=normalized(row.product_type);
              if(type&&type!==normalized(s.line)&&!s.types.has(type)&&s.types.size<30)s.types.set(type,row.product_type.trim());
            }
            s.products.push(...matches);s.pages.push(receipt);s.pending.delete(s.nextPage);s.nextPage++;
          }
        }
        if(!s.complete)throw new CatalogFailure("CATALOG_PAGE_LIMIT",false);
        if(!s.products.length)throw new CatalogFailure("NO_EXACT_PRODUCT_TYPE_MATCH",false);
        const finalScope=evaluateOnepageProductTypeScope({brand:s.brand,requested_product_type:s.line,scan_complete:true,has_more_pages:false,products:s.products});
        if(finalScope.status!=="MATCHED_REQUIRES_HOST_PDP_REVIEW")throw new CatalogFailure("CATALOG_SCOPE_EVALUATOR_REJECTED",false);
      } catch(error) {
        failure=error instanceof CatalogFailure?error:new CatalogFailure("CATALOG_FETCH_UNAVAILABLE");
        // A fetched but rejected current page must be refetched on retry, not
        // promoted from the speculative page cache after a source correction.
        if(!isBudgetPause(failure.code))s.pending.delete(s.nextPage);
      }
      s.bytes+=budget.bytes;
      if(failure?.code==="CATALOG_SCAN_EXPIRED"||requiresRestart(failure?.code)||
        (failure&&!failure.retryable&&!isBudgetPause(failure.code)&&!s.complete)){sessions.delete(s.id);s.id="";s.pending.clear();}
      return structuredClone(resultFor(s,failure,budget.bytes,performance.now()-started));
    })();
    s.inFlight=work;
    try{return structuredClone(await work);}finally{s.inFlight=undefined;}
  };
}

export const resolveOnepageNamedProductSource=createOnepageNamedProductSourceResolver();
