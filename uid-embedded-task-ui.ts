/** Small embedded ChatGPT controls. No materials feedback picker is embedded. */
export const UID_EMBEDDED_UI_URI="ui://uid-brands/brief-content-v5.html";
export const UID_EMBEDDED_UI_META={ui:{resourceUri:UID_EMBEDDED_UI_URI,visibility:["model","app"]}, "openai/outputTemplate":UID_EMBEDDED_UI_URI} as const;
export const UID_EMBEDDED_UI_HTML=String.raw`<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
:root{font:14px system-ui,-apple-system,sans-serif;color:#1d2423;color-scheme:light dark}*{box-sizing:border-box}body{margin:0;padding:15px;background:transparent}main{max-width:540px;margin:auto;border:1px solid #c4c9c855;border-radius:16px;padding:18px}h2{font-size:17px;margin:0 0 5px}p{color:gray;font-size:12px;line-height:1.45}label{display:block;font-size:12px;font-weight:600;margin:12px 0 5px}select,input,textarea{width:100%;padding:10px;border:1px solid #a3a3a366;background:transparent;color:inherit;border-radius:8px;font:inherit}textarea{min-height:64px}button{padding:11px 14px;border-radius:24px;border:1px solid #8a8a8a88;background:transparent;color:inherit;font:inherit;cursor:pointer}button.primary{background:#196f51;color:#fff;border:0}button:disabled{opacity:.45;cursor:not-allowed}.actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:16px}.hidden{display:none}#status{min-height:22px}#fallback{width:100%;min-height:84px;margin-top:8px}.version{font-size:11px;overflow-wrap:anywhere}
</style></head><body><main><h2>UID Brands</h2><p id="intro">Chọn task và gửi vào cuộc trò chuyện này.</p>
<section id="launcher"><label for="brand">Brand</label><select id="brand"></select><label for="material">Material</label><select id="material"></select><label for="url">Product / Collection URL</label><input id="url" type="url" placeholder="https://..." maxlength="2000"><label for="theme">Yêu cầu thêm (không bắt buộc)</label><textarea id="theme" maxlength="2000"></textarea><div class="actions"><button class="primary" id="start">Tạo task trong ChatGPT</button></div></section>
<section id="content" class="hidden"><p class="version" id="identity"></p><div class="actions"><button class="primary" id="approve">Chốt content &amp; Gen materials</button><button id="revise">Chỉnh content</button></div><label for="note">Góp ý content (nếu cần)</label><textarea id="note" maxlength="4000" placeholder="Nội dung muốn chỉnh..."></textarea></section>
<section id="materials" class="hidden"><p id="materialHelp">Materials được review trực tiếp trên HTML overall preview, không mở feedback panel riêng.</p><div id="previewLinks"></div><div class="actions"><button class="primary" id="package">Kiểm tra &amp; Đóng gói</button></div></section>
<p role="status" id="status" aria-live="polite"></p><div id="manual" class="hidden"><label for="fallback">Prompt (sao chép và gửi trong chat nếu host chưa hỗ trợ)</label><textarea id="fallback" readonly></textarea><div class="actions"><button id="copy">Sao chép prompt</button></div></div>
</main><script>
(function(){
const $=id=>document.getElementById(id);
let state={},busy=false,prepared="";
const safeUrl=x=>{try{const u=new URL(x);return u.protocol==="https:"?u.href:null}catch{return null}};
const setStatus=t=>{$("status").textContent=t};
const setBusy=v=>{busy=v;document.querySelectorAll("button").forEach(b=>{if(b.id!=="copy")b.disabled=v})};
function unwrap(x){return x?.structuredContent||x?.toolResult?.structuredContent||x?.toolOutput?.structuredContent||x?.toolOutput||x||{}}
function use(output){
 state=unwrap(output);
 const stage=state.stage||"launcher";
 const content=stage==="content_approval";
 const materials=["asset_review","packaging","complete"].includes(stage);
 $("launcher").classList.toggle("hidden",stage!=="launcher");
 $("content").classList.toggle("hidden",!content);
 $("materials").classList.toggle("hidden",!materials);
 $("intro").textContent=content?"Duyệt content hiện tại, không thêm bước review khác.":materials?"Xem materials trên HTML preview rồi gửi feedback ngay tại đó.":"Chọn brand, material và sản phẩm.";
 if(stage==="launcher"){
   const routes=Array.isArray(state.routes)?state.routes.filter(x=>x&&typeof x.brand==="string"&&typeof x.branch==="string"):[];
   const brands=[...new Set(routes.map(x=>x.brand))];
   if(!brands.length){$("brand").replaceChildren(new Option("Không tải được danh mục",""));$("material").replaceChildren(new Option("Hãy thử lại danh mục",""));$("start").disabled=true;setStatus("Chưa xác minh được danh mục, không tự đoán material.");}
   else{const prev=$("brand").value;$("brand").replaceChildren(...brands.map(x=>new Option(x,x)));if(brands.includes(prev))$("brand").value=prev;renderMaterials();$("start").disabled=false;setStatus("")}
 }
 if(content||materials){
   const hasIdentity=typeof state.task_id==="string"&&state.task_id.trim()&&typeof state.content_version==="string"&&state.content_version.trim();
   $("identity").textContent=hasIdentity?"Task "+state.task_id+" · phiên bản "+state.content_version:"Chưa xác minh task/phiên bản";
   $("approve").disabled=!hasIdentity;
   $("revise").disabled=!hasIdentity;
   $("package").disabled=!hasIdentity||state.workflow_state?.status==="blocked"||state.workflow_state?.status==="failed"||state.workflow_state?.status==="in_progress";
   const links=Array.isArray(state.result_links)?state.result_links:[];
   const previews=links.filter(x=>x&&safeUrl(x.url)&&/preview|html|overall|review/i.test(String(x.label||"")+" "+x.url));
   $("previewLinks").replaceChildren();
   for(const entry of previews){const a=document.createElement("a");a.href=safeUrl(entry.url);a.textContent=String(entry.label||"Mở HTML preview");a.target="_blank";a.rel="noopener noreferrer";a.style.display="block";a.style.margin="8px 0";$("previewLinks").append(a)}
   if(materials&&!previews.length){const p=document.createElement("p");p.textContent="Chưa có HTML preview được xác minh. Yêu cầu tạo preview từ assets thật, đúng task/version."; $("previewLinks").append(p)}
 }
}
function renderMaterials(){
 const brand=$("brand").value;
 const routes=(state.routes||[]).filter(x=>x.brand===brand);
 const previous=$("material").value;
 $("material").replaceChildren(...routes.map(x=>new Option(String(x.title||x.branch),x.branch)));
 if(routes.some(x=>x.branch===previous))$("material").value=previous;
}
$("brand").onchange=renderMaterials;
async function send(prompt){
 if(busy)return;prepared=prompt;$("manual").classList.add("hidden");
 const host=window.openai;
 if(typeof host?.sendFollowUpMessage!=="function"){showManual("Host chưa hỗ trợ gửi lệnh trực tiếp.");return}
 setBusy(true);setStatus("Đang gửi yêu cầu vào ChatGPT...");
 try{await host.sendFollowUpMessage({prompt});setStatus("Đã gửi yêu cầu vào ChatGPT; kết quả do ChatGPT xử lý.");}
 catch(e){showManual("Chưa xác nhận gửi thành công. Không bấm gửi lại khi chưa kiểm tra chat.");}
 finally{setBusy(false)}
}
function showManual(t){setStatus(t);$("fallback").value=prepared;$("manual").classList.remove("hidden")}
$("copy").onclick=async()=>{try{await navigator.clipboard.writeText(prepared);setStatus("Đã sao chép. Dán vào chat và bấm Gửi.")}catch{$("fallback").focus();$("fallback").select();setStatus("Chọn và sao chép prompt thủ công.")}};
$("start").onclick=()=>{
 const route=(state.routes||[]).find(x=>x.brand===$("brand").value&&x.branch===$("material").value);if(!route)return setStatus("Material chưa hợp lệ.");
 const url=$("url").value.trim();try{const u=new URL(url);if(!["https:","http:"].includes(u.protocol)||!u.hostname.includes("."))throw Error()}catch{return setStatus("Nhập URL product/collection hợp lệ.")};
 const theme=$("theme").value.trim();
 send("Creative DNA — Use: "+route.brand+" / "+route.branch+"\nProduct / Collection: "+url+(theme?"\nTheme: "+theme:"")+"\nThực hiện theo Creative DNA và research bắt buộc. Trả content trước, hiện nút chốt content. Sau materials, cung cấp HTML overall preview đúng task/version để feedback trực tiếp, không mở material feedback panel. Không publish.");
};
function boundCommand(action,note=""){
 const id=state.task_id,version=state.content_version,branch=state.branch;
 if(typeof id!=="string"||!id.trim()||typeof version!=="string"||!version.trim())return setStatus("Thiếu task/version: không thể gửi lệnh.");
 const heading="UID Brands task "+id+" / version "+version+" / branch "+String(branch||"unverified")+". Xác minh đúng kết quả hiện tại trước khi thao tác; không lặp lệnh đã hoàn thành.\n";
 const commands={approve:"Anh chốt content này. Đi thẳng sang gen materials, không hỏi duyệt thêm. Khi done trả HTML overall preview có feedback chọn ngay trên trang, cùng assets thực tế.",revise:"Chỉnh riêng content theo góp ý: "+note+". Giữ phần khác không đổi.",package:"Kiểm tra QC thực tế, và đóng gói assets đúng task/version, xác minh ZIP/CRC trước khi trả. Nếu chưa đủ điều kiện, báo blocker; không khẳng định đã xong."};
 send(heading+commands[action]);
}
$("approve").onclick=()=>boundCommand("approve");
$("revise").onclick=()=>{const note=$("note").value.trim();if(!note)return setStatus("Nhập góp ý content trước.");boundCommand("revise",note)};
$("package").onclick=()=>boundCommand("package");
window.addEventListener("openai:set_globals",e=>{const data=e.detail?.globals?.toolOutput;if(data)use(data)});
use(window.openai?.toolOutput||{});
})();
</script></body></html>`;
