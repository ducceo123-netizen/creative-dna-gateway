/** Exact Shopify Product Type identity for name-only Onepage briefs.
 * Operates only on caller-supplied inspected store inventory; no server scan claims.
 * Shopify product_type is an independent field, NOT part of title/handle/SEO.
 */
export const PRODUCT_TYPE_SCOPE_VERSION="uid-onepage-product-type-scope/2026-11-20.v1";
export const PRODUCT_TYPE_SCOPE_DESCRIPTION="For name-only Onepage product-line briefs, resolve the exact Shopify product_type against verified, fully paginated store inventory. Never include products solely because their title, handle, tags or descriptions contain the search keyword. No fuzzy expansion or broad title fallback. Return clear candidate types if none matches, do not invent matches. This tool does not fetch store data.";
export const PRODUCT_TYPE_SCOPE_INPUT_SCHEMA={
  type:"object",additionalProperties:false,required:["brand","requested_product_type","scan_complete","has_more_pages","products"],
  properties:{
    brand:{type:"string"},requested_product_type:{type:"string"},scan_complete:{type:"boolean"},has_more_pages:{type:"boolean"},
    products:{type:"array",maxItems:2000,items:{type:"object",additionalProperties:false,required:["id","title","product_type","url"],properties:{
      id:{type:"string"},title:{type:"string"},product_type:{type:"string"},url:{type:"string"}
    }}}
  }
} as const;
const clean=(s:string)=>s.normalize("NFKC").trim().replace(/\s+/g," ").toLocaleLowerCase("en-US");
const valid=(s:unknown)=>typeof s==="string"&&s.trim().length>0&&s.length<=2000;
export function evaluateOnepageProductTypeScope(input:unknown){
  const base={schema_version:PRODUCT_TYPE_SCOPE_VERSION,source_verified_by_server:false,scope:"EXACT_SHOPIFY_PRODUCT_TYPE",title_contains_fallback:false};
  if(!input||typeof input!=="object"||Array.isArray(input))return {...base,status:"BLOCKED",issues:["INVALID_INPUT"],product_ids:[]};
  const q=input as Record<string,any>;
  if(!valid(q.brand)||!valid(q.requested_product_type)||q.requested_product_type.length>160||
     !Array.isArray(q.products)||q.products.length>2000||
     typeof q.scan_complete!=="boolean"||typeof q.has_more_pages!=="boolean")
    return {...base,status:"BLOCKED",issues:["INVALID_SCOPE_OR_SCAN"],product_ids:[]};
  const byId=new Map<string,any>(),issues:string[]=[];
  for(const p of q.products){
    if(!p||typeof p!=="object"||!valid(p.id)||!valid(p.title)||typeof p.product_type!=="string"||
       !valid(p.url)||!/^https:\/\/[^/\s]+/i.test(p.url)) {issues.push("INVALID_PRODUCT_ROW");continue;}
    if(byId.has(p.id)){issues.push("DUPLICATE_PRODUCT_ID:"+p.id);continue;}
    byId.set(p.id,p);
  }
  if(!q.scan_complete||q.has_more_pages)issues.push("INCOMPLETE_STORE_PRODUCT_TYPE_SCAN");
  const requested=clean(q.requested_product_type);
  const products=[...byId.values()].filter(p=>clean(p.product_type)===requested);
  const otherTypes=[...new Set([...byId.values()].map(p=>p.product_type.trim()).filter(Boolean))]
    .filter(x=>clean(x)!==requested).slice(0,30);
  if(!products.length)issues.push("NO_EXACT_PRODUCT_TYPE_MATCH");
  return {...base,status:issues.length?"BLOCKED":"MATCHED_REQUIRES_HOST_PDP_REVIEW",issues,
    requested_product_type:q.requested_product_type,matched_product_type:products[0]?.product_type||null,
    matched_count:products.length,scanned_count:byId.size,product_ids:products.map(p=>p.id),
    products:products.map(p=>({id:p.id,title:p.title,product_type:p.product_type,url:p.url})),
    available_product_types:otherTypes,
    exclusion_rule:"Exact Shopify product_type only. Title/handle/tag substring matches never enlarge scope.",
    note:"A scan_complete field is a caller report, not server certification. Inspect underlying source pages/Shopify fields before trusting a catalog."};
}
