import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFeedbackIndex, resolveFeedbackBlocks, type FeedbackIndex } from "../uid-brands-feedback-index.ts";

const input = {
  stage: "asset_review", task_id: "task-1", content_version: "v1", branch: "onepage-system",
  assets: [
    { id: "c", label: "Footer", section: "Page", position: "bottom" },
    { asset_id: "a", label: "Hero", section: "Top", position: "desktop" },
    { id: "b", asset_id: "b", name: "Mobile", section: "Top" },
  ],
};
function index(overrides = {}): FeedbackIndex {
  const result = buildFeedbackIndex({ ...input, ...overrides });
  if (!result.ok) assert.fail(result.message);
  return result.index;
}
function code(result: ReturnType<typeof resolveFeedbackBlocks> | ReturnType<typeof buildFeedbackIndex>, expected: string) {
  assert.equal(result.ok, false);
  if (!result.ok) { assert.equal(result.code, expected); assert.ok(result.recovery.length); }
}
const current = index();
const resolve = (blocks: unknown, idx = current) => resolveFeedbackBlocks(idx, { index_id: idx.index_id, blocks });

test("stable IDs order the exact bound inventory independent of input order", () => {
  assert.deepEqual(index({ assets: [...input.assets].reverse() }), current);
  assert.deepEqual(current.entries.map(e => [e.ordinal, e.asset_id]), [[1, "a"], [2, "b"], [3, "c"]]);
  for (const change of [{content_version:"v2"},{task_id:"task-2"},{stage:"complete"},{retry_id:"retry-1"},{branch:"packaging"},
    {assets: input.assets.map(a => ({...a,label:"Revised"}))},
    {assets: input.assets.map(a => ({...a,section:"Revised"}))},
    {assets: input.assets.map(a => ({...a,position:"Revised"}))}]) {
    assert.notEqual(index(change).index_id, current.index_id);
  }
});

test("unbound inventories, missing IDs, duplicate IDs, and conflicting identity aliases reject", () => {
  for (const override of [{task_id:undefined},{content_version:undefined},{stage:""},{assets:[]},{assets:[{id:" "}]}]) {
    code(buildFeedbackIndex({...input,...override}), "invalid_inventory");
  }
  code(buildFeedbackIndex({...input,assets:[{label:"Hero"}]}),"invalid_asset_id");
  code(buildFeedbackIndex({...input,assets:[{id:"a",asset_id:"b"}]}),"invalid_asset_id");
  code(buildFeedbackIndex({...input,assets:[{id:"a"},{asset_id:"a"}]}),"duplicate_asset_id");
});

test("multiple distinct grouped blocks preserve separate instructions and exact ID scopes", () => {
  const result = resolve([{text:"More whitespace",group_names:[" top "]},{text:"Smaller footer",asset_names:["Footer"]}]);
  assert.deepEqual(result, {ok:true,index_id:current.index_id,blocks:[
    {text:"More whitespace",asset_ids:["a","b"],ordinals:[1,2]},
    {text:"Smaller footer",asset_ids:["c"],ordinals:[3]},
  ]});
  const all = resolve([{text:"Use consistent typography",all:true}]);
  assert.ok(all.ok);
  if (all.ok) assert.deepEqual(all.blocks[0].asset_ids,["a","b","c"]);
});

test("old version/index, tampered inventory and malformed/unbound indexes reject", () => {
  code(resolveFeedbackBlocks(index({content_version:"v2"}),{index_id:current.index_id,blocks:[{text:"Edit",ordinals:[1]}]}),"stale_index");
  code(resolveFeedbackBlocks({...current,task_id:"other"},{index_id:current.index_id,blocks:[{text:"Edit",all:true}]}),"invalid_index");
  code(resolveFeedbackBlocks({...current,entries:current.entries.slice().reverse()},{index_id:current.index_id,blocks:[]}),"invalid_index");
  for (const bad of [null,{}, {...current,content_version:undefined}]) code(resolveFeedbackBlocks(bad,{}),"invalid_index");
});

test("invalid, empty and implicit selectors never broaden feedback", () => {
  for (const block of [{text:"Edit",ordinals:[1.2]},{text:"Edit",ordinals:[0]}, {text:"Edit",ordinals:["1"]},
    {text:"Edit",ordinals:[]},{text:" ",all:true},{text:"Edit",all:"true"},{text:"x".repeat(4001),all:true},{text:"Edit",section:"Top"}]) {
    code(resolve([block]),"invalid_feedback");
  }
  code(resolve(Array.from({length:11},()=>({text:"Edit",all:true}))),"invalid_feedback");
  code(resolve([{text:"Edit"}]),"missing_selector");
  code(resolve([{text:"Edit",all:false}]),"missing_selector");
  code(resolve([{text:"Edit",ordinals:[99]}]),"unknown_ordinal");
  code(resolve([{text:"Edit",asset_names:["He"]}]),"unknown_name");
  code(resolve([{text:"Edit",group_names:["Missing"]}]),"unknown_group");
  code(resolve([{text:"Edit",all:true,ordinals:[1]}]),"conflicting_selectors");
});

