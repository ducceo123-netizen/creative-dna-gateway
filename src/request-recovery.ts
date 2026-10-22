/** Bounds fetch AND response-body consumption, even if a transport ignores abort. */
export async function boundedFetch(url:string, init:RequestInit = {}, request:(url:string,init?:RequestInit)=>Promise<Response> = fetch, timeoutMs=20000):Promise<Response> {
  const controller=new AbortController();
  const abort=()=>controller.abort(init.signal?.reason);
  let timer:ReturnType<typeof setTimeout>;
  let rejectAbort:(reason:unknown)=>void=()=>{};
  const cancelled=new Promise<never>((_,reject)=>{rejectAbort=reject;});
  const onAbort=()=>{abort();rejectAbort(new Error("Request interrupted. The server may still complete a submitted change."));};
  if(init.signal?.aborted)onAbort();
  else init.signal?.addEventListener("abort",onAbort,{once:true});
  const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error("Request timed out. The server may still complete a submitted change; check its status before trying again."));},timeoutMs);(timer as any).unref?.();});
  try {
    return await Promise.race([deadline,cancelled,(async()=>{
      if(controller.signal.aborted)throw new Error("Request interrupted");
      const response=await request(url,{...init,signal:controller.signal});
      const body=await response.arrayBuffer();
      return new Response(response.status===204||response.status===205||response.status===304?null:body,{status:response.status,statusText:response.statusText,headers:response.headers});
    })()]);
  } finally {clearTimeout(timer!);init.signal?.removeEventListener("abort",onAbort);}
}

export type OwnerApproval={proposal_id:string;owner_user_id:string;candidate_hash:string;rule_hash:string;plan_hash:string;recovery_token:string|null;operation_id:string};
export type PendingReview={ownerApproval?:OwnerApproval;recoveryId?:string;action:"covered"|"process"|"rule"|"cancel"|"reject";requestId?:string};
const pending=new Map<string,PendingReview>();
export function reviewLockKey(id:string){return `uid-pending-review:${id}`;}
export function ownerReviewLockKey(id:string){
  const key=`uid-pending-owner-review:${id}`;
  // Migrate only an owner action. Queue/cancel/covered locks are not owner authority.
  const legacy=reviewLockKey(id),old=getReviewLock(legacy);
  if(old?.action==="rule"&&!getReviewLock(key)){if(setReviewLock(key,old))clearReviewLock(legacy);}
  return key;
}
export function getReviewLock(key:string):PendingReview|undefined{
  if(pending.has(key))return pending.get(key);
  try {const saved=sessionStorage.getItem(key);if(saved){const value=JSON.parse(saved);pending.set(key,value);return value;}}catch{}
}
export function setReviewLock(key:string,value:PendingReview){pending.set(key,value);try{sessionStorage.setItem(key,JSON.stringify(value));return true;}catch{return false;}}
export function clearReviewLock(key:string){pending.delete(key);try{sessionStorage.removeItem(key);}catch{}}
/** A pending snapshot is NOT proof a timed-out write failed. Only observed completion unlocks. */
export function reconcilesReview(lock:PendingReview,status:string,request?:{id:string;status:string}|null){
  if(lock.action==="rule")return false; // Owner receipts/fencing are reconciled separately.
  if(["merged","resolved","rejected"].includes(status))return true;
  if(status!=="pending")return false;
  if(lock.action==="process")return !!request&&request.id!==lock.requestId&&["queued","leased","blocked","merged","cancelled","superseded","expired"].includes(request.status);
  return lock.action==="cancel"&&!!request&&request.id===lock.requestId&&request.status==="cancelled";
}

/** An observed owner receipt must match the identity actually approved, not today's preview. */
export function matchesOwnerReceipt(lock:PendingReview,receipt:any):boolean {
 const approved=lock.ownerApproval;
 return !!approved&&receipt?.proposal_id===approved.proposal_id&&receipt?.owner_user_id===approved.owner_user_id&&
 receipt.status==="merged"&&receipt.decision_kind==="owner_direct_rule"&&receipt.visual_qc_performed===false&&
 typeof receipt.rule_decision_id==="string"&&!!receipt.rule_decision_id&&
 receipt.candidate_hash===approved.candidate_hash&&receipt.rule_hash===approved.rule_hash&&receipt.plan_hash===approved.plan_hash;
}
