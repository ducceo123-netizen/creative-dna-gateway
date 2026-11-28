import test from "node:test";
import {strict as assert} from "node:assert";
import {resolveOnepageStorefrontSource,onepageStorefrontSourceUrl,onepageStorefrontProductTypeFilter} from "../uid-onepage-storefront-source.ts";
import {createOnepageNamedProductSourceResolver,onepageNamedSourceUrls} from "../uid-onepage-source-resolution.ts";

const input={brand:"PawfectHouse",product_line:"Oven Skirt"};
const row=(id:number|string,type="Oven Skirt",extra:Record<string,unknown>={})=>({id:`gid://shopify/Product/${id}`,handle:`product-${id}`,title:`Product ${id}`,productType:type,...extra});
const response=(nodes:unknown[],hasNextPage=false,endCursor:string|null=null,extra:Record<string,unknown>={})=>new Response(JSON.stringify({data:{products:{nodes,pageInfo:{hasNextPage,endCursor}}},...extra}),{headers:{"content-type":"application/json"}});

test("documented exact-type query paginates all eligible rows and records actual GraphQL provenance",async()=>{
  const calls:any[]=[];
  const fetcher:typeof fetch=async(url,init)=>{
    const body=JSON.parse(String(init?.body));calls.push({url:String(url),init,body});
    return body.variables.after?response([row("90071992547409931234")],false,"Yg=="):response([row(1)],true,"YQ==");
  };
  const {result,fallback_allowed}=await resolveOnepageStorefrontSource(input,fetcher);
  assert.equal(result.status,"RESOLVED");assert.equal(fallback_allowed,false);
  assert.deepEqual(result.product_ids,["1","90071992547409931234"]);
  assert.equal(result.source_url,"https://pawfecthouse.com/api/2026-10/graphql.json");
  assert.equal(result.products[1].url,"https://pawfecthouse.com/products/product-90071992547409931234");
  assert.equal(result.catalog_complete,true);assert.equal(result.has_more_pages,false);assert.equal(result.whole_store_scan_complete,false);
  assert.equal(result.visibility_scope,"PUBLIC_TOKENLESS_STOREFRONT_QUERY");assert.match(result.publication_note,/Parity.*not established/);
  assert.equal(result.evidence.authority,"TOKENLESS_STOREFRONT_EXACT_TYPE_QUERY");assert.equal(result.evidence.pagination,"STOREFRONT_CURSOR_UNTIL_HAS_NEXT_FALSE");
  assert.equal(result.evidence.page_count,2);assert.equal(result.evidence.scanned_count,2);assert.equal(result.pixels_inspected,false);assert.equal(result.pdp_review_required,true);
  assert.deepEqual(calls.map(c=>c.body.variables),[{filter:'product_type:"Oven Skirt"',after:null},{filter:'product_type:"Oven Skirt"',after:"YQ=="}]);
  for(const call of calls){assert.equal(call.init.method,"POST");assert.equal(call.init.redirect,"manual");assert.equal(call.init.credentials,"omit");assert.equal(new Headers(call.init.headers).has("authorization"),false);assert.equal(new Headers(call.init.headers).has("X-Shopify-Storefront-Access-Token"),false);assert.ok(!/\bmutation\b/.test(call.body.query));}
});

test("every returned productType is independently exact filtered without title-based widening",async()=>{
  let n=0;const fetcher:typeof fetch=async()=>++n===1?response([row(1,"Apron",{title:"Oven Skirt"}),row(2,"Oven Skirts")],true,"YQ=="):response([row(3,"  OVEN   SKIRT ")],false,"Yg==");
  const {result}=await resolveOnepageStorefrontSource(input,fetcher);
  assert.equal(result.status,"RESOLVED");assert.deepEqual(result.product_ids,["3"]);assert.equal(result.evidence.scanned_count,3);
  assert.deepEqual(result.available_product_types,["Apron","Oven Skirts"]);assert.equal(n,2);
  const missing=await resolveOnepageStorefrontSource(input,async()=>response([row(1,"Apron")]));
  assert.deepEqual(missing.result.issues,["NO_EXACT_PRODUCT_TYPE_MATCH"]);assert.equal(missing.result.catalog_complete,true);assert.equal(missing.fallback_allowed,false);
});

test("fixed brand endpoints and search/GraphQL escaping reject endpoint or query injection",async()=>{
  for(const [brand,host] of [["PawfectHouse","pawfecthouse.com"],["GiftSoul","giftsoul.co"],["SoulPrise","soulprise.co"]]){
    assert.equal(onepageStorefrontSourceUrl(brand),`https://${host}/api/2026-10/graphql.json`);
    assert.deepEqual(onepageNamedSourceUrls(brand),[`https://${host}/products.json`,`https://${host}/api/2026-10/graphql.json`]);
  }
  for(const brand of ["constructor","__proto__","https://evil.example","pawfecthouse.com:443"]){assert.equal(onepageStorefrontSourceUrl(brand),null);assert.deepEqual(onepageNamedSourceUrls(brand),[]);}
  const malicious='Oven" OR product_type:"Apron\\(x)';let body:any;
  const result=await resolveOnepageStorefrontSource({...input,product_line:malicious},async(_url,init)=>{body=JSON.parse(String(init?.body));return response([row(1,malicious)]);});
  assert.equal(result.result.status,"RESOLVED");assert.equal(body.variables.filter,onepageStorefrontProductTypeFilter(malicious));
  assert.ok(body.variables.filter.includes('\\"'));assert.ok(body.variables.filter.includes('product_type\\:'));assert.ok(body.variables.filter.includes('\\\\\\('));
  assert.equal(body.query.includes(malicious),false);assert.equal(body.variables.after,null);
});

