import { boundedFetch } from "../request-recovery";
import { useRef, useState } from "react";
import { ArrowLeft, Check, Copy, ImagePlus, Loader2, UploadCloud } from "lucide-react";
type UploadedAsset={asset_id:string;image_url:string;name:string;role:string};
export function FeedbackUpload({onBack}:{onBack:()=>void}){
 const [assets,setAssets]=useState<UploadedAsset[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[copied,setCopied]=useState(false);
 const uploadBusy=useRef(false);
 const upload=async(files:FileList|null)=>{
  if(!files?.length||uploadBusy.current)return;
  const available=Math.max(0,12-assets.length);
  if(!available){setMessage("12 images already uploaded. Copy the confirmed asset IDs below.");return;}
  uploadBusy.current=true;setBusy(true);setMessage("");setCopied(false);
  let confirmed=0;
  try{
   for(const file of Array.from(files).slice(0,available)){
    if(!["image/png","image/jpeg","image/webp","image/gif"].includes(file.type))throw new Error(`${file.name}: unsupported image type`);
    if(file.size>10*1024*1024)throw new Error(`${file.name}: exceeds 10 MB`);
    const data=await new Promise<string>((resolve,reject)=>{const r=new FileReader();const timer=setTimeout(()=>{r.abort();reject(new Error("Reading image timed out"));},20000);r.onload=()=>{clearTimeout(timer);resolve(String(r.result||""));};r.onerror=()=>{clearTimeout(timer);reject(new Error("Unable to read image"));};r.onabort=()=>{clearTimeout(timer);reject(new Error("Image reading interrupted"));};r.readAsDataURL(file);});
    const res=await boundedFetch("/api/feedback/context-assets/upload",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mime_type:file.type,data_base64:data})});
    const json=await res.json();
    if(!res.ok)throw new Error(json.error||"Upload failed");
    if(typeof json.asset_id!=="string"||!json.asset_id||typeof json.image_url!=="string"||!json.image_url)throw new Error("Upload result could not be confirmed. Do not repeat the upload until its status is checked.");
    const asset={asset_id:json.asset_id,image_url:json.image_url,name:file.name,role:"OUTPUT_BEING_REVIEWED"};
    confirmed++;setAssets(v=>[...v,asset]);setMessage(`Confirmed ${confirmed} image${confirmed===1?"":"s"}; continuing upload…`);
   }
   setMessage(`Uploaded ${confirmed} image${confirmed===1?"":"s"} to Creative DNA.${files.length>available?" Remaining files were not uploaded: the 12-image limit was reached.":""}`);
  }catch(e:any){setMessage(`${confirmed} image${confirmed===1?"":"s"} confirmed and retained. ${e.message} Remaining files were not uploaded.`);}
  finally{uploadBusy.current=false;setBusy(false);}
 };
 const payload=JSON.stringify(assets.map(x=>({asset_id:x.asset_id,role:x.role,caption:x.name})),null,2);
 const copy=async()=>{await navigator.clipboard.writeText(payload);setCopied(true);setTimeout(()=>setCopied(false),1500)};
 return <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6"><button onClick={onBack} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900"><ArrowLeft className="w-4 h-4"/>Back to Creative DNA</button><section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-5"><div><div className="flex items-center gap-2"><ImagePlus className="w-5 h-5 text-indigo-600"/><h1 className="text-2xl font-extrabold text-slate-900">Feedback Image Upload</h1></div><p className="text-sm text-slate-500 mt-1">Upload review evidence to Creative DNA, then copy the asset IDs into your Train message.</p></div><label className="min-h-44 border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/30 transition">{busy?<Loader2 className="w-8 h-8 animate-spin text-indigo-600"/>:<UploadCloud className="w-8 h-8 text-indigo-600"/>}<div className="text-sm font-bold text-slate-800">{busy?"Uploading...":"Choose feedback images"}</div><div className="text-xs text-slate-500">PNG, JPEG, WebP or GIF · max 10 MB each · up to 12</div><input className="hidden" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple disabled={busy} onChange={e=>{void upload(e.target.files);e.target.value="";}}/></label>{message&&<div className="text-xs p-3 rounded-lg bg-slate-50 border border-slate-200 text-slate-700">{message}</div>}{!!assets.length&&<div className="space-y-4"><div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{assets.map((x,i)=><div key={x.asset_id} className="border border-slate-200 rounded-xl overflow-hidden"><img src={x.image_url} alt={x.name} className="w-full aspect-square object-cover"/><div className="p-2"><div className="text-xs font-semibold truncate">{x.name}</div><select value={x.role} onChange={e=>setAssets(v=>v.map((a,j)=>j===i?{...a,role:e.target.value}:a))} className="mt-2 w-full text-[11px] border border-slate-200 rounded-md p-1.5"><option>OUTPUT_BEING_REVIEWED</option><option>STYLE_REFERENCE</option><option>PRODUCT_REFERENCE</option><option>GENERATION_CONTEXT</option></select></div></div>)}</div><div className="rounded-xl bg-slate-950 p-4 text-slate-100"><div className="flex justify-between items-center mb-3"><div className="text-xs font-bold">context_asset_ids</div><button onClick={copy} className="inline-flex items-center gap-1.5 text-xs font-semibold">{copied?<Check className="w-3.5 h-3.5"/>:<Copy className="w-3.5 h-3.5"/>}{copied?"Copied":"Copy"}</button></div><pre className="text-[11px] whitespace-pre-wrap break-all">{payload}</pre></div><div className="text-sm text-slate-600">Paste this into the same Train request as <code className="font-semibold">Context asset IDs</code>. V3 can submit these IDs without accessing ChatGPT Library files.</div></div>}</section></main>
}