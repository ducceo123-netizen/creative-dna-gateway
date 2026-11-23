import {readBoundedReferenceBytes} from "./supabase/functions/_shared/private-reference-access.ts";
import {auditOnepageEoPixels,trustedEoImageUrl} from "./uid-eo-pixel-audit.ts";
export const EO_STORE_SCAN_VERSION="uid-eo-store-scan/2026-11-21.v1";
export const EO_STORE_SCAN_DESCRIPTION="Gateway performs a bounded LIVE scan of public product pages on one of the three verified UID brands, obtains Shopify product_type and real PDP section/image evidence, and decodes selected source image pixels. NEVER mark live pages EO-approved automatically. Does not replace the exact-product-type SKU inventory scan, and does not require Studio.";
const domains={pawfecthouse:"pawfecthouse.com",giftsoul:"giftsoul.co",soulprise:"soulprise.co"} as const;
type Brand=keyof typeof domains;
type Input={brand:Brand;product_type:string;related_terms:string[];seed_product_urls?:string[];limit?:number;inspect_pixels?:boolean};
const safeProduct=(host:string,value:string)=>{
 try{const u=new URL(value.replace(/&amp;/g,"&"),"https://"+host);
  if(u.protocol!=="https:"||!([host,"www."+host].includes(u.hostname))||u.port||u.username||u.password||
    !/^\/products\/[a-z0-9][a-z0-9-]*\/?$/i.test(u.pathname))return null;
  return "https://"+host+u.pathname.replace(/\/$/,"");
 }catch{return null;}
};
const safeImage=(host:string,value:string)=>{
 try{const u=new URL(value.trim().replace(/^\/\//,"https://").replace(/&amp;/g,"&"),"https://"+host);
  return trustedEoImageUrl(u.toString())?u.toString():null;
 }catch{return null;}
};
async function fetchStore(url:string,host:string,max:number,fetcher:typeof fetch){
 const u=new URL(url);
 if(u.protocol!=="https:"||u.hostname!==host||u.port)throw new Error("UNTRUSTED_STORE_ORIGIN");
 const r=await fetcher(url,{redirect:"manual",signal:AbortSignal.timeout(10000),
    headers:{Accept:"text/html,application/json","User-Agent":"UID-Brands-Eo-Reference-Research/1.0"}});
 if(!r.ok)throw new Error("HTTP_"+r.status);
 if(!/text\/html|application\/json|text\/javascript/.test(r.headers.get("content-type")||""))throw new Error("UNEXPECTED_CONTENT_TYPE");
 const b=await readBoundedReferenceBytes(r.body,max);
 if(!b)throw new Error("STORE_RESPONSE_TOO_LARGE");
 return new TextDecoder().decode(b);
}
/**
 * Resolve the exact Shopify product type from a user-supplied PDP URL.
 * A collection is intentionally not inferred from one item: collection tasks
 * need a verified multi-product inventory.
 */
export async function resolveOnepagePdpProductType(brand:Brand,sourceUrl:string,fetcher:typeof fetch=fetch){
 const host=domains[brand];
 if(!host||typeof sourceUrl!=="string")return {status:"INVALID_SOURCE",product_type:null};
 const page=safeProduct(host,sourceUrl);
 if(!page)return {status:"NOT_A_TRUSTED_PRODUCT_URL",product_type:null};
 const handle=new URL(page).pathname.split("/")[2];
 try{
  const body=await fetchStore("https://"+host+"/products/"+handle+".js",host,500000,fetcher);
  const data=JSON.parse(body);
  const type=typeof data.type==="string"?data.type.trim():"";
  if(!type||type.length>160)return {status:"PRODUCT_TYPE_MISSING",product_type:null};
  return {status:"EXACT_SHOPIFY_PRODUCT_TYPE",product_type:type,source_page:page};
 }catch(e){
  return {status:"PRODUCT_TYPE_FETCH_UNAVAILABLE",product_type:null,
   reason:String(e instanceof Error?e.message:e).slice(0,120)};
 }
}
const found=(text:string,host:string)=>{
 const links:string[]=[];
 try{const json=JSON.parse(text);const products=json?.resources?.results?.products||json?.products||[];
  if(Array.isArray(products))for(const p of products)links.push(typeof p.url==="string"?p.url:"/products/"+p.handle);
 }catch{for(const m of text.matchAll(/href=["']([^"']*\/products\/[a-z0-9-]+(?:\?[^"']*)?)["']/gi))links.push(m[1]);}
 return [...new Set(links.map(x=>safeProduct(host,x)).filter((x):x is string=>!!x))];
};
const imagesFromHtml=(html:string,host:string)=>{
 const urls:string[]=[];
 const start=html.search(/why\s+you(?:'|’|&#39;)?ll\s+love\s+it/i);
 const scope=start>=0?html.slice(Math.max(0,start-45000),start+150000):html.slice(0,110000);
 for(const m of scope.matchAll(/<img\b[^>]*>/gi)){
   const tag=m[0];const x=tag.match(/(?:data-src|src|data-original)=["']([^"']+)["']/i);
   if(x)urls.push(x[1]);else {
     const set=tag.match(/(?:data-srcset|srcset)=["']([^"']+)["']/i);
     if(set)urls.push(set[1].split(",").pop()?.trim().split(/\s+/)[0]||"");
   }
 }
 return [...new Set(urls.map(x=>safeImage(host,x)).filter((x):x is string=>!!x))].slice(0,12);
};
export async function scanOnepageEoStore(raw:unknown,fetcher:typeof fetch=fetch){
 const b={schema_version:EO_STORE_SCAN_VERSION,approved:false,studio_dependency:false};
 const q=raw as Input;
 if(!q||!q.brand||!(q.brand in domains)||typeof q.product_type!=="string"||!q.product_type.trim()||
   q.product_type.length>160||!Array.isArray(q.related_terms)||q.related_terms.length>4||
   q.related_terms.some(x=>typeof x!=="string"||!x.trim()||x.length>80)||
   (q.limit!==undefined&&(!Number.isInteger(q.limit)||q.limit<1||q.limit>12))||
   (q.seed_product_urls!==undefined&&(!Array.isArray(q.seed_product_urls)||q.seed_product_urls.length>12)))
   return {...b,status:"INVALID_INPUT",errors:["INVALID_BOUNDED_SCAN_INPUT"],candidates:[]};
 const host=domains[q.brand],max=q.limit||8,urls:string[]=[],errors:string[]=[];
 const seen=new Set<string>();
 for(const seed of q.seed_product_urls||[]){
   const u=safeProduct(host,seed);if(!u)errors.push("REJECTED_INVALID_SEED");else if(!seen.has(u)){seen.add(u);urls.push(u);}
 }
 for(const term of [q.product_type,...q.related_terms]){
   if(urls.length>=max)break;
   const endpoint="https://"+host+"/search/suggest.json?q="+encodeURIComponent(term)+"&resources[type]=product&resources[limit]=10";
   try{
     const txt=await fetchStore(endpoint,host,350000,fetcher);
     for(const u of found(txt,host))if(!seen.has(u)){seen.add(u);urls.push(u);}
   }catch(e){errors.push("SEARCH_ERROR:"+String(e instanceof Error?e.message:e).slice(0,100));}
 }
 if(!urls.length)try{
   const txt=await fetchStore("https://"+host+"/search?q="+encodeURIComponent(q.product_type)+"&type=product",host,1000000,fetcher);
   for(const u of found(txt,host))if(!seen.has(u)){seen.add(u);urls.push(u);}
 }catch(e){errors.push("FALLBACK_ERROR:"+String(e instanceof Error?e.message:e).slice(0,100));}
 const candidates:any[]=[];
 for(const page_url of urls.slice(0,max)){
   const handle=new URL(page_url).pathname.split("/")[2];
   let type="",title="";
   try{const json=JSON.parse(await fetchStore("https://"+host+"/products/"+handle+".js",host,500000,fetcher));
     type=String(json.type||json.product_type||"").trim().slice(0,160);title=String(json.title||"").slice(0,160);
   }catch(e){errors.push("PDP_TYPE_ERROR:"+handle);}
   try{
     const html=await fetchStore(page_url,host,1500000,fetcher);
     const markers={
       benefits:/why\s+you(?:'|’|&#39;)?ll\s+love\s+it/i.test(html),
       details:/product\s+details/i.test(html),
       gtk:/good\s+to\s+know/i.test(html),
       faqs:/\bFAQs\b/i.test(html),
       occasion:/\bOccasion\b/i.test(html)};
     if(!title)title=(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||"").replace(/<[^>]+>/g," ").slice(0,160);
     candidates.push({brand:q.brand,page_url,product_type:type,title,markers,
       onepage_evidence:markers.benefits&&markers.details?"SECTION_MARKERS_FOUND":"ONEPAGE_NOT_VERIFIED",
       image_urls:imagesFromHtml(html,host),approval_status:"DISCOVERED_NOT_APPROVED",
       source:"LIVE_PUBLIC_PDP_AND_SHOPIFY_JSON"});
   }catch(e){errors.push("PDP_FETCH_ERROR:"+handle);}
 }
 let pixel_receipts:any=null;
 if(q.inspect_pixels!==false){
   const images=candidates.filter(x=>x.image_urls.length>0).slice(0,3).map((x,i)=>({slot:"source_"+i,image_url:x.image_urls[0]}));
   if(images.length)pixel_receipts=await auditOnepageEoPixels(images,fetcher);
 }
 return {...b,status:candidates.length?"LIVE_BOUNDED_SCAN":"NO_STORE_CANDIDATES",brand:q.brand,
    store_origin:"https://"+host,query_type:q.product_type,candidates,pixel_receipts,
    scanned_pages:candidates.length,discovered_pages:urls.length,scan_complete:false,errors,
    note:"Actual store HTML and PDP metadata fetched. Source pixels inspected only for pixel_receipts. No full-store crawl, native mobile screenshot, confirmed owner approval or subjective EO certification."};
}
