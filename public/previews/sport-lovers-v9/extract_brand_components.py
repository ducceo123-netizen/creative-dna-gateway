"""Snapshot native PawfectHouse chrome; strip runtime/app code for review preview."""
from pathlib import Path
from lxml import html, etree
from copy import deepcopy
from urllib.parse import urljoin
from urllib.request import urlopen
import re, base64, json, hashlib

ROOT=Path(__file__).resolve().parent
REF=ROOT.parent/'brand-reference/audit'
doc=html.fromstring((REF/'book-lovers.html').read_text())
OUT=ROOT/'brand-components';OUT.mkdir(exist_ok=True)
SOURCE='https://pawfecthouse.com/pages/book-lovers'

def clean(e):
    for index,svg in enumerate(e.xpath('.//svg')):
        names={n.get('id'):f'pfh-{e.tag}-{index}-'+n.get('id') for n in svg.iter() if n.get('id')}
        for n in svg.iter():
            for a,value in list(n.attrib.items()):
                if a=='id' and value in names:n.set(a,names[value])
                elif 'url(#' in value:
                    for old,new in names.items():value=value.replace('url(#'+old+')','url(#'+new+')')
                    n.set(a,value)
    for n in list(e.iter()):
        if not isinstance(n.tag,str):continue
        if n.tag in ['script','style','iframe']:
            if n.getparent() is not None:n.getparent().remove(n)
            continue
        for a in list(n.attrib):
            if a.startswith('on') or a in ['srcset','data-searchanise','data-api-key']:del n.attrib[a]
        for a in ['href','action','src']:
            u=n.get(a)
            if u and not u.startswith(('data:','#')):n.set(a,urljoin(SOURCE,u))
        if n.tag=='a':n.set('target','_blank');n.set('rel','noopener')
        if n.tag=='img':
            u=n.get('src','')
            if u.startswith('https://'):
                name=hashlib.sha256(u.encode()).hexdigest()[:16]+'.asset'
                p=OUT/name
                if not p.exists():p.write_bytes(urlopen(u,timeout=25).read())
                b=p.read_bytes();mime='image/svg+xml' if b.lstrip().startswith(b'<') else 'image/png'
                n.set('src','data:'+mime+';base64,'+base64.b64encode(b).decode())
    return html.tostring(e,encoding='unicode')

head=doc.get_element_by_id('main-header')
desktop=deepcopy(doc.get_element_by_id('header__desktop-main-nav'))
# Native panels become accessible HTML details; links remain official store links.
row=desktop.xpath('.//*[contains(concat(" ",normalize-space(@class)," ")," header__nav-menu-container ")]')[0]
for button in list(row):
    bid=button.get('id','')
    if not bid.startswith('header__nav-menu-btn__'):continue
    key=bid.split('__')[-1]
    panel=desktop.xpath('.//*[@id="header__nav-panel__'+key+'"]')
    if not panel:continue
    panel=panel[0];panel.getparent().remove(panel)
    panel.set('class','header__nav-panel')
    panel.attrib.pop('aria-hidden',None)
    details=etree.Element('details',{'class':'pfh-nav-details'})
    index=row.index(button);row.remove(button)
    button.tag='summary';button.attrib.pop('type',None)
    details.append(button);details.append(panel);row.insert(index,details)
for n in list(desktop.xpath('.//*[contains(concat(" ",normalize-space(@class)," ")," header__nav-panel-container ")]')):
    n.getparent().remove(n)
announcement=deepcopy(head.xpath('./div[contains(@class,"announcement-bar")]')[0])
# Keep a neutral evergreen brand line; live promotional offer is not this task's offer.
announcement.clear();announcement.set('class','pfh-announcement')
announcement.text='Deliver Happiness, Personally!'
mobile=deepcopy(head.xpath('.//*[contains(concat(" ",normalize-space(@class)," ")," header__main-nav-container ")]')[0])
menu=mobile.xpath('.//button[@aria-label="Open menu"]')[0]
menu.tag='summary';menu.attrib.pop('type',None);menu.attrib.pop('aria-expanded',None)
details=etree.Element('details',{'class':'pfh-mobile-menu'})
menu.getparent().replace(menu,details);details.append(menu)
ml=etree.SubElement(details,'div',{'class':'pfh-mobile-links'})
for link in row:
    if link.tag=='a':
        ml.append(deepcopy(link))
    elif link.tag=='details':
        cp=deepcopy(link);cp.set('class','pfh-mobile-branch')
        for n in cp.iter():n.attrib.pop('id',None)
        ml.append(cp)
