/** Cross-account, server-owned Onepage quality intelligence.
 * The upstream canonical Creative DNA and verified product/PDP facts remain authoritative.
 * This describes portable execution and evidence; it is NOT an image renderer or visual classifier.
 */
export const ONEPAGE_QUALITY_PACK_VERSION="uid-onepage-portable-quality/2026-11-12.v2";
export const ONEPAGE_QUALITY_PACK_DESC=
  "Read the portable, account-independent Onepage quality playbook BEFORE starting content, banner or asset work. It includes the real current reference readiness, content research and insight selection, product-to-image proof, PawfectHouse EO icons, integrated-final typography with feathered local blur, mobile recomposition, slot-specific QA and delivery gates. This is shared by ChatGPT and Web App through the same Gateway; never substitute chat memory for references. Missing verified banner/icon images means visual parity is UNVERIFIED, not PASS. The host must inspect actual PDP/reference/output pixels.";

const ONEPAGE_SCOPED_ROLES=["banner","why_you_love_it","product_details","occasion","ugc","good_to_know","faqs"] as const;

export const ONEPAGE_PORTABLE_QUALITY_RULES={
  content:{
    evidence_before_copy:["matching_live_pdp","full_gallery_and_variants","product_physical_specifications","personalization_and_included_items","real_customer_questions_and_accessible_reviews"],
    research_decision:"For collections enumerate a verified product/design pool and document uncovered SKUs; no guessed family-wide specs. Match claims to original source and exact applicable variant.",
    decision_order:["product_truth","customer_use_case","incremental_buying_value","brand_tone","short_eo_copy"],
    section_roles:{
      why_you_love_it:"Three different verifiable reasons to want/gift; emotion without product causality is insufficient.",
      product_details:"Physical construction, function and material; one verified anchor SKU/design with genuinely distinct detail proofs.",
      occasion:"Recipient/use moments tied to what product does, not generic gift occasions.",
      good_to_know:"Three concise, genuinely distinct visual/practical buying insights when supported.",
      faqs:"Choose instead of GTK only for conditional questions (inclusions, variants, ordering, compatibility), no invented answers.",
    },
    post_story_choice:"GTK versus FAQs only after source review; do not default or include both. Omit unsupported ideas rather than invent filler.",
    avoid:["repeated_gifting_praise_across_sections","generic_benefits","unverified_care_and_materials","unsupported_customization_options","promotional_prices_without_verified_source"],
    copy_rule:"Use concise naturally written US English. Product/line keyword is banner title per current Onepage content contract, with verified short support in desktop only; mobile no unsupported subtitle. Never overwrite owner-approved wording.",
  },
  imagery:{
    production_sequence:["verify_real_pdp_media_and_artworks","assign_unique_design_id_to_each_story_slot","define_one_proof_action_per_slot","choose_natural_scene_and_camera","inspect_full_resolution_product_physics","render_inside_exact_template","compare_desktop_mobile_overall"],
    human_physics:"Product is oriented for the actual user, never forced toward the camera. Real hands, gaze, joints, grip, gravity and contact come before complete artwork visibility; choose a separate over-shoulder/top-down/details shot for clarity.",
    product_identity:"Shape, printed-vs-relief depth, material, mechanism, scale, supported variants and printed artwork must match actual PDP. No invented hardware or pseudo embossed designs.",
    page_wide_variety:"Do not count background, model, crop or angle as a different product/design; use actual distinct verified design IDs across Banner/WYL/Occasion/UGC. Product Details is the single-anchor exception.",
    role_routing:{
      banner:"One believable product-caused relationship/action, with natural type-safe negative space; exact same creative identity at both aspect ratios.",
      why_you_love_it:"Demonstrate the distinct buyer benefit rather than one generic smiling hold per card.",
      product_details:"Same verified SKU and artwork; physical closeup must prove the chosen claim and work with the native UI crop/mask.",
      occasion:"Distinct practical gifting/ownership story; relevant cast and pose, natural camera angle.",
      ugc:"Casual genuine customer-phone feeling; ordinary rooms/lighting, honest skin and hand anatomy, no stock ad symmetry.",
      good_to_know:"Clear factual visual explanation, no unsupported symbolic features.",
      faqs:"Questions/answers grounded in source; no checkbox UI or fake interface controls baked into assets.",
    },
  },
  banner:{
    dimensions:{desktop:"2560x960",mobile:"720x700"},
    preferred_workflow:["verify_product_copy_and_real_scene_story","inspect_true_pfh_reference_if_approved_and_available","generate_complete_desktop_banner_including_final_typography_and_soft_blur","generate_separately_recomposed_complete_mobile_banner_including_final_typography_and_soft_blur","inspect_actual_final_desktop_mobile_pixels_and_mapping"],
    generation_mode:"single_pass_integrated_final_banner",
    local_blur:"REQUIRED: a very soft feathered local blur supporting title contrast must be fully integrated into each generated final banner. It must never form a visible flat plate, artificial wall, gradient stripe or cloudy blur patch.",
    composition:"Create a motivated real-life scene and a natural text-safe region; do not flatten a wall or push all people to one side mechanically.",
    type:"GEN INTEGRATED FINAL IMAGE with designed PawfectHouse EO typography already rendered: correct approved title, expressive hierarchy, natural brand/occasion personality, semantic line breaks, professionally composed scale/kerning and optional approved concise support. No separate typography output, generic PowerPoint title, or mechanical one-font-for-all product lines.",
    contrast:"Typography must be legible; retain a gentle localized feathered SOFT BLUR behind text as part of the integrated generated banner. Preserve photographic texture outside focal blur. Never allow obvious solid panels, gradients with cut edges, synthetic empty walls or unreadable pale text.",
    responsive:"Create complete DESKTOP and MOBILE banners separately, each with embedded final typo/blur, both sharing approved product/design, human moment, title, emotional tone and scene identity. Recompose type hierarchy and framing; never merely resize/crop a desktop banner.",
    required_visual_checks:["final_image_contains_all_typography","approved_title_spelling_exact","expressive_eo_title_scale_and_semantic_linebreak","subtle_feathered_blur_under_text","text_background_local_contrast","no_visible_solid_panel_or_fake_flat_wall","type_zone_not_over_face_or_product","natural_relationship_and_product_physics","desktop_mobile_story_parity","mobile_specific_legibility"],
  },
  icons:{
    context:"PawfectHouse Onepage Occasion glyphs; not a blanket visual rule for other brands or asset families.",
    style:{badge_shape:"simple circular badge",badge_fill:"#FBDEBE",stroke:"#924A3B",enclosed_interiors:"#FFFFFF",outside:"transparent",badge_outline:"none",gradient:"none",visual_language:"clean consistent minimal semantic glyphs"},
    first_pass_qa:["unified_optical_stroke_weight","recognizable_silhouette_at_mobile_size","plausible_anatomy_or_object_geometry","correct_white_interior_details","no_fragments_or_unnecessary_lines","no_extra_palette_or_background","each_icon_distinct_correct_semantics"],
  },
  quality_stages:{
    research:"Prove source coverage, claim applicability and exact product/variant identity.",
    content:"Audit actionable buyer value, section uniqueness and copy against evidence; content changes still require user approval.",
    materials:"Use verified product/design pool and slot-level shot/proof plan; do not claim image QC without opening the actual output.",
    overall:"Inspect rendered fixed-template full-page desktop+mobile and all source images; correct visual defects before presenting.",
    packaging:"After user's explicit approval only, package required WebP assets and one exact overall PNG; preserve provenance and avoid silent replacement.",
  },
  prohibitions:["fabricated_verified_references","self_attested_pixel_qa_as_pass","memory_only_brand_rules","camera_facing_design_over_real_use","industrial_typography_backdrop","repeated_same_artwork_for_different_story_slots","invented_personalization_or_product_parts","checkboxes_in_new_onepage_mapping"],
} as const;

