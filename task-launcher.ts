/**
 * Creative DNA task launcher embedded as an MCP Apps resource.
 * UI only prepares a brief; canonical resolution stays on the existing server.
 */
export const LAUNCHER_URI = "ui://creative-dna/task-launcher-v1.html";
export const LAUNCHER_MIME = "text/html;profile=mcp-app";

export const launcherHtml = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
:root{font-family:system-ui,-apple-system,Segoe UI,sans-serif;color-scheme:light;--fg:#182133;--muted:#596579;--bg:#ffffff;--input:#ffffff;--tile:#f7f8fc;--border:#d6dce7;--active:#eeeaff;--active-border:#6349e9;--placeholder:#788399}
@media(prefers-color-scheme:dark){:root{color-scheme:dark;--fg:#f5f5f7;--muted:#afb5c4;--bg:#171717;--input:#252525;--tile:#242424;--border:#494949;--active:#342b55;--active-border:#aa98ff;--placeholder:#a3a3ad}}
*{box-sizing:border-box}
body{margin:0;padding:18px;color:var(--fg);background:var(--bg)}
.wrap{max-width:640px;margin:auto}
.header{display:flex;align-items:center;gap:12px;margin-bottom:16px}
.logo{display:grid;place-items:center;width:38px;height:38px;border-radius:12px;background:#eeeaff;color:#573cde;font-weight:800;font-size:21px}
h1{font-size:21px;line-height:1.3;margin:0;color:var(--fg)}
p{margin:3px 0 0;font-size:13px;color:var(--muted)}
label{font-weight:650;font-size:13px;color:var(--fg);display:block;margin:18px 0 8px}
select,input,textarea,button{font:inherit;width:100%;border-radius:10px;padding:11px 12px}
select,input,textarea{background:var(--input);color:var(--fg);border:1px solid var(--border);outline-offset:2px}
input::placeholder,textarea::placeholder{color:var(--placeholder);opacity:1}
textarea{min-height:72px;resize:vertical}
.tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}
.tile{border:1px solid var(--border);background:var(--tile);color:var(--fg);text-align:left;cursor:pointer;padding:13px;min-height:55px;overflow-wrap:anywhere}
.tile:hover{border-color:var(--active-border)}
.tile.active{border:2px solid var(--active-border);background:var(--active);color:var(--fg);padding:12px}
.tile.active::before{content:"✓ ";color:var(--active-border);font-weight:800}
.tile span{display:inline;font-size:13px;font-weight:650;color:inherit}
.action{margin-top:16px;background:#6047ef;color:#fff;border:0;font-weight:700;cursor:pointer}
.action:disabled{opacity:.5;cursor:not-allowed}
.note{font-size:12px;color:var(--muted);margin-top:12px;line-height:1.5}
.error{color:#e24848;font-size:12px;min-height:16px}
.optional{font-weight:400;color:var(--muted)}
@media(max-width:400px){body{padding:12px}.tiles{grid-template-columns:1fr}}
</style></head>
<body><main class="wrap">
<div class="header"><div class="logo">✦</div><div><h1>Creative DNA</h1><p>Choose a workflow and start inside ChatGPT</p></div></div>
<label for="brand">Brand</label><select id="brand"></select>
<label>Material</label><div class="tiles" id="branches" role="group" aria-label="Select material"></div>
<label for="url">Product / Collection URL</label><input id="url" type="url" placeholder="https://pawfecthouse.com/collections/..." maxlength="2000" required/>
<label for="theme">Theme <span class="optional">(optional)</span></label><input id="theme" maxlength="120" placeholder="Christmas, Family, Memorial..."/>
<label for="custom">Custom requirements <span class="optional">(optional)</span></label><textarea id="custom" maxlength="4000" placeholder="Any specific creative angle or requirements"></textarea>
<div class="error" id="error" role="alert"></div><button class="action" id="run" type="button">Generate with Creative DNA</button>
<div class="note">Uses the current canonical Creative DNA rules. No copying or external dashboard is required.</div>
</main>
<script>
(function(){
const $=id=>document.getElementById(id);
const initial=(window.openai&&window.openai.widgetState)||{};
let routes=[], selected=initial.branch||"";
const fallback=[{brand:"pawfecthouse",branch:"onepage-system",title:"Onepage"}];
function readable(name){return name.replace(/\b\w/g,x=>x.toUpperCase()).replace(/-/g," ")}
function load(output){
 let data=output||{};
 if(data.structuredContent)data=data.structuredContent;
 if(data.routes)routes=data.routes.filter(r=>r&&r.brand&&r.branch);
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
 save();
}
function save(){window.openai?.setWidgetState?.({brand:$("brand").value,branch:selected,url:$("url").value,theme:$("theme").value,custom:$("custom").value})}
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
