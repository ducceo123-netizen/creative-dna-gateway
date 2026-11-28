import test from "node:test";
import {strict as assert} from "node:assert";
import {createOnepageNamedProductSourceResolver as createResolver, onepageCatalogSourceUrl, NAMED_PRODUCT_SCAN_LIMITS} from "../uid-onepage-source-resolution.ts";
const createOnepageNamedProductSourceResolver=(options:Parameters<typeof createResolver>[0]={})=>createResolver({requestStartIntervalMs:0,preferStorefront:false,...options});
const resolveOnepageNamedProductSource:(ReturnType<typeof createOnepageNamedProductSourceResolver>)=(...args)=>createOnepageNamedProductSourceResolver()(...args);

const input={brand:"PawfectHouse",product_line:"Oven Skirt"};
const row=(id:number|string,type="Oven Skirt",extra:Record<string,unknown>={})=>({id,title:`Product ${id}`,handle:`product-${id}`,product_type:type,...extra});
const json=(products:unknown[],headers:Record<string,string>={})=>new Response(JSON.stringify({products}),{headers:{"content-type":"application/json; charset=utf-8",...headers}});
const mock=(pages:unknown[][],calls:string[]=[]):typeof fetch=>async(url,init)=>{
  calls.push(String(url));
  assert.equal(init?.redirect,"manual");assert.equal(init?.credentials,"omit");
  assert.equal(new Headers(init?.headers).has("Authorization"),false);
  const page=Number(new URL(String(url)).searchParams.get("page"));
  return json(pages[page-1]||[]);
};

test("exact named family covers every page and keeps all IDs/PDPs without collection invention",async()=>{
  const calls:string[]=[];
  const result=await resolveOnepageNamedProductSource({...input,product_line:"  OVEN   SKIRT "},mock([
    [row(1),row(2,"Apron",{title:"Oven Skirt Apron",handle:"oven-skirt-apron"})],
    [row("90071992547409931234"," Oven   Skirt "),row(3,"Oven Skirts")],
    [row(4,"Oven Skirt",{body_html:"<script>untrusted catalog body</script>",images:[{src:"https://invalid.example/private"}]})],[],
  ],calls));
  assert.equal(result.status,"RESOLVED");assert.equal(result.catalog_complete,true);assert.equal(result.has_more_pages,false);
  assert.deepEqual(result.product_ids,["1","90071992547409931234","4"]);
  assert.deepEqual(result.products.map(p=>p.url),["https://pawfecthouse.com/products/product-1","https://pawfecthouse.com/products/product-90071992547409931234","https://pawfecthouse.com/products/product-4"]);
  assert.equal(result.source_url,"https://pawfecthouse.com/products.json");assert.equal(result.source_type,"collection");
  assert.equal(result.evidence.scanned_count,5);assert.equal(result.evidence.page_count,4);
  assert.deepEqual(result.evidence.pages.map(p=>p.count),[2,2,1,0]);assert.ok(result.evidence.pages.every(p=>/^[a-f0-9]{64}$/.test(p.sha256)));
  assert.equal(result.source_verified_by_server,true);assert.equal(result.pixels_inspected,false);assert.equal(result.pdp_review_required,true);
  assert.equal(result.evidence.transactional_snapshot,false);assert.equal(result.title_contains_fallback,false);
  assert.equal(JSON.stringify(result).includes("untrusted catalog body"),false);
  assert.deepEqual(calls.map(u=>new URL(u).search),["?limit=250&page=1","?limit=250&page=2","?limit=250&page=3","?limit=250&page=4"]);
});

test("scans beyond the evaluator's 2000-row input bound without truncating family scope",async()=>{
  const rows=Array.from({length:2252},(_,i)=>row(i+1,i>=2250?"Oven Skirt":"Poster"));
  const pages=Array.from({length:Math.ceil(rows.length/250)},(_,i)=>rows.slice(i*250,(i+1)*250));
  const result=await resolveOnepageNamedProductSource(input,mock(pages));
  assert.equal(result.status,"RESOLVED");assert.equal(result.evidence.scanned_count,2252);
  assert.deepEqual(result.product_ids,["2251","2252"]);assert.equal(result.evidence.pages.at(-1)?.count,0);
});

