"""Real Chromium owner-panel QA. All HTTP requests are synthetic route fixtures.

Run after npm run build with CHROMIUM_EXECUTABLE_PATH if needed. No credentials,
production API, remote media, or server mutations are used.
"""
import json, os, subprocess, tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
PROPOSAL = dict(id='browser-owner-synthetic', status='pending', brand_name='PawfectHouse',
    branch_slug='onepage-system', proposed_scope='global_system',
    raw_feedback='Preserve the real product silhouette.',
    proposed_content_md='Preserve the real product silhouette.\nDo not infer dimensions.')
TARGETS = [dict(id=f'node-{i}', brand_id=f'brand-{i}', brand_name=brand,
    slug='onepage-system', title='Onepage System', content_md='Existing canonical safeguards.',
    node_hash=f'node-hash-{i}', version=3) for i, brand in enumerate(['PawfectHouse', 'Nolan'])]
DATA = dict(proposal=PROPOSAL, candidate_hash='scope-v2:browser-synthetic',
    preview_kind='owner_rule', queue_available=False, review_intent_hash=None, review_request=None,
    targets=TARGETS, baselines=[], evaluations=[], covered_candidates=[], issues=[], automatic_evaluation_id=None,
    direct_rule=dict(schema_version='uid.owner-rule-eligibility.v1', eligible=True, owner_authorized=True,
        rule_hash='owner-rule-v1:browser-synthetic', rule_class='STRUCTURAL', blockers=[],
        check_scope='STRUCTURE_SCOPE_AND_DETECTABLE_CONFLICTS_ONLY', visual_qc_performed=False),
    direct_rule_plan=dict(eligible=True, plan_hash='plan-sha256:browser-synthetic', blockers=[],
        visual_qc_performed=False, semantic_consistency='NOT_PROVEN_BY_DETERMINISTIC_CHECKS',
        additions=[dict(schema_version='uid.owner-supplemental-rule.v1', id='owner:'+PROPOSAL['id'],
            proposal_id=PROPOSAL['id'], decision_kind='owner_direct_rule',
            canonical_text=PROPOSAL['proposed_content_md'], declared_scope='global_system',
            scope=dict(brands=[t['brand_name'].lower()], branches=[t['slug']]),
            rule_class='STRUCTURAL', confidence='HIGH',
            precedence='SUPPLEMENTAL_SUBORDINATE_TO_CANONICAL_HARD_RULES_AND_PRODUCT_TRUTH',
            semantic_consistency='NOT_PROVEN_BY_DETERMINISTIC_CHECKS', visual_qc_performed=False,
            source=dict(node='branch', locator='owner-rule:'+PROPOSAL['id'], canonical_text_hash='canonical-sha256:synthetic'),
            accepted_source_hashes=dict(branch=t['node_hash'], brand_dna='brand-dna-sha256:synthetic'),
            target_node_ids=[t['id']], affected_brands=[t['brand_name'].lower()]) for t in TARGETS]))
EXPECTED = dict(approve_rule=True, candidate_hash=DATA['candidate_hash'],
    rule_hash=DATA['direct_rule']['rule_hash'], plan_hash=DATA['direct_rule_plan']['plan_hash'])
RECEIPT = dict(status='merged', proposal_id=PROPOSAL['id'],
    proposal=dict(id=PROPOSAL['id'], status='merged', merged_at='2026-10-22T00:00:00Z'),
    decision_kind='owner_direct_rule', visual_qc_performed=False, rule_decision_id='synthetic-decision',
    canonical_changed=True, **{k:v for k,v in EXPECTED.items() if k != 'approve_rule'})

