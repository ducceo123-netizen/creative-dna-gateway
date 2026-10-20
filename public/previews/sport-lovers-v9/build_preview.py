from pathlib import Path
from urllib.request import urlopen
from PIL import Image
import json, re, base64, hashlib, io, concurrent.futures, datetime, html

ROOT=Path(__file__).resolve().parent
SRC=ROOT.parent/'recovered/PawfectHouse-Sport-Lovers-Materials-v7'
DIST=ROOT/'dist'; ASSETS=DIST/'assets'; ASSETS.mkdir(parents=True,exist_ok=True)
TASK='libfile_51054066fdf48191a89e81d4b749e4f9'
COLLECTION='https://pawfecthouse.com/collections/gifts-for-sport-lover'
OBS=datetime.datetime.now(datetime.timezone.utc).isoformat()
live=json.loads((ROOT.parent/'sport-live-catalog.json').read_text())['products']
live_by={str(p['id']):p for p in live}
historical=json.loads((SRC/'08-mapping/product-sources.json').read_text())
asset_manifest=[]
prior={a['id']:a for a in json.loads((ROOT/'preview-manifest.json').read_text()).get('asset_manifest',[])} if (ROOT/'preview-manifest.json').exists() else {}

def sha(b): return 'sha256:'+hashlib.sha256(b).hexdigest()
def esc(s): return html.escape(str(s),quote=True)
def asset(path,key,maxsize=1254):
    b=path.read_bytes(); im=Image.open(io.BytesIO(b)).convert('RGB')
    w,h=im.size; im.thumbnail((maxsize,maxsize))
    dest=ASSETS/(key+'.webp')
    if not dest.exists() or dest.stat().st_size==0 or prior.get(key,{}).get('source_checksum')!=sha(b):
        temporary=dest.with_suffix('.tmp.webp')
        im.save(temporary,'WEBP',quality=92,method=6)
        with Image.open(temporary) as check:check.verify()
        temporary.replace(dest)
    rec={'id':key,'source_file':str(path.relative_to(SRC)) if path.is_relative_to(SRC) else path.name,
         'source_checksum':sha(b),'checksum':sha(dest.read_bytes()),'width':im.width,'height':im.height,
         'original_width':w,'original_height':h,'file_url':'assets/'+dest.name,
         'provenance':'verified_source_media' if key.startswith('catalog-') else 'generated_commercial',
         'review_note':'Existing outcome asset reused; codec/size export only, no generative edit.'}
    asset_manifest.append(rec);return rec['file_url']

assets={}
for p in sorted(SRC.glob('0[1-5]*/*.png')):
    key=p.stem
    assets[key]=asset(p,key,2560 if 'desktop' in key else 1504 if 'featured' in key else 1254)

def category(t):
    if 'Socks' in t:return 'socks'
    if 'Ornament' in t:return 'ornaments'
    if any(x in t for x in ['Plaque','Sign','Poster']):return 'signs'
    if any(x in t for x in ['Tumbler','Mug','Cups','Glass']):return 'drinkware'
    if 'Cap' in t:return 'caps'
    if 'Blanket' in t:return 'blankets'
    if any(x in t for x in ['Football','Soccer Ball','Volleyball','Basketball','Leather Baseball']):return 'balls'
    if any(x in t for x in ['Basket','Pillow','Mat']):return 'decor'
    if 'Towel' in t:return 'golf'
    return 'apparel'

ids=[p['product_id'] for p in historical if p['product_id'] in live_by]
for typ in ['Middle Tube Socks','Blanket','Wooden Plaque With Flat Stand','Shaped Acrylic Plaque','Poster','Pajamas','Mugs']:
    ids += [str(p['id']) for p in live if p['product_type']==typ and not re.search(r'fishing|hooked',p['title'],re.I)][:2]
ids=list(dict.fromkeys(ids))
catalog=[]
for pid in ids:
    p=live_by[pid];images=p.get('images',[])
    if not images:continue
    variants=p.get('variants',[]); prices=[float(v['price']) for v in variants if v.get('price')]
    cat=category(p['product_type'])
    catalog.append({'id':pid,'title':p['title'],'type':p['product_type'],'category':cat,
       'url':'https://pawfecthouse.com/products/'+p['handle'],
       'image_url':images[0]['src'],'price':min(prices) if prices else None,
       'price_prefix':'From ' if len(set(prices))>1 else '',
       'created_at':p['created_at'],'available':any(v.get('available',True) for v in variants)})

