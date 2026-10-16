/** Public rule-review contract. Never accepts worker leases or v2 outcome-QC receipts. */
export const RULE_REVIEW_MODE = 'agent_rule_review';
export type RuleRequest = {
 proposal_id:string; review_mode:typeof RULE_REVIEW_MODE; intent_hash:string; idempotency_key:string;
 status:'queued'|'leased'|'blocked'|'merged'|'cancelled'|'superseded'|'expired';
 created_at:string; expires_at:string; blockers:{code:string;message?:string}[];
 outcome?:{canonical_changed:true;visual_qc_performed:false;review_scope:"RULE_SEMANTICS_AND_COMPILATION_NOT_OUTPUT_QC"}|null;
};
export type RulePreflight = {
 proposal_id:string; review_mode:typeof RULE_REVIEW_MODE; available:boolean; eligible:boolean;
 intent_hash:string|null; proposed_content_md:string; scope:Record<string,unknown>;
 review_request:RuleRequest|null; blockers:{code:string;message?:string}[];
};
const text=(v:unknown):v is string=>typeof v==='string'&&v.length>0;
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const blockers=(v:any)=>Array.isArray(v)&&v.every(x=>object(x)&&text(x.code)&&(x.message===undefined||typeof x.message==='string'));
export function validateRuleRequest(v:any, proposalId:string):RuleRequest|null {
 if(v===null)return null;
 if(!object(v)||v.proposal_id!==proposalId||v.review_mode!==RULE_REVIEW_MODE||!text(v.intent_hash)
  ||!text(v.idempotency_key)||!['queued','leased','blocked','merged','cancelled','superseded','expired'].includes(v.status)
  ||!Number.isFinite(Date.parse(v.created_at))||!Number.isFinite(Date.parse(v.expires_at))||!blockers(v.blockers))
  throw Error('Trạng thái AI chưa xác minh được. Hãy tải lại để kiểm tra.');
 if(v.status==='merged'&&(v.outcome?.canonical_changed!==true||v.outcome?.visual_qc_performed!==false||v.outcome?.review_scope!=='RULE_SEMANTICS_AND_COMPILATION_NOT_OUTPUT_QC'))throw Error('Chưa xác minh được kết quả merge.');
 return v as RuleRequest;
}
export function validateRulePreflight(v:any, proposalId:string):RulePreflight {
 if(!object(v)||v.proposal_id!==proposalId||v.review_mode!==RULE_REVIEW_MODE||typeof v.available!=='boolean'||typeof v.eligible!=='boolean'
  ||typeof v.proposed_content_md!=='string'||!object(v.scope)||!blockers(v.blockers)
  ||(v.eligible&&(!v.available||!text(v.intent_hash))))throw Error('Chưa có thông tin bàn giao AI hợp lệ. Hãy tải lại.');
 return {...v,review_request:validateRuleRequest(v.review_request,proposalId)} as RulePreflight;
}
export const ruleRequestActive=(request?:RuleRequest|null)=>!!request&&['queued','leased','blocked'].includes(request.status);
export const ruleStatusLabel=(status:RuleRequest['status'])=>({queued:'Đang chờ AI',leased:'AI đang xem xét',blocked:'AI đang gặp vướng mắc',merged:'Đã merge',cancelled:'Đã hủy bàn giao',superseded:'Nội dung hoặc quyền đã thay đổi',expired:'Bàn giao đã hết hạn'}[status]);
const keys=new Map<string,string>();
export function ruleHandoffKey(proposalId:string,intentHash:string,renew=false):string {
 const name=`uid-rule-handoff:${proposalId}:${intentHash}`;
 if(!renew&&keys.has(name))return keys.get(name)!;
 let saved:string|null=null;try{saved=sessionStorage.getItem(name);}catch{}
 const key=!renew&&saved&&/^[a-f0-9-]{36}$/i.test(saved)?saved:crypto.randomUUID();
 keys.set(name,key);try{sessionStorage.setItem(name,key);}catch{}
 return key;
}
export type RulePending={intent:string;key?:string;action:'handoff'|'cancel'};
const uncertainWrites=new Map<string,RulePending>();
export function readRulePending(proposalId:string):RulePending|null {
 if(uncertainWrites.has(proposalId))return uncertainWrites.get(proposalId)!;
 try{const raw=sessionStorage.getItem(`uid-rule-pending:${proposalId}`);if(raw){const p=JSON.parse(raw);if(text(p.intent)&&['handoff','cancel'].includes(p.action)){uncertainWrites.set(proposalId,p);return p;}}}catch{}
 return null;
}
export function saveRulePending(proposalId:string,value:RulePending|null){
 if(value)uncertainWrites.set(proposalId,value);else uncertainWrites.delete(proposalId);
 try{if(value)sessionStorage.setItem(`uid-rule-pending:${proposalId}`,JSON.stringify(value));else sessionStorage.removeItem(`uid-rule-pending:${proposalId}`);}catch{}
}
