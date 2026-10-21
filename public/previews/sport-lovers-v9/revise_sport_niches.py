"""Apply the requested six-sport niche revision to the retained v6 standalone preview.

Run after base build_preview.py; keep the original bound HTML as parent-review.html.
This leaves all HTML/CSS outside niche and the shared navigation hook unchanged.
"""
from pathlib import Path
import base64, copy, hashlib, html, json, re, shutil
from PIL import Image

ROOT=Path(__file__).resolve().parent
DIST=ROOT/'dist'
def digest(b):return 'sha256:'+hashlib.sha256(b).hexdigest()
def dump(p,o):p.write_text(json.dumps(o,ensure_ascii=False,indent=2))
def jsjson(o):return json.dumps(o,ensure_ascii=False).replace('</','<\\/')
source_path=ROOT/'parent-review.html'
if not source_path.exists():shutil.copy2(ROOT/'Sport-Lovers-Review.html',source_path)
parent=source_path.read_text()
match=re.search(r'<script id="preview-data" type="application/json">(.*?)</script>',parent,re.S)
D=json.loads(match[1]);M=D['manifest'];original=copy.deepcopy(M)
assert M['task_id']=='libfile_51054066fdf48191a89e81d4b749e4f9'
assert M['content_version']=='sha256:8d2507926d1984d3ae79496ac665f7a699ba57b7e02aaad43a265f28106de29c'
assert M['render_hash']=='sha256:b990a8479c2f1c0742f110c6a441e7134b1b4494f8f033ee081f855f2aa50bc7'
configs=[
 ('combo_01','Football','football','exec-c6f74132-91b5-4f61-9243-c9e5b3bd8763.png',['10549224440097','10507401363745'],'https://pawfecthouse.com/collections/american-football'),
 ('combo_02','Baseball','baseball','exec-b34fbe0c-9a7f-484e-b39b-71db55a9d8c3.png',['10319659925793','10305845985569'],'https://pawfecthouse.com/collections/baseball'),
 ('combo_03','Basketball','basketball','exec-abed667d-2d05-4e8f-85b7-258952de9a8e.png',['10537313435937','10588931227937'],'https://pawfecthouse.com/collections/basketball'),
 ('combo_04','Soccer','soccer','exec-107d9a22-92a7-46b5-842d-fc53880d943b.png',['10583428137249','10586742161697'],'https://pawfecthouse.com/search?q=soccer&type=product'),
 ('combo_05','Golf','golf','exec-9fc83199-de4a-45ff-8d62-a8d8c9a645c9.png',['10335559778593','10353211375905'],'https://pawfecthouse.com/collections/golf'),
 ('combo_06','Hockey','hockey','exec-da2d0fc8-2522-4f65-84ac-8d8e90661252.png',['10131943260449','10365302309153'],'https://pawfecthouse.com/search?q=title%3Ahockey&type=product')
]
offline_match=re.search(r'<script>const offlineAssets=(\{.*?\});document.querySelectorAll.*?</script>',parent,re.S)
assert offline_match
offline=json.loads(offline_match[1])
for name,url in offline.items():
 p=DIST/name;p.parent.mkdir(parents=True,exist_ok=True)
 if not p.exists():p.write_bytes(base64.b64decode(url.split(',',1)[1]))
