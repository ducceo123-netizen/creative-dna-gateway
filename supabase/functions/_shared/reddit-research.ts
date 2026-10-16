/** Host-reported qualitative evidence, never server retrieval or product/market proof. */
export const REDDIT_VERSION = 'reddit-customer-research/1';
export const REDDIT_GUIDANCE = 'Research Reddit as a preferred qualitative customer source before selecting concepts or writing product messaging, UGC or Good To Know. Start with verified product facts, buyer, recipient, occasion and market; discover relevant category, recipient and occasion communities. Read actual public threads and comments in context through permitted host search/read tools; search snippets alone are not inspection. Search positive experiences, complaints, alternatives and counterevidence. Record direct thread/comment URLs, subreddit, publication and observation dates, queries, sort/filters, actual inspected counts, exclusions and access limits. Deduplicate crossposts and repeated comments; a popular thread is not independent market confirmation. Distinguish reported opinions from interpretation and testable hypotheses; disclose selection bias, unknown geography and suspected promotion without declaring users bots. Translate insights into original bounded messaging and concept hypotheses linked to verified product facts. Reddit never proves specifications, sales, demand size, profitability or winning products and never becomes an own-product testimonial. Do not copy personal stories into fake UGC, profile users, collect user histories or sensitive identities, or target individuals. No scraping, login/access bypass, posting, direct API integration or background collection is authorized; commercial API/data ingestion needs a verified permitted route. Keep excerpts minimal and do not retain or reuse deleted content. Record partial, blocked or zero-result research honestly; continue unrelated work using verified evidence. Product truth, Pinterest visual inspiration, content approval, pixel inspection and QC gates remain independent.';
const obj=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const str=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=4000;
const strings=(v:unknown):v is string[]=>Array.isArray(v)&&v.length<=100&&v.every(str);
const date=(v:unknown,now:number)=>{
 if(typeof v!=='string')return false;
 const m=v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/);
 if(!m)return false;
 const [year,month,day,hour,minute,second]=m.slice(1,7).map(Number);
 const calendar=new Date(0);calendar.setUTCFullYear(year,month-1,day);calendar.setUTCHours(0,0,0,0);
 if(calendar.getUTCFullYear()!==year||calendar.getUTCMonth()!==month-1||calendar.getUTCDate()!==day||hour>23||minute>59||second>59)return false;
 if(m[7]!=='Z'&&(Number(m[7].slice(1,3))>23||Number(m[7].slice(4,6))>59))return false;
 return Number.isFinite(Date.parse(v))&&Date.parse(v)<=now+300000;
};
const count=(v:unknown)=>Number.isInteger(v)&&Number(v)>=0;
function permalink(v:unknown){
 try {const u=new URL(String(v)); if(u.protocol!=='https:'||u.username||u.password||! /^(www\.|old\.)?reddit\.com$/.test(u.hostname)||u.search||u.hash)return null;
 const m=u.pathname.match(/^\/r\/([A-Za-z0-9_]+)\/comments\/([a-z0-9]+)\/[^/]+(?:\/([a-z0-9]+))?\/?$/i);
 return m?{subreddit:m[1].toLowerCase(),identity:`${m[2].toLowerCase()}/${(m[3]||'').toLowerCase()}`}:null;
 }catch{return null;}
}
export const REDDIT_CONTRACT={schema_version:REDDIT_VERSION,purpose:'qualitative_customer_insight_only',execution:'HOST_PERMITTED_READING',source_authenticity:'NOT_SERVER_VERIFIED',instruction:REDDIT_GUIDANCE,
 input_shape:{schema_version:REDDIT_VERSION,scope:{source_url:'exact task URL',product:'product/category',buyer:'buyer or unknown',recipient:'recipient or unknown',occasion:'occasion or unknown',market:'target market; not inferred author location'},searches:[{id:'unique search ID',query:'actual query',observed_at:'ISO timestamp',status:'completed | partial | blocked | not_found',sort_order:'actual sort or unknown',filters:['date/community filters'],threads_inspected:'nonnegative integer',comments_inspected:'nonnegative integer',limitations:['sampling/access/selection limits']}],observations:[{id:'unique evidence ID',search_id:'search ID',url:'direct Reddit thread/comment permalink',subreddit:'community name without r/',published_at:'ISO timestamp',observed_at:'ISO timestamp',status:'inspected | unavailable | deleted',method:'thread_and_comment_context',finding:'brief paraphrase of reported opinion',signal:'positive | negative | mixed | neutral',geography:'explicit evidence or unknown',promotion_risk:'unknown | suspected | none_observed',limitations:['actual limits']}],insights:[{id:'insight ID',evidence_ids:['inspected observation IDs'],counterevidence_ids:['contradicting inspected observation IDs'],counterevidence_note:'what was searched/found; absence is not proof',interpretation:'qualified interpretation',hypothesis:'falsifiable test',application:'messaging | ugc | good_to_know | concept',product_claim_ids:['independently validated product_fact IDs, or empty'],limitations:['bias, contradictions and unknowns']}]}};
