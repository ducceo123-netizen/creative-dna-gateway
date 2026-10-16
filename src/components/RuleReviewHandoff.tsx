import {useEffect,useRef,useState} from 'react';
import {boundedFetch} from '../request-recovery';
import {readRulePending,saveRulePending,ruleHandoffKey,ruleRequestActive,ruleStatusLabel,validateRulePreflight,validateRuleRequest,type RulePreflight,type RuleRequest} from './rule-review-handoff';
type Http=(url:string,init?:RequestInit)=>Promise<Response>;
const button='rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed';
/** One explicit delegation. Read-only polling never starts or renews a request. */
export function RuleReviewHandoff({proposalId,request,onBusyChange,onMerged,disabled=false}:{disabled?:boolean;proposalId:string;request:Http;onBusyChange?:(busy:boolean)=>void;onMerged?:()=>void}) {
 const [data,setData]=useState<RulePreflight|null>(null),[saved,setSaved]=useState<RuleRequest|null>(null);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[uncertain,setUncertain]=useState(false);
 const refs=useRef({request,onBusyChange,onMerged});refs.current={request,onBusyChange,onMerged};
 const alive=useRef(false),mutation=useRef(false),reading=useRef(false),generation=useRef(0);
 const pending=useRef<{intent:string;key?:string;action:'handoff'|'cancel'}|null>(null);
 const notified=useRef(false);
 const read=async()=>{
  if(reading.current||mutation.current)return;
  reading.current=true;const version=generation.current;
  const current=()=>alive.current&&generation.current===version;
  setLoading(true);
  try {
   // Status remains readable even when the release is disabled after handoff.
   const statusResponse=await boundedFetch(`/api/admin/feedback/${encodeURIComponent(proposalId)}/rule-review/status`,{},refs.current.request);
   const status=await statusResponse.json();
   if(!current())return;
   if(!statusResponse.ok)throw Error(status.error||'Chưa đọc được trạng thái bàn giao AI.');
   const latest=validateRuleRequest(status.review_request,proposalId);setSaved(latest);
   if(pending.current&&latest?.intent_hash===pending.current.intent&&(latest.idempotency_key===pending.current.key&&(pending.current.action==='handoff'||latest.status==='cancelled'))){
    pending.current=null;saveRulePending(proposalId,null);setUncertain(false);
   }
   if(latest?.status==='merged'){setData(null);setError('');if(!notified.current){notified.current=true;refs.current.onMerged?.();}return;}
   const response=await boundedFetch(`/api/admin/feedback/${encodeURIComponent(proposalId)}/rule-review/preflight`,{},refs.current.request);
   const result=await response.json();
   if(!current())return;
   if(!response.ok){setData(null);throw Error(result.error||'Bàn giao AI chưa khả dụng.');}
   const next=validateRulePreflight({...result,review_request:latest},proposalId);setData(next);
   setError(pending.current?'Chưa xác minh được yêu cầu trước. Đang kiểm tra trạng thái; chưa gửi yêu cầu mới.':'');
  }catch(e){if(current()){setData(null);setError(e instanceof Error?e.message:'Chưa tải được trạng thái AI.');}}
  finally{if(current())setLoading(false);reading.current=false;}
 };
 useEffect(()=>{
  alive.current=true;generation.current++;setData(null);setSaved(null);setError('');notified.current=false;pending.current=readRulePending(proposalId);setUncertain(!!pending.current);void read();
  const sync=()=>{if(document.visibilityState==='visible')void read();};
  const timer=window.setInterval(sync,10000);window.addEventListener('focus',sync);document.addEventListener('visibilitychange',sync);
  return()=>{alive.current=false;generation.current++;window.clearInterval(timer);window.removeEventListener('focus',sync);document.removeEventListener('visibilitychange',sync);refs.current.onBusyChange?.(false);};
 },[proposalId]);
 const post=async(action:'handoff'|'cancel',recover=false)=>{
  if(mutation.current||loading||(!recover&&uncertain)||disabled)return;
  const recovery=recover?pending.current:null;
  if(recover&&(!recovery?.key||recovery.action!==action))return;
  const intent=recovery?.intent||(action==='cancel'?saved?.intent_hash:data?.intent_hash);
  if(!intent||(!recover&&((action==='handoff'&&(!data?.available||!data.eligible||ruleRequestActive(saved)))||(action==='cancel'&&!ruleRequestActive(saved)))))return;
  mutation.current=true;setBusy(true);refs.current.onBusyChange?.(true);setError('');
  const key=recovery?.key||(action==='handoff'?ruleHandoffKey(proposalId,intent,!!saved&&!ruleRequestActive(saved)):saved?.idempotency_key);
  pending.current={action,intent,key};saveRulePending(proposalId,pending.current);setUncertain(true);
  const version=generation.current,current=()=>alive.current&&generation.current===version;
  try {
   if(recover){
    const checked=await boundedFetch(`/api/admin/feedback/${encodeURIComponent(proposalId)}/rule-review/status`,{},refs.current.request);
    const result=await checked.json();if(!current())return;
    if(!checked.ok)throw Error(result.error||'Chưa kiểm tra được trạng thái. Chưa gửi lại yêu cầu.');
    const latest=validateRuleRequest(result.review_request,proposalId);setSaved(latest);
    if(latest?.intent_hash===intent&&latest.idempotency_key===key&&(action==='handoff'||latest.status==='cancelled')){
     pending.current=null;saveRulePending(proposalId,null);setUncertain(false);return;
    }
   }
   const response=await boundedFetch(`/api/admin/feedback/${encodeURIComponent(proposalId)}/rule-review/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(action==='handoff'?{delegate:true,intent_hash:intent,idempotency_key:key}:{intent_hash:intent,idempotency_key:key})},refs.current.request,45000);
   const result=await response.json();
   if(!current())return;
   if(!response.ok){
    if(response.status<500&&response.status!==408){pending.current=null;saveRulePending(proposalId,null);setUncertain(false);}
    throw Error(result.error||'Chưa hoàn tất bàn giao AI.');
   }
   const next=validateRuleRequest(result.review_request,proposalId);
   if(!next||next.intent_hash!==intent||next.idempotency_key!==key||result.canonical_changed!==false||(action==='cancel'&&next.status!=='cancelled'))throw Error('Chưa xác minh được kết quả. Đang kiểm tra trạng thái trước khi cho phép thao tác mới.');
   pending.current=null;saveRulePending(proposalId,null);setUncertain(false);setSaved(next);
  }catch(e){if(current())setError(e instanceof Error?e.message:'Không nhận được kết quả; đang kiểm tra trạng thái.');}
  finally{mutation.current=false;if(current()){setBusy(false);refs.current.onBusyChange?.(false);void read();}}
 };
 return <section aria-label="AI xem xét feedback" aria-busy={loading||busy} className="rounded-xl border border-indigo-200 bg-indigo-50/30 p-4 space-y-3">
  <h3 className="text-sm font-bold">Giao AI xem xét và merge nếu hợp lý</h3>
  <p className="text-xs text-slate-600">AI đọc feedback, đối chiếu quy chuẩn và phạm vi, rồi tự merge nếu hợp lý. Bạn không cần duyệt lại hoặc chuẩn bị baseline.</p>
  {data&&<details className="text-xs"><summary className="cursor-pointer">Nội dung và phạm vi đang giao AI</summary><p className="mt-2">{String(data.scope.branch_slug||"Quy chuẩn hiện tại")}{data.scope.cross_brand?" · Toàn bộ brand trong phạm vi":""}</p><pre className="whitespace-pre-wrap break-words mt-2">{data.proposed_content_md}</pre></details>}
  {saved&&<div role="status" className="text-sm font-semibold">{ruleStatusLabel(saved.status)}{saved.blockers.map((item,i)=><p key={i} className="text-xs font-normal text-amber-900">{item.message||item.code}</p>)}</div>}
  {error&&<p role="alert" className="text-xs text-amber-900">{error}</p>}
  {data?.blockers.map((item,i)=><p key={i} className="text-xs text-amber-900">{item.message||item.code}</p>)}
  {loading&&!data&&!saved&&<p role="status" className="text-xs">Đang kiểm tra khả năng bàn giao…</p>}
  {uncertain&&<p className="text-xs text-amber-900">Kết quả chưa rõ. Có thể thử lại đúng yêu cầu cũ; hệ thống sẽ kiểm tra trạng thái trước. Đóng cửa sổ không hủy yêu cầu đã gửi.</p>}
  <div className="flex flex-wrap gap-2">
   {uncertain&&pending.current?.key&&<button className={button} disabled={disabled||loading||busy} onClick={()=>post(pending.current!.action,true)}>Thử lại đúng yêu cầu đã gửi</button>}
   {!ruleRequestActive(saved)&&saved?.status!=='merged'&&<button className={`${button} bg-indigo-700 text-white`} disabled={disabled||loading||busy||uncertain||!data?.available||!data.eligible} onClick={()=>post('handoff')}>{busy?'Đang bàn giao…':'Giao AI xem xét & merge'}</button>}
   {ruleRequestActive(saved)&&<button className={button} disabled={disabled||loading||busy||uncertain} onClick={()=>post('cancel')}>Hủy bàn giao</button>}
   <button className={button} disabled={loading||busy} onClick={()=>read()}>Kiểm tra trạng thái</button>
  </div>
 </section>;
}