niche_match=re.search(r'<section id="niche".*?</section>',parent,re.S)
niche=niche_match[0]
prefix='task/'+M['task_id']+'/section/niche'
old_title=D['copy']['niche']['title'];new_title='Gifts for Their Favorite Sport'
niche=niche.replace('>'+html.escape(old_title)+'<','>'+html.escape(new_title)+'<')
D['copy']['niche']['title']=new_title
cards=[]
for asset,label,sport,generated,pids,url in configs:
 filter_key='sport-'+sport
 if asset not in D['copy']:
  template='combo_04'
  tp=r'<article class="combo-card" data-review-id="'+re.escape(prefix+'/card/'+template)+r'">.*?</article>'
  addition=re.search(tp,niche,re.S)[0].replace(template,asset)
  assert niche.endswith('</div></section>')
  niche=niche[:-len('</div></section>')]+addition+'</div></section>'
  D['copy'][asset]=dict(D['copy'][template])
  new_elements=[]
  for e in M['elements']:
   if e['section_id']=='niche' and ('/card/'+template in e['id'] or '/asset/'+template in e['id']):
    ne=copy.deepcopy(e);ne['id']=ne['id'].replace(template,asset);ne['asset_id']=asset if 'asset_id' in ne else ne.get('asset_id')
    if ne.get('asset_id') is None:ne.pop('asset_id',None)
    new_elements.append(ne)
  assert len(new_elements)==4
  M['elements'].extend(new_elements)
  for v in ['desktop','mobile']:M['viewport_visibility'][v]['niche/card/'+asset+'/lead']=False
  na=copy.deepcopy(next(a for a in M['asset_manifest'] if a['id']==template));na['id']=asset;na['file_url']='assets/'+asset+'.webp';M['asset_manifest'].append(na)
 old=D['copy'][asset].copy()
 # Limit replacements to this card, never the separate product navigation.
 pattern=r'<article class="combo-card" data-review-id="'+re.escape(prefix+'/card/'+asset)+r'">.*?</article>'
 cm=re.search(pattern,niche,re.S);assert cm
 card=cm[0].replace('data-filter="'+old['filter']+'"','data-filter="'+filter_key+'"')
 card=card.replace('Browse '+html.escape(old['title'],quote=True),'Browse '+label)
 card=card.replace('alt="'+html.escape(old['title'],quote=True)+'"','alt="'+label+'"')
 card=card.replace('>'+html.escape(old['title'])+'<','>'+label+'<')
 # Keep hidden lead element IDs as empty tombstones, without stale legacy copy.
 card=re.sub(r'(<p[^>]+data-review-id="'+re.escape(prefix+'/card/'+asset+'/lead')+r'"[^>]*>).*?(</p>)',r'\1\2',card)
 niche=niche[:cm.start()]+card+niche[cm.end():]
 D['copy'][asset]={'title':label,'lead':'','filter':filter_key}
 originals=ROOT/'originals';originals.mkdir(exist_ok=True)
 png=originals/('niche-'+sport+'-v1.png')
 shutil.copy2(ROOT.parent/'generated_images'/generated,png)
 im=Image.open(png);assert im.size[0]==im.size[1]
 webp=DIST/'assets'/f'{asset}.webp';im.save(webp,'WEBP',quality=94,method=6)
 Image.open(webp).load()
 a=next(a for a in M['asset_manifest'] if a['id']==asset)
 a.update(source_file=str(png.relative_to(ROOT)),source_checksum=digest(png.read_bytes()),checksum=digest(webp.read_bytes()),width=im.width,height=im.height,original_width=im.width,original_height=im.height,product_ids=pids,rule_route='niche-product-combo',provenance='generated_commercial',review_note='New user-requested sport-axis composition; exact two source SKU/variant images inspected. Physical support, full silhouettes and readable names/graphics visually reviewed. Commercial imagery, not a purchasable bundle.')
 offline['assets/'+asset+'.webp']='data:image/webp;base64,'+base64.b64encode(webp.read_bytes()).decode()
 for e in M['elements']:
  if e['section_id']!='niche':continue
  eid=e['id']
  if eid in [prefix+'/card/'+asset,prefix+'/asset/'+asset,prefix+'/card/'+asset+'/title']:e['label']=label
  if eid==prefix+'/card/'+asset+'/lead':e['label']=''
 cards.append({'asset_id':asset,'label':label,'sport':sport,'filter_key':filter_key,'product_ids':pids,'destination':url,'destination_kind':'store_search' if sport in ['soccer','hockey'] else 'live_collection','shared_viewports':['desktop','mobile']})
for e in M['elements']:
 if e['id'] in [prefix,prefix+'/title']:e['label']=new_title