with tempfile.TemporaryDirectory(prefix='uid-owner-browser-') as tmp:
    # Bundle the genuine production React panel, not a DOM imitation.
    entry = '''import React from 'react'; import {createRoot} from 'react-dom/client';
import {FeedbackReviewPanel} from './src/components/FeedbackReviewPanel';
window.completed=[];
createRoot(document.getElementById('root')).render(<FeedbackReviewPanel
 proposal={PROPOSAL} path="owner" request={(url,init)=>fetch(url,init)}
 onClose={()=>{}} onComplete={(...args)=>window.completed.push(args)}/>);'''.replace('PROPOSAL', json.dumps(PROPOSAL))
    build = """import {buildSync} from 'esbuild';
const input=JSON.parse(process.argv[1]);
buildSync({stdin:{contents:input.entry,loader:'tsx',resolveDir:process.cwd()},bundle:true,
 format:'iife',platform:'browser',outfile:input.outfile,define:{'process.env.NODE_ENV':'\"production\"'}});"""
    outfile = Path(tmp) / 'owner.js'
    subprocess.run(['node','--input-type=module','-e',build,json.dumps(dict(entry=entry,outfile=str(outfile)))],cwd=ROOT,check=True)
    js = outfile.read_text()
    css = '\n'.join(f.read_text() for f in (ROOT/'dist/assets').glob('*.css'))
    html = '<meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style><main id="root" style="max-width:1000px;margin:auto;padding:16px"></main><script src="/owner.js"></script>'
    with sync_playwright() as p:
        browser=p.chromium.launch(**({'executable_path':os.environ['CHROMIUM_EXECUTABLE_PATH']} if os.environ.get('CHROMIUM_EXECUTABLE_PATH') else {}),args=['--no-sandbox'])
        for width, uncertain in [(1280, False), (390, False), (390, True)]:
            context=browser.new_context(viewport=dict(width=width,height=900),service_workers='block')
            calls=[]; unexpected=[]; errors=[]
            def route(r):
                req=r.request
                if req.url=='http://owner.test/': return r.fulfill(content_type='text/html',body=html)
                if req.url=='http://owner.test/owner.js': return r.fulfill(content_type='text/javascript',body=js)
                calls.append((req.method,req.url,req.post_data_json if req.method=='POST' else None))
                if req.method=='GET' and req.url==f'http://owner.test/api/admin/feedback/{PROPOSAL["id"]}/owner-preflight':
                    return r.fulfill(json=DATA)
                if req.method=='POST' and req.url==f'http://owner.test/api/admin/feedback/{PROPOSAL["id"]}/accept-rule':
                    return r.fulfill(status=503,json=dict(error='Synthetic uncertain response')) if uncertain else r.fulfill(json=RECEIPT)
                unexpected.append(req.url); r.abort()
            context.route('**/*',route)
            page=context.new_page(); page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto('http://owner.test/')
            confirm=page.get_by_role('button',name='Xác nhận hard merge',exact=True)
            expect(confirm).to_be_enabled()
            assert len(calls)==1 and calls[0][0]=='GET',calls
            assert page.get_by_role('checkbox').count()==0
            assert page.get_by_role('button',name='Duyệt & giao dot review',exact=True).count()==0
            rule=page.locator('[aria-label="Hướng dẫn rule có hiệu lực"]')
            expect(rule).to_contain_text(PROPOSAL['proposed_content_md'])
            expect(rule).to_contain_text('PawfectHouse, Nolan')
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            screenshots=os.environ.get('OWNER_QA_SCREENSHOTS')
            if screenshots:
                Path(screenshots).mkdir(parents=True,exist_ok=True)
                page.screenshot(path=str(Path(screenshots)/f'owner-{width}-{uncertain}.png'),full_page=True)
            # Two immediate real DOM click events exercise the synchronous mutation guard.
            confirm.evaluate('(button)=>{button.click();button.click()}')
            page.wait_for_function('window.completed.length===1' if not uncertain else 'document.querySelector("[role=alert]")!==null')
            posts=[c for c in calls if c[0]=='POST']
            assert len(posts)==1 and posts[0][2]==EXPECTED,posts
            if uncertain:
                expect(confirm).to_be_disabled()
                page.get_by_role('button',name='Tải lại / Retry',exact=True).click()
                expect(page.get_by_role('alert')).to_contain_text('Kết quả thao tác chưa rõ')
                expect(confirm).to_be_disabled()
                page.reload()
                expect(page.get_by_role('alert')).to_contain_text('Kết quả thao tác chưa rõ')
                expect(page.get_by_role('button',name='Xác nhận hard merge',exact=True)).to_be_disabled()
                assert len([c for c in calls if c[0]=='POST'])==1
            assert not unexpected,unexpected
            assert not errors,errors
            print(f'owner {width}px uncertain={uncertain}: exact rule/scope, zero open mutation, one-click hashes, double-click guard'+(', reload lock' if uncertain else '')+' passed')
            context.close()
        browser.close()
