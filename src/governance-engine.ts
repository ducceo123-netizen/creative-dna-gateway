/**
 * Deterministic regression checks for PRE-GENERATED candidate outputs.
 * This does not generate images/content or evaluate subjective visual quality.
 * Missing baseline or missing candidate output => blocked.
 */
export type BaselineCase = {
 id:string; brand_id:string; branch_slug:string; case_key:string;
 approved_output:Record<string,unknown>;
 expected_assertions:{ required_text?:string[]; forbidden_text?:string[]; required_keys?:string[] };
};
export type CandidateCase = {baseline_id:string; output:Record<string,unknown>};
export type CaseResult = {baseline_id:string;status:"passed"|"failed"|"blocked";issues:string[]};
const text=(value:unknown)=>typeof value==="string"?value:JSON.stringify(value??"");
export function evaluateCase(base:BaselineCase,candidate?:CandidateCase):CaseResult {
 const issues:string[]=[];
 if(!candidate)return {baseline_id:base.id,status:"blocked",issues:["Candidate generation output missing"]};
 const output=candidate.output;
 if(!output||typeof output!=="object")return {baseline_id:base.id,status:"blocked",issues:["Candidate output invalid"]};
 const raw=text(output).toLowerCase();
 const assertions=base.expected_assertions||{};
 for(const required of assertions.required_text||[])
  if(!raw.includes(required.toLowerCase()))issues.push("Missing required text: "+required);
 for(const forbidden of assertions.forbidden_text||[])
  if(raw.includes(forbidden.toLowerCase()))issues.push("Forbidden text present: "+forbidden);
 for(const key of assertions.required_keys||[])
  if(!Object.prototype.hasOwnProperty.call(output,key))issues.push("Missing field: "+key);
 if(!Object.keys(assertions).length) return {baseline_id:base.id,status:"blocked",issues:["No approved assertions for this case"]};
 return {baseline_id:base.id,status:issues.length?"failed":"passed",issues};
}
export function evaluateSuite(baselines:BaselineCase[],candidates:CandidateCase[]) {
 if(!baselines.length)return {status:"blocked",critical_failures:0,results:[],reason:"No curated approved baselines"};
 const results=baselines.map(b=>evaluateCase(b,candidates.find(c=>c.baseline_id===b.id)));
 const status=results.some(x=>x.status==="blocked")?"blocked":results.some(x=>x.status==="failed")?"failed":"passed";
 return {status,critical_failures:results.filter(x=>x.status==="failed").length,results};
}
export function detectCandidateConflicts(candidate:string,canonical:{id:string;content_md:string}[]){
 const normalized=(s:string)=>new Set(s.toLowerCase().match(/[a-z0-9À-ỹ]+/gu)||[]);
 const tokens=normalized(candidate);
 return canonical.map(rule=>{
  const t=normalized(rule.content_md), overlap=[...tokens].filter(w=>t.has(w)).length;
  return {rule_id:rule.id,lexical_overlap:tokens.size?overlap/tokens.size:0,requires_human_review:true};
 }).filter(x=>x.lexical_overlap>=0.6);
}
