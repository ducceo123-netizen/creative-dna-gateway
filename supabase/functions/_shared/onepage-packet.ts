import { compileCompatibleQuality as compileCreativeQuality } from './agent-rule-quality.ts';
import { ONEPAGE_PACKAGING_CONTRACT } from './onepage-packaging.ts';
import { attachResearch, classifySource, type ResearchContext } from './product-research.ts';
import { QUALITY_COMPILER, type ResolvedDna } from './creative-quality.ts';
const assets=[
 {slot:"banner_desktop",size:"2560x960",role:"story_banner"},
 {slot:"banner_mobile",size:"720x700",role:"story_banner_responsive_pair"},
 {slot:"wyl_01",size:"732x480",role:"benefit_proof"},{slot:"wyl_02",size:"732x480",role:"benefit_proof"},{slot:"wyl_03",size:"732x480",role:"benefit_proof"},
 {slot:"detail_main",size:"950x950",role:"product_function"},
 {slot:"detail_01",size:"240x240",role:"detail_evidence"},{slot:"detail_02",size:"240x240",role:"detail_evidence"},{slot:"detail_03",size:"240x240",role:"detail_evidence"},
 {slot:"occasion_01",size:"1280x720",role:"gifting_moment"},{slot:"occasion_02",size:"1280x720",role:"gifting_moment"},
 {slot:"gtk_01",size:"300x300",role:"practical_tip"},{slot:"gtk_02",size:"300x300",role:"practical_tip"},{slot:"gtk_03",size:"300x300",role:"practical_tip"},
 {slot:"occasion_icon_01",size:"3x_UI_DISPLAY_SIZE",role:"occasion_symbol"},{slot:"occasion_icon_02",size:"3x_UI_DISPLAY_SIZE",role:"occasion_symbol"},{slot:"occasion_icon_03",size:"3x_UI_DISPLAY_SIZE",role:"occasion_symbol"},{slot:"occasion_icon_04",size:"3x_UI_DISPLAY_SIZE",role:"occasion_symbol"},
 {slot:"ui_mapping_preview",size:"full_page",role:"assembly_guide"}
];