test("GraphQL partial errors fail closed and never trigger the JSON fallback",async()=>{
  for(const errors of [[{message:"partial",extensions:{code:"INTERNAL"}}],[{message:"access",extensions:{code:"ACCESS_DENIED"}}]]){
    const result=await resolveOnepageStorefrontSource(input,async()=>response([row(1)],false,null,{errors}));
    assert.deepEqual(result.result.issues,["STOREFRONT_GRAPHQL_ERRORS"]);assert.equal(result.fallback_allowed,false);assert.equal(result.result.catalog_complete,false);assert.deepEqual(result.result.products,[]);
  }
  let n=0;
  const later=await resolveOnepageStorefrontSource(input,async()=>++n===1?response([row(1)],true,"YQ=="):new Response("",{status:403}));
  assert.equal(later.fallback_allowed,false);assert.equal(later.result.catalog_complete,false);assert.deepEqual(later.result.product_ids,["1"]);
});

test("only genuine initial unavailable/unsupported tokenless access allows fallback",async()=>{
  for(const status of [401,403,404,405,501])assert.equal((await resolveOnepageStorefrontSource(input,async()=>new Response("",{status}))).fallback_allowed,true);
  const denied=await resolveOnepageStorefrontSource(input,async()=>new Response(JSON.stringify({errors:[{extensions:{code:"ACCESS_DENIED"}}]}),{headers:{"content-type":"application/json"}}));
  assert.equal(denied.fallback_allowed,true);
  for(const status of [429,500,503])assert.equal((await resolveOnepageStorefrontSource(input,async()=>new Response("",{status}))).fallback_allowed,false);
  assert.equal((await resolveOnepageStorefrontSource(input,async()=>{throw Error("network");})).fallback_allowed,false);
  assert.equal((await resolveOnepageStorefrontSource(input,async()=>new Response("",{status:302,headers:{location:"https://evil.example"}}))).fallback_allowed,false);
});

test("pagination requires valid progressing cursors, unique IDs/PDPs and a terminal false flag",async()=>{
  const cases=[
    [()=>response([row(1)],true,null),"INCOMPLETE_STOREFRONT_PAGINATION"],
    [()=>response([],true,"YQ=="),"INCOMPLETE_STOREFRONT_PAGINATION"],
    [()=>response([row(1)],true,'evil"}mutation'),"INVALID_STOREFRONT_CURSOR"],
  ] as const;
  for(const [make,code] of cases)assert.deepEqual((await resolveOnepageStorefrontSource(input,async()=>make())).result.issues,[code]);
  for(const kind of ["id","url","cursor"]){let n=0;
    const r=await resolveOnepageStorefrontSource(input,async()=>++n===1?response([row(1)],true,"YQ=="):response([row(kind==="id"?1:2,"Oven Skirt",kind==="url"?{handle:"product-1"}:{})],false,kind==="cursor"?"YQ==":"Yg=="));
    assert.deepEqual(r.result.issues,[kind==="cursor"?"STOREFRONT_CURSOR_DID_NOT_ADVANCE":"DUPLICATE_STOREFRONT_PRODUCT"]);assert.equal(r.result.catalog_complete,false);
  }
  const capped=await resolveOnepageStorefrontSource(input,async()=>response([row(1)],true,"YQ=="),{maxPages:1});
  assert.deepEqual(capped.result.issues,["STOREFRONT_PAGE_LIMIT"]);assert.equal(capped.result.catalog_complete,false);
});

test("invalid product fields, unsafe GIDs/handles and malformed bodies cannot confer scope",async()=>{
  const missing:any=row(1);delete missing.productType;
  for(const bad of [missing,row(1,"Oven Skirt",{id:"gid://shopify/Customer/1"}),row(1,"Oven Skirt",{id:"9007199254740993"}),row(1,"Oven Skirt",{handle:"../admin"}),row(1,"Oven Skirt",{title:""})]){
    const r=await resolveOnepageStorefrontSource(input,async()=>response([bad]));assert.deepEqual(r.result.issues,["INVALID_STOREFRONT_PRODUCT"]);assert.equal(r.fallback_allowed,false);
  }
  for(const data of ["{}","{broken",JSON.stringify({data:{products:{nodes:[],pageInfo:{hasNextPage:"false",endCursor:null}}}})]){
    const r=await resolveOnepageStorefrontSource(input,async()=>new Response(data,{headers:{"content-type":"application/json"}}));assert.equal(r.result.status,"BLOCKED");assert.equal(r.fallback_allowed,false);
  }
});