CACHE=ROOT/'source-catalog';CACHE.mkdir(exist_ok=True)
def fetch_product(p):
    target=SRC/'06-catalog-products'/('product_'+p['id']+'.webp')
    if not target.exists():
        target=CACHE/(p['id']+'.img')
        if not target.exists():target.write_bytes(urlopen(p['image_url'],timeout=30).read())
    return p['id'],target
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
    fetched=dict(ex.map(fetch_product,catalog))
for p in catalog:p['image']=asset(fetched[p['id']],'catalog-'+p['id'],850)

brand=ROOT.parent/'brand-reference'
def fetch_font(weight):
    n={'400':'Regular','500':'Medium','600':'SemiBold','700':'Bold'}[weight]
    f=brand/('Poppins-'+n+'.woff2')
    if not f.exists():f.write_bytes(urlopen('https://pawfecthouse.com/cdn/shop/t/133/assets/Poppins-'+n+'.woff2',timeout=20).read())
    return weight,'data:font/woff2;base64,'+base64.b64encode(f.read_bytes()).decode()
fonts=dict(concurrent.futures.ThreadPoolExecutor(4).map(fetch_font,['400','500','600','700']))
logo='data:image/svg+xml;base64,'+base64.b64encode((brand/'logo.svg').read_bytes()).decode()

copy={
 'hero':{'eyebrow':'GIFTS FOR SPORTS LOVERS','title':'Their Sport. Your Support.','lead':'Celebrate your favorite player with a gift that feels personal.'},
 'picks':{'title':'Gifts Worth Cheering For','lead':'A personal touch for their favorite sport.'},
 'niche':{'title':'Find Their Kind of Sports Gift','lead':'For the ones who play, cheer, or never miss a game.'},
 'combo_01':{'title':'Game Day at Home','lead':'Settle in with favorites made for watching the game.','filter':'game-day'},
 'combo_02':{'title':'Sideline Support','lead':'For the ones who cheer them on, game after game.','filter':'family'},
 'combo_03':{'title':'Gifts for Players','lead':'A personal reminder that you’re always behind them.','filter':'players'},
 'combo_04':{'title':'Room Decor','lead':'Bring their favorite sport into their own space.','filter':'decor'},
 'sbp':{'title':'Pick a Sports Gift They’ll Love','lead':'From game-day favorites to keepsakes for their space.'},
 'featured_01':{'title':'Golf Towels for Their Next Round','lead':'Add a personal touch to their days on the green.'},
 'featured_02':{'title':'Sports Ornaments for a Season to Remember','lead':'Give their favorite game a place on the Christmas tree.'},
 'new':{'title':'Discover New Sports Gifts','lead':'More ways to make their favorite sport personal.'},
 'gallery':{'title':'Sports Gifts in Everyday Life','lead':'Little moments. A shared love of the game.'},
 'gift-picks':{'title':'Find a Gift That Fits','lead':'Explore these picks, or browse the full collection.'}
}
filters={
 'game-day':[p['id'] for p in catalog if p['category'] in ['socks','apparel','drinkware']],
 'family':[p['id'] for p in catalog if re.search(r'dad|mom|grandpa|grandma|family',p['title'],re.I)],
 'players':[p['id'] for p in catalog if p['category'] in ['balls','blankets']],
 'decor':[p['id'] for p in catalog if p['category'] in ['decor','signs']],
 **{k:[p['id'] for p in catalog if p['category']==k] for k in ['apparel','caps','drinkware','socks','balls','blankets','ornaments','signs','golf']}
}
viewport_copy={}
shared_hidden={'picks/lead':False,'gift-picks':False,**{'niche/card/combo_0'+str(i)+'/lead':False for i in range(1,5)}}
viewport_visibility={v:dict(shared_hidden) for v in ['desktop','mobile']}
cv=sha(json.dumps({'viewport_visibility':viewport_visibility,'copy':copy,'viewport_copy':viewport_copy,'assets':asset_manifest,'catalog':catalog,'filters':filters},sort_keys=True).encode())
elements=[]
def attr(sec,sub='',kind='text',label='',assetid=None):
    key='task/'+TASK+'/section/'+sec+('/'+sub if sub else '')
    e={'id':key,'section_id':sec,'kind':kind,'label':label}
    if assetid:e['asset_id']=assetid
    elements.append(e)
    return 'data-review-id="'+esc(key)+'"'