export type OnepageInput = ResearchContext & { theme?: string };
export async function buildOnepagePacket(r: ResolvedDna & { branch: NonNullable<ResolvedDna['branch']>; brand: NonNullable<ResolvedDna['brand']> }, input: OnepageInput = {}) {
 const sourceUrl=String(input.source_url||'').trim(), sourceType=String(input.source_type||'auto').trim().toLowerCase(), theme=String(input.theme||'').trim();
 if (!['auto','product','collection'].includes(sourceType)) throw new Error('Invalid source_type');
 const creative_quality_contract = await compileCreativeQuality(r,{source_url:sourceUrl});
 const ruleIds=(...keys:string[]) => creative_quality_contract.rules.filter(rule => keys.includes(rule.key)).map(rule => rule.id);
 const ruleValue=(key:string) => creative_quality_contract.rules.find(rule => rule.key===key)?.value ?? null;
 const m=r.branch.metadata||{}; const inferred=classifySource(sourceUrl, sourceType);
 const singleProduct=inferred==="product";
 const packet = {
  api_version:"2.2",mode:"compiled_job",compiler_version:creative_quality_contract.compiler_version,
  resolved:{brand:r.brand.slug,branch:r.branch.slug,dna_version:r.branch.version,creative_execution_revision:m.onepage_creative_execution_revision||null},
  dynamic_job:{source_url:sourceUrl||null,source_type:inferred,theme:theme||null,user_content_lock:"HARD_EXACT_PRESERVATION",single_product_mode:singleProduct},
  acquisition_contract:{
   source_acquisition:"HARD",inspect_actual_matching_pdps:true, source_classification:inferred==="unknown"?"REQUIRES_INSPECTION":"CLASSIFIED",
   verified_product_pool_required:true,
   min_verified_designs:inferred==="collection"?Number(m.collection_min_verified_designs||4):inferred==="product"?1:null,
   rule:singleProduct?"Exact PDP is merchandise source of truth. Product pool=1. Do not drift to neighboring products. PDP thumbnail people/pets are NOT casting references.":"If fewer valid designs exist, use all. Never invent designs. Fidelity outranks diversity.",
   diversity_gate:inferred==="collection"?"BLOCK_GENERATION_UNTIL_PASS":inferred==="product"?"N/A_BY_SINGLE_PDP":"REQUIRES_SOURCE_CLASSIFICATION",
   required_state:["matching_pdps_inspected","verified_design_count","product_pool","product_to_asset_allocation","diversity_gate"]
  },
  hard_gates:{
   product_physical_truth:"HARD_MULTI_SOURCE",content_approval:"HARD",content_to_visual_proof:"HARD",
   product_asset_allocation:"HARD",responsive_banner_pair:"HARD_SAME_CREATIVE",
   exact_dimensions:"HARD",standalone_assets:"HARD",ui_mapping_preview:"HARD",
   thumbnail_casting_bias:"FORBIDDEN_HARD",casting_diversity:"HARD",
   moment_story_interaction:"HARD",moment_product_causality:"HARD"
  },
  main_banner_contract:{
   desktop_size:"2560x960",mobile_size:"720x700",
   policy_source:"creative_quality_contract.rules",
   rule_ids:ruleIds("banner.story","banner.typography","banner.responsive"),
   note:"Creative direction, text hierarchy, allowed content and responsive composition come from active rules above, never a duplicate hardcoded policy. Dimensions remain locked to the approved template."
  },
  casting_contract:{
   policy_source:"creative_quality_contract.rules",
   rule_ids:ruleIds("brand.active_expression","brand.inheritance","proof.visual_variation","proof.occasion_story"),
   note:"Apply active brand expression and its market/casting direction. Product thumbnails establish merchandise evidence, not a casting identity lock."
  },
  single_pdp_contract:singleProduct?{
   exact_product_only:"HARD",
   visual_diversity:"HARD",
   diversify:["camera_angle","distance_crop","people_cast","pose_action","environment","pets_when_relevant"],
   verified_variant_color_diversity:"HARD_WHEN_MULTIPLE_VERIFIED",
   variant_priority:"FEATURED_THUMBNAIL_THEN_EARLY_GALLERY_THEN_VARIANT_ORDER",
   explicit_variant_lock_overrides_diversity:true,
   upload_photo_subject_diversity:"HARD_WHEN_VERIFIED",
   subject_to_design_continuity:"HARD",
   rule:"Keep exact product/design grammar while varying creative subjects and verified PDP variants. Thumbnail subject identity is never a lock."
  }:null,
  execution:["ACQUIRE_SOURCE","BUILD_VERIFIED_PRODUCT_POOL","CHECK_DIVERSITY_GATE","BUILD_CONTENT_MAP","CONTENT_APPROVAL_GATE","BUILD_ASSET_MANIFEST","ALLOCATE_PRODUCTS_VARIANTS_CAST_TO_ASSETS","GENERATE_SLOT_BY_SLOT","QA_EACH_SLOT","BUILD_UI_MAPPING_PREVIEW"],
  assets: assets.map(asset => ({...asset, ...(asset.slot.startsWith("gtk_") ? {condition:"ONLY_WHEN_GTK_SELECTED"} : {}), ...(asset.slot === "ui_mapping_preview" ? {format:ruleValue("delivery.mapping_format"),delivery_rule_ids:ruleIds("delivery.mapping_format","delivery.final_package")} : {})})),
  packaging_contract: {
    ...ONEPAGE_PACKAGING_CONTRACT,
    status: creative_quality_contract.status === "COMPILED" && ruleValue("delivery.final_package") === "WEBP_ASSETS_PLUS_ONE_PNG_MAPPING" && ruleValue("delivery.mapping_format") === "PNG" ? "READY_AFTER_EXPLICIT_APPROVAL" : "BLOCKED_INCOMPATIBLE_DELIVERY_RULES",
    delivery_rule_ids: ruleIds("delivery.final_package", "delivery.mapping_format"),
  },
  template_asset_bindings: {occasion_story_01:"occasion_01",occasion_story_02:"occasion_02",occasion_story_01_mobile:"detail_main"},
  template_binding_note:"The legacy template name occasion_story_01_mobile belongs to Product Details picture source; bind the same anchor-SKU detail_main asset there. Never replace it with a different Occasion SKU. Other slots bind by identical names.",
  context_policy:{static_dynamic_split:true,reuse_product_pool:true,reuse_product_asset_allocation:true,do_not_repeat_full_dna_per_slot:true,load_slot_relevant_rules_only:true,never_drop_hard_gates_for_token_savings:true},
  brand_expression:{inherit_brand_dna:true,differences_scope:"STYLE_MOOD_BRAND_DNA_ONLY"},
  post_story_section: {decision:ruleValue("content.post_story_section"),rule_ids:ruleIds("content.post_story_section","content.gtk_insights"),faq_template_status:"REQUIRED_NOT_YET_DEPLOYED",faq_mapping_gate:"BLOCK_MAPPING_UNTIL_VERIFIED_FAQ_VARIANT_AVAILABLE",faq_answers:"ALL_EXPANDED_FOR_REVIEW",gtk_assets:"ONLY_WHEN_GTK_SELECTED",rule:"Select using verified buyer questions, not keyword or brand defaults. Never generate placeholder GTK assets for FAQ mode."},
  angle_policy:{mode:"FEEDBACK_PROGRESSIVE",avoid_duplicate_angles:true,follow_content_and_product_geometry:true},
  instruction:"Use creative_quality_contract active scoped rules as the creative execution authority. Read owner_supplemental_contract, agent_reviewed_supplemental_contract and any agent_rule_reviewed_supplemental_contract canonical text verbatim as additional guidance, subordinate to every existing canonical rule, hard gate, safety rule and verified product fact. Stop any conflicting supplemental direction for clarification; owner acceptance does not verify output quality, and agent review covers only pinned evidence, never future output. Do not substitute account memory or superseded historical metadata. Content/typography/banner/proof quality gates are mandatory alongside technical dimensions. Reference Library examples are optional supplementary inspiration; missing examples never block creation or override active brand/product rules. Inspect any selected example before using it. Only explicit required evidence can block the affected asset stage. Human artistic review is still required."
 };

 return attachResearch({ ...packet, creative_quality_contract,
   resolved: { ...packet.resolved, quality_revision: creative_quality_contract.revision, quality_contract_hash: creative_quality_contract.contract_hash },
   rule_index_note: "Category indexes below refer to complete rules in creative_quality_contract.rules; do not reload full canonical prose or duplicate rules per slot.",
   owner_supplemental_contract: { ...creative_quality_contract.owner_supplemental_policy,
     rules: creative_quality_contract.owner_supplemental_rules },
   ...(creative_quality_contract.agent_rule_reviewed_supplemental_rules ? {agent_rule_reviewed_supplemental_contract:{...creative_quality_contract.agent_rule_reviewed_supplemental_policy,rules:creative_quality_contract.agent_rule_reviewed_supplemental_rules}} : {}),
   agent_reviewed_supplemental_contract: { ...creative_quality_contract.agent_reviewed_supplemental_policy, rules: creative_quality_contract.agent_reviewed_supplemental_rules },
   content_contract: creative_quality_contract.rules.filter(r => r.category === 'content').map(r => r.id),
   typography_contract: creative_quality_contract.rules.filter(r => r.category === 'typography').map(r => r.id),
   visual_proof_contract: creative_quality_contract.rules.filter(r => r.category === 'proof' || r.category === 'banner').map(r => r.id),
   delivery_contract: creative_quality_contract.rules.filter(r => r.category === 'delivery').map(r => r.id),
   brand_expression: { ...packet.brand_expression, rule_ids: creative_quality_contract.rules.filter(r => r.category === 'brand_style').map(r => r.id) },
   execution: ['VALIDATE_QUALITY_CONTRACT', 'READ_OWNER_SUPPLEMENTS_WITH_CANONICAL_PRECEDENCE', 'READ_AGENT_REVIEWED_SUPPLEMENTS_WITH_PINNED_EVIDENCE_SCOPE', ...packet.execution.slice(0,3), 'INSPECT_DESCRIPTIONS_AND_REVIEW_COVERAGE', 'RESEARCH_MARKETPLACE_COMPETITOR_SUPPLIER', 'RESEARCH_PINTEREST_PRODUCT_THEME_MARKET_REFERENCES', 'RESEARCH_REDDIT_CUSTOMER_CONTEXT_AND_COUNTEREVIDENCE', 'ANALYZE_BUYER_CONCERNS_AND_SCOPED_CLAIMS', 'VALIDATE_RESEARCH_BEFORE_CONTENT', 'SELECT_INCREMENTAL_CUSTOMER_VALUE', ...packet.execution.slice(3,7), 'INSPECT_PRODUCT_AND_EXPLICITLY_REQUIRED_EVIDENCE_PIXELS', ...packet.execution.slice(7)],
   readiness: creative_quality_contract.gates,
 }, {...input, require_pdp_coverage:true});
}
