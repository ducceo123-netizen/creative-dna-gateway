/**
 * Creative DNA task launcher embedded as an MCP Apps resource.
 * UI only prepares a brief; canonical resolution stays on the existing server.
 */
export const LAUNCHER_URI = "ui://creative-dna/task-launcher-v1.html";
export const LAUNCHER_MIME = "text/html;profile=mcp-app";

export const launcherHtml = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
:root{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color-scheme:light;--fg:#202123;--muted:#656b73;--bg:#fff;--surface:#f8f9fa;--input:#fff;--tile:#fff;--border:#d9dde3;--active:#f3f2ff;--accent:#5955d8;--placeholder:#777e89;--focus:#6e68d9}
@media(prefers-color-scheme:dark){:root{color-scheme:dark;--fg:#ececec;--muted:#b6bac3;--bg:#212121;--surface:#292929;--input:#2b2b2b;--tile:#292929;--border:#505050;--active:#343044;--accent:#b3a8ff;--placeholder:#a1a1aa;--focus:#b3a8ff}}
*{box-sizing:border-box}body{margin:0;padding:14px;color:var(--fg);background:var(--bg);font-size:14px;line-height:1.4}
.wrap{max-width:620px;margin:auto}.header{display:flex;align-items:center;gap:10px;margin-bottom:14px}
.logo{display:grid;place-items:center;width:34px;height:34px;border:1px solid var(--border);border-radius:11px;background:var(--surface);color:var(--accent);font-weight:750;font-size:18px}
h1{font-size:18px;line-height:1.3;margin:0;color:var(--fg);font-weight:700}p{margin:2px 0 0;font-size:12px;color:var(--muted)}
label{font-size:13px;font-weight:650;color:var(--fg);display:block;margin:14px 0 6px}
select,input,textarea,button{font:inherit;border-radius:10px}
select,input,textarea{width:100%;padding:10px 12px;background:var(--input);color:var(--fg);border:1px solid var(--border);outline:none}
select:focus-visible,input:focus-visible,textarea:focus-visible,.tile:focus-visible,.preview-toggle:focus-visible,.action:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
input::placeholder,textarea::placeholder{color:var(--placeholder);opacity:1}textarea{min-height:69px;resize:vertical}
.tiles{display:flex;flex-wrap:wrap;gap:7px}.tile{width:auto;min-height:38px;border:1px solid var(--border);background:var(--tile);color:var(--fg);text-align:center;cursor:pointer;padding:8px 12px;overflow-wrap:anywhere}
.tile:hover{border-color:var(--accent);background:var(--surface)}.tile.active{border-color:var(--accent);background:var(--active);color:var(--fg)}
.tile.active::before{content:"✓";color:var(--accent);font-weight:750;margin-right:6px}.tile span{font-size:12.5px;font-weight:550;color:inherit}
.preview{margin:15px 0 2px;padding:11px 12px;border:1px solid var(--border);border-radius:12px;background:var(--surface)}
.preview-top{display:flex;justify-content:space-between;align-items:center;gap:12px}.preview-title{font-size:13px;font-weight:650;color:var(--fg)}
.preview-desc{font-size:12px;color:var(--muted);margin-top:8px;line-height:1.5}
.preview-img{margin-top:10px;max-height:240px;width:100%;object-fit:contain;border-radius:8px;background:var(--input);cursor:zoom-in}
.preview-toggle{width:auto;flex-shrink:0;background:var(--input);border:1px solid var(--border);color:var(--fg);padding:6px 10px;font-size:12px;cursor:pointer}
.preview-link{display:inline-block;margin-top:8px;color:var(--accent);font-size:12px;font-weight:650}
.preview-modal{position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:10;display:none;place-items:center;padding:25px}
.preview-modal.open{display:grid}.preview-modal img{max-width:95vw;max-height:82vh;object-fit:contain}
.preview-close{position:absolute;right:12px;top:12px;width:auto;color:#fff;background:#383838;border:1px solid #999;cursor:pointer;padding:7px 11px}
.action{width:100%;min-height:45px;margin-top:14px;padding:11px 14px;background:#5755d6;color:white;border:0;font-weight:650;cursor:pointer}
.action:hover{background:#4846c4}.action:disabled{opacity:.55;cursor:not-allowed}
.note{font-size:11.5px;color:var(--muted);margin-top:9px;line-height:1.5;text-align:center}
.error{color:#e5484d;font-size:12px;min-height:12px}.optional{font-weight:400;color:var(--muted)}
[hidden]{display:none!important}
@media(max-width:420px){body{padding:10px}.tile{padding:7px 10px}.preview-top{align-items:flex-start}}
</style></head>
<body><main class="wrap">
<div class="header"><div class="logo">✦</div><div><h1>Creative DNA</h1><p>Select a brand and material to begin</p></div></div>
<label for="brand">Brand</label><select id="brand"></select>
<label>Material</label><div class="tiles" id="branches" role="group" aria-label="Select material"></div>
<section class="preview" aria-label="Material preview">
  <div class="preview-top"><div class="preview-title" id="previewTitle">Material preview</div><button class="preview-toggle" id="previewToggle" type="button" aria-expanded="false">Show preview</button></div>
  <div id="previewBody" hidden><div class="preview-desc" id="previewDescription"></div><img id="previewImage" class="preview-img" alt="Selected material preview" hidden /><div class="preview-desc" id="previewEmpty" hidden>Preview image is not available for this material yet.</div><a id="previewLink" class="preview-link" target="_blank" rel="noopener noreferrer" hidden>Open live preview ↗</a></div>
</section>
<div class="preview-modal" id="previewModal" role="dialog" aria-modal="true" aria-label="Full preview"><button id="previewClose" class="preview-close" type="button">Close ✕</button><img id="previewLarge" alt="Full material preview" /></div>
<label for="url">Product / Collection URL</label><input id="url" type="url" placeholder="https://pawfecthouse.com/collections/..." maxlength="2000" required/>
<label for="theme">Theme <span class="optional">(optional)</span></label><input id="theme" maxlength="120" placeholder="Christmas, Family, Memorial..."/>
<label for="custom">Custom requirements <span class="optional">(optional)</span></label><textarea id="custom" maxlength="4000" placeholder="Any specific creative angle or requirements"></textarea>
<div class="error" id="error" role="alert"></div><button class="action" id="run" type="button">Generate</button>
<div class="note">Uses your current Creative DNA rules — no copy/paste needed.</div>
</main>
<script>
(function(){
const $=id=>document.getElementById(id);
const initial=(window.openai&&window.openai.widgetState)||{};
let routes=[], guides=[], selected=initial.branch||"";
const fallback=[{brand:"pawfecthouse",branch:"onepage-system",title:"Onepage"}];
function readable(name){return name.replace(/\b\w/g,x=>x.toUpperCase()).replace(/-/g," ")}
function load(output){
 let data=output||{};
 if(data.structuredContent)data=data.structuredContent;
 if(data.routes)routes=data.routes.filter(r=>r&&r.brand&&r.branch);
 if(Array.isArray(data.guides))guides=data.guides;
 if(!routes.length)routes=fallback;
 const brands=[...new Set(routes.map(x=>x.brand))];
 const select=$("brand"); const current=initial.brand&&brands.includes(initial.brand)?initial.brand:brands[0];
 select.replaceChildren(...brands.map(b=>{const o=document.createElement("option");o.value=b;o.textContent=readable(b);return o;}));select.value=current;
 $("url").value=initial.url||"";$("theme").value=initial.theme||"";$("custom").value=initial.custom||"";
 draw();
}
function draw(){
 const brand=$("brand").value, options=routes.filter(r=>r.brand===brand);
 if(!options.some(r=>r.branch===selected))selected=options.find(r=>r.branch==="onepage-system")?.branch||options[0]?.branch||"";
 const container=$("branches");container.replaceChildren();
 options.forEach(r=>{
 const btn=document.createElement("button");btn.type="button";btn.className="tile"+(selected===r.branch?" active":"");
 const title=document.createElement("span");const shortNames={"onepage-system":"Onepage","ldp-system":"LDP","home-hero":"Home Hero","ldp-hero":"LDP Hero","ugc-image":"UGC Image","recipient-image":"Recipient Image","seasonal-banner":"Seasonal Banner","shop-by-product-image":"Shop By Product","shop-by-categories":"Shop By Categories","niche-product-combo":"Niche Product Combo"};title.textContent=shortNames[r.branch]||readable(r.branch);
 btn.appendChild(title);btn.setAttribute("aria-pressed",String(selected===r.branch));btn.onclick=()=>{selected=r.branch;draw();save();};
 container.appendChild(btn);
 });
 renderPreview();
 save();
}
function save(){window.openai?.setWidgetState?.({brand:$("brand").value,branch:selected,url:$("url").value,theme:$("theme").value,custom:$("custom").value})}
function renderPreview(){
 const guide=guides.find(g=>g.brand===$("brand").value&&g.branch===selected)||{};
 const route=routes.find(r=>r.brand===$("brand").value&&r.branch===selected);
 $("previewTitle").textContent=(route?.branch==="onepage-system"?"Onepage":route?.title||readable(selected))+" · Preview";
 $("previewDescription").textContent=guide.description||"Visual reference for the selected material.";
 const img=$("previewImage");img.hidden=!guide.imageUrl;
 if(guide.imageUrl){img.src=guide.imageUrl;img.alt=guide.imageCaption||"Creative DNA material reference";}
 $("previewEmpty").hidden=!!guide.imageUrl;
 const link=$("previewLink");
 // For live previews, only navigate to the user-visible original page. Never embed arbitrary HTML in the ChatGPT sandbox.
 const allowed=/^https:\/\/(?:[a-z0-9-]+\.)*(?:pawfecthouse\.com|giftsoul\.co|soulprise\.co)\//i;
 link.hidden=!guide.pageUrl||!allowed.test(guide.pageUrl);
 if(!link.hidden)link.href=guide.pageUrl;
}
$("previewToggle").onclick=()=>{
 const body=$("previewBody"),isOpen=body.hidden;body.hidden=!isOpen;
 $("previewToggle").textContent=isOpen?"Hide preview":"Show preview";$("previewToggle").setAttribute("aria-expanded",String(isOpen));
};
$("previewImage").onclick=()=>{if(!$("previewImage").src)return;$("previewLarge").src=$("previewImage").src;$("previewModal").classList.add("open");};
$("previewClose").onclick=()=>{$("previewModal").classList.remove("open");};
$("previewModal").onclick=e=>{if(e.target===$("previewModal"))$("previewModal").classList.remove("open");};
$("brand").onchange=draw; ["url","theme","custom"].forEach(id=>$(id).addEventListener("input",save));
$("run").onclick=async()=>{
 const url=$("url").value.trim(), brand=$("brand").value, route=routes.find(r=>r.brand===brand&&r.branch===selected);
 if(!route){$("error").textContent="Choose a material.";return;}
 try{const u=new URL(url);if(!/^https?:$/.test(u.protocol))throw new Error();}catch{$("error").textContent="Enter a valid PDP or collection URL.";return;}
 $("error").textContent="";save();
 const prompt="Creative DNA — Use: "+readable(brand)+" / "+(route.branch==="onepage-system"?"Onepage":route.title||readable(route.branch))+"\nProduct / Collection: "+url+($("theme").value.trim()?"\nTheme: "+$("theme").value.trim():"")+($("custom").value.trim()?"\nCustom content: "+$("custom").value.trim():"")+"\nExecute this task using the current canonical Creative DNA rules. For Onepage, compile_onepage_job first; do not invent product facts.";
 const fn=window.openai?.sendFollowUpMessage;
 if(!fn){$("error").textContent="ChatGPT widget bridge is unavailable. Open this launcher inside ChatGPT.";return;}
 $("run").disabled=true;
 try{await fn({prompt});}catch(e){$("error").textContent="Could not start the task. Please try again.";}finally{$("run").disabled=false;}
};
window.addEventListener("openai:set_globals",event=>{const output=event.detail?.globals?.toolOutput;if(output?.routes)load(output);});
load(window.openai?.toolOutput||{});
})();
</script></body></html>`;