def txt(sec,key,text,tag='p',cls=''):
    review_attr=attr(sec,key,label=text)
    return f'<{tag} class="{cls}" {review_attr}>{viewport_text(sec,key,text)}</{tag}>'
def viewport_text(sec,key,text):
    parts=key.split('/')
    obj,field=(parts[1],parts[2]) if sec=='niche' and len(parts)==3 and parts[0]=='card' else (sec,key)
    labels={v:viewport_copy.get(v,{}).get(obj,{}).get(field,text) for v in ['desktop','mobile']}
    if labels['desktop']==labels['mobile']:return esc(text)
    elements[-1]['viewport_labels']=labels
    return '<span class="copy-desktop">'+esc(labels['desktop'])+'</span><span class="copy-mobile">'+esc(labels['mobile'])+'</span>'

def img(sec,key,file,alt,cls='',eager=False):
    return f'<img class="{cls}" {attr(sec,"asset/"+key,"image",alt,key)} src="{file}" alt="{esc(alt)}" loading="{"eager" if eager else "lazy"}">'
def head(sec):return '<div class="section-heading">'+txt(sec,'title',copy[sec]['title'],'h2')+txt(sec,'lead',copy[sec]['lead'],'p')+'</div>'
def section(sec,body,cls=''):
    result=f'<section id="{sec}" class="section {cls}" {attr(sec,kind="section",label=copy.get(sec,{}).get("title",sec))}>{body}</section>'
    return result
def product_card(p,sec):
    key='card/'+p['id']
    title=p['type'];price=(p['price_prefix']+'$'+format(p['price'],'.2f')+' USD') if p['price'] is not None else ''
    return f'<article class="product-card" {attr(sec,key,"card",p["title"])}><a href="{esc(p["url"])}" target="_blank" rel="noopener">'+img(sec,'catalog-'+p['id'],p['image'],p['title'])+'</a>'+f'<a href="{esc(p["url"])}" target="_blank" rel="noopener" class="product-label" {attr(sec,key+"/title",label=title)}>{esc(title)}</a>'+txt(sec,key+'/price',price,'p','price')+'</article>'
def grid(sec,ps,cls=''):return '<div class="product-grid '+cls+'">'+''.join(product_card(p,sec) for p in ps)+'</div>'
def browse(label='View more',filter=None):
    if filter:return f'<button type="button" class="browse" data-filter="{filter}">{esc(label)} <span aria-hidden="true">→</span></button>'
    return f'<a class="browse" href="{COLLECTION}" target="_blank" rel="noopener">{esc(label)} <span aria-hidden="true">→</span></a>'

header=f'<header {attr("header",kind="section",label="PawfectHouse header")}><div class="topline"><a href="https://pawfecthouse.com/pages/ornament" target="_blank" rel="noopener">Personalized gifts for the people you love</a></div><div class="header-main"><a class="logo" href="https://pawfecthouse.com" target="_blank" rel="noopener"><img src="{logo}" alt="PawfectHouse"></a><form action="https://pawfecthouse.com/search" target="_blank"><input name="q" type="search" placeholder="Find a personal gift…" aria-label="Search gifts"><button aria-label="Search">⌕</button></form><div class="header-tools"><a href="https://pawfecthouse.com/account" target="_blank" rel="noopener">Account</a><a href="https://pawfecthouse.com/cart" target="_blank" rel="noopener">Bag</a></div></div><nav aria-label="Store categories"><a href="https://pawfecthouse.com/pages/family-gifts" target="_blank">Recipients</a><a href="https://pawfecthouse.com/pages/ornament" target="_blank">Occasions</a><a href="{COLLECTION}" target="_blank">Interests</a><a href="#sbp">Home & Living</a><a href="#sbp">Apparel</a><a href="#sbp">Accessories</a><a href="#sbp">Drinkware</a></nav></header>'
hero=section('hero', '<div class="hero-image">'+img('hero','hero-desktop',assets['hero-desktop-2560x800'],'Grandmother and grandson sharing a personalized football','hero-desktop',True)+img('hero','hero-mobile',assets['hero-mobile-750x954'],'Grandmother and grandson sharing a personalized football','hero-mobile',True)+'</div><div class="hero-copy">'+txt('hero','eyebrow',copy['hero']['eyebrow'],'p','eyebrow')+txt('hero','title',copy['hero']['title'],'h1')+txt('hero','lead',copy['hero']['lead'])+'</div>','hero')
hero=hero.replace('>Their Sport. Your Support.</h1>','>Their Sport.<br>Your Support.</h1>')
trust='<div class="trust" '+attr('trust',kind='section',label='Store trust strip')+'>'+''.join('<div>'+f'<span class="trust-icon" aria-hidden="true">{ic}</span>'+txt('trust','item/'+str(i),label,'span')+'</div>' for i,(ic,label) in enumerate([('⌁','On-Time Delivery'),('↶','45-Day Refund'),('◇','Superior Quality'),('♡','Holiday Support')]))+'</div>'
icon_paths=['<path d="M3 6h11v11H3zM14 10h4l3 4v3h-7"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>','<path d="M4 10a8 8 0 1 1 1 8M4 4v6h6"/>','<path d="M3 9l4-5h10l4 5-9 12zM3 9h18M7 4l5 17 5-17"/>','<path d="M4 14v-3a8 8 0 0 1 16 0v3M20 16v2c0 2-3 3-6 3"/><rect x="2" y="11" width="4" height="7" rx="2"/><rect x="18" y="11" width="4" height="7" rx="2"/>']
for char,path in zip(['⌁','↶','◇','♡'],icon_paths):
    trust=trust.replace('>'+char+'</span>','><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">'+path+'</svg></span>')