test("complete mismatch returns actual type choices and never fuzzy/title matches",async()=>{
  const result=await resolveOnepageNamedProductSource(input,mock([[row(1,"Oven Skirts"),row(2,"Apron",{title:"Oven Skirt"}),row(3,"",{title:"Oven Skirt"})]]));
  assert.equal(result.status,"BLOCKED");assert.equal(result.catalog_complete,true);
  assert.deepEqual(result.products,[]);assert.deepEqual(result.issues,["NO_EXACT_PRODUCT_TYPE_MATCH"]);
  assert.deepEqual(result.available_product_types,["Oven Skirts","Apron"]);
  assert.equal(result.recovery.action,"CLARIFY_EXACT_PRODUCT_TYPE");assert.equal(result.retryable,false);
});

test("all three brand origins are exact, fixed, and reject arbitrary/prototype inputs",async()=>{
  for(const [brand,host] of [["PawfectHouse","pawfecthouse.com"],["GiftSoul","giftsoul.co"],["SoulPrise","soulprise.co"]]) {
    const calls:string[]=[];const result=await resolveOnepageNamedProductSource({brand,product_line:"Oven Skirt"},mock([[row(1)]],calls));
    assert.equal(onepageCatalogSourceUrl(brand),`https://${host}/products.json`);
    assert.equal(result.status,"RESOLVED");assert.ok(calls.every(u=>new URL(u).origin===`https://${host}`));
  }
  let called=false;const never:typeof fetch=async()=>{called=true;throw Error("unexpected fetch");};
  for(const brand of ["__proto__","constructor","https://pawfecthouse.com","pawfecthouse.com:443","localhost"]) {
    assert.equal(onepageCatalogSourceUrl(brand),null);
    const result=await resolveOnepageNamedProductSource({brand,product_line:"Oven Skirt"},never);
    assert.deepEqual(result.issues,["INVALID_NAMED_PRODUCT_INPUT"]);
  }
  for(const product_line of ["", " ","x".repeat(161)]) assert.equal((await resolveOnepageNamedProductSource({...input,product_line},never)).status,"BLOCKED");
  assert.equal(called,false);
});

test("invalid/missing rows, unsafe IDs and unsafe handles invalidate the scan",async()=>{
  const missingType:any=row(1);delete missingType.product_type;
  const invalid=[null,{},missingType,row(Number.MAX_SAFE_INTEGER+1),row("-1"),row(1,"Oven Skirt",{handle:"../private"}),
    row(1,"Oven Skirt",{handle:"test?next=https://evil.example"}),row(1,"Oven Skirt",{handle:"a%2fb"}),row(1,"Oven Skirt",{title:""})];
  for(const candidate of invalid) {
    const result=await resolveOnepageNamedProductSource(input,mock([[candidate]]));
    assert.equal(result.status,"BLOCKED");assert.equal(result.catalog_complete,false);assert.deepEqual(result.issues,["INVALID_CATALOG_PRODUCT"]);
  }
});

test("duplicate IDs, duplicate PDPs, and nonempty pages after terminal empty fail closed",async()=>{
  for(const pages of [[[row(1)],[row(1)]],[[row(1)],[row(2,"Oven Skirt",{handle:"product-1"})]]]) {
    const result=await resolveOnepageNamedProductSource(input,mock(pages));
    assert.deepEqual(result.issues,["DUPLICATE_CATALOG_PRODUCT"]);assert.equal(result.catalog_complete,false);
  }
  const inconsistent=await resolveOnepageNamedProductSource(input,mock([[row(1)],[],[row(2)],[]]));
  assert.deepEqual(inconsistent.issues,["INCONSISTENT_CATALOG_PAGINATION"]);assert.equal(inconsistent.catalog_complete,false);
});

