/** Advisory-only governance assessment. Never approves, rejects or merges proposals. */
export type GovernanceProposal = {
 id:string; brand_name?:string; branch_slug?:string; raw_feedback?:string;
 proposed_scope?:string; evidence_summary?:Record<string,unknown>;
 context_images?:Array<{role:string;image_url?:string|null;reference_id?:string|null}>;
};
const normalize=(v:string)=>v.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu," ").trim();
const tokens=(v:string)=>new Set(normalize(v).split(/\s+/).filter(x=>x.length>2));
function similarity(a:string,b:string){
 const x=tokens(a),y=tokens(b);if(!x.size||!y.size)return 0;
 let overlap=0;for(const v of x)if(y.has(v))overlap++;
 return overlap/(x.size+y.size-overlap);
}
export function assessProposal(p:GovernanceProposal,peers:GovernanceProposal[]){
 const text=p.raw_feedback||"";
 const images=p.context_images||[];
 const summary=p.evidence_summary||{};
 const evidence=images.length>0||Object.keys(summary).length>0;
 const productTruth=/product|pdp|sku|reference|variant|sản phẩm|thực tế/i.test(text);
 const scope=Boolean(p.brand_name&&p.branch_slug&&p.proposed_scope);
 const impact=/because|therefore|khiến|vì|ảnh hưởng|khắc phục|expected|desired|mong muốn/i.test(text);
 const detail=text.trim().length>=90;
 const near=peers.filter(x=>x.id!==p.id&&x.brand_name===p.brand_name&&x.branch_slug===p.branch_slug)
  .map(x=>({id:x.id,score:similarity(text,x.raw_feedback||"")}))
  .filter(x=>x.score>=0.72).sort((a,b)=>b.score-a.score).slice(0,3);
 const scores={
  evidence:(images.length?20:0)+(Object.keys(summary).length?10:0),
  productTruth:productTruth?25:0,
  reusability:scope?20:0,
  consistency:near.length?0:15,
  outcomeImpact:(impact?5:0)+(detail?5:0)
 };
 const total=Object.values(scores).reduce((a,b)=>a+b,0);
 const issues:string[]=[];
 if(!evidence)issues.push("Chưa có evidence để đối chiếu");
 if(!productTruth)issues.push("Chưa có xác minh Product Truth");
 if(!scope)issues.push("Phạm vi áp dụng chưa rõ");
 if(near.length)issues.push("Có feedback gần trùng — cần kiểm tra");
 // Scores are review prioritization, not evidence of factual truth.
 return {total,scores,issues,similar:near,
  recommendation:issues.length?"Needs Review":"Candidate",
  canonicalEligible:false as const,
  note:"Điểm chỉ hỗ trợ ưu tiên review; Admin phải kiểm tra nguồn, xung đột và regression trước khi merge."};
}