search=mobile.xpath('.//button[@id="search-toggle"]')[0]
search.tag='a';search.set('href','https://pawfecthouse.com/search')
for n in list(desktop.xpath('.//*[contains(@class,"header__cart-count")]'))+list(mobile.xpath('.//*[contains(@class,"header__cart-count")]')):n.getparent().remove(n)
header='<div class="pfh-static pfh-native-header"><header class="pfh-header">'+clean(announcement)+'<div class="pfh-native-desktop">'+clean(desktop)+'</div><div class="pfh-native-mobile">'+clean(mobile)+'</div></header></div>'
(OUT/'header.html').write_text(header)
footer=deepcopy(doc.xpath('//footer')[0])
for e in list(footer):
    if e.get('id') not in ['group-fQLDrK','group-A7dB3b']:footer.remove(e)
footer.attrib.pop('class',None)
footer.set('class','pfh-footer')
(OUT/'footer.html').write_text('<div class="pfh-static pfh-native-footer">'+clean(footer)+'</div>')

def blocks(css):
    css=re.sub(r'/\*.*?\*/','',css,flags=re.S)
    start=0;i=0
    while i<len(css):
        j=css.find('{',i)
        if j<0:break
        selector=css[start:j].strip();depth=1;k=j+1;quote=None
        while k<len(css) and depth:
            c=css[k]
            if quote:
                if c==quote and css[k-1]!='\\':quote=None
            elif c in ['"',"'"]:quote=c
            elif c=='{':depth+=1
            elif c=='}':depth-=1
            k+=1
        yield selector,css[j+1:k-1]
        i=start=k

def scoped(css,only_pf=False):
    result=[]
    for sel,body in blocks(css):
        if sel.startswith('@media'):
            cond=sel[6:].strip()
            if 'width' not in cond or 'print' in cond:continue
            cond=re.sub(r'^(only\s+)?(screen|all)\s+and\s+','',cond)
            result.append('@container '+cond+'{'+scoped(body,only_pf)+'}')
        elif sel.startswith('@'):continue
        elif not only_pf or any(k in sel for k in ['.pf_','.pf-']):
            sels=[('.pfh-static' if x.strip()==':root' else '.pfh-static '+x.strip()) for x in sel.split(',')]
            result.append(','.join(sels)+'{'+body+'}')
    return ''.join(result)
styles=doc.xpath('//style')
css=scoped(styles[0].text)+scoped(styles[9].text)
css+=scoped((REF/'styles.common.css').read_text(),True)
css+=scoped((ROOT.parent/'brand-reference/header.css').read_text())
css+=scoped((ROOT.parent/'brand-reference/ui.css').read_text())
css+=scoped(styles[3].text)+scoped(styles[20].text)
(OUT/'native.css').write_text(css)
record={'source_url':SOURCE,'method':'Live HTML/CSS and rendered desktop computed-style inspection; mobile declarations inspected in source CSS. Native header/footer HTML sanitized and ported with container queries. No third-party store/app scripts included.','core_tokens':{'font':'Poppins','text':'#202024','muted':'#79797B','primary':'#EE860F','price':'#F34028','card_radius':10,'button_radius':12},'ldp_observations':{'max_width_px':1280,'desktop_heading_px':28,'desktop_heading_weight':600,'desktop_heading_line_height':1.4,'desktop_card_title_px':20,'mobile_card_title_px':18,'desktop_product_gap_px':20,'mobile_product_gap_px':15,'hero_radius_px':20,'mobile_hero_radius_px':10,'feature_copy_share':0.4,'feature_image_share':0.6},'campaign_boundary':'Book Lovers greens/cream and Gardening palettes are source-specific. Sport Lovers preserves existing imagery and uses core neutral surfaces.'}
(OUT/'source-audit.json').write_text(json.dumps(record,ensure_ascii=False,indent=2))
print(json.dumps({'header_bytes':len(header),'footer_bytes':len((OUT/'footer.html').read_bytes()),'css_bytes':len(css)}))
