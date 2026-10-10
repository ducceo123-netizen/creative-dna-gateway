/**
 * UID Brands task launcher embedded as an MCP Apps resource.
 * UI only prepares a brief; canonical resolution stays on the existing server.
 */
export const LAUNCHER_URI = "ui://uid-brands/workflow-v2.html";
export const LAUNCHER_MIME = "text/html;profile=mcp-app";

export const launcherHtml = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
:root{color-scheme:light;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;font-feature-settings:"ss03" 1;
--fg:#101010;--muted:#71717a;--bg:#fff;--surface:#fbfbf5;--input:#fff;--border:#e4e4e7;--active:#d4f9e0;--accent:#101010;--placeholder:#a1a1aa;--focus:#217d54}
@media(prefers-color-scheme:dark){:root{color-scheme:dark;--fg:#f7f7f7;--muted:#a1a1aa;--bg:#1c1c1c;--surface:#272727;--input:#222;--border:#454545;--active:#284a37;--accent:#f7f7f7;--placeholder:#98989b;--focus:#9bdab5}}
*{box-sizing:border-box}html{font-size:14px}body{margin:0;padding:20px 20px 24px;color:var(--fg);background:var(--bg);font-size:14px;line-height:1.45}
.wrap{max-width:600px;margin:auto}.header{display:flex;align-items:center;gap:10px;margin:0 0 20px}
.logo{display:none}h1{font-size:19px;line-height:1.3;margin:0;color:var(--fg);font-weight:630;letter-spacing:-.02em}
p{margin:3px 0 0;font-size:12px;color:var(--muted)}
label{font-size:12.5px;font-weight:600;color:var(--fg);display:block;margin:14px 0 6px}
select,input,textarea,button{font:inherit;letter-spacing:inherit;border-radius:8px}
select,input,textarea{width:100%;min-height:42px;padding:10px 12px;background:var(--input);color:var(--fg);border:1px solid var(--border);outline:none}
select:focus-visible,input:focus-visible,textarea:focus-visible,button:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
input::placeholder,textarea::placeholder{color:var(--placeholder);opacity:1}textarea{min-height:76px;resize:vertical}
.action{width:100%;min-height:44px;margin-top:16px;padding:10px 18px;background:var(--fg);color:var(--bg);border:1px solid var(--fg);font-weight:600;cursor:pointer;border-radius:9999px}
.action:hover{opacity:.86}.action:disabled{opacity:.5;cursor:not-allowed}
.review-area{display:none}.review-area.visible{display:block}
.review-options{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.review-choice{flex:1 1 120px;min-height:40px;border:1px solid var(--border);border-radius:9999px;padding:9px 13px;background:var(--input);color:var(--fg);text-align:center;font-size:13px;cursor:pointer}
.review-choice.selected{border-color:var(--fg);background:var(--active);font-weight:600}
body.review-mode{padding:10px 12px 14px}body.review-mode .wrap{max-width:600px}body.review-mode .header,body.review-mode .note{display:none}
body.review-mode .action{width:auto;min-height:38px;margin-top:12px;padding:8px 19px;font-size:13px}
body.review-mode #reviewHelp{font-size:13px;margin:0;color:var(--muted)}
body.review-mode label{margin-top:10px}
.flow-state{font-size:12px;color:var(--muted);padding:9px 12px;border:1px solid var(--border);border-radius:9px;background:var(--surface);margin-bottom:15px}
.mode-tabs{display:flex;gap:4px;background:var(--surface);border:1px solid var(--border);border-radius:9999px;padding:3px;width:max-content}
.mode-tab{border:0;background:transparent;color:var(--fg);padding:8px 18px;cursor:pointer;border-radius:9999px}
.mode-tab.active{background:var(--input);box-shadow:0 1px 2px rgba(0,0,0,.08);font-weight:600}
.mode-info{font-size:12px;color:var(--muted);margin:10px 0}
.variable-keys{display:flex;gap:6px;flex-wrap:wrap}
.variable-key{border:1px solid var(--border);background:var(--input);border-radius:9999px;padding:7px 12px;color:var(--fg);cursor:pointer;font-size:12px}
.variable-key.selected{background:var(--active);border-color:var(--fg)}
.variable-item{border:1px solid var(--border);border-radius:12px;padding:12px;margin-top:10px;background:var(--bg)}
.variable-item-head{display:flex;justify-content:space-between;align-items:center;font-size:12px;font-weight:600}
.variable-item-head button{border:0;color:var(--muted);background:transparent;cursor:pointer}
.variable-item textarea{min-height:70px;margin-top:8px}
.back-action{border:0;background:transparent;color:var(--muted);padding:10px 0;cursor:pointer;text-align:left;font-size:12px}
.error{color:#b42318;font-size:12px;min-height:12px}.optional{font-weight:400;color:var(--muted)}.note{font-size:11.5px;color:var(--muted);margin-top:12px;line-height:1.5;text-align:center}
[hidden]{display:none!important}
@media(max-width:420px){body{padding:15px 14px 20px}.review-choice{flex:1 1 100%}}
</style></head>
<body><main class="wrap">
<div class="header"><div><h1>UID Brands</h1><p>Chọn nội dung cần thực hiện</p></div></div>
<div class="flow-state" id="flowState" role="status" aria-live="polite"></div><section id="launchFields"><label for="brand">Brand</label><select id="brand"></select>
<label for="branches">Material / Task</label><select id="branches" aria-label="Select material"></select>
<label for="url">Product / Collection URL</label><input id="url" type="url" placeholder="https://pawfecthouse.com/collections/..." maxlength="2000" required/>
<label for="theme">Theme <span class="optional">(optional)</span></label><input id="theme" maxlength="120" placeholder="Christmas, Family, Memorial..."/>
<label for="custom">Custom requirements <span class="optional">(optional)</span></label><textarea id="custom" maxlength="4000" placeholder="Any specific creative angle or requirements"></textarea>
</section><section id="reviewFields" class="review-area"><p id="reviewHelp">Review the current outcome and choose the next step.</p><div id="reviewChoices" class="review-options"></div><label for="reviewFeedback" id="feedbackLabel" hidden>Feedback</label><textarea id="reviewFeedback" placeholder="Nhập yêu cầu chỉnh sửa cụ thể..." hidden></textarea><div id="assetFeedbackFields" hidden><div class="mode-tabs"><button type="button" id="modeFeedback" class="mode-tab">Feedback</button><button type="button" id="modeTrain" class="mode-tab">Train</button></div><p id="modeInfo" class="mode-info"></p><label>Chọn variables / section</label><div id="variableKeys" class="variable-keys"></div><div id="groupActions"><button id="createSharedFeedback" type="button">+ Feedback chung cho mục đã chọn</button><button id="clearTargets" type="button">Bỏ chọn</button></div><div id="variableItems"></div><button id="backToReview" type="button" class="back-action">← Quay lại</button></div></section><div class="error" id="error" role="alert"></div><button class="action" id="run" type="button">Run UID Brands</button>

</main>
<script>
(function(){
const $=id=>document.getElementById(id);
const initial=(window.openai&&window.openai.widgetState)||{};
// Keep typing local: setWidgetState can trigger host updates and input focus loss.
let routes=[], selected=initial.branch||"", fallbackActive=true, stage="launcher", decision="approve", submitting=false, feedbackStep=false, taskAssets=[], feedbackMode="feedback", variableItems=[], selectedTargets=new Set();
const fallback=[{brand:"pawfecthouse",branch:"onepage-system",title:"Onepage"}];
function readable(name){const brands={pawfecthouse:"PawfectHouse",giftsoul:"GiftSoul",soulprise:"SoulPrise"};return brands[name.toLowerCase()]||name.replace(/-/g," ").replace(/\b\w/g,x=>x.toUpperCase())}
function availableVariables(){
 const seen=new Set(), result=[{key:"Overall",label:"Overall · Toàn bộ outcome",element:"Overall"}];
 const counters={};
 taskAssets.forEach(a=>{
  const id=String(a.id||a.asset_id||"").trim();if(!id||seen.has(id))return;seen.add(id);
  const element=String(a.element||a.section||"").trim();
  const explicit=String(a.label||a.asset_name||a.name||a.position||"").trim();
  const section=element||"Chưa xác định section";
  counters[section]=(counters[section]||0)+1;
  const index=String(counters[section]).padStart(2,"0");
  // A missing section MUST NOT be guessed from the opaque libfile ID.
  const label=explicit?(element?element+" · "+explicit:explicit):(element?element+" · Asset "+index:"Asset "+String(result.length).padStart(2,"0")+" · Chưa định danh");
  result.push({key:id,label,element:section});
 });
 return result;
}
function renderVariables(){
 $("modeFeedback").classList.toggle("active",feedbackMode==="feedback");
 $("modeTrain").classList.toggle("active",feedbackMode==="train");
 $("modeInfo").textContent=feedbackMode==="train"?"Gửi đề xuất training đến Admin duyệt; không cập nhật database tự động.":"Yêu cầu chỉnh sửa kết quả trong task hiện tại.";
 const keys=$("variableKeys");keys.replaceChildren();
 const variables=availableVariables(), groups={};
 variables.slice(1).forEach(v=>(groups[v.element]??=[]).push(v));
 function targetButton(variable,where){
  const key=variable.key,selected=selectedTargets.has(key);
  const btn=document.createElement("button");btn.type="button";btn.className="variable-key"+(selected?" selected":"");
  btn.textContent=(selected?"✓ ":"")+variable.label;btn.title=variable.label;
  btn.setAttribute("aria-pressed",String(selected));
  btn.onclick=()=>{
   if(selected)selectedTargets.delete(key);
   else {if(key==="Overall")selectedTargets.clear();else selectedTargets.delete("Overall");selectedTargets.add(key);}
   renderVariables();
  };
  where.appendChild(btn);
 }
 targetButton(variables[0],keys);
 Object.entries(groups).forEach(([name,items])=>{
  const section=document.createElement("div");section.className="variable-section";
  const header=document.createElement("div");header.className="variable-section-title";
  const all=items.every(v=>selectedTargets.has(v.key));
  const select=document.createElement("button");select.type="button";select.className="variable-key"+(all?" selected":"");
  select.textContent=(all?"✓ ":"")+"Chọn cả nhóm: "+name+" ("+items.length+")";
  select.onclick=()=>{selectedTargets.delete("Overall");items.forEach(v=>all?selectedTargets.delete(v.key):selectedTargets.add(v.key));renderVariables();};
  header.appendChild(select);section.appendChild(header);
  const wrap=document.createElement("div");wrap.className="variable-keys";
  items.forEach(v=>targetButton(v,wrap));section.appendChild(wrap);keys.appendChild(section);
 });
 $("createSharedFeedback").disabled=!selectedTargets.size;
 const root=$("variableItems");root.replaceChildren();
 variableItems.forEach(item=>{
  const box=document.createElement("div");box.className="variable-item";
  const head=document.createElement("div");head.className="variable-item-head";
  const name=document.createElement("span");const display=availableVariables().find(v=>v.key===item.key);name.textContent=item.targets?("Feedback chung · "+item.targets.length+" targets"):(display?display.label:"Asset không còn trong danh sách");
  const remove=document.createElement("button");remove.type="button";remove.textContent="×";remove.setAttribute("aria-label","Bỏ "+item.key);
  remove.onclick=()=>{variableItems=variableItems.filter(x=>x!==item);renderVariables();};
  head.append(name,remove);
  const area=document.createElement("textarea");area.rows=2;area.placeholder=item.targets?"Feedback chung cho tất cả targets đã chọn…":"Feedback cho "+(display?.label||"asset đã chọn")+"…";area.value=item.text;area.oninput=()=>{item.text=area.value;};
  box.appendChild(head);if(item.targets){const names=document.createElement("p");names.className="group-targets";names.textContent=item.targets.map(k=>availableVariables().find(v=>v.key===k)?.label||"Asset").join(" · ");box.appendChild(names);}box.appendChild(area);root.appendChild(box);
 });
}
$("createSharedFeedback").onclick=()=>{const targets=[...selectedTargets];if(!targets.length)return;variableItems.push({key:"group-"+variableItems.length,targets,text:""});selectedTargets.clear();renderVariables();};
$("clearTargets").onclick=()=>{selectedTargets.clear();renderVariables();};
$("modeFeedback").onclick=()=>{feedbackMode="feedback";renderVariables();};
$("modeTrain").onclick=()=>{feedbackMode="train";renderVariables();};
$("backToReview").onclick=()=>{feedbackStep=false;decision="feedback";renderStage();};
function renderStage(){
 const review=stage!=="launcher";document.body.classList.toggle("review-mode",review);
 const statuses={launcher:"Bước 1/4 · Chuẩn bị brief",content_approval:"Bước 2/4 · Chờ duyệt nội dung",asset_review:"Bước 3/4 · Chờ duyệt hình ảnh",packaging:"Bước 4/4 · Sẵn sàng đóng gói"};
 $("flowState").textContent=statuses[stage]||statuses.launcher;
 $("launchFields").hidden=review;$("reviewFields").classList.toggle("visible",review);
 const labels={content_approval:"Content Approval",asset_review:"Asset Review",packaging:"Packaging"};
 $("reviewChoices").replaceChildren();
 if(review){
  $("reviewHelp").textContent=(labels[stage]||"Review")+" · Chọn bước tiếp theo";
  const choices=stage==="packaging"?[["package","Đóng gói"]]:stage==="asset_review"?[["package","Đóng gói"],["feedback","Gửi feedback"]]:[["approve","Chốt content"],["revise","Yêu cầu chỉnh sửa"],["regenerate","Tạo phương án khác"]];
  if(!choices.some(x=>x[0]===decision))decision=choices[0][0];
  choices.forEach(([value,label])=>{const b=document.createElement("button");b.type="button";b.className="review-choice"+(decision===value?" selected":"");b.setAttribute("aria-pressed",String(decision===value));b.textContent=label;b.onclick=()=>{decision=value;feedbackStep=stage==="asset_review"&&value==="feedback";renderStage();};$("reviewChoices").appendChild(b);});
  $("reviewChoices").hidden=feedbackStep; $("assetFeedbackFields").hidden=!feedbackStep;
  $("reviewFeedback").hidden=decision!=="revise";$("feedbackLabel").hidden=decision!=="revise";
  if(feedbackStep)renderVariables();
 }
 $("run").textContent=review?(feedbackStep?(feedbackMode==="train"?"Gửi Train":"Gửi feedback"):(stage==="packaging"||stage==="asset_review"&&decision==="package")?"Đóng gói":stage==="content_approval"&&decision==="approve"?"Chốt content":"Tiếp tục"):"Bắt đầu";
}
function load(output){
 let data=output||{};
 if(data.structuredContent)data=data.structuredContent;
 if(["launcher","content_approval","asset_review","packaging"].includes(data.stage))stage=data.stage;
 if(Array.isArray(data.assets))taskAssets=data.assets.filter(a=>a&&typeof a==="object").slice(0,100);
 if(stage==="asset_review"&&decision!=="feedback"&&decision!=="package")decision="package";
 if(Array.isArray(data.routes)&&data.routes.length){routes=data.routes.filter(r=>r&&r.brand&&r.branch);fallbackActive=false;}
 if(!routes.length)routes=fallback;
 const brands=[...new Set(routes.map(x=>x.brand))];
 const select=$("brand"); const current=initial.brand&&brands.includes(initial.brand)?initial.brand:(brands.includes("pawfecthouse")?"pawfecthouse":brands[0]);
 select.replaceChildren(...brands.map(b=>{const o=document.createElement("option");o.value=b;o.textContent=readable(b);return o;}));select.value=current;
 $("url").value=$("url").value||initial.url||"";$("theme").value=$("theme").value||initial.theme||"";$("custom").value=$("custom").value||initial.custom||"";
 draw();renderStage();
}
function draw(){
 const brand=$("brand").value, options=routes.filter(r=>r.brand===brand);
 if(!options.some(r=>r.branch===selected))selected=options.find(r=>r.branch==="onepage-system")?.branch||options[0]?.branch||"";
 const select=$("branches");
 const shortNames={"onepage-system":"Onepage","ldp-system":"LDP","home-hero":"Home Hero","ldp-hero":"LDP Hero","ugc-image":"UGC","recipient-image":"Recipient Image","seasonal-banner":"Seasonal Banner","shop-by-product-image":"Shop By Product","shop-by-categories":"Shop By Categories","niche-product-combo":"Niche Product Combo"};
 select.replaceChildren(...options.map(r=>{const option=document.createElement("option");option.value=r.branch;option.textContent=shortNames[r.branch]||readable(r.branch);return option;}));
 select.value=selected;

}
function save(){try{window.openai?.setWidgetState?.({brand:$("brand").value,branch:selected,url:$("url").value,theme:$("theme").value,custom:$("custom").value});}catch{}}
$("brand").onchange=()=>{draw();save();}; $("branches").onchange=()=>{selected=$("branches").value;save();}; ["url","theme","custom"].forEach(id=>{ $(id).addEventListener("change",save); $(id).addEventListener("blur",save); });
$("run").onclick=async()=>{
 if(submitting)return;
 if(stage!=="launcher"){
  const feedback=$("reviewFeedback").value.trim();if(decision==="revise"&&!feedback){$("error").textContent="Vui lòng nhập nội dung cần chỉnh sửa.";return;}
  if(stage==="asset_review"&&feedbackStep&&(!variableItems.length||variableItems.some(x=>!x.text.trim()))){$("error").textContent="Chọn variables và nhập feedback cho từng mục.";return;}
  const payload=variableItems.map(x=>{const target=availableVariables().find(v=>v.key===x.key);return "@"+(target?.label||"Asset")+" [asset_id="+x.key+"]: "+x.text.trim();}).join("\n");
  const message=stage==="asset_review"&&feedbackStep
    ? (feedbackMode==="train"
      ? "UID Brands — Train cho material của task hiện tại.\n"+payload+"\nThực hiện Train NGAY bằng submit_training_feedback, không hỏi user xác nhận lại; chờ kết quả tool rồi báo trạng thái thực, không tự sửa canonical rules. Kèm action tiếp theo ngay trong câu trả lời."
      : "UID Brands — Feedback chỉnh sửa assets của task hiện tại.\n"+payload+"\nTHỰC HIỆN NGAY feedback đã gửi, không hỏi xác nhận lần nữa. Chỉ chỉnh sửa các variable được chọn; giữ nguyên phần còn lại. Trả outcome mới kèm action Gửi feedback / Đóng gói ngay trong cùng câu trả lời.")
    : stage==="content_approval"?(decision==="approve"?"UID Brands: Chốt content hiện tại và tạo assets NGAY theo canonical rules, không hỏi lại. Trả assets kèm action Gửi feedback / Train / Đóng gói.":decision==="revise"?"UID Brands: Chỉnh sửa content hiện tại theo feedback: "+feedback:"UID Brands: Tạo phương án content mới NGAY theo brief hiện tại, trả content và action Chốt content / Gửi feedback / Tạo lại trong cùng câu trả lời.")
    : stage==="asset_review"?"UID Brands: Đóng gói assets hiện tại ngay theo canonical rules. Trả link/file đã tạo và action Sửa tiếp / Task mới; nếu không tạo được file, báo lỗi thật và action Thử lại, không im lặng."
    : "UID Brands: Đóng gói ngay kết quả task hiện tại; trả deliverables và action Sửa tiếp / Task mới.";
  const fn=window.openai?.sendFollowUpMessage;if(!fn){$("error").textContent="Không kết nối được ChatGPT.";return;}
  submitting=true;$("run").disabled=true;$("flowState").textContent="Đang gửi lựa chọn sang ChatGPT…";try{await fn({prompt:message});$("flowState").textContent="Đã gửi lựa chọn · Chờ ChatGPT xử lý";}catch{$("error").textContent="Gửi thất bại — bấm lại nút để thử; nội dung feedback vẫn được giữ.";$("flowState").textContent="Chưa gửi được · Vui lòng thử lại";}finally{submitting=false;$("run").disabled=false;}return;
 }
 const url=$("url").value.trim(), brand=$("brand").value, route=routes.find(r=>r.brand===brand&&r.branch===selected);
 if(!route){$("error").textContent="Choose a material.";return;}
 try{const u=new URL(url);if(!/^https?:$/.test(u.protocol)||!u.hostname.includes("."))throw new Error();}catch{$("error").textContent="Enter a valid PDP or collection URL.";return;}
 $("error").textContent="";save();
 const prompt="Creative DNA — Use: "+readable(brand)+" / "+(route.branch==="onepage-system"?"Onepage":route.title||readable(route.branch))+"\nProduct / Collection: "+url+($("theme").value.trim()?"\nTheme: "+$("theme").value.trim():"")+($("custom").value.trim()?"\nCustom content: "+$("custom").value.trim():"")+"\nExecute this task using the current canonical Creative DNA rules. For Onepage, compile_onepage_job first; do not invent product facts.";
 const fn=window.openai?.sendFollowUpMessage;
 if(!fn){$("error").textContent="ChatGPT widget bridge is unavailable. Open this launcher inside ChatGPT.";return;}
 submitting=true;$("run").disabled=true;$("run").textContent="Đang gửi…";$("flowState").textContent="Đang gửi brief sang ChatGPT…";
 try{await fn({prompt});$("flowState").textContent="Đã gửi brief · ChatGPT đang tiếp nhận";}catch(e){$("error").textContent="Không gửi được task. Vui lòng thử lại.";$("flowState").textContent="Chưa gửi được brief";}finally{submitting=false;$("run").disabled=false;$("run").textContent="Bắt đầu";}
};
window.addEventListener("openai:set_globals",event=>{const output=event.detail?.globals?.toolOutput;if(output&&(output.routes||output.stage)){if(fallbackActive||output.stage)load(output);}});
load(window.openai?.toolOutput||{});renderStage();
})();
</script></body></html>`;