pickids=[p['product_id'] for p in historical[:8]]
picks=[p for pid in pickids for p in catalog if p['id']==pid]
early=section('picks','<div class="section-heading-row">'+head('picks')+browse()+'</div>'+grid('picks',picks),'container')
combos='<div class="combo-grid">'
for i in range(1,5):
    k=f'combo_0{i}';c=copy[k]
    combos+=f'<article class="combo-card" {attr("niche","card/"+k,"card",c["title"])}><button class="image-button" data-filter="{c["filter"]}" aria-label="Browse {esc(c["title"])}">'+img('niche',k,assets[k],c['title'])+'</button>'+f'<button class="card-heading" data-filter="{c["filter"]}" {attr("niche","card/"+k+"/title",label=c["title"])}>{viewport_text("niche","card/"+k+"/title",c["title"])}</button>'+txt('niche','card/'+k+'/lead',c['lead'])+'</article>'
combos+='</div>'
niche=section('niche',head('niche')+combos,'container')
sbp='<div class="category-grid">'
names=[('apparel','Apparel'),('caps','Caps'),('drinkware','Drinkware'),('socks','Socks'),('balls','Personalized Balls'),('blankets','Blankets'),('ornaments','Ornaments'),('signs','Signs & Plaques')]
keys=[k for k in assets if k.startswith('sbp_')]
for (flt,label),k in zip(names,sorted(keys)):
    sbp+=f'<article {attr("sbp","card/"+k,"card",label)}><button class="image-button circle" data-filter="{flt}" aria-label="Browse {esc(label)}">'+img('sbp',k,assets[k],label)+'</button>'+f'<button class="card-heading" data-filter="{flt}" {attr("sbp","card/"+k+"/title",label=label)}>{esc(label)}</button></article>'
sbp+='</div>'
byproduct=section('sbp',head('sbp')+sbp,'container')
features=[]
for key,flt in [('featured_01','golf'),('featured_02','ornaments')]:
    feat='<div class="feature-band">'+img(key,key,assets[key],copy[key]['title'])+'<div class="feature-copy">'+txt(key,'title',copy[key]['title'],'h2')+txt(key,'lead',copy[key]['lead'])+browse('Explore '+('Golf Towels' if flt=='golf' else 'Ornaments'),flt)+'</div></div>'
    features.append(section(key,feat+grid(key,[p for p in catalog if p['category']==flt][:4]),'container feature'))