test("ambiguous names and normalized group collisions require numbered clarification", () => {
  const dup = index({assets:[{id:"a",name:"Hero",section:"Top"},{id:"b",name:" HERO ",section:"TOP"}]});
  code(resolve([{text:"Edit",asset_names:["hero"]}],dup),"ambiguous_name");
  code(resolve([{text:"Edit",group_names:["top"]}],dup),"ambiguous_group");
  assert.ok(resolve([{text:"Edit",ordinals:[1]}],dup).ok);
  // Explicit selector fields keep a name from accidentally matching a group.
  const collision = index({assets:[{id:"a",name:"Top",section:"Other"},{id:"b",name:"Other",section:"Top"}]});
  const byName = resolve([{text:"Edit",asset_names:["Top"]}],collision);
  assert.ok(byName.ok); if(byName.ok) assert.deepEqual(byName.blocks[0].asset_ids,["a"]);
});

test("overlap between any blocks rejects even identical text and mixed selector types", () => {
  code(resolve([{text:"Make red",ordinals:[1]},{text:"Make blue",group_names:["Top"]}]),"overlapping_blocks");
  code(resolve([{text:"Same",ordinals:[1]},{text:"Same",asset_names:["Hero"]}]),"overlapping_blocks");
  const dedup = resolve([{text:"Edit",ordinals:[1,1],asset_names:["Hero"]}]);
  assert.ok(dedup.ok); if(dedup.ok) assert.deepEqual(dedup.blocks[0].asset_ids,["a"]);
});

test("media stays reference-only and links only through explicit asset identity", () => {
  assert.ok(current.entries.every(e=>e.media.length===0 && e.preview_availability==="unavailable"));
  assert.deepEqual(index({result_images:[{file_id:"real_file",label:"Hero"}]}),current);
  const linked = index({result_images:[{file_id:"real_file",label:"Actual reference",asset_id:"a"}]});
  assert.deepEqual(linked.entries[0].media,[{file_id:"real_file",label:"Actual reference"}]);
  assert.equal(linked.entries[0].preview_availability,"reference_only");
  assert.equal(linked.entries[1].preview_availability,"unavailable");
  assert.notEqual(linked.index_id,current.index_id);
  code(buildFeedbackIndex({...input,result_images:[{file_id:"real",label:"x",asset_id:"missing"}]}),"unknown_media_asset");
  code(buildFeedbackIndex({...input,result_images:[{file_id:"real",label:"x",asset_id:"a"},{file_id:"real",label:"x",asset_id:"b"}]}),"ambiguous_media_link");
  const unnamed = index({assets:[{id:"a"}]});
  assert.equal(unnamed.entries[0].name,null);
});

test("builders and resolvers do not mutate caller inputs", () => {
  const before = JSON.stringify(input);
  index();
  const request = { index_id: current.index_id, blocks:[{text:"Edit",ordinals:[2,1]}] };
  const requestBefore = JSON.stringify(request);
  const indexBefore = JSON.stringify(current);
  resolveFeedbackBlocks(current,request);
  assert.equal(JSON.stringify(input),before);
  assert.equal(JSON.stringify(request),requestBefore);
  assert.equal(JSON.stringify(current),indexBefore);
});

test("explicit group/all selections support exact item exclusions without broadening scope", () => {
  assert.deepEqual(resolve([{text:"Adjust Top except its last item",group_names:["Top"],exclude_ordinals:[2]}]), {
    ok:true,index_id:current.index_id,blocks:[{text:"Adjust Top except its last item",asset_ids:["a"],ordinals:[1]}],
  });
  assert.deepEqual(resolve([{text:"Adjust all except Footer",all:true,exclude_asset_names:["footer"]}]), {
    ok:true,index_id:current.index_id,blocks:[{text:"Adjust all except Footer",asset_ids:["a","b"],ordinals:[1,2]}],
  });
  const split = resolve([{text:"Red",all:true,exclude_ordinals:[2,3]},{text:"Blue",group_names:["Top"],exclude_asset_names:["Hero"]}]);
  assert.ok(split.ok); if (split.ok) assert.deepEqual(split.blocks.map(b=>b.asset_ids),[["a"],["b"]]);
  const duplicate = resolve([{text:"Edit",all:true,exclude_ordinals:[3,3],exclude_asset_names:["Footer"]}]);
  assert.ok(duplicate.ok); if (duplicate.ok) assert.deepEqual(duplicate.blocks[0].asset_ids,["a","b"]);
});

