/**
 * UID Brands task launcher embedded as an MCP Apps resource.
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
select:focus-visible,input:focus-visible,textarea:focus-visible,.preview-toggle:focus-visible,.action:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
input::placeholder,textarea::placeholder{color:var(--placeholder);opacity:1}textarea{min-height:69px;resize:vertical}
.action{width:100%;min-height:45px;margin-top:14px;padding:11px 14px;background:#5755d6;color:white;border:0;font-weight:650;cursor:pointer}
.action:hover{background:#4846c4}.action:disabled{opacity:.55;cursor:not-allowed}
.note{font-size:11.5px;color:var(--muted);margin-top:9px;line-height:1.5;text-align:center}
.error{color:#e5484d;font-size:12px;min-height:12px}.optional{font-weight:400;color:var(--muted)}
[hidden]{display:none!important}
@media(max-width:420px){body{padding:10px}.tile{padding:7px 10px}}
</style></head>
<body><main class="wrap">
<div class="header"><div class="logo">✦</div><div><h1>UID Brands</h1><p>Choose a material and start your task</p></div></div>
<label for="brand">Brand</label><select id="brand"></select>
<label for="branches">Material / Task</label><select id="branches" aria-label="Select material"></select>
<label for="url">Product / Collection URL</label><input id="url" type="url" placeholder="https://pawfecthouse.com/collections/..." maxlength="2000" required/>
<label for="theme">Theme <span class="optional">(optional)</span></label><input id="theme" maxlength="120" placeholder="Christmas, Family, Memorial..."/>
<label for="custom">Custom requirements <span class="optional">(optional)</span></label><textarea id="custom" maxlength="4000" placeholder="Any specific creative angle or requirements"></textarea>
<div class="error" id="error" role="alert"></div><button class="action" id="run" type="button">Run UID Brands</button>
<div class="note">Uses your current UID Brands rules — no copy/paste needed.</div>
</main>
<script>
(function(){
const $=id=>document.getElementById(id);
const initial=(window.openai&&window.openai.widgetState)||{};
// Keep typing local: setWidgetState can trigger host updates and input focus loss.
let routes=[], selected=initial.branch||"", fallbackActive=true;
const fallback=[{brand:"pawfecthouse",branch:"onepage-system",title:"Onepage"}];
function readable(name){const brands={pawfecthouse:"PawfectHouse",giftsoul:"GiftSoul",soulprise:"SoulPrise"};return brands[name.toLowerCase()]||name.replace(/-/g," ").replace(/\b\w/g,x=>x.toUpperCase())}
function load(output){
 let data=output||{};
 if(data.structuredContent)data=data.structuredContent;
 if(Array.isArray(data.routes)&&data.routes.length){routes=data.routes.filter(r=>r&&r.brand&&r.branch);fallbackActive=false;}
 if(!routes.length)routes=fallback;
 const brands=[...new Set(routes.map(x=>x.brand))];
 const select=$("brand"); const current=initial.brand&&brands.includes(initial.brand)?initial.brand:(brands.includes("pawfecthouse")?"pawfecthouse":brands[0]);
 select.replaceChildren(...brands.map(b=>{const o=document.createElement("option");o.value=b;o.textContent=readable(b);return o;}));select.value=current;
 $("url").value=$("url").value||initial.url||"";$("theme").value=$("theme").value||initial.theme||"";$("custom").value=$("custom").value||initial.custom||"";
 draw();
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
 const url=$("url").value.trim(), brand=$("brand").value, route=routes.find(r=>r.brand===brand&&r.branch===selected);
 if(!route){$("error").textContent="Choose a material.";return;}
 try{const u=new URL(url);if(!/^https?:$/.test(u.protocol)||!u.hostname.includes("."))throw new Error();}catch{$("error").textContent="Enter a valid PDP or collection URL.";return;}
 $("error").textContent="";save();
 const prompt="Creative DNA — Use: "+readable(brand)+" / "+(route.branch==="onepage-system"?"Onepage":route.title||readable(route.branch))+"\nProduct / Collection: "+url+($("theme").value.trim()?"\nTheme: "+$("theme").value.trim():"")+($("custom").value.trim()?"\nCustom content: "+$("custom").value.trim():"")+"\nExecute this task using the current canonical Creative DNA rules. For Onepage, compile_onepage_job first; do not invent product facts.";
 const fn=window.openai?.sendFollowUpMessage;
 if(!fn){$("error").textContent="ChatGPT widget bridge is unavailable. Open this launcher inside ChatGPT.";return;}
 $("run").disabled=true;$("run").textContent="Starting...";
 try{await fn({prompt});}catch(e){$("error").textContent="Could not start the task. Please try again.";}finally{$("run").disabled=false;$("run").textContent="Run UID Brands";}
};
window.addEventListener("openai:set_globals",event=>{const output=event.detail?.globals?.toolOutput;if(output?.routes&&fallbackActive)load(output);});
load(window.openai?.toolOutput||{});
})();
</script></body></html>`;
