/** Reference-led EO icon evidence. Structural validation only; host inspects pixels. */
export const ONEPAGE_EO_STORE_REF_VERSION="uid-onepage-eo-store-reference/2026-11-20.v1";
export const ONEPAGE_EO_STORE_REF_DESCRIPTION="Before generating/recoloring Onepage Occasion icons, inspect two or more ACTUAL existing image icons on the target brand store Onepage (not from memory, generic SVG/icon font or a different brand). Report full-size and mobile visual inspection evidence, exact source image links, matching brand/store source and palette/stroke findings. If no verified reference, do not pretend EO fidelity is approved; continue production using conservative brand style, mark visual parity UNVERIFIED and repair locally.";
export const ONEPAGE_EO_STORE_REF_SCHEMA={
  type:"object",additionalProperties:false,required:["brand","store_origin","references"],
  properties:{
    brand:{type:"string"},store_origin:{type:"string"},
    references:{type:"array",minItems:2,maxItems:12,items:{type:"object",additionalProperties:false,
      required:["page_url","image_url","inspected_full_size","inspected_mobile_size","image_is_actual_store_icon","stroke_note","badge_note","palette_note"],
      properties:{page_url:{type:"string"},image_url:{type:"string"},inspected_full_size:{type:"boolean"},
        inspected_mobile_size:{type:"boolean"},image_is_actual_store_icon:{type:"boolean"},
        stroke_note:{type:"string"},badge_note:{type:"string"},palette_note:{type:"string"}}
    }}
  }
} as const;
const isWeb=(v:unknown)=>typeof v==="string"&&/^https:\/\/[^/\s]+/i.test(v)&&v.length<=2000;
const note=(v:unknown)=>typeof v==="string"&&v.trim().length>=20&&v.length<=600;
export function evaluateOnepageEoStoreReferences(input:unknown){
  const base={schema_version:ONEPAGE_EO_STORE_REF_VERSION,server_pixel_inspected:false,can_certify_visual_parity:false};
  if(!input||typeof input!=="object"||Array.isArray(input))return {...base,status:"REFERENCE_UNVERIFIED",issues:["MISSING_REFERENCE_INPUT"]};
  const q=input as Record<string,any>, issues:string[]=[];
  if(typeof q.brand!=="string"||!q.brand.trim()||!isWeb(q.store_origin)||!Array.isArray(q.references)||q.references.length<2||q.references.length>12)
    return {...base,status:"REFERENCE_UNVERIFIED",issues:["REQUIRE_TWO_ACTUAL_STORE_ICON_REFERENCES"]};
  const seen=new Set<string>();let host:string;
  try{host=new URL(q.store_origin).hostname.toLowerCase();}catch{return {...base,status:"REFERENCE_UNVERIFIED",issues:["INVALID_STORE_ORIGIN"]};}
  for(const x of q.references){
    if(!x||!isWeb(x.page_url)||!isWeb(x.image_url)||!note(x.stroke_note)||!note(x.badge_note)||!note(x.palette_note)||
       x.inspected_full_size!==true||x.inspected_mobile_size!==true||x.image_is_actual_store_icon!==true){
      issues.push("UNINSPECTED_EO_STORE_ICON");continue;
    }
    const pageHost=new URL(x.page_url).hostname.toLowerCase();
    if(pageHost!==host&&pageHost!=="www."+host&&host!=="www."+pageHost)issues.push("CROSS_BRAND_EO_SOURCE");
    if(seen.has(x.image_url))issues.push("DUPLICATE_EO_REFERENCE_IMAGE");
    seen.add(x.image_url);
    if(/\.svg(?:[?#]|$)/i.test(x.image_url))issues.push("GENERIC_SVG_REFERENCE_NOT_ACCEPTED");
  }
  if(seen.size<2)issues.push("NOT_ENOUGH_DISTINCT_STORE_ICONS");
  return {...base,status:issues.length?"REFERENCE_UNVERIFIED":"REFERENCE_REPORTED_REQUIRES_HOST_PIXEL_QA",
    issues:[...new Set(issues)],brand:q.brand,reference_count:seen.size,
    next_action:issues.length?"Collect actual same-brand Onepage icon images and inspect in host. Continue other Onepage work without owner permission pause; do not claim EO parity.":"Use these actual inspected store images as one EO family anchor for all four icons; inspect and repair generated PNG/WebP pixels together at full/mobile size. Do not replace with generic SVG.",
    note:"URLs and booleans come from the client; server did NOT fetch or visually inspect images."};
}