newps=sorted(catalog,key=lambda p:p['created_at'],reverse=True)[:8]
newgrid='<div class="new-carousel" id="new-carousel"><button class="carousel-arrow carousel-prev" type="button" aria-label="Previous new arrivals" disabled>‹</button>'+grid('new',newps,'new-carousel-track')+'<button class="carousel-arrow carousel-next" type="button" aria-label="Next new arrivals">›</button></div>'
new=section('new','<div class="section-heading-row">'+head('new')+f'<a class="browse" href="{COLLECTION}?sort_by=created-descending" target="_blank" rel="noopener">View more <span aria-hidden="true">→</span></a></div>'+newgrid,'container')
gallery=section('gallery',head('gallery')+'<div class="gallery-grid">'+''.join(img('gallery',f'gallery_0{i}',assets[f'gallery_0{i}'],f'Sports lifestyle moment {i}') for i in range(1,9))+'</div>','container')
gift=section('gift-picks','<button type="button" id="back-to-ldp" class="back-to-ldp">← Back to Sports Gifts</button>'+head('gift-picks')+'<div class="filter-summary"><span id="active-filter">All picks</span><button id="show-all" type="button">Show all</button></div><div id="filtered-grid" class="product-grid">'+''.join(product_card(p,'gift-picks') for p in catalog)+'</div>'+browse('Browse the full collection'),'container filtered-section')
footer='<footer '+attr('footer',kind='section',label='PawfectHouse footer')+'><div class="footer-inner"><div><img class="footer-logo" src="'+logo+'" alt="PawfectHouse"><p>Deliver Happiness, Personally!</p></div><div><strong>Explore</strong><a href="'+COLLECTION+'" target="_blank">Sports Gifts</a><a href="https://pawfecthouse.com/pages/family-gifts" target="_blank">Family Gifts</a><a href="https://pawfecthouse.com/pages/ornament" target="_blank">Ornaments</a></div><div><strong>Here to Help</strong><a href="https://pawfecthouse.com/pages/contact-us" target="_blank">Contact Us</a><a href="https://pawfecthouse.com/pages/track-order" target="_blank">Track Order</a><a href="https://pawfecthouse.com" target="_blank">Visit PawfectHouse</a></div></div><p class="copyright">© PawfectHouse · Sports Lovers</p></footer>'
header='<div '+attr('native-header',kind='section',label='PawfectHouse native header')+'>'+(ROOT/'brand-components/header.html').read_text()+'</div>'
footer='<div '+attr('native-footer',kind='section',label='PawfectHouse native footer')+'>'+(ROOT/'brand-components/footer.html').read_text()+'</div>'
# Preserve the existing header/footer review identifiers rather than creating new task elements.
header=header.replace('/section/native-header','/section/header')
footer=footer.replace('/section/native-footer','/section/footer')
elements[:]=[e for e in elements if e['section_id'] not in ['native-header','native-footer']]
page=header+hero+trust+early+niche+byproduct+''.join(features)+new+gallery+gift+footer
layout={'schema_version':'uid-ldp-preview-layout/1','task_id':TASK,'content_version':cv,
 'sections':[{'section_id':s,'desktop':'separate_browse_view' if s=='gift-picks' else 'carousel' if s=='new' else 'split' if s.startswith('featured') else 'grid' if s in ['picks','niche','sbp','new','gallery','gift-picks'] else 'stack','mobile':'separate_browse_view' if s=='gift-picks' else 'grid' if s in ['picks','niche','sbp','new','gallery','gift-picks'] else 'stack','columns':4,'mobile_columns':2,'image_fit':'cover' if s=='hero' else 'contain','image_position':'center','source_url':'https://pawfecthouse.com/pages/book-lovers','observed_at':OBS,'evidence_note':'Live Book Lovers rendered desktop and Gardening/Fishing source CSS audited: 1280px commerce, left-aligned 28px/600 headings, inline text browse links, 20/15px grids, native 40:60 feature panels, 10/20px radii. Mobile adapted from actual source declarations.'} for s in ['header','hero','trust','picks','niche','sbp','featured_01','featured_02','new','gallery','gift-picks','footer']],
 'typography':{'heading_px':28,'mobile_heading_px':24,'body_px':16,'line_height':1.5,'source_url':'https://pawfecthouse.com/pages/book-lovers','evidence_note':'Live theme CSS declares Poppins, #202024 text, #EE860F primary, #F34028 prices and 10px card radii. Section sizes adapted to source hierarchy.'}}