function norm(value:unknown){return String(value||"").trim().toLowerCase().replace(/[^a-z0-9]/g,"")}
function list(v:unknown):any[]{return Array.isArray(v)?v:[]}
export function getOnepagePortableQualityPack(brand:string,quality?:any){
  const b=norm(brand);
  const isPfh=b==="pawfecthouse";
  const catalog=list(quality?.canonical_visual_reference_catalog);
  const refs=list(quality?.references);
  const ids=new Set<string>();
  for(const row of [...catalog,...refs]){
    if(row&&typeof row==="object"&&typeof row.id==="string")ids.add(row.id);
  }
  const selectedCount=ids.size||Math.max(catalog.length,refs.length);
  const checked=quality!==undefined&&quality!==null;
  const live={status:!checked?"REFERENCE_CATALOG_NOT_QUERIED":selectedCount>0?"REFERENCE_METADATA_PRESENT_REQUIRES_PIXEL_VERIFICATION":"NO_VERIFIED_VISUAL_STYLE_EXEMPLARS_IN_COMPILED_JOB",
    catalog_count:catalog.length,reference_count:refs.length,unique_reference_ids:ids.size,
    source:"current_compiled_creative_quality_contract",
    not_proven:"Source entries do not prove image pixels were inspected, the approval scope or that all selected assets match current brand expression.",
    effect:"Content research may continue. Do not claim visual EO parity, approved reference use or final image QA PASS until actual selected reference images and output assets are independently inspected."};
  return {
    schema_version:ONEPAGE_QUALITY_PACK_VERSION,
    source_of_truth:"canonical_active_rules_plus_server_owned_portable_execution",
    scope:"onepage-system",brand:b,
    applies_to_clients:["chatgpt_mcp","web_app","external_mcp_client"],
    account_memory_required:false,
    excludes:"No transfer of a named brand's palette/casting/typography identity into other brands without their own canonical approval.",
    active_pawfecthouse_brand_style:isPfh,
    reference_readiness:live,
    source_rule_ids:["banner.moment.v1","banner.responsive.v1","banner.type.v1","content.research.v1","content.gtk-adaptive.v1","content.product-led.v1","content.section-semantics.v1","proof.slot-brief.v1","proof.physical-truth.v1","proof.diversity.v1","proof.icon-clean.v1","proof.ui-mask.v1","workflow.approval.v1"],
    execution: {
      steps:["resolve_creative_dna_or_compile_onepage_job","read_portable_quality_pack_and_reference_status","inspect_live_product_and_actual_reference_images","map_sources_claims_designs_and_proof_slots","get_content_approval","create_and_inspect_desktop_mobile_images","bind_to_fixed_onepage_template","host_inspect_overall_and_record_qc","get_packaging_approval"],
      per_slot_evidence:["verified_source_url","product_id","design_id","claim_id","image_asset_id","role","scene_action","camera_angle","reference_id_if_verified","actual_visual_inspection_note"],
      output_provenance:["quality_pack_schema_version","upstream_quality_revision_or_hash","template_version","selected_reference_ids_and_approval_evidence","per_asset_inspection_receipts","desktop_mobile_overall_visual_review"],
      fail_closed_visual_certification: !checked || selectedCount===0,
      safe_progress:"Continue evidence-based content planning and research when verified visual exemplars are missing. Mark style parity not verified and do not claim production-ready visual quality. No speculative borrowing of reference styles.",
    },
    rules:{
      ...ONEPAGE_PORTABLE_QUALITY_RULES,
      ...(isPfh?{}:{
        banner:{...ONEPAGE_PORTABLE_QUALITY_RULES.banner,type:"Use the active target brand typography and visual voice from its own canonical Creative DNA; PawfectHouse typography personality is NOT inherited."},
        icons:{policy:"Use this brand's current canonical icon design; PawfectHouse badge tokens above are NOT inherited.",first_pass_qa:ONEPAGE_PORTABLE_QUALITY_RULES.icons.first_pass_qa},
      }),
    },
    role_names:ONEPAGE_SCOPED_ROLES,
    confirmed_references:"No fixed publicly available approved PFH reference image set is bundled by this playbook. User-provided example images and their stylistic patterns can guide an active task, but are not automatically approved canonical training. Only independently inspected selected canonical reference assets can certify visual fidelity.",
    limitation:"This Gateway does not itself generate images, evaluate visual pixel fidelity or guarantee equivalent artistic quality on different models/accounts.",
  };
}