test("redirect, wrong MIME, malformed JSON and unexpected catalog shape are rejected",async()=>{
  const factories=[
    [()=>new Response("",{status:302,headers:{location:"http://127.0.0.1/secret"}}),"CATALOG_REDIRECT_REJECTED"],
    [()=>new Response("<html>login</html>",{headers:{"content-type":"text/html"}}),"INVALID_CATALOG_CONTENT_TYPE"],
    [()=>new Response("{broken",{headers:{"content-type":"application/json"}}),"INVALID_CATALOG_JSON"],
    [()=>new Response("{}",{headers:{"content-type":"application/json"}}),"INVALID_CATALOG_RESPONSE"],
    [()=>json(Array.from({length:251},(_,i)=>row(i+1))),"INVALID_CATALOG_RESPONSE"],
  ] as const;
  for(const [make,code] of factories) {
    const result=await resolveOnepageNamedProductSource(input,async()=>make());
    assert.deepEqual(result.issues,[code]);assert.equal(result.source_verified_by_server,false);
    assert.equal(JSON.stringify(result).includes("127.0.0.1"),false);
  }
});

test("mid-scan failure retains only partial metadata, never claims complete and redacts errors",async()=>{
  const fetcher:typeof fetch=async(url)=>{
    const page=Number(new URL(String(url)).searchParams.get("page"));
    if(page===2) throw Error("credential=DO_NOT_ECHO");
    return json(page===1?[row(1)]:[]);
  };
  const result=await resolveOnepageNamedProductSource(input,fetcher);
  assert.deepEqual(result.issues,["CATALOG_FETCH_UNAVAILABLE"]);assert.equal(result.retryable,true);
  assert.equal(result.catalog_complete,false);assert.equal(result.has_more_pages,true);assert.deepEqual(result.product_ids,["1"]);
  assert.equal(JSON.stringify(result).includes("DO_NOT_ECHO"),false);
  const limited=await resolveOnepageNamedProductSource(input,async()=>new Response("",{status:429}));
  assert.deepEqual(limited.issues,["CATALOG_RATE_LIMITED"]);assert.equal(limited.retryable,true);
  const after=await resolveOnepageNamedProductSource(input,async()=>new Response("",{status:429,headers:{"retry-after":"2"}}));
  assert.equal(after.retry_after_ms,2000);
});

test("hard page/product/matched-pool limits block rather than certify a truncated family",async()=>{
  const pageLimit=await resolveOnepageNamedProductSource(input,mock([[row(1)],[row(2)],[row(3)]]),{maxPages:2});
  assert.deepEqual(pageLimit.issues,["CATALOG_PAGE_LIMIT"]);assert.equal(pageLimit.catalog_complete,false);
  const productLimit=await resolveOnepageNamedProductSource(input,mock([[row(1,"Poster")],[row(2)]]),{maxProducts:1});
  assert.deepEqual(productLimit.issues,["CATALOG_PRODUCT_LIMIT"]);assert.equal(productLimit.catalog_complete,false);
  const poolLimit=await resolveOnepageNamedProductSource(input,mock([[row(1)],[row(2)]]),{maxMatches:1});
  assert.deepEqual(poolLimit.issues,["EXACT_MATCH_POOL_LIMIT"]);assert.deepEqual(poolLimit.product_ids,["1"]);
  assert.equal(poolLimit.source_verified_by_server,false);assert.equal(poolLimit.catalog_complete,false);
  let called=false;const fetcher:typeof fetch=async()=>{called=true;return json([]);};
  const invalid=await resolveOnepageNamedProductSource(input,fetcher,{maxMatches:NAMED_PRODUCT_SCAN_LIMITS.maxMatches+1});
  assert.deepEqual(invalid.issues,["INVALID_SCAN_LIMITS"]);assert.equal(called,false);
});

test("actual streamed bytes enforce both per-page and cumulative limits",async()=>{
  const perPage=await resolveOnepageNamedProductSource(input,mock([[row(1)]]),{maxPageBytes:20});
  assert.deepEqual(perPage.issues,["CATALOG_PAGE_BYTE_LIMIT"]);assert.equal(perPage.catalog_complete,false);
  const total=await resolveOnepageNamedProductSource(input,mock([[row(1)],[row(2)],[row(3)]]),{maxTotalBytes:200});
  assert.deepEqual(total.issues,["CATALOG_TOTAL_BYTE_LIMIT"]);assert.equal(total.catalog_complete,false);
  const declared=await resolveOnepageNamedProductSource(input,async()=>json([],{"content-length":String(10*1024*1024)}));
  assert.deepEqual(declared.issues,["CATALOG_PAGE_BYTE_LIMIT"]);
});