test("invalid, ambiguous, unrelated, and all-removing exclusions require clarification", () => {
  for (const bad of [{exclude_ordinals:[0]},{exclude_ordinals:[1.5]},{exclude_ordinals:["1"]},{exclude_ordinals:[]},{exclude_asset_names:[]}]) {
    code(resolve([{text:"Edit",all:true,...bad}]),"invalid_feedback");
  }
  code(resolve([{text:"Edit",exclude_ordinals:[1]}]),"missing_selector");
  code(resolve([{text:"Edit",all:true,exclude_ordinals:[99]}]),"unknown_excluded_ordinal");
  code(resolve([{text:"Edit",all:true,exclude_asset_names:["Missing"]}]),"unknown_excluded_name");
  code(resolve([{text:"Edit",group_names:["Top"],exclude_ordinals:[3]}]),"exclusion_outside_selection");
  code(resolve([{text:"Edit",ordinals:[1],exclude_asset_names:["Hero"]}]),"empty_selection");
  const dup = index({assets:[{id:"a",name:"Hero"},{id:"b",name:"HERO"}]});
  code(resolve([{text:"Edit",all:true,exclude_asset_names:["hero"]}],dup),"ambiguous_excluded_name");
  code(resolve([{text:"First",all:true,exclude_ordinals:[3]},{text:"Second",ordinals:[1]}]),"overlapping_blocks");
});

test("canonical slots resolve only exact asset IDs or explicitly supplied current mappings", () => {
  const mapped = index({assets:[{id:"banner_desktop",name:"Desktop"},{id:"random-id",canonical_slot:"detail_01",name:"Detail"},{id:"third",name:"detail_02"}]});
  const result = resolve([{text:"Edit selected",canonical_slots:["detail_01","banner_desktop"]}],mapped);
  assert.ok(result.ok); if(result.ok) assert.deepEqual(result.blocks[0].asset_ids,["banner_desktop","random-id"]);
  code(resolve([{text:"Edit",canonical_slots:["detail_02"]}],mapped),"missing_canonical_slot");
  code(resolve([{text:"Edit",canonical_slots:["occasion_story_01"]}],mapped),"invalid_feedback");
  code(resolve([{text:"Edit",canonical_slots:["DETAIL_01"]}],mapped),"invalid_feedback");
  const changed = index({assets:[{id:"random-id",canonical_slot:"detail_02",name:"Detail"}]});
  assert.notEqual(changed.index_id,index({assets:[{id:"random-id",canonical_slot:"detail_01",name:"Detail"}]}).index_id);
  code(resolveFeedbackBlocks(changed,{index_id:mapped.index_id,blocks:[{text:"Edit",canonical_slots:["detail_01"]}]}),"stale_index");
});

test("canonical slot mappings reject duplicate, unknown and conflicting assignments", () => {
  code(buildFeedbackIndex({...input,assets:[{id:"a",canonical_slot:"made_up"}]}),"invalid_inventory");
  code(buildFeedbackIndex({...input,assets:[{id:"detail_01",canonical_slot:"detail_02"}]}),"conflicting_canonical_slot");
  code(buildFeedbackIndex({...input,assets:[{id:"a",canonical_slot:"detail_01"},{id:"b",canonical_slot:"detail_01"}]}),"ambiguous_canonical_slot");
  code(buildFeedbackIndex({...input,assets:[{id:"detail_01"},{id:"b",canonical_slot:"detail_01"}]}),"ambiguous_canonical_slot");
});

test("canonical exclusions preserve positive scope, block boundaries, and overlap checks", () => {
  const mapped = index({assets:[{id:"a",canonical_slot:"detail_01",section:"PD"},{id:"b",canonical_slot:"detail_02",section:"PD"},{id:"c",canonical_slot:"banner_mobile"}]});
  const result = resolve([{text:"PD except last",group_names:["PD"],exclude_canonical_slots:["detail_02"]},{text:"Last separately",canonical_slots:["detail_02"]}],mapped);
  assert.ok(result.ok); if(result.ok) assert.deepEqual(result.blocks.map(b=>b.asset_ids),[["a"],["b"]]);
  code(resolve([{text:"Edit",exclude_canonical_slots:["detail_01"]}],mapped),"missing_selector");
  code(resolve([{text:"Edit",group_names:["PD"],exclude_canonical_slots:["banner_mobile"]}],mapped),"exclusion_outside_selection");
  code(resolve([{text:"Edit",canonical_slots:["detail_01"],exclude_canonical_slots:["detail_01"]}],mapped),"empty_selection");
  code(resolve([{text:"Edit",all:true,exclude_canonical_slots:["detail_03"]}],mapped),"missing_canonical_slot");
  code(resolve([{text:"Edit",canonical_slots:["detail_01"]},{text:"Other",ordinals:[1]}],mapped),"overlapping_blocks");
});

test("canonical selectors require verified Onepage branch without affecting legacy selectors", () => {
  for (const branch of [undefined,"packaging"]) {
    const other = index({branch,assets:[{id:"detail_01",name:"Detail"}]});
    code(resolve([{text:"Edit",canonical_slots:["detail_01"]}],other),"canonical_branch_required");
    code(resolve([{text:"Edit",all:true,exclude_canonical_slots:["detail_01"]}],other),"canonical_branch_required");
    assert.ok(resolve([{text:"Edit",ordinals:[1]}],other).ok);
    assert.ok(resolve([{text:"Edit",asset_names:["Detail"]}],other).ok);
  }
  const onepage = index({branch:"onepage-system",assets:[{id:"detail_01"}]});
  assert.ok(resolve([{text:"Edit",canonical_slots:["detail_01"]}],onepage).ok);
});