for k in ['game-day','family','players','decor']:D['filters'].pop(k,None)
D['filters'].update({c['filter_key']:c['product_ids'] for c in cards})
D['niche_destinations']={c['filter_key']:c['destination'] for c in cards}
review_js=re.findall(r'<script>(.*?)</script>',parent,re.S)[-1]
old_filter='function filter(k){fillFilter(k);'
assert old_filter in review_js
review_js=review_js.replace(old_filter,"function filter(k){if(D.niche_destinations?.[k]){window.open(D.niche_destinations[k],'_blank','noopener');return;}fillFilter(k);")
review_js=review_js.replace("const filterLabels={","const filterLabels={'sport-football':'Football','sport-baseball':'Baseball','sport-basketball':'Basketball','sport-soccer':'Soccer','sport-golf':'Golf','sport-hockey':'Hockey',")
M['niche_cards']=cards
grid_css='\n/* Six approved sport cards: responsive layout only. */\n@container(min-width:800px){#page #niche .combo-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}\n'
(ROOT/'niche-grid.css').write_text(grid_css)
M['view_contract']['niche_navigation']={'axis':'sport','shared_viewports':['desktop','mobile'],'destinations':'Four live official sport collections; Soccer uses verified native store search, Hockey uses verified title:hockey search to avoid unrelated items in the native collection.','uses_complete_live_destinations':True}
revision={'schema_version':'uid-ldp-applied-feedback/1','task_id':M['task_id'],'source_outcome':M['source_outcome'],'source_version':M['source_version'],'parent_content_version':original['content_version'],'parent_render_hash':original['render_hash'],'groups':[{'scope':'desktop_and_mobile','element_ids':[e['id'] for e in M['elements'] if e['section_id']=='niche'],'feedback':'Chỗ niche này em chia theo bộ môn đi, ổn không? → oke em gen ảnh cho mấy đó luôn nha','resolution':'Four shared sports labels, four new two-SKU niche images, matching official store destinations. Keep all other sections, products, CSS and review IDs.'}],'source_limits':['Only 12 selected original product images audited; complete galleries and entire assortment not audited.','Pinterest reference retrieval blocked; no visual Pinterest observation claimed.','Soccer destination is native store search; no invented collection URL.'],'generation_tool':'built-in image_gen; four images plus targeted framing/support corrections on Football and Soccer.'}
M['revision']=revision
revision['groups'][0]['element_ids']=[e['id'] for e in M['elements'] if e['section_id']=='niche' and not any(a in e['id'] for a in ['combo_05','combo_06'])]
revision['groups'].append({'scope':'desktop_and_mobile','element_ids':[e['id'] for e in M['elements'] if e['section_id']=='niche' and any(a in e['id'] for a in ['combo_05','combo_06'])],'feedback':'Cho anh thêm 2 môn Golf Hockey nữa nha','resolution':'Add two standalone two-product images and two sport navigation cards; desktop 3 columns, mobile 2 columns. New element IDs allocated only for these two actual cards.'})
revision['generation_tool']='built-in image_gen; six independent images plus targeted framing/support corrections on Football, Soccer and Golf.'
revision['source_limits'].append('Hockey live collection contains unrelated sports. Use verified native title:hockey search (7 matching product titles), not the mixed collection.')
M['content_version']=digest(json.dumps({'copy':D['copy'],'filters':D['filters'],'niche_destinations':D['niche_destinations'],'assets':M['asset_manifest'],'catalog':D['catalog'],'viewport_visibility':M['viewport_visibility']},sort_keys=True).encode())
bound=parent[:niche_match.start()]+niche+parent[niche_match.end():]
bound=bound.replace('</style>',grid_css+'</style>',1)
css=re.search(r'<style>(.*?)</style>',bound,re.S)[1]
main=re.search(r'<main id="page">(.*?)</main>',bound,re.S)[1]
M['render_hash']=digest((main+css+review_js).encode())
M['render_hash_basis']='sha256(bound main HTML + full inline CSS + review runtime JS); content_version includes image digests.'
from datetime import datetime, timezone
M['created_at']=datetime.now(timezone.utc).isoformat()
assert {e['id'] for e in original['elements']}<={e['id'] for e in M['elements']}
assert len(M['elements'])==319 and len({e['id'] for e in M['elements']})==319
# Deterministic substitution keeps untouched page markup byte-identical.
bound=re.sub(r'(<script id="preview-data" type="application/json">).*?(</script>)',lambda m:m[1]+jsjson(D)+m[2],bound,flags=re.S)
bound=bound.replace(re.findall(r'<script>(.*?)</script>',bound,re.S)[-1],review_js)
offline_script='<script>const offlineAssets='+jsjson(offline)+';document.querySelectorAll("img[data-offline-src]").forEach(i=>{i.src=offlineAssets[i.dataset.offlineSrc];});</script>'
bound=re.sub(r'<script>const offlineAssets=.*?</script>',lambda m:offline_script,bound,flags=re.S)
(ROOT/'Sport-Lovers-Review.html').write_text(bound)
public=re.sub(r'<script>const offlineAssets=.*?</script>','',bound,flags=re.S)
public=re.sub(r'data-offline-src="([^"]+)"',r'src="\1"',public)
(DIST/'index.html').write_text(public)
(ROOT/'review.js').write_text(review_js)
dump(ROOT/'preview-manifest.json',M)
source=json.loads((ROOT/'parent-source-map.json').read_text())
source.update(copy=D['copy'],filters=D['filters'],niche_destinations=D['niche_destinations'],niche_cards=cards,revision=revision,view_contract=M['view_contract'],content_version=M['content_version'],render_hash=M['render_hash'])
source['layout']['content_version']=M['content_version']
for section in source['layout']['sections']:
 if section['section_id']=='niche':section['columns']=3;section['mobile_columns']=2;section['evidence_note']+=' User requested six sport cards; retain brand geometry with three desktop columns and two mobile columns.'
source['extra_niche_products']=[]
for pid in ['10131943260449','10365302309153']:
 product=json.loads((ROOT/'product-evidence'/(pid+'.json')).read_text())
 source['extra_niche_products'].append({'id':pid,'title':product['title'],'url':'https://pawfecthouse.com/products/'+product['handle'],'source':'Exact live PDP JSON and original first image inspected; used only in Hockey niche image.'})
M['layout_hash']=digest(json.dumps(source['layout'],sort_keys=True).encode())
# Persist the final layout hash both in HTML and the standalone.
for output in [ROOT/'Sport-Lovers-Review.html',DIST/'index.html']:
 text=output.read_text();text=re.sub(r'(<script id="preview-data" type="application/json">).*?(</script>)',lambda m:m[1]+jsjson(D)+m[2],text,flags=re.S);output.write_text(text)
dump(ROOT/'preview-manifest.json',M)
dump(ROOT/'preview-layout.json',source['layout'])
dump(ROOT/'copy-destination-source-map.json',source)
dump(ROOT/'applied-feedback-20261021-sport-niches.json',revision)
print(json.dumps({'task':M['task_id'],'content_version':M['content_version'],'render_hash':M['render_hash'],'elements':len(M['elements']),'images':len(M['asset_manifest']),'niche_cards':cards},ensure_ascii=False))