css=(ROOT/'style.css').read_text()+(ROOT/'brand-components/native.css').read_text()+(ROOT/'brand-system.css').read_text()
render_hash=sha((page+css+(ROOT/'review.js').read_text()).encode())
manifest={'schema_version':'uid-ldp-preview/1','renderer_version':'uid-ldp-html-renderer/1','task_id':TASK,'task_id_basis':'Existing outcome Library identity, not a newly registered UID task','content_version':cv,'brand':'pawfecthouse','scope':'complete_ldp','source_outcome':'libfile_51054066fdf48191a89e81d4b749e4f9','source_version':'3','created_at':OBS,'canonical_snapshot':'sha256:45c9edae00cec9694961e419be4fff8d6d832213d7f7e7c0098917e47a995580','layout_hash':sha(json.dumps(layout,sort_keys=True).encode()),'asset_manifest':asset_manifest,'elements':elements,'render_hash':render_hash,'verification_limits':['Current collection JSON first 250 products; not an exhaustive assortment census.','Historical approved/revised materials reused; full PDP media/spec research not repeated.','Generated gallery is campaign imagery, not verified customer reviews.','Native header/footer HTML and CSS ported from live PawfectHouse reference; container-query review adaptation and evergreen announcement, without store/app runtime scripts.','Internal curated product subsets; no invented niche collection destinations.','Figma not used or synchronized in this HTML workflow.']}
source={'collection_url':COLLECTION,'observed_at':OBS,'observed_product_count':len(live),'exhaustive':False,'selected_products':catalog,'filters':filters,'copy':copy,'layout':layout,'limits':manifest['verification_limits']}
(ROOT/'copy-destination-source-map.json').write_text(json.dumps(source,ensure_ascii=False,indent=2))
(ROOT/'preview-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
(ROOT/'preview-layout.json').write_text(json.dumps(layout,ensure_ascii=False,indent=2))
fontcss=''.join('@font-face{font-family:Poppins;src:url('+url+');font-weight:'+w+';font-display:swap;}' for w,url in fonts.items())
toolbar=(ROOT/'review-ui.html').read_text()
js=(ROOT/'review.js').read_text()
manifest['viewport_copy']=viewport_copy
manifest['viewport_visibility']=viewport_visibility
manifest['view_contract']={'content':'One shared copy, section order and product assortment across desktop and mobile.','landing':{'desktop_omits':['gift-picks'],'mobile_omits':['gift-picks']},'browse':{'viewports':['desktop','mobile'],'query_parameter':'browse','reuses_section':'gift-picks','return_to_landing':True},'new_arrivals':{'desktop':'carousel','mobile':'two_column_grid','same_product_ids':True}}
for e in elements:
    path=e['id'].split('/section/',1)[1]
    visibility={v:overrides[path] for v,overrides in viewport_visibility.items() if path in overrides}
    if visibility:e['viewport_visibility']={v:visibility.get(v,True) for v in ['desktop','mobile']}
manifest['brand_system_source']=json.loads((ROOT/'brand-components/source-audit.json').read_text())
manifest['revision']=json.loads((ROOT/'applied-feedback-20261020-content-sync.json').read_text())
(ROOT/'preview-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
source['viewport_copy']=viewport_copy
source['viewport_visibility']=viewport_visibility
source['view_contract']=manifest['view_contract']
source['revision']=manifest['revision']
(ROOT/'copy-destination-source-map.json').write_text(json.dumps(source,ensure_ascii=False,indent=2))
data=json.dumps({'manifest':manifest,'filters':filters,'copy':copy,'catalog':catalog},ensure_ascii=False).replace('</','<\\/')
out='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="PawfectHouse Sport Lovers landing page review — select elements and copy grouped feedback."><title>Sport Lovers · PawfectHouse · Review</title><style>'+fontcss+css+'</style></head><body>'+toolbar+'<div class="preview-stage"><div id="canvas" class="canvas"><main id="page">'+page+'</main></div></div><script id="preview-data" type="application/json">'+data+'</script><script>'+js+'</script></body></html>'
(DIST/'index.html').write_text(out)
# Store each bitmap once in the offline file, even when it appears in multiple rows.
offline={}
used={a['id'] for a in asset_manifest}
for p in ASSETS.glob('*.webp'):
    if p.stem not in used:
        p.unlink()
        continue
    offline['assets/'+p.name]='data:image/webp;base64,'+base64.b64encode(p.read_bytes()).decode()
out=re.sub(r'src="(assets/[^\"]+)"',r'data-offline-src="\1"',out)
offline_boot='const offlineAssets='+json.dumps(offline)+';document.querySelectorAll("img[data-offline-src]").forEach(i=>{i.src=offlineAssets[i.dataset.offlineSrc];});'
out=out.replace('<script>'+js,'<script>'+offline_boot+'</script><script>'+js)
(ROOT/'Sport-Lovers-Review.html').write_text(out)
print(json.dumps({'catalog':len(catalog),'assets':len(asset_manifest),'elements':len(elements),'self_contained_bytes':len(out.encode()),'content_version':cv}))
