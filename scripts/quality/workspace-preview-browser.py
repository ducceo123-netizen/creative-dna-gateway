"""Local Playwright regression: synthetic fixture, no auth/network/production data.
Usage: node --import tsx scripts/quality/workspace-preview-fixture.ts /tmp/uid-preview-test.html
       python scripts/quality/workspace-preview-browser.py /tmp/uid-preview-test.html
"""
import json, pathlib, sys
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':1000})
    external=[]
    page.on('request',lambda req: external.append(req.url) if req.url.startswith(('http:','https:')) else None)
    page.goto(pathlib.Path(sys.argv[1]).resolve().as_uri())
    frame=page.frame_locator('iframe')
    frame.locator('[data-text-slot="title_01"]').click()
    assert page.evaluate('received.filter(x=>x.type==="uid-workspace-selection").at(-1).element_id')=='text:title_01'
    # Browser picture selection must target the actual mobile asset, not desktop img.
    frame.locator('img[data-asset-slot="banner_desktop"]').click(force=True)
    assert page.evaluate('received.filter(x=>x.type==="uid-workspace-selection").at(-1).element_id')=='image:banner_mobile'
    page.evaluate("document.querySelector('iframe').contentWindow.postMessage({type:'uid-workspace-mode',channel_nonce:preview.channel_nonce,mode:'section'},'*')")
    page.wait_for_timeout(50)
    frame.locator('[data-text-slot="title_01"]').click()
    assert page.evaluate('received.filter(x=>x.type==="uid-workspace-selection").at(-1).element_id')=='section:benefits'
    # Wrong nonce cannot change current interaction mode.
    page.evaluate("document.querySelector('iframe').contentWindow.postMessage({type:'uid-workspace-mode',channel_nonce:'invalid',mode:'element'},'*')")
    frame.locator('[data-text-slot="title_01"]').click()
    assert page.evaluate('received.filter(x=>x.type==="uid-workspace-selection").at(-1).element_id')=='section:benefits'
    page.evaluate("document.querySelector('iframe').style.width='1280px';document.querySelector('iframe').contentWindow.postMessage({type:'uid-workspace-mode',channel_nonce:preview.channel_nonce,mode:'element'},'*')")
    page.wait_for_timeout(80)
    frame.locator('img[data-asset-slot="banner_desktop"]').click(force=True)
    assert page.evaluate('received.filter(x=>x.type==="uid-workspace-selection").at(-1).element_id')=='image:banner_desktop'
    frame.locator('[data-text-slot="title_01"]').focus()
    page.keyboard.press('Enter')
    assert page.evaluate('received.filter(x=>x.type==="uid-workspace-selection").at(-1).element_id')=='text:title_01'
    assert page.evaluate('document.querySelector("iframe").contentDocument') is None, 'sandbox must remain opaque'
    assert external==[], external
    print(json.dumps({'result':'PASS','checks':['text click','mobile picture target','section scope','wrong nonce rejected','desktop picture target','keyboard selection','opaque origin sandbox','no external requests']}))
    browser.close()
