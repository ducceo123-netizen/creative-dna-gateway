import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import { mkdirSync } from 'node:fs';
const out=process.env.QA_OUTDIR || '/tmp/uid-feedback-inbox-qa';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {}),headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:1100},deviceScaleFactor:1});
const definitions=[
 ['GiftSoul','Home Hero','home-hero','Giữ sản phẩm làm điểm nhìn chính, giảm chi tiết nền trong Hero','Linh Nguyễn','brand_branch'],
 ['GiftSoul','Onepage System','onepage-system','Tách rõ Product Details và Good To Know, tránh lặp lại thông tin','Minh Trần','shared_cross_brand'],
 ['PawfectHouse','LDP Hero','ldp-hero','Bám silhouette thật của tumbler 20oz, không tự suy đoán chiều cao','Nolan','brand_branch'],
 ['PawfectHouse','Onepage System','onepage-system','Kiểm tra đúng giới hạn từ cho từng Occasion card trước khi kết luận','Duy Phạm','brand_branch'],
 ['SoulPrise','UGC','ugc','Đưa cảm xúc người nhận lên đầu câu chuyện, giữ lời kể tự nhiên','Hà Lê','brand_branch'],
 ['SoulPrise','Home Hero','home-hero','Tăng khoảng thở quanh headline và giữ CTA rõ trên mobile','Linh Nguyễn','brand_branch'],
];
const proposals=definitions.map(([brand,title,slug,summary,author,scope],i)=>({id:'demo-'+i,status:'pending',brand_name:brand,branch_title:title,branch_slug:slug,submitted_by_name:author,created_at:'2026-10-13T04:30:00Z',proposed_scope:scope,change_summary:summary,raw_feedback:summary,proposed_content_md:'Giữ silhouette, tỷ lệ chiều cao/rộng, miệng, nắp và đáy đúng product reference của SKU. Không suy ra kích thước thực tế từ capacity. Mọi claim mới cần bằng chứng từ đúng sản phẩm.',evidence_summary:{admin_overview:{summary,why_it_matters:'Cần đối chiếu đúng product reference để tránh thay đổi hình dáng sản phẩm hoặc đưa thông tin chưa có bằng chứng.',proposed_change:'Bám reference thật của SKU, kiểm tra chi tiết sản phẩm trước khi tạo hoặc duyệt outcome.'}},context_images:i===2?[{role:'OUTPUT_BEING_REVIEWED',reference_id:'demo-reference',caption:'Tumbler bị kéo cao và quá ốm so với silhouette thật.'}]:[]}));
proposals.push({...proposals[0],id:'demo-merged',status:'merged',change_summary:'Giữ tương phản đủ rõ cho CTA trên nền sáng'});
let mutations=[];const errors=[];page.on('pageerror',e=>errors.push(String(e)));
await page.route('**/api/**',async route=>{
 const url=new URL(route.request().url());const path=url.pathname;
 if(route.request().method()!=='GET'&&path!=='/api/routes')mutations.push(path);
 const body=path==='/api/admin/feedback'?{proposals}:path==='/api/admin/team'?{members:[]}:path==='/api/routes'?{routes:[]}:path==='/api/branch-guides'?{guides:[]}:{};
 await route.fulfill({json:body});
});
await page.addInitScript(()=>sessionStorage.setItem('creative_dna_admin_token','synthetic-visual-test-only'));
await page.goto((process.env.BASE_URL || 'http://127.0.0.1:4180') + '/admin/feedback');
await page.getByRole('button',{name:/Mở feedback:/}).first().waitFor();
assert.equal(await page.getByRole('button',{name:/Mở feedback:/}).count(),6);
await page.screenshot({path:out+'/inbox-desktop.png',fullPage:true});
await page.getByRole('button',{name:/Mở feedback: Bám silhouette/}).click();
await page.getByRole('dialog').waitFor();
await page.screenshot({path:out+'/detail-desktop.png'});
await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'detached'});
assert.match(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')), /Mở feedback: Bám silhouette/);
await page.setViewportSize({width:390,height:844});await page.screenshot({path:out+'/inbox-mobile.png',fullPage:true});
await page.getByRole('button',{name:/Mở feedback:/}).first().click();await page.screenshot({path:out+'/detail-mobile.png'});
const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false);assert.deepEqual(errors,[]);assert.deepEqual(mutations,[]);console.log({errors,mutations,overflow,screenshots:out});
await browser.close();
