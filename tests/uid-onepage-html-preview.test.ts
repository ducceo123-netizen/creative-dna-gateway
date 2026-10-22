import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {packageOnepageReview} from '../public/onepage-review-pack.mjs';
import {getOnepageReviewContract} from '../uid-onepage-html-preview.ts';
import {getOnepageUiTemplate,attachOnepageUiTemplate} from '../onepage-ui-template.ts';
const input = {schema_version:'uid-onepage-preview/1',task_id:'onepage-real-task',content_version:'v3',brand:'pawfecthouse',template_version:'2026-10-11.v3',asset_manifest:[{slot:'actual_image',asset_id:'real-asset-id',file_url:'assets/actual.webp',checksum:'sha256:'+'a'.repeat(64)}]};
const source='<!doctype html><html><head><link rel="stylesheet" href="styles.css"></head><body><div class="brand-layout" style="width:320px"><img data-asset-slot="actual_image" src="assets/actual.webp"><p data-text-slot="title">Actual copy</p></div></body></html>';
test('packager preserves exact original content and layout, adds local-only controls and stable identity',()=>{
 const out=packageOnepageReview(source,input,'/* local controls */','.toolbar{}');
 assert.equal(out.manifest.render_hash,createHash('sha256').update(source).digest('hex'));
 assert.ok(out.html.startsWith(source.slice(0,source.indexOf('</body>'))));
 assert.ok(out.html.endsWith('</body></html>'));
 assert.match(out.html,/id="onepage-review-styles"/);assert.match(out.html,/id="onepage-review-manifest"/);
 assert.match(out.html,/real-asset-id/);assert.doesNotMatch(out.html,/gtk_|fetch\(|https:/);
 assert.equal(out.manifest.task_id,input.task_id);assert.equal(out.manifest.content_version,'v3');
});
test('stale or ambiguous delivery packets are rejected before packaging',()=>{
 for(const bad of [{...input,task_id:''},{...input,content_version:''},{...input,render_hash:'old'},{...input,asset_manifest:[]},{...input,asset_manifest:[...input.asset_manifest,...input.asset_manifest]},{...input,asset_manifest:[{...input.asset_manifest[0],file_url:'javascript:alert(1)'}]}]) assert.throws(()=>packageOnepageReview(source,bad,'',''));
 assert.throws(()=>packageOnepageReview(source.replace('Actual copy','{{title}}'),input,'',''));
 const first=packageOnepageReview(source,input,'','');assert.throws(()=>packageOnepageReview(first.html,input,'',''));
});
test('manifest cannot escape its JSON script container',()=>{
 const out=packageOnepageReview(source,{...input,task_id:'</script><script>alert(1)</script>'},'','');
 assert.ok(out.html.includes('\\u003c/script\\u003e'));assert.ok(!out.html.includes('<script>alert(1)'));
});
test('real compiler and template delivery expose feedback-first review without altering canonical template bytes',()=>{
 const contract=getOnepageReviewContract();assert.equal(contract.auto_send,false);assert.match(contract.instruction,/actual bound HTML/);assert.match(contract.instruction,/overall PNG/);
 const gtk:any=getOnepageUiTemplate(undefined,'source');const faq:any=getOnepageUiTemplate('2026-10-19.faq.v1','source');
 assert.deepEqual(gtk.live_html_feedback,contract);assert.deepEqual(faq.live_html_feedback,contract);
 assert.equal(createHash('sha256').update(gtk.html).digest('hex'),gtk.sha256.html);assert.equal(createHash('sha256').update(faq.html).digest('hex'),faq.sha256.html);
 assert.ok(!faq.asset_slots.some((x:string)=>x.startsWith('gtk_')));
 const result=attachOnepageUiTemplate({},'PawfectHouse','Onepage');assert.deepEqual(result.onepage_preview_contract,contract);assert.match(result.instruction,/actual bound output/);
 const server=readFileSync(new URL('../server.ts',import.meta.url),'utf8');assert.match(server,/attachOnepageUiTemplate\(data,validated.brand,"onepage-system"\)/);
});
test('outcome-only provenance is explicit and never pretends to be a registered task',()=>{
 const {task_id,...rest}=input;const result=packageOnepageReview(source,{...rest,identity_type:'outcome',outcome_id:'libfile_actual'},'','');assert.equal(result.manifest.outcome_id,'libfile_actual');assert.equal(result.manifest.task_id,undefined);assert.equal(result.manifest.identity_type,'outcome');
 assert.throws(()=>packageOnepageReview(source,{...input,identity_type:'outcome',outcome_id:'libfile_actual'},'',''));
});
test('Onepage feedback-first removes hosting gates while legacy LDP preview remains explicit',()=>{
 const onepage=getOnepageReviewContract();assert.equal(onepage.hosted_url_required,false);assert.equal('hosted_delivery' in onepage,false);assert.equal(onepage.delivery_mode,'CHAT_OUTCOME_WITH_GROUPED_FEEDBACK');assert.equal(onepage.feedback.opens_automatically,false);assert.equal(onepage.feedback.private_context_transferred,false);assert.match(onepage.instruction,/Do not deliver or require a hosted web preview/);assert.match(onepage.instruction,/At content approval, review prose only/);assert.match(onepage.instruction,/render hash/);assert.match(onepage.instruction,/packaging is explicitly requested/);assert.match(onepage.instruction,/Unregistered outcomes use host-verified direct chat/);assert.match(onepage.instruction,/do not pass them through the task-only review-index tool/);
 const ldp=readFileSync(new URL('../uid-ldp-html-preview.ts',import.meta.url),'utf8');assert.match(ldp,/hostedReviewDeliveryContract\('ldp'/);assert.match(ldp,/downloads, ZIP, screenshots and Figma are supplemental only/);
});
