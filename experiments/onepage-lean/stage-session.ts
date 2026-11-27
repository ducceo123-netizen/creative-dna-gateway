// Offline-only staged retrieval. Never import into production.
import { createHash } from "node:crypto";
import { compactOnepage, restoreOnepage } from "./lean-packet.ts";
type Packet=Record<string,any>;
const stages={
 research:["acquisition_contract","research_contract","research_validation","pinterest_contract","pinterest_validation","reddit_contract","reddit_validation","insight_value_contract","insight_value_assessment","single_pdp_contract","clipo_reference_discovery","clipo_reference_contract"],
 content:["content_contract","content_plan_contract","content_plan_assessment","content_to_materials_contract","product_line_title_contract","post_story_section","insight_value_contract","research_validation"],
 materials:["assets","main_banner_contract","casting_contract","desktop_support_typography_contract","typography_contract","visual_proof_contract","angle_policy","human_realism_reference_discovery","human_realism_qc","human_realism_execution_contract","clipo_reference_discovery","clipo_reference_contract","eo_reference_intelligence"],
 mapping:["ui_mapping_templates","template_asset_bindings","template_binding_note","template_policy_compatibility","onepage_preview_contract","post_story_section"],
 packaging:["packaging_contract","delivery_contract","assets","template_asset_bindings","onepage_preview_contract"]
} as const;
const always=["api_version","mode","compiler_version","resolved","dynamic_job","hard_gates","execution","instruction","creative_quality_contract","owner_supplemental_contract","agent_rule_reviewed_supplemental_contract","agent_reviewed_supplemental_contract","portable_quality_playbook","quality_execution_guard","readiness","brand_expression","context_policy","rule_index_note","named_product_scope"];
const known=new Set([...always,...Object.values(stages).flat(),"ui_mapping_template"]);
export function openSession(packet:Packet){
 const snapshot=structuredClone(packet);
 const hash=createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
 const compact=compactOnepage(snapshot);
 function check(revision:string){if(revision!==hash)throw new Error("Snapshot revision mismatch; restart or use verified full fallback");}
 return {
 revision:hash, stages:Object.keys(stages),
 full(revision:string){check(revision);return restoreOnepage(compact);},
 read(stage:keyof typeof stages,revision:string){
  check(revision);if(!Object.hasOwn(stages,stage))throw new Error("Unknown stage");
  const keys=new Set([...always,...stages[stage],...Object.keys(snapshot).filter(k=>!known.has(k))]);
  // Unknown fields stay visible. Canonical rules remain intact for all stages.
  const data=Object.fromEntries(Object.entries(compact.data).filter(([k])=>keys.has(k)));
  const aliases=Object.fromEntries(Object.entries(compact.aliases).filter(([k])=>keys.has(k.split(".")[0])));
  return {revision:hash,stage,data:structuredClone(data),aliases,available_paths:Object.keys(snapshot),deferred:Object.keys(snapshot).filter(k=>!keys.has(k)),instruction:"Resolve alias or deferred path via readPath before relying on it. Full fallback is mandatory if a required rule, evidence or dependency is uncertain. No step or quality gate is waived."};
 },
 readPath(path:string,revision:string){check(revision);let v:any=snapshot;for(const key of path.split(".")){if(!key||!v||typeof v!=="object"||!Object.hasOwn(v,key))throw new Error("Unknown path");v=v[key];}return structuredClone(v);}
 };
}
