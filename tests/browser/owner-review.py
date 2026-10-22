"""Real Chromium owner-panel QA. All HTTP requests are synthetic route fixtures.

Run after npm run build with CHROMIUM_EXECUTABLE_PATH if needed. No credentials,
production API, remote media, or server mutations are used.
"""
import copy, json, os, re, subprocess, tempfile
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
DATA = dict(proposal=PROPOSAL, owner_user_id='browser-owner', recovery_token=None, candidate_hash='scope-v2:browser-synthetic',
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
    rule_hash=DATA['direct_rule']['rule_hash'], plan_hash=DATA['direct_rule_plan']['plan_hash'], recovery_token=None)
RECEIPT = dict(status='merged', proposal_id=PROPOSAL['id'], owner_user_id='browser-owner', merged_at='2026-10-22T00:00:00Z',
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
                if req.url=='https://owner.test/': return r.fulfill(content_type='text/html',body=html)
                if req.url=='https://owner.test/owner.js': return r.fulfill(content_type='text/javascript',body=js)
                calls.append((req.method,req.url,req.post_data_json if req.method=='POST' else None))
                if req.method=='GET' and req.url==f'https://owner.test/api/admin/feedback/{PROPOSAL["id"]}/owner-preflight':
                    return r.fulfill(json=DATA)
                if req.method=='POST' and req.url==f'https://owner.test/api/admin/feedback/{PROPOSAL["id"]}/accept-rule':
                    return r.fulfill(status=503,json=dict(error='Synthetic uncertain response')) if uncertain else r.fulfill(json=RECEIPT)
                unexpected.append(req.url); r.abort()
            context.route('**/*',route)
            page=context.new_page(); page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto('https://owner.test/')
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

        def recovery_case(name, mode, width=390, legacy=False):
            context=browser.new_context(viewport=dict(width=width,height=900),service_workers='block')
            calls=[]; unexpected=[]; errors=[]; held=[]
            state=dict(token=None,recoveries=0,reads=0)
            owner_key='uid-pending-owner-review:'+PROPOSAL['id']
            legacy_key='uid-pending-review:'+PROPOSAL['id']
            lock=dict(action='rule') if legacy else dict(action='rule',ownerApproval=dict(
                proposal_id=PROPOSAL['id'],owner_user_id='browser-owner',
                candidate_hash=DATA['candidate_hash'],rule_hash=DATA['direct_rule']['rule_hash'],
                plan_hash=DATA['direct_rule_plan']['plan_hash'],recovery_token=None,
                operation_id='11111111-1111-4111-8111-111111111111'))
            key=legacy_key if legacy or mode=='queue' else owner_key
            if mode=='queue': lock=dict(action='process',requestId='separate-queue-request')
            seed=f'''if (!sessionStorage.getItem('seeded-owner-test')) {{
                sessionStorage.setItem({json.dumps(key)},{json.dumps(json.dumps(lock))});
                sessionStorage.setItem('seeded-owner-test','true');
            }}'''
            context.add_init_script(seed)
            def current_preview():
                data=copy.deepcopy(DATA)
                if state['token']:
                    data['recovery_token']=state['token']
                    data['candidate_hash']='scope-v2:recovered-synthetic'
                    data['direct_rule']['rule_hash']='owner-rule-v1:recovered-synthetic'
                    data['direct_rule_plan']['plan_hash']='plan-sha256:recovered-synthetic'
                return data
            def route(r):
                req=r.request
                if req.url=='https://owner.test/': return r.fulfill(content_type='text/html',body=html)
                if req.url=='https://owner.test/owner.js': return r.fulfill(content_type='text/javascript',body=js)
                payload=req.post_data_json if req.method=='POST' else None
                calls.append((req.method,req.url,payload))
                if req.method=='GET' and req.url.endswith('/owner-preflight'):
                    state['reads']+=1
                    if mode=='poll' and state['reads']==2:
                        held.append(r); return
                    return r.fulfill(json=current_preview())
                if req.method=='POST' and req.url.endswith('/recover-owner-rule'):
                    state['recoveries']+=1
                    assert set(payload)=={'recover','recovery_id'} and payload['recover'] is True,payload
                    assert re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}',payload['recovery_id']),payload
                    result=dict(proposal_id=PROPOSAL['id'],owner_user_id='browser-owner',recovery_id=payload['recovery_id'])
                    if mode=='committed': return r.fulfill(json=dict(**result,status='merged',receipt=RECEIPT))
                    if mode=='wrong_actor': return r.fulfill(json=dict(**result,status='merged',receipt=dict(RECEIPT,owner_user_id='unrelated-owner')))
                    if mode=='wrong_id':
                        result['recovery_id']='33333333-3333-4333-8333-333333333333'
                        return r.fulfill(json=dict(**result,status='fenced_not_applied',recovery_token='22222222-2222-4222-8222-222222222222'))
                    if mode=='malformed': return r.fulfill(json=dict(**result,status='fenced_not_applied'))
                    state['token']='22222222-2222-4222-8222-222222222222'
                    if mode=='lost' and state['recoveries']==1: return r.abort('failed')
                    return r.fulfill(json=dict(**result,status='fenced_not_applied',recovery_token=state['token']))
                if req.method=='POST' and req.url.endswith('/accept-rule'):
                    receipt=dict(RECEIPT,**{k:v for k,v in payload.items() if k!='approve_rule'})
                    return r.fulfill(json=receipt)
                unexpected.append(req.url); r.abort()
            context.route('**/*',route)
            page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
            if mode=='poll': page.clock.install()
            page.goto('https://owner.test/')
            confirm=page.get_by_role('button',name='Xác nhận hard merge',exact=True)
            recover=page.get_by_role('button',name='Khôi phục thao tác chưa rõ kết quả',exact=True)
            if mode=='queue':
                expect(confirm).to_be_enabled();expect(recover).to_have_count(0)
                assert page.evaluate('(key)=>sessionStorage.getItem(key)',legacy_key)==json.dumps(lock)
                assert page.evaluate('(key)=>sessionStorage.getItem(key)',owner_key) is None
            else:
                expect(confirm).to_be_disabled();expect(recover).to_be_enabled()
                if legacy:
                    assert page.evaluate('(key)=>sessionStorage.getItem(key)',legacy_key) is None
                    assert json.loads(page.evaluate('(key)=>sessionStorage.getItem(key)',owner_key))['action']=='rule'
                if mode=='poll':
                    page.clock.fast_forward(10000)
                    page.wait_for_function('document.body.textContent.includes("Đang cập nhật trạng thái")')
                    assert len(held)==1
                    assert page.get_by_text('Đang tải nội dung rule và phạm vi áp dụng hiện tại…',exact=True).count()==0
                    expect(page.locator('[aria-label="Hướng dẫn rule có hiệu lực"]')).to_contain_text(PROPOSAL['proposed_content_md'])
                    expect(page.locator('[aria-label="Hard merge · Tự duyệt rule"]')).to_have_attribute('aria-busy','false')
                    expect(confirm).to_be_disabled();expect(recover).to_be_disabled()
                    held[0].fulfill(json=current_preview());expect(recover).to_be_enabled()
                else:
                    assert not [c for c in calls if c[0]=='POST'],calls
                    recover.evaluate('(button)=>{button.click();button.click()}')
                    if mode=='lost':
                        page.wait_for_function('document.querySelector("[role=alert]").textContent.includes("Failed to fetch")')
                        first_id=[c[2]['recovery_id'] for c in calls if c[1].endswith('/recover-owner-rule')][0]
                        expect(confirm).to_be_disabled()
                        page.reload();expect(recover).to_be_enabled();expect(confirm).to_be_disabled()
                        assert len([c for c in calls if c[0]=='POST'])==1,'Reload must not auto-recover or auto-merge'
                        recover.click()
                        expect(confirm).to_be_enabled()
                        ids=[c[2]['recovery_id'] for c in calls if c[1].endswith('/recover-owner-rule')]
                        assert ids==[first_id,first_id],ids
                    elif mode=='committed':
                        page.wait_for_function('window.completed.length===1')
                        assert page.evaluate('window.completed[0][1].proposal.status')=='merged'
                        assert page.evaluate('(key)=>sessionStorage.getItem(key)',owner_key) is None
                    elif mode in ['wrong_actor','wrong_id','malformed']:
                        expect(recover).to_be_enabled()
                        expect(confirm).to_be_disabled()
                        page.wait_for_function('document.querySelector("[role=alert]").textContent.includes("không khớp") || document.querySelector("[role=alert]").textContent.includes("chưa được xác minh")')
                        assert page.evaluate('(key)=>sessionStorage.getItem(key)',owner_key) is not None
                        assert page.evaluate('window.completed.length')==0
                    else: expect(confirm).to_be_enabled()
                    assert not [c for c in calls if c[1].endswith('/accept-rule')],'Recovery never accepts a rule'
                    if mode in ['fenced','lost']:
                        assert page.evaluate('(key)=>sessionStorage.getItem(key)',owner_key) is None
                        confirm.evaluate('(button)=>{button.click();button.click()}')
                        page.wait_for_function('window.completed.length===1')
                        accepts=[c for c in calls if c[1].endswith('/accept-rule')]
                        assert len(accepts)==1,accepts
                        expected=dict(approve_rule=True,candidate_hash='scope-v2:recovered-synthetic',
                            rule_hash='owner-rule-v1:recovered-synthetic',plan_hash='plan-sha256:recovered-synthetic',
                            recovery_token='22222222-2222-4222-8222-222222222222')
                        assert accepts[0][2]==expected,accepts
            assert not unexpected,unexpected
            assert not errors,errors
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            screenshots=os.environ.get('OWNER_QA_SCREENSHOTS')
            if screenshots: page.screenshot(path=str(Path(screenshots)/f'owner-recovery-{name}-{width}.png'),full_page=True)
            print(f'owner recovery {name} {width}px: real React, controlled HTTP, exact identity and no implicit accept passed')
            context.close()
        for args in [
            ('legacy-fence','fenced',390,True),('saved-fence','fenced',1280,False),
            ('lost-recovery','lost',390,False),('prior-committed','committed',390,False),
            ('wrong-actor','wrong_actor',390,False),('wrong-recovery-id','wrong_id',390,False),
            ('malformed-recovery','malformed',390,False),('queue-isolation','queue',390,False),
            ('background-poll','poll',390,False),
        ]: recovery_case(*args)
        browser.close()
