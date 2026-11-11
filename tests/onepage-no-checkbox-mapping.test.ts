import { test } from "node:test";
import { strict as assert } from "node:assert";
import { assertNoCheckboxMapping, getOnepageUiTemplate, getTemplateFile, ONEPAGE_NO_CHECKBOX_POLICY } from "../onepage-ui-template.ts";

test("every active Onepage UI mapping template has zero checkbox controls",()=>{
  for(const version of ["2026-10-03.v2","2026-10-11.v3","2026-11-11.faq.v2"]){
    const template=getOnepageUiTemplate(version,"source");
    const html=getTemplateFile(version,"template.html")!.body;
    assert.equal(template.ui_mapping_policy.checkboxes,"FORBIDDEN_ALL_SECTIONS");
    assert.equal(template.ui_mapping_policy.compliance,ONEPAGE_NO_CHECKBOX_POLICY);
    assert.doesNotMatch(html,/<input\b/i);
    assert.doesNotMatch(html,/<label\b[^>]*for=["']uid-faq-/i);
    assert.doesNotThrow(()=>assertNoCheckboxMapping(html));
  }
});
test("archived checkbox-backed FAQ v1 cannot be served or reused in new mapping",()=>{
  assert.throws(()=>getOnepageUiTemplate("2026-10-19.faq.v1","source"),/RETIRED_CHECKBOX_FAQ_TEMPLATE/);
  assert.equal(getTemplateFile("2026-10-19.faq.v1","template.html"),null);
  assert.equal(getTemplateFile("2026-10-19.faq.v1","bundle.json"),null);
});
test("real FAQ v2 uses accessible details summary without any checkbox input",()=>{
  const html=getTemplateFile("2026-11-11.faq.v2","template.html")!.body;
  assert.match(html,/<details\b/);
  assert.match(html,/<summary\b/);
  assert.doesNotMatch(html,/<input\b/i);
});
test("input checkbox and label-toggle regressions are rejected rather than visually hidden",()=>{
  assert.throws(()=>assertNoCheckboxMapping('<input type="checkbox" checked>'),/CHECKBOX_FORBIDDEN/);
  assert.throws(()=>assertNoCheckboxMapping('<input class="product-tabs__radio" hidden>'),/CHECKBOX_FORBIDDEN/);
  assert.throws(()=>assertNoCheckboxMapping('<label for="uid-faq-01">Q</label>'),/CHECKBOX_FORBIDDEN/);
});
