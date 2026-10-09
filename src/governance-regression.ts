/**
 * UID Brands Phase 2: fail-closed merge preflight.
 * This is human-attested evidence, not an automated generation benchmark.
 * No canonical read/write happens here.
 */
export type RegressionAttestation = {
 evidence_urls:string[];
 baseline_ids:string[];
 scope_checked:boolean;
 canonical_conflicts_checked:boolean;
 product_truth_verified:boolean;
 before_after_reviewed:boolean;
 severe_regressions:number;
 review_note:string;
};
export function validateRegressionAttestation(value:unknown):{ok:boolean;issues:string[];attestation?:RegressionAttestation}{
 const v=(value&&typeof value==="object"?value:{} ) as Record<string,unknown>;
 const issues:string[]=[];
 const list=(key:string)=>Array.isArray(v[key])?(v[key] as unknown[]).filter(x=>typeof x==="string"&&x.trim().length>0&&x.length<=500) as string[]:[];
 const evidence_urls=list("evidence_urls"),baseline_ids=list("baseline_ids");
 if(!evidence_urls.length)issues.push("Cần ít nhất một evidence/reference URL hoặc ID");
 if(!baseline_ids.length)issues.push("Cần ít nhất một regression baseline ID");
 for(const key of ["scope_checked","canonical_conflicts_checked","product_truth_verified","before_after_reviewed"])
  if(v[key]!==true)issues.push("Chưa xác nhận: "+key);
 if(!Number.isInteger(v.severe_regressions)||Number(v.severe_regressions)!==0)issues.push("Chưa xác nhận 0 critical regressions");
 if(typeof v.review_note!=="string"||v.review_note.trim().length<20)issues.push("Cần ghi chú kết quả kiểm tra (ít nhất 20 ký tự)");
 if(issues.length)return {ok:false,issues};
 return {ok:true,issues,attestation:{
  evidence_urls,baseline_ids,
  scope_checked:true,canonical_conflicts_checked:true,product_truth_verified:true,before_after_reviewed:true,
  severe_regressions:0,review_note:(v.review_note as string).trim().slice(0,4000)
 }};
}
