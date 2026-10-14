import test from 'node:test';
import assert from 'node:assert/strict';
import {ONEPAGE_PACKAGING_CONTRACT, onepagePackagePaths, validateOnepagePackagePaths} from '../supabase/functions/_shared/onepage-packaging.ts';
test('exact canonical roles retain different production and mapping separators',()=>{
 const paths=onepagePackagePaths('Poseable Plush Doll','poseable_plush_doll','gtk');
 assert.equal(paths.length,19);
 for(const suffix of ['banner.webp','banner-mobile.webp','detail_banner.webp','wyl_01.webp','occasion_banner-01.webp','occasion_icon-04.webp']) assert.ok(paths.includes(`Onepage - Poseable Plush Doll/onepage-poseable_plush_doll-${suffix}`));
 assert.ok(paths.includes('Onepage - Poseable Plush Doll/onepage_poseable_plush_doll-overall.png'));
 assert.equal(validateOnepagePackagePaths(paths,'Poseable Plush Doll','poseable_plush_doll','gtk').status,'VALID_NAMES_ONLY');
 assert.equal(ONEPAGE_PACKAGING_CONTRACT.role_by_slot.occasion_story_01_mobile,undefined);
});
test('actual observed slot aliases, wrong production prefix and slugified root are rejected',()=>{
 for(const [from,to] of [['-banner.webp','-banner-desktop.webp'],['-detail_banner.webp','-detail-main.webp'],['-wyl_01.webp','-wyl-01.webp'],['-occasion_banner-01.webp','-occasion-01.webp'],['-occasion_icon-01.webp','-occasion-icon-01.webp'],['/onepage-','/onepage_'],['Onepage - Penguin Advent Calendar/','Onepage-Penguin-Advent-Calendar/']]){
  const paths=onepagePackagePaths('Penguin Advent Calendar','penguin_advent_calendar','gtk').map(p=>p.replace(from,to));
  assert.equal(validateOnepagePackagePaths(paths,'Penguin Advent Calendar','penguin_advent_calendar','gtk').status,'INVALID',to);
 }
});
test('duplicates, missing, extras, unsafe paths and duplicate guides fail',()=>{
 const paths=onepagePackagePaths('Wooden Ornament','wooden_ornament','gtk');
 for(const bad of [[...paths,paths[0]],paths.slice(1),[...paths,'README.md'],[...paths,'../escape.webp'],[...paths,'Onepage - Wooden Ornament/old-overall.png']]) assert.equal(validateOnepagePackagePaths(bad,'Wooden Ornament','wooden_ornament','gtk').status,'INVALID');
});
test('FAQ omits GTK; folder directory entry allowed; byte certification never implied',()=>{
 const paths=onepagePackagePaths('Shaped Pillow','shaped_pillow','faq'); assert.equal(paths.length,16); assert.ok(paths.every(p=>!p.includes('-gtk-')));
 const result=validateOnepagePackagePaths(['Onepage - Shaped Pillow/',...paths],'Shaped Pillow','shaped_pillow','faq');
 assert.equal(result.status,'VALID_NAMES_ONLY'); assert.equal(result.byte_validation,'NOT_PERFORMED');
 assert.throws(()=>onepagePackagePaths('../escape','x','gtk'));assert.throws(()=>onepagePackagePaths('Safe','Not-Snake','gtk'));
});

test('gateway packaging handoff requires a fresh contract and actual archive validation',async()=>{
 const {REVIEW_EXECUTION_GUIDANCE}=await import('../uid-brands-actions.ts');
 assert.match(REVIEW_EXECUTION_GUIDANCE,/Before Onepage packaging, refresh compile_onepage_job/);
 assert.match(REVIEW_EXECUTION_GUIDANCE,/reopen the actual ZIP and validate exact entries plus CRC before delivery/);
 assert.match(REVIEW_EXECUTION_GUIDANCE,/stop on a failure or unavailable verification/);
});
