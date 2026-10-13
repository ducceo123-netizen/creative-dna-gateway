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

export type PendingReview={action:"covered"|"process"|"rule"|"cancel"|"reject";requestId?:string};
const pending=new Map<string,PendingReview>();
export function reviewLockKey(id:string){return `uid-pending-review:${id}`;}
export function getReviewLock(key:string):PendingReview|undefined{
  if(pending.has(key))return pending.get(key);
  try {const saved=sessionStorage.getItem(key);if(saved){const value=JSON.parse(saved);pending.set(key,value);return value;}}catch{}
}
export function setReviewLock(key:string,value:PendingReview){pending.set(key,value);try{sessionStorage.setItem(key,JSON.stringify(value));}catch{}}
export function clearReviewLock(key:string){pending.delete(key);try{sessionStorage.removeItem(key);}catch{}}
/** A pending snapshot is NOT proof a timed-out write failed. Only observed completion unlocks. */
export function reconcilesReview(lock:PendingReview,status:string,request?:{id:string;status:string}|null){
  if(["merged","resolved","rejected"].includes(status))return true;
  if(status!=="pending")return false;
  if(lock.action==="process")return !!request&&request.id!==lock.requestId&&["queued","leased","blocked","merged","cancelled","superseded","expired"].includes(request.status);
  return lock.action==="cancel"&&!!request&&request.id===lock.requestId&&request.status==="cancelled";
}
