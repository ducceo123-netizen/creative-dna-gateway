"""Real HTTP delivery + sandboxed Chromium canonical GTK/FAQ and LDP interaction QA."""
import json, os, subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[2]
server=subprocess.Popen(['node','--import','tsx','tests/browser/build-hosted-fixtures.ts'],cwd=ROOT,stdout=subprocess.PIPE,text=True)
try:
    ready=json.loads(server.stdout.readline())
    with sync_playwright() as p:
        browser=p.chromium.launch(**({'executable_path':os.environ['CHROMIUM_EXECUTABLE_PATH']} if os.environ.get('CHROMIUM_EXECUTABLE_PATH') else {}),args=['--no-sandbox'])
        for kind,url in ready['urls'].items():
            page=browser.new_page(viewport={'width':1280,'height':900})
            errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            response=page.goto(ready['origin']+url)
            assert response.status==200
            policy=response.headers['content-security-policy']
            assert 'sandbox allow-scripts allow-downloads' in policy and 'allow-same-origin' not in policy
            prefix='#onepage-review-controls ' if kind!='ldp' else ''
            page.wait_for_selector(prefix+'#feedback')
            # The browser truly enforces the opaque-origin boundary.
            assert page.evaluate('() => {try {localStorage.getItem("test");return false;} catch {return true;}}')
            page.wait_for_function('() => [...document.images].every(x => x.complete && x.naturalWidth > 0)')
            if kind!='ldp':
                assert len(page.locator('link[rel=stylesheet]').all())==1
                assert page.evaluate('document.styleSheets.length')>0
                page.locator(prefix+'#inventory').select_option('image:banner_desktop')
            else:
                page.locator('[data-review-id]').first.click(force=True)
            page.locator(prefix+'#feedback').fill('Desktop test feedback')
            page.locator(prefix+'#add').click()
            page.set_viewport_size({'width':390,'height':844})
            if kind!='ldp':page.locator(prefix+'#inventory').select_option('image:banner_mobile')
            else:page.locator('[data-review-id]').first.click(force=True)
            page.locator(prefix+'#feedback').fill('Mobile test feedback')
            page.locator(prefix+'#add').click()
            page.locator(prefix+'#copy').click()
            prompt=page.locator(prefix+'#prompt').input_value()
            packet=json.loads(prompt[prompt.index('{'):])
            assert len(packet['groups'])==2
            assert packet['groups'][0]['viewport']=='desktop' and packet['groups'][1]['viewport']=='mobile'
            if kind!='ldp':
                assert packet['groups'][0]['elements'][0]['asset_id']=='qa-banner_desktop'
                assert packet['groups'][1]['elements'][0]['asset_id']=='qa-banner_mobile'
                assert packet['groups'][1]['elements'][0]['file_url']==('image.webp' if kind=='faq' else 'image.png')
                assert packet['groups'][1]['elements'][0]['hosted_file_url'].startswith('assets/')
            # Clipboard denied under sandbox must expose a manually selectable prompt.
            page.locator(prefix+'#prompt').wait_for(state='visible')
            assert not errors,errors
            print(kind+': sandbox, assets, desktop/mobile feedback and copy fallback passed')
            page.close()
        browser.close()
finally:
    server.terminate();server.wait(timeout=10)
