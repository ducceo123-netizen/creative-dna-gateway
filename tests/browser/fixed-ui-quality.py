"""Actual Chromium regression checks; source template is genuine, form is an explicit test fixture."""
import importlib.util
import json
import os
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('fixed_ui',ROOT/'scripts/quality/fixed_ui.py')
qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(qa)
fixture='''<style>body{margin:0;font:16px Arial}form{width:330px;padding:16px}label,input,select,button{display:block;margin:8px 0}button{height:44px;width:100%;background:#ffffff;color:#000000} .tee-btn--preview{background:#eeeeee}input{font:16px Arial}</style><form id="form"><label>Name<input id="name" required maxlength="25"></label><label>Background<select id="bg"><option>Snow</option><option>Pine</option></select></label><input type="checkbox" id="gift"><button type="button" class="tee-btn--upload">Select Photo</button><button type="button" class="tee-btn--preview">Preview</button><button type="button" id="teeAtcButton">Add to cart</button></form>'''
colors=['preview_background','cart_text']
overlay='<style>.tee-btn--preview{background-color:#e07030 !important}#teeAtcButton{color:#804000 !important}</style>'
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True, executable_path=os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE"))
 for width in (390,1280):
  a=browser.new_page(viewport={'width':width,'height':900});b=browser.new_page(viewport={'width':width,'height':900})
  for page in (a,b): page.route('**/*',lambda r:r.abort())
  a.set_content(fixture);b.set_content(fixture+overlay)
  for state in ('default','filled','selected','cleared','disabled'):
   for page in (a,b):
    if state=='filled':page.locator('#name').fill('Alex')
    if state=='selected':page.locator('#bg').select_option(label='Pine');page.locator('#gift').check()
    if state=='cleared':page.locator('#name').fill('');page.locator('#gift').uncheck()
    if state=='disabled':page.locator('#teeAtcButton').evaluate('(n)=>n.disabled=true')
   assert not qa.compare(qa.capture(a,'#form',colors),qa.capture(b,'#form',colors))['differences'],state
  if os.environ.get('FIXED_UI_ARTIFACTS'):
   out=Path(os.environ['FIXED_UI_ARTIFACTS']);out.mkdir(parents=True,exist_ok=True)
   a.screenshot(path=str(out/f'form-source-{width}.png'),full_page=True)
   b.screenshot(path=str(out/f'form-color-candidate-{width}.png'),full_page=True)
  # Each deliberate error must be caught; never approve or overwrite the source.
  for mutation in ["document.querySelector('#name').remove()", "document.querySelector('label').prepend('Invented heading')", "document.querySelector('#name').style.fontFamily='serif'", "document.querySelector('form').style.padding='20px'", "document.querySelector('#name').required=false", "document.querySelector('#bg').selectedIndex=1", "document.querySelector('#teeAtcButton').textContent='Buy differently'", "document.querySelector('#teeAtcButton').style.borderRadius='30px'"]:
   a.set_content(fixture);b.set_content(fixture+overlay);b.evaluate(mutation)
   assert qa.compare(qa.capture(a,'#form',colors),qa.capture(b,'#form',colors))['differences'],mutation
  # Real checked-in canonical source: fixed slot counts and layout, not a new mockup.
  t=json.loads((ROOT/'templates/onepage-ui-v1.json').read_text())
  image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDZkAAAAASUVORK5CYII='
  html=t['html']
  for slot in t['asset_slots']:html=html.replace('{{'+slot+'}}',image)
  for slot in t['text_slots']:html=html.replace('{{'+slot+'}}','Test '+slot)
  html=html.replace('<link rel="stylesheet" href="styles.css">','')+'<style>'+t['css']+'</style>'
  for page in (a,b):page.set_content(html);page.evaluate('document.fonts.ready')
  if os.environ.get('FIXED_UI_ARTIFACTS'):
   a.screenshot(path=str(out/f'onepage-source-{width}.png'),full_page=True)
   b.screenshot(path=str(out/f'onepage-candidate-{width}.png'),full_page=True)
  source=qa.capture(a,'body'); candidate=qa.capture(b,'body')
  assert not qa.compare(source,candidate)['differences']
  b.locator('.uid-product-occasions').evaluate('(n)=>n.insertAdjacentHTML("afterbegin","<h2>Invented Occasion heading</h2>")')
  assert qa.compare(source,qa.capture(b,'body'))['status']=='BLOCKED'
  a.close();b.close()
 browser.close()
print('PASS: fixed UI desktop/mobile, 5 native states, 8 deliberate form drifts, real Onepage extra-heading drift; no visual/native-provider QC claimed')
