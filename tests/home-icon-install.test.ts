import test from 'node:test';import assert from 'node:assert/strict';
import {installHomeIcon} from '../supabase/functions/_shared/home-icon-install.ts';
import {HOME_ICON_CONTENT,HOME_ICON_METADATA,HOME_ICON_INPUT,HOME_ICON_GUIDE,HOME_ICON_REVISION} from '../supabase/functions/_shared/home-icon.ts';
const body={confirm_revision:HOME_ICON_REVISION};
function fake(options:any={}){
 const state={nodes:options.nodes||[],guide:options.guide||null,writes:[] as any[]};
 const db={from(table:string){let op='read',payload:any,filters:any={};const q:any={select(){return q;},eq(k:string,v:any){filters[k]=v;return q;},insert(p:any){op='insert';payload=p;return q;},update(p:any){op='update';payload=p;return q;},single(){return exec();},maybeSingle(){return exec();},then(a:any,b:any){return exec().then(a,b);}};
 async function exec(){if(options.fail===table+':'+op)return {error:{message:'synthetic error'}};
 if(table==='brands')return {data:{id:'brand-1'}};
 if(op==='read')return {data:table==='knowledge_nodes'?state.nodes:state.guide};
 state.writes.push({table,op,payload});
 if(table==='knowledge_nodes'&&op==='insert'){const n={id:'node-1',...payload};state.nodes.push(n);return {data:n};}
 if(table==='knowledge_nodes'&&op==='update'){const n=state.nodes.find((n:any)=>n.id===filters.id&&n.status===filters.status&&n.content_md===filters.content_md);if(n)Object.assign(n,payload);return {data:n||null};}
 state.guide=payload;return {data:payload};}
 return q;}};return {db,state};
}
const node=(extra:any={})=>({id:'node-1',status:'draft',node_type:'material',slug:'home-icon',title:'PawfectHouse Home Icon Material Recipe',version:'1.0',confidence:'contextual',content_md:HOME_ICON_CONTENT,metadata:HOME_ICON_METADATA,input_schema:HOME_ICON_INPUT,...extra});
test('missing exact revision makes zero database writes',async()=>{const f=fake();assert.equal((await installHomeIcon(f.db,{})).status,422);assert.equal(f.state.writes.length,0);});
test('fixed new material is draft until guide created, then activates; ignores arbitrary payload',async()=>{const f=fake();const r=await installHomeIcon(f.db,{...body,brand:'evil',content_md:'evil'});assert.equal(r.status,200);assert.deepEqual(f.state.writes.map(w=>[w.table,w.op]),[['knowledge_nodes','insert'],['branch_visual_guides','insert'],['knowledge_nodes','update']]);assert.equal(f.state.writes[0].payload.status,'draft');assert.equal(f.state.writes[0].payload.content_md,HOME_ICON_CONTENT);assert.equal(r.body.output_owner_approved,false);});
test('repeat installed revision is a no-write read',async()=>{const f=fake({nodes:[node({status:'active'})],guide:HOME_ICON_GUIDE});assert.equal((await installHomeIcon(f.db,body)).body.already_active,true);assert.equal(f.state.writes.length,0);});
test('different canonical content, duplicate version, deprecated state cannot be overwritten',async()=>{for(const nodes of [[node({content_md:'different'})],[node(),node()],[node({status:'deprecated'})]]){const f=fake({nodes});assert.equal((await installHomeIcon(f.db,body)).status,409);assert.equal(f.state.writes.length,0);}});
test('existing incompatible guide blocks activation without overwriting',async()=>{const f=fake({nodes:[node()],guide:{...HOME_ICON_GUIDE,ratio_note:'different'}});assert.equal((await installHomeIcon(f.db,body)).status,409);assert.equal(f.state.writes.length,0);});
test('guide failure leaves material draft and never announces success',async()=>{const f=fake({fail:'branch_visual_guides:insert'});assert.equal((await installHomeIcon(f.db,body)).status,409);assert.equal(f.state.nodes[0].status,'draft');});
test('matching partial install can complete without creating another node',async()=>{const f=fake({nodes:[node()],guide:HOME_ICON_GUIDE});assert.equal((await installHomeIcon(f.db,body)).status,200);assert.deepEqual(f.state.writes.map(w=>w.op),['update']);});
test('read failure writes nothing; activation uncertainty never says installed',async()=>{const f=fake({fail:'knowledge_nodes:read'});assert.equal((await installHomeIcon(f.db,body)).status,503);assert.equal(f.state.writes.length,0);const g=fake({nodes:[node()],guide:HOME_ICON_GUIDE,fail:'knowledge_nodes:update'});assert.equal((await installHomeIcon(g.db,body)).status,409);});

test('active or draft metadata/schema/title drift never counts as installed',async()=>{for(const status of ['active','draft'])for(const change of [{metadata:{...HOME_ICON_METADATA,output_owner_approved:true}},{input_schema:{}},{title:'different'}]){const f=fake({nodes:[node({status,...change})],guide:HOME_ICON_GUIDE});assert.equal((await installHomeIcon(f.db,body)).status,409);assert.equal(f.state.writes.length,0);}});
test('active route requires matching guide before success',async()=>{for(const guide of [null,{...HOME_ICON_GUIDE,output_note:'drift'}]){const f=fake({nodes:[node({status:'active'})],guide});assert.equal((await installHomeIcon(f.db,body)).status,409);assert.equal(f.state.writes.length,0);}});
