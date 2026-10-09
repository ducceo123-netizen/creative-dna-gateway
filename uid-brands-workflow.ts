/**
 * UID Brands task launcher embedded as an MCP Apps resource.
 * UI only prepares a brief; canonical resolution stays on the existing server.
 */
export const LAUNCHER_URI = "ui://uid-brands/workflow-v2.html";
export const LAUNCHER_MIME = "text/html;profile=mcp-app";

export const launcherHtml = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
:root{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color-scheme:light;--fg:#202123;--muted:#656b73;--bg:#fff;--surface:#f8f9fa;--input:#fff;--tile:#fff;--border:#d9dde3;--active:#ececec;--accent:#202123;--placeholder:#777e89;--focus:#777e89}
@media(prefers-color-scheme:dark){:root{color-scheme:dark;--fg:#ececec;--muted:#b6bac3;--bg:#212121;--surface:#292929;--input:#2b2b2b;--tile:#292929;--border:#505050;--active:#373737;--accent:#ececec;--placeholder:#a1a1aa;--focus:#a1a1aa}}
*{box-sizing:border-box}body{margin:0;padding:14px;color:var(--fg);background:var(--bg);font-size:14px;line-height:1.4}
.wrap{max-width:620px;margin:auto}.header{display:flex;align-items:center;gap:10px;margin-bottom:14px}
.logo{display:grid;place-items:center;width:34px;height:34px;border:1px solid var(--border);border-radius:11px;background:var(--surface);color:var(--accent);font-weight:750;font-size:18px}
h1{font-size:18px;line-height:1.3;margin:0;color:var(--fg);font-weight:700}p{margin:2px 0 0;font-size:12px;color:var(--muted)}
label{font-size:13px;font-weight:650;color:var(--fg);display:block;margin:14px 0 6px}
select,input,textarea,button{font:inherit;border-radius:10px}
select,input,textarea{width:100%;padding:10px 12px;background:var(--input);color:var(--fg);border:1px solid var(--border);outline:none}
select:focus-visible,input:focus-visible,textarea:focus-visible,.preview-toggle:focus-visible,.action:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
input::placeholder,textarea::placeholder{color:var(--placeholder);opacity:1}textarea{min-height:69px;resize:vertical}
.action{width:100%;min-height:45px;margin-top:14px;padding:11px 14px;background:var(--fg);color:var(--bg);border:0;font-weight:650;cursor:pointer}
.action:hover{opacity:.88}.action:disabled{opacity:.55;cursor:not-allowed}
.review-area{display:none}.review-area.visible{display:block}.review-options{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.review-choice{width:auto;flex:1 1 auto;min-height:38px;border:1px solid var(--border);border-radius:9px;padding:8px 12px;background:var(--input);color:var(--fg);text-align:center;font-size:13px;cursor:pointer}
.review-choice.selected{border-color:var(--fg);background:var(--active);font-weight:600}.review-choice:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
body.review-mode{padding:8px 10px 12px}body.review-mode .wrap{max-width:620px}body.review-mode .header,body.review-mode .note{display:none}
body.review-mode .action{width:auto;min-height:36px;margin-top:12px;padding:8px 16px;font-size:13px;border-radius:9px}
body.review-mode #reviewHelp{font-size:13px;margin:0;color:var(--muted)}
body.review-mode label{margin-top:10px}.note{font-size:11.5px;color:var(--muted);margin-top:9px;line-height:1.5;text-align:center}
.flow-state{font-size:12px;color:var(--muted);padding:8px 10px;border:1px solid var(--border);border-radius:9px;margin-bottom:12px}.field-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.back-action{border:0;background:transparent;color:var(--muted);padding:8px 0;cursor:pointer;text-align:left;font-size:12px}#assetFeedbackFields label{margin-top:10px}@media(max-width:400px){.field-grid{grid-template-columns:1fr}}.error{color:#e5484d;font-size:12px;min-height:12px}.optional{font-weight:400;color:var(--muted)}
[hidden]{display:none!important}
@media(max-width:420px){body{padding:10px}.tile{padding:7px 10px}}
</style></head>
<body><main class="wrap">
<div class="header"><div><h1>UID Brands</h1><p>Chọn nội dung cần thực hiện</p></div></div>
<div class="flow-state" id="flowState" role="status" aria-live="polite"></div><section id="launchFields"><label for="brand">Brand</label><select id="brand"></select>
<label for="branches">Material / Task</label><select id="branches" aria-label="Select material"></select>
<label for="url">Product / Collection URL</label><input id="url" type="url" placeholder="https://pawfecthouse.com/collections/..." maxlength="2000" required/>
<label for="theme">Theme <span class="optional">(optional)</span></label><input id="theme" maxlength="120" placeholder="Christmas, Family, Memorial..."/>
<label for="custom">Custom requirements <span class="optional">(optional)</span></label><textarea id="custom" maxlength="4000" placeholder="Any specific creative angle or requirements"></textarea>
</section><section id="reviewFields" class="review-area"><p id="reviewHelp">Review the current outcome and choose the next step.</p><div id="reviewChoices" class="review-options"></div><label for="reviewFeedback" id="feedbackLabel" hidden>Feedback</label><textarea id="reviewFeedback" placeholder="Nhập yêu cầu chỉnh sửa cụ thể..." hidden></textarea><div id="assetFeedbackFields" hidden><div class="field-grid"><div><label for="feedbackElement">Element</label><select id="feedbackElement"></select></div><div><label for="feedbackPosition">Asset / Vị trí</label><select id="feedbackPosition"></select></div></div><label for="assetFeedbackText">Feedback</label><textarea id="assetFeedbackText" rows="3" placeholder="Điểm cần chỉnh sửa..."></textarea><button id="backToReview" type="button" class="back-action">← Quay lại lựa chọn</button></div></section><div class="error" id="error" role="alert"></div><button class="action" id="run" type="button">Run UID Brands</button>

</main>
<script>
(function(){
const $=id=>document.getElementById(id);
const initial=(window.openai&&window.openai.widgetState)||{};
// Keep typing local: setWidgetState can trigger host updates and input focus loss.
let routes=[], selected=initial.branch||"", fallbackActive=true, stage="launcher", decision="approve", submitting=false, feedbackStep=false, taskAssets=[];
const fallback=[{brand:"pawfecthouse",branch:"onepage-system",title:"Onepage"}];
function readable(name){const brands={pawfecthouse:"PawfectHouse",giftsoul:"GiftSoul",soulprise:"SoulPrise"};return brands[name.toLowerCase()]||name.replace(/-/g," ").replace(/\b\w/g,x=>x.toUpperCase())}
const elementDefaults={"Overall":["Overall"],"Banner":["Overall"],"Why You'll Love It":["Overall"],"Product Details":["Overall"],"Good To Know":["Overall"],"FAQs":["Overall"],"UGC":["Overall"]};
function assetOptions(){
 const groups={"Overall":["Overall"]};
 taskAssets.forEach(a=>{const el=String(a.element||"Overall"),id=String(a.id||a.asset_id||"").trim();if(!id)return;(groups[el]??=[]).push(id);});
 return taskAssets.length?groups:elementDefaults;
}
function renderFeedbackOptions(){
 const groups=assetOptions(), el=$("feedbackElement"),prev=el.value;
 el.replaceChildren(...Object.keys(groups).map(v=>{const opt=document.createElement("option");opt.value=v;opt.textContent=v;return opt}));
 el.value=groups[prev]?prev:Object.keys(groups)[0];
 const pos=$("feedbackPosition"),old=pos.value;const choices=groups[el.value]||["Overall"];
 pos.replaceChildren(...["Overall",...choices.filter(v=>v!=="Overall")].map(v=>{const opt=document.createElement("option");opt.value=v;opt.textContent=v;return opt}));
 pos.value=[...pos.options].some(o=>o.value===old)?old:"Overall";
}
$("feedbackElement").onchange=renderFeedbackOptions;
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
  const choices=stage==="packaging"?[["package","Đóng gói"]]:stage==="asset_review"?[["package","Đóng gói"],["feedback","Gửi feedback"]]:[["approve","Duyệt content"],["revise","Yêu cầu chỉnh sửa"],["regenerate","Tạo phương án khác"]];
  if(!choices.some(x=>x[0]===decision))decision=choices[0][0];
  choices.forEach(([value,label])=>{const b=document.createElement("button");b.type="button";b.className="review-choice"+(decision===value?" selected":"");b.setAttribute("aria-pressed",String(decision===value));b.textContent=label;b.onclick=()=>{decision=value;feedbackStep=stage==="asset_review"&&value==="feedback";renderStage();};$("reviewChoices").appendChild(b);});
  $("reviewChoices").hidden=feedbackStep; $("assetFeedbackFields").hidden=!feedbackStep;
  $("reviewFeedback").hidden=decision!=="revise";$("feedbackLabel").hidden=decision!=="revise";
  if(feedbackStep)renderFeedbackOptions();
 }
 $("run").textContent=review?(feedbackStep?"Gửi feedback":(stage==="packaging"||stage==="asset_review"&&decision==="package")?"Đóng gói":"Tiếp tục"):"Bắt đầu";
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
  if(stage==="asset_review"&&feedbackStep&&!$("assetFeedbackText").value.trim()){$("error").textContent="Nhập feedback trước khi gửi.";return;}
  const message=stage==="content_approval"?(decision==="approve"?"UID Brands: Duyệt content hiện tại, tiếp tục bước tạo assets.":decision==="revise"?"UID Brands: Chỉnh sửa content hiện tại theo feedback: "+feedback:"UID Brands: Tạo phương án content mới theo brief hiện tại."):stage==="asset_review"?(decision==="package"?"UID Brands: Đóng gói các assets hiện tại theo canonical rules.": "UID Brands: Chỉnh sửa asset của task hiện tại. Element: "+$("feedbackElement").value+"; Asset ID / Position: "+$("feedbackPosition").value+"; Feedback: "+$("assetFeedbackText").value.trim()+". Giữ các assets khác không liên quan. Sau khi sửa, hiển thị lại Asset Review với lựa chọn Gửi feedback hoặc Đóng gói."):"UID Brands: Đóng gói kết quả task hiện tại theo canonical rules.";
  const fn=window.openai?.sendFollowUpMessage;if(!fn){$("error").textContent="Không kết nối được ChatGPT.";return;}
  submitting=true;$("run").disabled=true;$("flowState").textContent="Đang gửi lựa chọn sang ChatGPT…";try{await fn({prompt:message});$("flowState").textContent="Đã gửi lựa chọn · Chờ ChatGPT xử lý";}catch{$("error").textContent="Không gửi được lựa chọn, thử lại.";$("flowState").textContent="Chưa gửi được · Vui lòng thử lại";}finally{submitting=false;$("run").disabled=false;}return;
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