test("deadline covers ignored-abort fetches and stalled bodies; concurrency is bounded",async()=>{
  let active=0,peak=0;const signals:AbortSignal[]=[];
  const never:typeof fetch=async(_url,init)=>{
    active++;peak=Math.max(peak,active);signals.push(init!.signal!);
    return new Promise<Response>(()=>{});
  };
  const started=performance.now();const stalled=await resolveOnepageNamedProductSource(input,never,{timeoutMs:25,concurrency:2});
  assert.ok(performance.now()-started<500);assert.equal(peak,2);assert.ok(signals.every(s=>s.aborted));
  assert.deepEqual(stalled.issues,["CATALOG_CALL_BUDGET_EXHAUSTED"]);assert.equal(stalled.catalog_complete,false);assert.equal(stalled.status,"IN_PROGRESS");
  let cancelled=0;
  const body:typeof fetch=async()=>new Response(new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new TextEncoder().encode('{"products":['));},cancel(){cancelled++;}}),{headers:{"content-type":"application/json"}});
  const response=await resolveOnepageNamedProductSource(input,body,{timeoutMs:25,concurrency:1});
  assert.deepEqual(response.issues,["CATALOG_CALL_BUDGET_EXHAUSTED"]);assert.equal(cancelled,1);
});

test("available alternatives stay bounded without dropping any matched product",async()=>{
  const rows=Array.from({length:50},(_,i)=>row(i+1,`Other ${i+1}`));rows.push(row(51));
  const result=await resolveOnepageNamedProductSource(input,mock([rows]));
  assert.equal(result.status,"RESOLVED");assert.equal(result.available_product_types.length,30);assert.deepEqual(result.product_ids,["51"]);
});

test("two bounded calls resume server-owned metadata and resolve only after terminal empty",async()=>{
  const resolve=createOnepageNamedProductSourceResolver(),calls:string[]=[];
  const fetcher=mock([[row(1)],[row(2)],[]],calls);
  const first=await resolve(input,fetcher,{maxTotalBytes:150,concurrency:1});
  assert.equal(first.status,"IN_PROGRESS");assert.equal(first.catalog_complete,false);assert.equal(first.source_verified_by_server,false);
  assert.equal(first.next_action,"CONTINUE_CATALOG_SCAN");assert.equal(first.recovery.action,"CONTINUE_CATALOG_SCAN");
  assert.match(first.scan_id!,/^[a-f0-9]{64}$/);assert.deepEqual(first.product_ids,["1"]);
  first.products[0].id="caller-cannot-mutate-cache";
  const second=await resolve({...input,scan_id:first.scan_id!,products:[row(999)]} as any,fetcher);
  assert.equal(second.status,"RESOLVED");assert.equal(second.catalog_complete,true);assert.deepEqual(second.product_ids,["1","2"]);
  assert.deepEqual(calls.map(u=>Number(new URL(u).searchParams.get("page"))),[1,2,2,3]);
  const count=calls.length;
  const replay=await resolve({...input,scan_id:first.scan_id!},fetcher);
  assert.equal(replay.status,"RESOLVED");assert.deepEqual(replay.product_ids,["1","2"]);assert.equal(calls.length,count);
  assert.equal(replay.evidence.call_bytes,0);assert.equal(replay.evidence.bytes,second.evidence.bytes);
});

