import {trustedEoImageUrl} from "./uid-eo-pixel-audit.ts";
/** Authenticated Supabase-backed, shared EO reference library.
 * Server never accepts owner-supplied service-role credentials and never
 * promotes scanned public pages automatically.
 */
export const EO_LIBRARY_VERSION="uid-eo-reference-library/2026-11-21.v1";
export const EO_LIBRARY_DESCRIPTION="Read versioned, approved EO Onepage quality references shared by authenticated UID Brands members. Reads from real Supabase datastore, not session memory. Requires connected member Bearer JWT. Does not assume live store pages are approved.";
export const EO_REFERENCE_SUBMIT_DESCRIPTION="Save a scanned same-brand Onepage as a DISCOVERED reference candidate in the shared Supabase library, never approved. Requires an authenticated UID contributor/admin. The source URL must belong to the corresponding official store; image URLs must be trusted storefront/CDN.";
export const EO_REFERENCE_APPROVE_DESCRIPTION="Owner/admin explicit one-time approval of a pixel-inspected reference with reason, quality notes, desktop and mobile inspection. Transactionally records a version and immutable audit entry. NEVER auto-run as part of Onepage, scanning or model inference; a user must explicitly approve a named candidate.";

const PROJECT="https://wuonwttmkadwsmefjukv.supabase.co";
const origins={pawfecthouse:"pawfecthouse.com",giftsoul:"giftsoul.co",soulprise:"soulprise.co"} as const;
export type EoBrand=keyof typeof origins;
const idPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const nonempty=(s:unknown)=>typeof s==="string"&&s.trim().length>0;
const jwt=(value?:string|null)=>typeof value==="string"&&/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)&&value.length<16500;
const key=()=>process.env.SUPABASE_PUBLISHABLE_KEY||"";
function headers(auth:string,extra:Record<string,string>={}){
 const apiKey=key();if(!apiKey)throw new Error("LIBRARY_PUBLISHABLE_KEY_NOT_CONFIGURED");
 return {apikey:apiKey,Authorization:auth,"Content-Type":"application/json",...extra};
}
const validateBrand=(brand:string):brand is EoBrand=>brand in origins;
export function validEoReferencePage(brand:string,page:string){
 try{if(!validateBrand(brand)||!page.startsWith("https://"))return false;
  const u=new URL(page);return !u.username&&!u.password&&!u.port&&u.hash===""&&
    [origins[brand],"www."+origins[brand]].includes(u.hostname)&&/^\/products\/[a-z0-9][a-z0-9-]*\/?$/i.test(u.pathname);
 }catch{return false;}
}
async function responseJson(r:Response){
 const text=await r.text();if(text.length>500000)throw new Error("LIBRARY_RESPONSE_OVERSIZED");
 try{return JSON.parse(text);}catch{throw new Error("LIBRARY_RESPONSE_INVALID");}
}
async function memberIdentity(auth:string,fetcher:typeof fetch){
 const r=await fetcher(PROJECT+"/auth/v1/user",{headers:headers(auth),redirect:"error",signal:AbortSignal.timeout(8000)});
 if(!r.ok)throw new Error("UID_MEMBER_SESSION_NOT_VERIFIED");
 const j=await responseJson(r);
 if(!j?.id||!idPattern.test(j.id))throw new Error("UID_MEMBER_IDENTITY_INVALID");
 return j.id as string;
}
export async function listEoLibrary(brand:string,auth:string|undefined|null,fetcher:typeof fetch=fetch){
 if(!validateBrand(brand))return {status:"INVALID_BRAND",references:[]};
 if(!jwt(auth))return {status:"AUTHENTICATED_UID_MEMBER_REQUIRED",references:[]};
 try{
   const url=PROJECT+"/rest/v1/uid_eo_onepage_references?select=id,brand_slug,page_url,product_type,match_terms,image_urls,quality_notes,inspection,status,approved_at,version&brand_slug=eq."+brand+"&status=eq.approved&order=approved_at.desc&limit=100";
   const r=await fetcher(url,{headers:headers(auth!),redirect:"error",signal:AbortSignal.timeout(9000)});
   if(!r.ok)return {status:"LIBRARY_READ_UNAVAILABLE",http_status:r.status,references:[]};
   const rows=await responseJson(r);
   if(!Array.isArray(rows))throw new Error("INVALID_ROWS");
   return {status:"APPROVED_LIBRARY_READ",version:EO_LIBRARY_VERSION,brand,approved_count:rows.length,references:rows};
 }catch(e){return {status:"LIBRARY_READ_UNAVAILABLE",message:e instanceof Error?e.message:"unknown",references:[]};}
}
export async function submitEoCandidate(input:{
 brand:string;page_url:string;product_type:string;image_urls:string[];match_terms?:Record<string,unknown>;
 quality_notes?:Record<string,unknown>;inspection?:Record<string,unknown>;
},auth:string|undefined|null,fetcher:typeof fetch=fetch){
 if(!jwt(auth))return {status:"AUTHENTICATED_UID_MEMBER_REQUIRED"};
 if(!validEoReferencePage(input.brand,input.page_url)||!Array.isArray(input.image_urls)||input.image_urls.length>16||
    input.image_urls.some(u=>typeof u!=="string"||!trustedEoImageUrl(u))||
    !nonempty(input.product_type)||input.product_type.length>160)
    return {status:"INVALID_REFERENCE_SOURCE"};
 try{
   const user_id=await memberIdentity(auth!,fetcher);
   const row={brand_slug:input.brand,page_url:input.page_url,product_type:input.product_type,
     image_urls:input.image_urls,match_terms:input.match_terms||{},quality_notes:input.quality_notes||{},
     inspection:input.inspection||{},status:"discovered",submitted_by:user_id};
   const r=await fetcher(PROJECT+"/rest/v1/uid_eo_onepage_references?select=id,status,version,brand_slug,page_url",{
      method:"POST",headers:headers(auth!,{Prefer:"return=representation"}),body:JSON.stringify(row),redirect:"error",signal:AbortSignal.timeout(9000)});
   if(!r.ok)return {status:r.status===409?"ALREADY_EXISTS_DO_NOT_OVERWRITE":"CANDIDATE_SAVE_REJECTED",http_status:r.status};
   const result=await responseJson(r);return {status:"CANDIDATE_SAVED_NOT_APPROVED",record:Array.isArray(result)?result[0]:null};
 }catch(e){return {status:"CANDIDATE_SAVE_UNAVAILABLE",message:e instanceof Error?e.message:"unknown"};}
}
export async function approveEoReference(input:{reference_id:string;expected_version:number;
 justification:string;quality_notes:Record<string,unknown>;desktop_inspected:boolean;mobile_inspected:boolean;explicit_admin_approval:boolean},
 auth:string|undefined|null,fetcher:typeof fetch=fetch){
 if(!jwt(auth))return {status:"AUTHENTICATED_UID_ADMIN_REQUIRED"};
 if(!input.explicit_admin_approval||!idPattern.test(input.reference_id)||!Number.isInteger(input.expected_version)||
    input.expected_version<1||!nonempty(input.justification)||input.justification.length<12||
    input.desktop_inspected!==true||input.mobile_inspected!==true)
    return {status:"EXPLICIT_INSPECTED_ADMIN_APPROVAL_REQUIRED"};
 try{
   const body={p_reference_id:input.reference_id,p_expected_version:input.expected_version,
     p_quality_notes:{...input.quality_notes,approval_basis:input.justification},
     p_inspection:{desktop:true,mobile:true},p_justification:input.justification};
   const r=await fetcher(PROJECT+"/rest/v1/rpc/uid_eo_approve_reference",{
     method:"POST",headers:headers(auth!),body:JSON.stringify(body),redirect:"error",signal:AbortSignal.timeout(9000)});
   if(!r.ok)return {status:"APPROVAL_REJECTED_BY_DATABASE",http_status:r.status};
   const recordId=await responseJson(r);
   return {status:"ADMIN_APPROVAL_COMMITTED",reference_id:recordId};
 }catch(e){return {status:"ADMIN_APPROVAL_UNAVAILABLE",message:e instanceof Error?e.message:"unknown"};}
}
