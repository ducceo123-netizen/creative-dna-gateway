"""Real Chromium DOM checks; no fake DOM and no external requests required."""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[2]
JS = (ROOT / 'public/onepage-review.js').read_text()
CSS = (ROOT / 'public/onepage-review.css').read_text()
A = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMDAiIGhlaWdodD0iMTAwIj48L3N2Zz4='
B = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMjAwIj48L3N2Zz4='
M = dict(schema_version='uid-onepage-preview/1', task_id='task-real-123', content_version='v3', render_hash='hash-real', brand='pawfecthouse', template_version='v1', asset_manifest=[dict(slot='hero_desktop',asset_id='asset-d',file_url=A,checksum='sha-d'),dict(slot='hero_mobile',asset_id='asset-m',file_url=B,checksum='sha-m')])
def setup(page, manifest=None, suffix='', width=1200):
    page.set_viewport_size(dict(width=width,height=900))
    markup = f'''<style>.uid-product-content-container{{width:80%;margin:auto}}.hero{{padding:20px}}img{{width:200px;height:100px}}h2{{font-size:24px}}</style><main class="uid-product-content-container"><div class="hero"><h2 data-text-slot="headline">Actual custom title</h2><picture><source media="(max-width:799px)" srcset="{B}" data-asset-slot="hero_mobile"><img data-asset-slot="hero_desktop" src="{A}"></picture></div><div class="anything"><p data-text-slot="copy">A real paragraph</p></div></main>{suffix}<script type="application/json" id="onepage-review-manifest">{json.dumps(manifest or M)}</script><template id="onepage-review-styles"><style>{CSS}</style></template>'''
    page.set_content(markup)
    original = page.locator('main').evaluate('(n) => ({html:n.outerHTML,width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height})')
    page.add_script_tag(content=JS)
    page.wait_for_selector('#onepage-review-controls')
    return original
def pick(page, selector):
    page.locator(selector).click(force=True)
def group(page, text):
    page.locator('#onepage-review-controls #feedback').fill(text)
    page.locator('#onepage-review-controls #add').click()
def packet(page):
    value=page.locator('#onepage-review-controls #prompt').input_value()
    return json.loads(value[value.index('{'):])
def status(page): return page.locator('#onepage-review-controls #status').inner_text()
with sync_playwright() as p:
    browser = p.chromium.launch(**({'executable_path':os.environ['CHROMIUM_EXECUTABLE_PATH']} if os.environ.get('CHROMIUM_EXECUTABLE_PATH') else {}), args=['--no-sandbox'])
    page=browser.new_page()
    # Real text + image multi-selection, grouped feedback and canonical visual invariance.
    before=setup(page)
    pick(page,'[data-text-slot="headline"]'); pick(page,'img')
    group(page,'Keep this exact title and asset aligned')
    one=packet(page)
    assert one['task_id']=='task-real-123' and one['render_hash']=='hash-real'
    assert one['groups'][0]['element_ids']==['text:headline','image:hero_desktop']
    assert one['groups'][0]['elements'][1]['asset_id']=='asset-d'
    after=page.locator('main').evaluate('(n) => ({html:n.outerHTML,width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height})')
    assert before==after, (before,after)
    page.set_viewport_size(dict(width=390,height=844))
    page.wait_for_function('document.querySelector("img").currentSrc === '+json.dumps(B))
    pick(page,'img'); group(page,'Mobile crop only')
    two=packet(page)
    assert two['groups'][1]['element_ids']==['image:hero_mobile']
    assert two['groups'][1]['elements'][0]['asset_id']=='asset-m'
    assert two['groups'][1]['viewport_width']==390
    page.locator('#onepage-review-controls #kind').select_option('section')
    pick(page,'[data-text-slot="copy"]'); group(page,'Space this actual section')
    three=packet(page)
    assert three['groups'][2]['element_ids']==['section:2']
    assert three['groups'][2]['section_elements'][0]['id']=='text:copy'
    # Fail clipboard, expose editable-selection fallback, never auto-send.
    page.evaluate('Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async()=>{throw Error("denied")}}})')
    page.locator('#onepage-review-controls #copy').click()
    assert page.locator('#onepage-review-controls #prompt-details').evaluate('(n)=>n.open')
    assert 'Clipboard' in status(page)
    # Live mutation clears generated prompt and disables copying until reload.
    page.locator('[data-text-slot="headline"]').evaluate('(n)=>n.textContent="mutated"')
    page.wait_for_function('document.querySelector("#onepage-review-controls").shadowRoot.querySelector("#copy").disabled')
    assert page.locator('#onepage-review-controls #prompt').input_value()==''
    assert 'thay đổi' in status(page)
    # Different inventory faults, including exact duplicate and missing mappings.
    for manifest,suffix,expected in [
        ({**M,'asset_manifest':M['asset_manifest'][:1]},'', 'không khớp'),
        (M,'<p data-text-slot="headline">Duplicate</p>', 'trùng'),
        ({**M,'expected_context':{'content_version':'stale'}},'', 'context'),
        ({**M,'asset_manifest':M['asset_manifest']+[dict(slot='phantom',asset_id='never',file_url=A,checksum='never')]},'', 'không tồn tại')
    ]:
        setup(page,manifest,suffix)
        assert page.locator('#onepage-review-controls #copy').is_disabled()
        assert expected in status(page), status(page)
    # Bound image src changes must fail before copying, including same-turn copy invocation.
    setup(page); pick(page,'img'); group(page,'Change crop')
    page.evaluate('''() => {document.querySelector('img').src='data:image/png;base64,broken'; document.querySelector('#onepage-review-controls').shadowRoot.querySelector('#copy').click()}''')
    assert page.locator('#onepage-review-controls #prompt').input_value()==''
    # Readable current context changes and replaced node identity also fail closed.
    setup(page); pick(page,'img'); group(page,'Change crop')
    page.evaluate('''() => {const e=document.querySelector('[data-text-slot]');e.replaceWith(e.cloneNode(true))}''')
    page.wait_for_timeout(25)
    assert 'thay đổi' in status(page)
    # Artifacts with no registered task must preserve outcome identity, never fabricate task_id.
    outcome={**M,'identity_type':'outcome','outcome_id':'artifact-exact-9'}
    del outcome['task_id']
    setup(page,outcome); pick(page,'[data-text-slot="headline"]'); group(page,'Outcome-only feedback')
    out=packet(page)
    assert out['identity_type']=='outcome' and out['outcome_id']=='artifact-exact-9' and 'task_id' not in out
    setup(page,{**outcome,'current_context':{'outcome_id':'different'}})
    assert 'context' in status(page)
    browser.close()
print('Onepage real Chromium checks passed: layout invariance, responsive asset selection, grouped exact mappings, section inventory, fallback and stale/invalid guards.')