test("scan cursors reject forged, expired, restarted or mismatched scope without leaking cached products",async()=>{
  let now=1000;const resolve=createOnepageNamedProductSourceResolver({now:()=>now,sessionTtlMs:20});
  const fetcher=mock([[row(1)],[row(2)]]);
  const first=await resolve(input,fetcher,{maxTotalBytes:150,concurrency:1});
  assert.equal(first.status,"IN_PROGRESS");
  for(const next of [{...input,scan_id:"a".repeat(64)},{...input,brand:"GiftSoul",scan_id:first.scan_id!},{...input,product_line:"Oven Skirts",scan_id:first.scan_id!}]){
    const result=await resolve(next,fetcher);assert.deepEqual(result.issues,["CATALOG_SCAN_UNAVAILABLE"]);assert.deepEqual(result.products,[]);assert.equal(result.scan_id,null);
  }
  const restarted=await createOnepageNamedProductSourceResolver()({...input,scan_id:first.scan_id!},fetcher);
  assert.deepEqual(restarted.issues,["CATALOG_SCAN_UNAVAILABLE"]);
  now=1021;
  const expired=await resolve({...input,scan_id:first.scan_id!},fetcher);assert.deepEqual(expired.issues,["CATALOG_SCAN_UNAVAILABLE"]);assert.deepEqual(expired.products,[]);
  const replacement=await resolve(input,fetcher,{maxTotalBytes:150,concurrency:1});assert.equal(replacement.status,"IN_PROGRESS");assert.notEqual(replacement.scan_id,first.scan_id);
});

test("same-id concurrent calls singleflight and immutable replies prevent duplicate ingestion",async()=>{
  const resolve=createOnepageNamedProductSourceResolver();
  const first=await resolve(input,mock([[row(1)],[row(2)]]),{maxTotalBytes:150,concurrency:1});
  let release!:()=>void;const held=new Promise<void>(done=>{release=done;});let requests=0;
  const fetcher:typeof fetch=async(url)=>{requests++;await held;return json(Number(new URL(String(url)).searchParams.get("page"))===2?[row(2)]:[]);};
  const a=resolve({...input,scan_id:first.scan_id!},fetcher);
  const b=resolve({...input,product_line:"  OVEN  SKIRT ",scan_id:first.scan_id!},fetcher);
  release();const [one,two]=await Promise.all([a,b]);
  assert.deepEqual(one,two);assert.equal(requests,2);assert.deepEqual(one.product_ids,["1","2"]);
  one.products[0].title="mutated";assert.notEqual(two.products[0].title,"mutated");
});

test("transient failed page retains subsequent verified pages and retries only the gap",async()=>{
  const resolve=createOnepageNamedProductSourceResolver(),calls:number[]=[];
  let fail=true;
  const fetcher:typeof fetch=async(url)=>{const page=Number(new URL(String(url)).searchParams.get("page"));calls.push(page);if(page===1&&fail)throw Error("transient");return json(page<=2?[row(page)]:[]);};
  const first=await resolve(input,fetcher);
  assert.equal(first.status,"BLOCKED");assert.equal(first.retryable,true);assert.ok(first.scan_id);assert.equal(first.catalog_complete,false);
  fail=false;
  const second=await resolve({...input,scan_id:first.scan_id!},fetcher);
  assert.equal(second.status,"RESOLVED");assert.deepEqual(second.product_ids,["1","2"]);assert.deepEqual(calls,[1,2,3,4,1]);
});

test("server cache capacity is bounded and expiration frees slots without evicting live scans",async()=>{
  let now=1000;const resolve=createOnepageNamedProductSourceResolver({now:()=>now,maxSessions:2,sessionTtlMs:20});
  const fetcher=mock([[row(1)],[row(2)]]);
  const a=await resolve(input,fetcher,{maxTotalBytes:150,concurrency:1});
  const b=await resolve(input,fetcher,{maxTotalBytes:150,concurrency:1});assert.notEqual(a.scan_id,b.scan_id);
  const full=await resolve(input,fetcher);assert.deepEqual(full.issues,["CATALOG_SCAN_CAPACITY"]);assert.equal(full.scan_id,null);assert.equal(full.retryable,true);
  now=1021;
  assert.equal((await resolve(input,mock([[row(1)]]))).status,"RESOLVED");
});

test("completed cache entries yield capacity to new scans and evicted cursors restart honestly",async()=>{
  const resolve=createOnepageNamedProductSourceResolver();let first:string|undefined;
  for(let i=0;i<5;i++) {
    const result=await resolve(input,mock([[row(i+1)]]));assert.equal(result.status,"RESOLVED");if(i===0)first=result.scan_id!;
  }
  const evicted=await resolve({...input,scan_id:first},mock([[row(99)]]));
  assert.deepEqual(evicted.issues,["CATALOG_SCAN_UNAVAILABLE"]);assert.deepEqual(evicted.products,[]);
});

