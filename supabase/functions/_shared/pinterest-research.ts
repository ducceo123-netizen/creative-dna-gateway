/** Structural validation only. This module does not browse or attest visual inspection. */
export const PINTEREST_VERSION = 'pinterest-visual-research/1';
export const PINTEREST_GUIDANCE = 'Research Pinterest visual references before selecting a creative direction or producing creative assets. Search for the actual product, theme/topic and intended US or specified European market. Inspect actual reference images; record direct Pin URLs, observation time, access limits, concrete composition/palette/typography/styling observations and an original adaptation. Treat market fit as a hypothesis, never a proven national aesthetic. Pins, saves and search placement do not prove demand, sales, product facts or licensing. Preserve product truth, canonical brand rules and existing approval gates. Blocked, partial or zero-result searches must remain explicit; do not invent references, claim snippet-only visual inspection, bypass login restrictions or block unrelated work.';
const str = (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0 && x.length <= 4000;
const obj = (x: unknown): x is Record<string, any> => !!x && typeof x === 'object' && !Array.isArray(x);
const strings = (x: unknown): x is string[] => Array.isArray(x) && x.length <= 100 && x.every(str);
const date = (x: unknown, now: number) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(x) && Number.isFinite(Date.parse(x)) && Date.parse(x) <= now + 300000;
const pin = (x: string) => { try { const u = new URL(x); return u.protocol === 'https:' && !u.username && !u.password && /^(www\.)?pinterest\.com$/.test(u.hostname) && /^\/pin\/\d+\/?$/.test(u.pathname) && !u.search && !u.hash; } catch { return false; } };
export const PINTEREST_CONTRACT = Object.freeze({
 schema_version:PINTEREST_VERSION, purpose:'visual_inspiration_only', source_authenticity:'NOT_SERVER_VERIFIED',
 input_shape:{schema_version:PINTEREST_VERSION, scope:{source_url:'exact task source URL',product:'actual product or product category',theme_topic:'brief theme/topic',market:'US or named European country/market'}, searches:[{query:'actual query',observed_at:'ISO timestamp',status:'completed | partial | blocked | not_found',limitations:['actual access or sampling limits']}], references:[{id:'unique reference ID',url:'canonical https://www.pinterest.com/pin/<id>/',observed_at:'ISO timestamp',status:'inspected | partial | blocked | unsupported',relevance:'product/theme/market relevance',limitations:['actual limits'],inspection_method:'image_view for inspected',observations:['concrete visual observations for inspected only'],adaptation:'original proposed adaptation for inspected only'}]},
 instruction:PINTEREST_GUIDANCE,
});
export function evaluatePinterestResearch(value: unknown, context: {source_url?:string; theme?:string; now?:number} = {}) {
 const now=context.now??Date.now();
 const issues:string[]=[], limitations:string[]=[];
 const result=(status:string, ids:string[]=[])=>({schema_version:PINTEREST_VERSION,status,issues:[...new Set(issues)],limitations:[...new Set(limitations)],usable_visual_reference_ids:ids,allowed_use:'visual_inspiration_only',source_authenticity:'NOT_SERVER_VERIFIED',market_fit:'HYPOTHESIS_ONLY'});
 if(value == null) return result('AWAITING_RESEARCH');
 if(!obj(value) || value.schema_version!==PINTEREST_VERSION || !obj(value.scope) || !['product','theme_topic','market'].every(k=>str(value.scope[k])) || !Array.isArray(value.searches) || !value.searches.length || value.searches.length>40 || !Array.isArray(value.references) || value.references.length>100) { issues.push('INVALID_PINTEREST_SHAPE'); return result('NEEDS_EVIDENCE'); }
 if(!context.source_url || value.scope.source_url!==context.source_url) issues.push('PIN_SCOPE_SOURCE_MISMATCH');
 if(context.theme && value.scope.theme_topic!==context.theme) issues.push('PIN_SCOPE_THEME_MISMATCH');
 let incomplete=false;
 for(const s of value.searches) {
  if(!obj(s)||!str(s.query)||!date(s.observed_at,now)||!['completed','partial','blocked','not_found'].includes(s.status)||!strings(s.limitations)){issues.push('INVALID_SEARCH');continue;}
  if(s.status!=='completed'){incomplete=true;if(!s.limitations.length)issues.push('SEARCH_LIMITATION_REQUIRED');}
  limitations.push(...s.limitations);
 }
 const seen=new Set(),urls=new Set(),usable:string[]=[];
 for(const r of value.references){
  if(!obj(r)||!str(r.id)||!pin(r.url)||!date(r.observed_at,now)||!str(r.relevance)||!strings(r.limitations)||!['inspected','partial','blocked','unsupported'].includes(r.status)){issues.push('INVALID_REFERENCE');continue;}
  const identity=new URL(r.url).pathname.replace(/\/$/,'');
  if(seen.has(r.id)||urls.has(identity)){issues.push('DUPLICATE_REFERENCE');continue;} seen.add(r.id);urls.add(identity);
  limitations.push(...r.limitations);
  if(r.status==='inspected'){
   if(r.inspection_method!=='image_view'||!strings(r.observations)||!r.observations.length||!str(r.adaptation))issues.push('VISUAL_INSPECTION_REQUIRED');else usable.push(r.id);
  }else{
   incomplete=true;
   if(!r.limitations.length)issues.push('REFERENCE_LIMITATION_REQUIRED');
   // Partial or unavailable images cannot supply trusted visual observations.
   if(r.observations!==undefined && (!Array.isArray(r.observations)||r.observations.length))issues.push('UNINSPECTED_VISUAL_CLAIM');
  }
 }
 if(!value.references.length){incomplete=true;limitations.push('No inspected Pinterest references available.');}
 if(issues.length)return result('NEEDS_EVIDENCE');
 return result(incomplete?'PARTIAL':'STRUCTURALLY_COMPLETE',usable);
}