test("actual bytes, row/match caps and ignored-abort timeouts remain bounded",async()=>{
  const big=await resolveOnepageStorefrontSource(input,async()=>response([row(1)]),{maxPageBytes:20});assert.deepEqual(big.result.issues,["STOREFRONT_PAGE_BYTE_LIMIT"]);
  const total=await resolveOnepageStorefrontSource(input,async()=>response([row(1)]),{maxTotalBytes:20});assert.deepEqual(total.result.issues,["STOREFRONT_TOTAL_BYTE_LIMIT"]);
  const pool=await resolveOnepageStorefrontSource(input,async()=>response([row(1),row(2)]),{maxMatches:1});assert.deepEqual(pool.result.issues,["EXACT_MATCH_POOL_LIMIT"]);
  const rows=await resolveOnepageStorefrontSource(input,async()=>response([row(1),row(2)]),{maxProducts:1});assert.deepEqual(rows.result.issues,["STOREFRONT_PRODUCT_LIMIT"]);
  const started=performance.now();let signal:AbortSignal|null|undefined;
  const timed=await resolveOnepageStorefrontSource(input,async(_url,init)=>{signal=init?.signal;return new Promise<Response>(()=>{});},{timeoutMs:15});
  assert.ok(performance.now()-started<500);assert.equal(signal?.aborted,true);assert.deepEqual(timed.result.issues,["STOREFRONT_TIMEOUT"]);assert.equal(timed.fallback_allowed,false);
  let cancelled=false;
  const stalled=await resolveOnepageStorefrontSource(input,async()=>new Response(new ReadableStream<Uint8Array>({start(c){c.enqueue(new TextEncoder().encode('{"data":'));},cancel(){cancelled=true;}}),{headers:{"content-type":"application/json"}}),{timeoutMs:15});
  assert.equal(cancelled,true);assert.deepEqual(stalled.result.issues,["STOREFRONT_TIMEOUT"]);
});

test("a server version fallback is never mislabeled as verified 2026-10 evidence",async()=>{
  const result=await resolveOnepageStorefrontSource(input,async()=>{
    const value=response([row(1)]);value.headers.set("x-shopify-api-version","2027-01");return value;
  });
  assert.deepEqual(result.result.issues,["STOREFRONT_VERSION_MISMATCH"]);assert.equal(result.result.source_verified_by_server,false);assert.equal(result.fallback_allowed,false);
});

test("production resolver prefers actual Storefront source, with JSON continuation only after unsupported access",async()=>{
  const calls:string[]=[];const resolve=createOnepageNamedProductSourceResolver({requestStartIntervalMs:0});
  const fast=await resolve(input,async(url)=>{calls.push(String(url));return response([row(1)]);});
  assert.equal(fast.source_url,onepageStorefrontSourceUrl(input.brand));assert.equal(fast.whole_store_scan_complete,false);assert.equal(calls.length,1);
  calls.length=0;
  const fallback=await resolve(input,async(url)=>{
    calls.push(String(url));if(String(url).endsWith("graphql.json"))return new Response("",{status:404});
    const page=Number(new URL(String(url)).searchParams.get("page"));
    return new Response(JSON.stringify({products:page===1?[{id:1,title:"One",handle:"one",product_type:"Oven Skirt"}]:[]}),{headers:{"content-type":"application/json"}});
  });
  assert.equal(fallback.status,"RESOLVED");assert.equal(fallback.source_url,"https://pawfecthouse.com/products.json");assert.equal(fallback.whole_store_scan_complete,true);
  assert.equal(calls.filter(u=>u.endsWith("graphql.json")).length,1);
});

test("concurrent fast queries hold the shared four slots through body decoding",async()=>{
  const resolve=createOnepageNamedProductSourceResolver({requestStartIntervalMs:0});
  let release!:()=>void,activeBodies=0,peak=0,requests=0;
  const held=new Promise<void>(done=>{release=done;});
  const fetcher:typeof fetch=async()=>{
    requests++;
    const body=new ReadableStream<Uint8Array>({async start(controller){
      activeBodies++;peak=Math.max(peak,activeBodies);await held;
      controller.enqueue(new TextEncoder().encode(JSON.stringify({data:{products:{nodes:[row(1)],pageInfo:{hasNextPage:false,endCursor:null}}}})));
      controller.close();activeBodies--;
    }});
    return new Response(body,{headers:{"content-type":"application/json"}});
  };
  const work=Array.from({length:5},()=>resolve(input,fetcher));
  await new Promise(done=>setTimeout(done,5));
  assert.equal(requests,4);assert.equal(activeBodies,4);release();
  const results=await Promise.all(work);
  assert.ok(results.every(r=>r.status==="RESOLVED"));assert.equal(requests,5);assert.equal(peak,4);
});