test("cumulative session byte limit survives continuation and never becomes a new call budget",async()=>{
  const pageBytes=Buffer.byteLength(JSON.stringify({products:[row(1)]}));
  const resolve=createOnepageNamedProductSourceResolver({maxSessionBytes:pageBytes*2});
  const first=await resolve(input,mock([[row(1)],[row(2)]]),{maxTotalBytes:pageBytes+20,concurrency:1});
  assert.equal(first.status,"IN_PROGRESS");
  const second=await resolve({...input,scan_id:first.scan_id!},mock([[row(1)],[row(2)]]));
  assert.equal(second.status,"BLOCKED");assert.deepEqual(second.issues,["CATALOG_SESSION_BYTE_LIMIT"]);
  assert.equal(second.retryable,false);assert.equal(second.catalog_complete,false);assert.deepEqual(second.product_ids,["1"]);
});

test("inconsistent pages invalidate the cursor and require a fresh scan instead of retrying cached corruption",async()=>{
  const resolve=createOnepageNamedProductSourceResolver();
  const first=await resolve(input,mock([[row(1)],[row(2)]]),{maxTotalBytes:150,concurrency:1});
  const corrupted=await resolve({...input,scan_id:first.scan_id!},mock([[row(1)],[row(1)]]));
  assert.deepEqual(corrupted.issues,["DUPLICATE_CATALOG_PRODUCT"]);assert.equal(corrupted.retryable,false);
  assert.equal(corrupted.recovery.action,"RESTART_CATALOG_SCAN");assert.equal(corrupted.scan_id,null);
  assert.deepEqual((await resolve({...input,scan_id:first.scan_id!},mock([[row(1)],[row(2)]]))).issues,["CATALOG_SCAN_UNAVAILABLE"]);
});

test("two active scan IDs share four network slots and timed-out queued waiters do not leak capacity",async()=>{
  const resolve=createOnepageNamedProductSourceResolver();
  let active=0,peak=0,requests=0;let release!:()=>void;
  const held=new Promise<void>(done=>{release=done;});
  const fetcher:typeof fetch=async()=>{active++;requests++;peak=Math.max(peak,active);await held;active--;return json([]);};
  const a=resolve(input,fetcher,{timeoutMs:1000});
  const b=resolve({...input,brand:"GiftSoul"},fetcher,{timeoutMs:20});
  await new Promise(done=>setTimeout(done,35));
  assert.equal(requests,4);assert.equal(peak,4);
  const queued=await b;assert.equal(queued.status,"IN_PROGRESS");assert.deepEqual(queued.issues,["CATALOG_CALL_BUDGET_EXHAUSTED"]);
  release();await a;
  const next=await resolve({...input,brand:"GiftSoul",scan_id:queued.scan_id!},mock([[row(1)]]));
  assert.equal(next.status,"RESOLVED");assert.equal(peak,4);
});

test("terminal limits release cache capacity while keeping partial evidence unverified",async()=>{
  const resolve=createOnepageNamedProductSourceResolver();
  for(let i=0;i<5;i++) {
    const failure=await resolve(input,mock([[row(1)],[row(2)]]),{maxMatches:1});
    assert.deepEqual(failure.issues,["EXACT_MATCH_POOL_LIMIT"]);assert.equal(failure.scan_id,null);assert.equal(failure.catalog_complete,false);
  }
  assert.equal((await resolve(input,mock([[row(1)]]))).status,"RESOLVED");
});

test("shared request pacing applies across sessions and consumes their bounded deadlines",async()=>{
  const resolve=createOnepageNamedProductSourceResolver({requestStartIntervalMs:20});
  const starts:number[]=[];
  const fetcher:typeof fetch=async()=>{starts.push(performance.now());return json([]);};
  await Promise.all([resolve(input,fetcher,{concurrency:1,timeoutMs:150}),resolve({...input,brand:"GiftSoul"},fetcher,{concurrency:1,timeoutMs:150})]);
  assert.equal(starts.length,2);assert.ok(starts[1]-starts[0]>=18);
});
