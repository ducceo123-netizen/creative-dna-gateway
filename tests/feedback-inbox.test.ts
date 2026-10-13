import test from 'node:test';
import assert from 'node:assert/strict';
import { feedbackTitle, sourceBrand, filterFeedback, groupFeedback, feedbackDate, materialLabel } from '../src/components/feedback-inbox';
import type { FeedbackProposal } from '../src/components/feedback-review';
const rows:FeedbackProposal[] = [
 {id:'a',status:'pending',brand_name:'PawfectHouse',branch_slug:'onepage-system',branch_title:'Onepage System',submitted_by_name:'Đặng Linh',change_summary:'Giữ đúng hình dáng sản phẩm',proposed_scope:'shared_cross_brand'},
 {id:'b',status:'merged',brand_name:'GiftSoul',branch_slug:'home-hero',branch_title:'Home Hero',raw_feedback:'CTA rõ hơn'},
 {id:'c',status:'pending',brand_name:'SoulPrise',branch_slug:'ugc',branch_title:'UGC'},
 {id:'d',status:'pending'},
];
const any={status:'all',brand:'all',material:'all',search:''};
test('source brand grouping never expands cross-brand proposal scope or invents a missing brand',()=>{
 const groups=groupFeedback(rows);
 assert.deepEqual(groups.map(g=>g.label),['GiftSoul','PawfectHouse','SoulPrise','Chưa xác định brand']);
 assert.deepEqual(groups.flatMap(g=>g.proposals).map(p=>p.id).sort(),['a','b','c','d']);
 assert.equal(groups.find(g=>g.key==='pawfecthouse')?.proposals.length,1);
 assert.equal(sourceBrand({...rows[0],brand_name:' PawfectHouse '}).key,'pawfecthouse');
 assert.equal(sourceBrand({...rows[0],brand_name:undefined}).key,'__unknown__');
 assert.equal(rows[0].proposed_scope,'shared_cross_brand');
});
test('status, source brand, material and accent-insensitive query compose without mutating source',()=>{
 assert.deepEqual(filterFeedback(rows,{...any,status:'pending',brand:'pawfecthouse',material:'onepage-system',search:'dang linh'}).map(p=>p.id),['a']);
 assert.deepEqual(filterFeedback(rows,{...any,search:'hinh dang'}).map(p=>p.id),['a']);
 assert.deepEqual(filterFeedback(rows,{...any,status:'merged',brand:'pawfecthouse'}),[]);
 assert.deepEqual(filterFeedback(rows,{...any,brand:'__unknown__'}).map(p=>p.id),['d']);
 assert.equal(rows.length,4);
});
test('row title prefers admin summary, tolerates missing fields and excludes training boilerplate',()=>{
 assert.equal(feedbackTitle({...rows[0],evidence_summary:{admin_overview:{summary:'  Tóm tắt\nngắn  '}}}),'Tóm tắt ngắn');
 assert.equal(feedbackTitle({...rows[0],change_summary:'',raw_feedback:'Ý kiến gốc\n--- AI INTERPRETED TRAINING SPEC ---\nOBSERVED_ISSUE: secret boilerplate'}),'Ý kiến gốc');
 assert.equal(feedbackTitle(rows[3]),'Feedback chưa có tóm tắt');
 assert.equal(materialLabel(rows[3]),'Chưa xác định material');
 assert.equal(feedbackDate('bad-date'),'Chưa có ngày');
});
