import { test } from "node:test";
import { strict as assert } from "node:assert";
import { getOnepagePortableQualityPack, ONEPAGE_QUALITY_PACK_VERSION } from "../supabase/functions/_shared/onepage-portable-quality.ts";
import { getOnepageUiTemplate, attachOnepageUiTemplate } from "../onepage-ui-template.ts";
import { createApp } from "../server.ts";

test("portable quality is independent of personal ChatGPT account and covers content, banner, image and icon roles",()=>{
  const pack=getOnepagePortableQualityPack("PawfectHouse");
  assert.equal(pack.schema_version,ONEPAGE_QUALITY_PACK_VERSION);
  assert.equal(pack.account_memory_required,false);
  assert.deepEqual(pack.applies_to_clients,["chatgpt_mcp","web_app","external_mcp_client"]);
  assert.equal(pack.rules.content.post_story_choice.includes("only after source review"),true);
  assert.equal(pack.rules.banner.dimensions.desktop,"2560x960");
  assert.equal(pack.rules.banner.dimensions.mobile,"720x700");
  assert.ok(pack.rules.imagery.production_sequence.length>=5);
  assert.equal(pack.rules.icons.style.badge_fill,"#FBDEBE");
});
test("cross-account default manifest exposes portable quality contract without inventing canonical reference approval",()=>{
  const manifest=getOnepageUiTemplate();
  assert.equal(manifest.portable_quality_playbook.schema_version,ONEPAGE_QUALITY_PACK_VERSION);
  assert.equal(manifest.portable_quality_playbook.reference_readiness.status,"REFERENCE_CATALOG_NOT_QUERIED");
  assert.equal(manifest.portable_quality_playbook.execution.fail_closed_visual_certification,true);
});
test("compiled empty canonical visual reference library does not falsely certify PFH fidelity",()=>{
  const pack=getOnepagePortableQualityPack("PawfectHouse",{canonical_visual_reference_catalog:[],references:[]});
  assert.equal(pack.reference_readiness.status,"NO_VERIFIED_VISUAL_STYLE_EXEMPLARS_IN_COMPILED_JOB");
  assert.equal(pack.execution.fail_closed_visual_certification,true);
});
test("reference metadata alone never claims pixel verification",()=>{
  const pack=getOnepagePortableQualityPack("PawfectHouse",{canonical_visual_reference_catalog:[{id:"reference-1",url:"https://example.com/approved.png"}]});
  assert.equal(pack.reference_readiness.status,"REFERENCE_METADATA_PRESENT_REQUIRES_PIXEL_VERIFICATION");
  assert.equal(pack.reference_readiness.catalog_count,1);
});
test("PawfectHouse icon palette must not leak into another brand",()=>{
  const pack=getOnepagePortableQualityPack("GiftSoul");
  assert.equal(pack.active_pawfecthouse_brand_style,false);
  assert.equal((pack.rules.icons as any).style,undefined);
});
test("invalid upstream contract remains blocked independently of portable rules",()=>{
  const fake={resolved:{brand:"pawfecthouse",branch:"onepage-system"},instruction:"legacy content"};
  const out=attachOnepageUiTemplate(fake,"PawfectHouse","Onepage");
  assert.equal(out.quality_execution_guard.status,"BLOCKED");
  assert.equal(out.portable_quality_playbook.schema_version,ONEPAGE_QUALITY_PACK_VERSION);
  assert.equal(out.portable_quality_playbook.execution.fail_closed_visual_certification,true);
});
test("public read-only endpoint exposes same playbook contract as shared template",async()=>{
  const listener=createApp().listen(0,"127.0.0.1");
  await new Promise<void>(resolve=>listener.once("listening",resolve));
  try {
    const port=(listener.address() as any).port;
    const resp=await fetch("http://127.0.0.1:"+port+"/api/onepage-quality-playbook/PawfectHouse");
    assert.equal(resp.status,200);
    const body=await resp.json();
    assert.equal(body.schema_version,ONEPAGE_QUALITY_PACK_VERSION);
    assert.equal(body.account_memory_required,false);
    const unknown=await fetch("http://127.0.0.1:"+port+"/api/onepage-quality-playbook/unknown");
    assert.equal(unknown.status,400);
  } finally {
    await new Promise<void>((resolve,reject)=>listener.close(err=>err?reject(err):resolve()));
  }
});