export function evaluateRedditResearch(raw:unknown,context:{source_url?:string;now?:number;product_claim_ids?:string[]}={}){
 const issues:string[]=[],limitations:string[]=[];const now=context.now??Date.now();
 const result=(status:string,ids:string[]=[])=>({schema_version:REDDIT_VERSION,status,issues:[...new Set(issues)],limitations:[...new Set(limitations)],usable_customer_insight_ids:ids,allowed_use:'qualitative_customer_insight_only',source_authenticity:'NOT_SERVER_VERIFIED',product_truth:'NOT_SUPPORTED',market_proof:'NOT_SUPPORTED'});
 if(raw==null)return result('AWAITING_RESEARCH');
 if(!obj(raw)||raw.schema_version!==REDDIT_VERSION||!obj(raw.scope)||!['source_url','product','buyer','recipient','occasion','market'].every(k=>str(raw.scope[k]))||!Array.isArray(raw.searches)||!raw.searches.length||raw.searches.length>40||!Array.isArray(raw.observations)||raw.observations.length>100||!Array.isArray(raw.insights)||raw.insights.length>30){issues.push('INVALID_REDDIT_SHAPE');return result('NEEDS_EVIDENCE');}
 if(!context.source_url||raw.scope.source_url!==context.source_url)issues.push('REDDIT_SCOPE_MISMATCH');
 const searches=new Map<string,any>(),observations=new Map<string,any>(),identities=new Set<string>(),insights=new Set<string>();let partial=false;
 for(const s of raw.searches){
  if(!obj(s)||!str(s.id)||searches.has(s.id)||!str(s.query)||!date(s.observed_at,now)||!['completed','partial','blocked','not_found'].includes(s.status)||!str(s.sort_order)||!strings(s.filters)||!count(s.threads_inspected)||!count(s.comments_inspected)||!strings(s.limitations)||!s.limitations.length){issues.push('INVALID_REDDIT_SEARCH');continue;}
  searches.set(s.id,s);limitations.push(...s.limitations);if(s.status!=='completed')partial=true;
  if(['blocked','not_found'].includes(s.status)&&(s.threads_inspected||s.comments_inspected))issues.push('REDDIT_SEARCH_COUNT_CONFLICT');
 }
 for(const o of raw.observations){
  const p=obj(o)?permalink(o.url):null;
  if(!obj(o)||!str(o.id)||observations.has(o.id)||!p||identities.has(p.identity)||!str(o.subreddit)||p.subreddit!==o.subreddit.toLowerCase()||!searches.has(o.search_id)||!date(o.observed_at,now)||!date(o.published_at,now)||Date.parse(o.published_at)>Date.parse(o.observed_at)||!['inspected','unavailable','deleted'].includes(o.status)||!strings(o.limitations)){issues.push('INVALID_REDDIT_OBSERVATION');continue;}
  identities.add(p.identity);observations.set(o.id,o);limitations.push(...o.limitations);
  if(o.status!=='inspected'){partial=true;if(!o.limitations.length||o.finding)issues.push('UNAVAILABLE_REDDIT_CONTENT');continue;}
  const s=searches.get(o.search_id);
  if(!['completed','partial'].includes(s.status)||s.threads_inspected<1||(p.identity.split('/')[1]&&s.comments_inspected<1)||Date.parse(o.observed_at)>Date.parse(s.observed_at))issues.push('REDDIT_SEARCH_OBSERVATION_CONFLICT');
  if(o.method!=='thread_and_comment_context'||!str(o.finding)||!['positive','negative','mixed','neutral'].includes(o.signal)||!str(o.geography)||!['unknown','suspected','none_observed'].includes(o.promotion_risk))issues.push('REDDIT_CONTEXT_INSPECTION_REQUIRED');
 }
 for(const [id,s] of searches){
  const inspected=[...observations.values()].filter(o=>o.search_id===id&&o.status==='inspected');
  const threads=new Set(inspected.map(o=>permalink(o.url)!.identity.split('/')[0]));
  const comments=inspected.filter(o=>!!permalink(o.url)!.identity.split('/')[1]);
  if(threads.size>s.threads_inspected||comments.length>s.comments_inspected)issues.push('REDDIT_OBSERVATION_COUNT_EXCEEDS_SAMPLE');
 }
 const usable:string[]=[];
 for(const i of raw.insights){
  if(!obj(i)||!str(i.id)||insights.has(i.id)||!strings(i.evidence_ids)||!i.evidence_ids.length||!strings(i.counterevidence_ids)||!str(i.counterevidence_note)||!str(i.interpretation)||!str(i.hypothesis)||!['messaging','ugc','good_to_know','concept'].includes(i.application)||!strings(i.product_claim_ids)||!strings(i.limitations)||!i.limitations.length){issues.push('INVALID_REDDIT_INSIGHT');continue;}
  insights.add(i.id);
  if([...i.evidence_ids,...i.counterevidence_ids].some(id=>observations.get(id)?.status!=='inspected'))issues.push('MISSING_REDDIT_INSIGHT_EVIDENCE');
  if(i.product_claim_ids.some(id=>!context.product_claim_ids?.includes(id)))issues.push('UNVERIFIED_REDDIT_PRODUCT_LINK');
  limitations.push(...i.limitations);usable.push(i.id);
 }
 if(!raw.observations.length||!raw.insights.length){partial=true;limitations.push('No usable Reddit insight established by this bounded search.');}
 return issues.length?result('NEEDS_EVIDENCE'):result(partial?'PARTIAL':'STRUCTURALLY_COMPLETE',usable);
}
