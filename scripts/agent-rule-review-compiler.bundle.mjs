// supabase/functions/_shared/creative-quality.ts
var QUALITY_SCHEMA = "uid-creative-quality/1";
var QUALITY_SUPPLEMENTED_SCHEMA = "uid-creative-quality/2";
var QUALITY_AGENT_REVIEWED_SCHEMA = "uid-creative-quality/3";
var QUALITY_COMPILER = "2026-10-13-agent-supplement-v1";
var AGENT_REVIEWED_SCHEMA = "uid.agent-reviewed-supplemental-rule.v1";
var AGENT_REVIEW_EVALUATOR = "dot-agent-v1-source-media";
var AGENT_REVIEW_SCOPE = "PINNED_EVIDENCE_ONLY_NOT_FUTURE_OUTPUT_GUARANTEE";
var OWNER_SUPPLEMENTAL_SCHEMA = "uid.owner-supplemental-rule.v1";
var OWNER_SUPPLEMENTAL_PRECEDENCE = "SUPPLEMENTAL_SUBORDINATE_TO_CANONICAL_HARD_RULES_AND_PRODUCT_TRUTH";
var MAX_OWNER_SUPPLEMENTS = 16;
var QUALITY_CATALOG_SCHEMA = "uid-creative-quality-catalog/1";
var object = (v) => !!v && typeof v === "object" && !Array.isArray(v);
var text = (v, max = 1600) => typeof v === "string" && !!v.trim() && v.length <= max;
var strings = (v, max = 80) => Array.isArray(v) && v.length <= max && v.every((x) => text(x, 500));
var list = (v) => Array.isArray(v) ? v : [];
function stableJson(v) {
  if (Array.isArray(v)) return "[" + v.map(stableJson).join(",") + "]";
  if (object(v)) return "{" + Object.keys(v).sort().filter((k) => v[k] !== void 0).map((k) => JSON.stringify(k) + ":" + stableJson(v[k])).join(",") + "}";
  return JSON.stringify(v) ?? "null";
}
async function sha256(v) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)))].map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function sourceHashes(dna) {
  const hash3 = async (node) => {
    const { creative_quality_contract: _contract, ...metadata } = node?.metadata || {};
    return sha256(stableJson({ slug: node?.slug ?? null, version: node?.version ?? null, content_md: node?.content_md ?? "", metadata }));
  };
  return { branch: await hash3(dna.branch), brand_dna: await hash3(dna.brand_dna) };
}
function normalizeUrl(value) {
  try {
    const u = new URL(value || "");
    if (u.protocol !== "https:" || u.username || u.password) return null;
    return u.origin + u.pathname.replace(/\/+$/, "");
  } catch {
    return null;
  }
}
function scopeValid(s) {
  return object(s) && strings(s.brands) && !!s.brands.length && strings(s.branches) && !!s.branches.length && (s.product_urls === void 0 || strings(s.product_urls) && !!s.product_urls.length && s.product_urls.every((u) => normalizeUrl(u)));
}
function applies(s, brand, branch, context) {
  return (s.brands.includes("*") || s.brands.includes(brand)) && (s.branches.includes("*") || s.branches.includes(branch)) && (!s.product_urls || s.product_urls.some((u) => normalizeUrl(u) === normalizeUrl(context.source_url)));
}
function narrower(a, b) {
  const subset = (x, y) => y.includes("*") || x.every((v) => y.includes(v));
  return subset(a.brands, b.brands) && subset(a.branches, b.branches) && (!b.product_urls || !!a.product_urls && a.product_urls.every((u) => b.product_urls.some((v) => normalizeUrl(u) === normalizeUrl(v))));
}
function sourceValid(s, dna) {
  if (!object(s) || !["branch", "brand_dna"].includes(s.node) || !text(s.locator, 500)) return false;
  return s.excerpt === void 0 || text(s.excerpt, 2e3) && !!dna[s.node]?.content_md?.includes(s.excerpt);
}
function ruleValid(r, dna) {
  return object(r) && text(r.id, 120) && text(r.key, 120) && text(r.instruction) && r.value !== void 0 && stableJson(r.value).length <= 2e3 && ["content", "typography", "banner", "proof", "brand_style", "delivery", "workflow"].includes(r.category) && scopeValid(r.scope) && Array.isArray(r.sources) && r.sources.length > 0 && r.sources.length <= 8 && r.sources.every((s) => sourceValid(s, dna)) && (r.supersedes === void 0 || strings(r.supersedes)) && (r.reference_ids === void 0 || strings(r.reference_ids)) && (r.required_reference_ids === void 0 || strings(r.required_reference_ids));
}
function referenceValid(r, dna) {
  return object(r) && text(r.id, 120) && text(r.role, 120) && scopeValid(r.scope) && strings(r.required_for) && (r.usage === void 0 || ["supplementary_inspiration", "required_evidence"].includes(r.usage)) && (r.usage !== "required_evidence" || r.required_for.length > 0) && (r.suggested_for === void 0 || strings(r.suggested_for)) && sourceValid(r.source, dna) && (r.asset_url === void 0 || text(r.asset_url, 2e3)) && (r.reference_id === void 0 || text(r.reference_id, 500));
}
function exactKeys(value, keys) {
  return object(value) && Object.keys(value).length === keys.length && keys.every((k) => Object.hasOwn(value, k));
}
var supplementUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
var supplementHash = (s) => typeof s === "string" && /^[0-9a-f]{64}$/.test(s);
function supplementalBodyValid(r, brand, branch) {
  if (!text(r.canonical_text, 16e3) || r.canonical_text !== r.canonical_text.trim() || /[\u0000-\u0008\u000b-\u001f]/.test(r.canonical_text) || !text(r.declared_scope, 500) || !scopeValid(r.scope) || !exactKeys(r.scope, ["brands", "branches"]) || r.scope.brands.includes("*") || r.scope.branches.includes("*") || !r.scope.brands.includes(brand) || !r.scope.branches.includes(branch) || !["STRUCTURAL", "BRAND_STYLE", "WORKFLOW"].includes(r.rule_class) || !["HIGH", "MEDIUM"].includes(r.confidence) || !exactKeys(r.source, ["node", "locator", "canonical_text_hash"]) || r.source.node !== "branch" || !supplementHash(r.source.canonical_text_hash) || !exactKeys(r.accepted_source_hashes, ["branch", "brand_dna"]) || !supplementHash(r.accepted_source_hashes.branch) || !supplementHash(r.accepted_source_hashes.brand_dna) || r.precedence !== OWNER_SUPPLEMENTAL_PRECEDENCE) return false;
  const headings = ["Generalized Rule", "Expected Behavior", "Reject Conditions", "Scope", "Rule Class", "Confidence"];
  const sections = [...r.canonical_text.matchAll(/^## ([^\n]+)\n/gm)];
  if (sections.length !== 6 || sections[0].index !== 0 || sections.some((m, i) => m[1] !== headings[i])) return false;
  const contents = sections.map((m, i) => r.canonical_text.slice(m.index + m[0].length, sections[i + 1]?.index ?? r.canonical_text.length).trim());
  return contents.every((v) => v && !/^#{1,6}\s/m.test(v) && !/```|~~~/m.test(v)) && contents.slice(0, 3).every((v) => v.length <= 4e3) && contents[2].split("\n").length <= 12 && contents[2].split("\n").every((v) => /^- \S/.test(v) && v.length <= 802) && contents[3] === r.declared_scope && contents[4] === r.rule_class && contents[5] === r.confidence;
}
function ownerSupplementalShapeValid(r, brand, branch) {
  return object(r) && exactKeys(r, ["schema_version", "id", "proposal_id", "decision_kind", "canonical_text", "declared_scope", "scope", "rule_class", "confidence", "source", "accepted_source_hashes", "precedence", "semantic_consistency", "visual_qc_performed"]) && r.schema_version === OWNER_SUPPLEMENTAL_SCHEMA && supplementUuid.test(r.proposal_id) && r.id === "owner:" + r.proposal_id && r.decision_kind === "owner_direct_rule" && r.source?.locator === "owner-rule:" + r.proposal_id && r.semantic_consistency === "NOT_PROVEN_BY_DETERMINISTIC_CHECKS" && r.visual_qc_performed === false && supplementalBodyValid(r, brand, branch);
}
function agentReviewedSupplementalShapeValid(r, brand, branch) {
  return object(r) && exactKeys(r, ["schema_version", "id", "proposal_id", "request_id", "attempt_id", "decision_kind", "evaluator_version", "snapshot_hash", "review_hash", "review_scope", "canonical_text", "declared_scope", "scope", "rule_class", "confidence", "source", "accepted_source_hashes", "precedence"]) && r.schema_version === AGENT_REVIEWED_SCHEMA && supplementUuid.test(r.proposal_id) && supplementUuid.test(r.request_id) && typeof r.attempt_id === "string" && new RegExp("^" + r.request_id + ":[1-9][0-9]{0,8}$").test(r.attempt_id) && r.id === "agent-review:" + r.attempt_id && r.decision_kind === "owner_approved_agent_review" && r.evaluator_version === AGENT_REVIEW_EVALUATOR && typeof r.snapshot_hash === "string" && /^sha256:[0-9a-f]{64}$/.test(r.snapshot_hash) && supplementHash(r.review_hash) && r.review_scope === AGENT_REVIEW_SCOPE && r.source?.locator === "agent-review:" + r.proposal_id + ":" + r.attempt_id && supplementalBodyValid(r, brand, branch);
}
function usableAssetUrl(value) {
  try {
    const u = new URL(value || "");
    return u.protocol === "https:" && !u.username && !u.password && !u.search && !u.hash && !/(^|\.)(chatgpt\.com|openai\.com|localhost)$/.test(u.hostname) && !/^(\[|\d{1,3}(\.\d{1,3}){3}$)/.test(u.hostname) ? u.href : null;
  } catch {
    return null;
  }
}
async function compileCreativeQuality(dna, context = {}) {
  const brand = String(dna.brand?.slug || ""), branch = String(dna.branch?.slug || "");
  const hashes = await sourceHashes(dna);
  const stored = dna.branch?.metadata?.creative_quality_contract;
  const errors = [];
  const isCatalog = object(stored) && stored.schema_version === QUALITY_CATALOG_SCHEMA;
  const catalogValid = isCatalog && object(stored.contracts) && Object.keys(stored.contracts).length <= 16;
  const raw = isCatalog ? catalogValid && Object.hasOwn(stored.contracts, brand) ? stored.contracts[brand] : void 0 : stored;
  if (isCatalog && (!catalogValid || !Object.hasOwn(stored.contracts, brand))) errors.push("BRAND_CONTRACT_MISSING");
  let bundle = null;
  if (!object(raw)) errors.push("QUALITY_CONTRACT_MISSING");
  else if (![QUALITY_SCHEMA, QUALITY_SUPPLEMENTED_SCHEMA, QUALITY_AGENT_REVIEWED_SCHEMA].includes(raw.schema_version) || !text(raw.revision, 120) || !object(raw.source_hashes) || !Array.isArray(raw.rules) || !raw.rules.length || raw.rules.length > 80 || !Array.isArray(raw.references) || raw.references.length > 48 || stableJson(raw).length > 1e5 || !raw.rules.every((r) => ruleValid(r, dna)) || !raw.references.every((r) => referenceValid(r, dna))) errors.push("QUALITY_CONTRACT_INVALID");
  else bundle = raw;
  if (bundle && (bundle.source_hashes.branch !== hashes.branch || bundle.source_hashes.brand_dna !== hashes.brand_dna)) errors.push("QUALITY_CONTRACT_STALE");
  const rawSupplemental = bundle?.owner_supplemental_rules;
  const rawAgentSupplemental = bundle?.agent_reviewed_supplemental_rules;
  if (bundle && (bundle.schema_version === QUALITY_SCHEMA && (rawSupplemental !== void 0 || rawAgentSupplemental !== void 0) || bundle.schema_version === QUALITY_SUPPLEMENTED_SCHEMA && (!Array.isArray(rawSupplemental) || !rawSupplemental.length || rawAgentSupplemental !== void 0)))
    errors.push("OWNER_SUPPLEMENTAL_SCHEMA_INVALID");
  if (bundle?.schema_version === QUALITY_AGENT_REVIEWED_SCHEMA && (!Array.isArray(rawAgentSupplemental) || !rawAgentSupplemental.length))
    errors.push("AGENT_SUPPLEMENTAL_SCHEMA_INVALID");
  const supplements = Array.isArray(rawSupplemental) ? rawSupplemental : [];
  const agentSupplements = Array.isArray(rawAgentSupplemental) ? rawAgentSupplemental : [];
  if (rawSupplemental !== void 0 && (!Array.isArray(rawSupplemental) || rawSupplemental.length > MAX_OWNER_SUPPLEMENTS || !supplements.every((r) => ownerSupplementalShapeValid(r, brand, branch)))) errors.push("OWNER_SUPPLEMENTAL_INVALID");
  if (rawAgentSupplemental !== void 0 && (!Array.isArray(rawAgentSupplemental) || rawAgentSupplemental.length > MAX_OWNER_SUPPLEMENTS || !agentSupplements.every((r) => agentReviewedSupplementalShapeValid(r, brand, branch)))) errors.push("AGENT_SUPPLEMENTAL_INVALID");
  if (supplements.length + agentSupplements.length > MAX_OWNER_SUPPLEMENTS) errors.push("SUPPLEMENTAL_CAPACITY_EXCEEDED");
  if (new Set(supplements.map((r) => r?.id)).size !== supplements.length) errors.push("DUPLICATE_OWNER_SUPPLEMENTAL_IDS");
  if (new Set(agentSupplements.map((r) => r?.id)).size !== agentSupplements.length) errors.push("DUPLICATE_AGENT_SUPPLEMENTAL_IDS");
  if (new Set([...supplements, ...agentSupplements].map((r) => r?.proposal_id)).size !== supplements.length + agentSupplements.length)
    errors.push("DUPLICATE_SUPPLEMENT_PROPOSALS");
  for (const supplement of supplements) if (ownerSupplementalShapeValid(supplement, brand, branch)) {
    if (supplement.source.canonical_text_hash !== await sha256(supplement.canonical_text)) errors.push("OWNER_SUPPLEMENTAL_HASH_MISMATCH");
    if (!dna.branch?.content_md?.includes(supplement.canonical_text)) errors.push("OWNER_SUPPLEMENTAL_SOURCE_DRIFT");
  }
  for (const supplement of agentSupplements) if (agentReviewedSupplementalShapeValid(supplement, brand, branch)) {
    if (supplement.source.canonical_text_hash !== await sha256(supplement.canonical_text)) errors.push("AGENT_SUPPLEMENTAL_HASH_MISMATCH");
    if (!dna.branch?.content_md?.includes(supplement.canonical_text)) errors.push("AGENT_SUPPLEMENTAL_SOURCE_DRIFT");
  }
  const allRules = bundle?.rules || [];
  if (new Set(allRules.map((r) => r.id)).size !== allRules.length) errors.push("DUPLICATE_RULE_IDS");
  const candidates = allRules.filter((r) => applies(r.scope, brand, branch, context));
  const superseded = /* @__PURE__ */ new Set();
  for (const r of candidates) for (const target of r.supersedes || []) {
    const prior = allRules.find((p) => p.id === target);
    if (!prior || prior.id === r.id || prior.key !== r.key || !narrower(r.scope, prior.scope)) errors.push(`INVALID_SUPERSESSION:${r.id}:${target}`);
    else if (candidates.some((p) => p.id === target)) superseded.add(target);
  }
  const visiting = /* @__PURE__ */ new Set(), visited = /* @__PURE__ */ new Set();
  const cyclic = (id) => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    if ((allRules.find((r) => r.id === id)?.supersedes || []).some(cyclic)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  if (allRules.some((r) => cyclic(r.id))) errors.push("SUPERSESSION_CYCLE");
  const rules = candidates.filter((r) => !superseded.has(r.id)).sort((a, b) => a.id.localeCompare(b.id));
  const byKey = /* @__PURE__ */ new Map();
  for (const r of rules) {
    const prior = byKey.get(r.key);
    if (prior && stableJson({ value: prior.value, instruction: prior.instruction }) !== stableJson({ value: r.value, instruction: r.instruction })) errors.push(`UNRESOLVED_RULE_CONFLICT:${r.key}`);
    byKey.set(r.key, r);
  }
  if (bundle && !rules.length) errors.push("NO_APPLICABLE_RULES");
  if (bundle && !rules.some((r) => r.category === "brand_style" && r.key === "brand.active_expression" && r.scope.brands.includes(brand) && !r.scope.brands.includes("*") && r.sources.some((source) => source.node === "brand_dna"))) errors.push("BRAND_STYLE_NOT_COMPILED");
  if (bundle && branch === "onepage-system") {
    for (const category of ["content", "typography", "banner", "proof", "delivery", "workflow"])
      if (!rules.some((r) => r.category === category)) errors.push(`QUALITY_CATEGORY_MISSING:${category}`);
  }
  const refCandidates = (bundle?.references || []).filter((r) => applies(r.scope, brand, branch, context));
  if (new Set((bundle?.references || []).map((r) => r.id)).size !== (bundle?.references.length || 0)) errors.push("DUPLICATE_REFERENCE_IDS");
  const allCanonicalReferences = list(dna.visual_references).filter(object);
  const canonicalReferences = allCanonicalReferences.filter((r) => ["approved", "reference"].includes(r.status));
  const references = refCandidates.map((r) => {
    const canonical2 = allCanonicalReferences.find((e) => e.id === r.id || !!r.reference_id && (e.id === r.reference_id || e.metadata?.reference_id === r.reference_id));
    const revoked = canonical2 && !["approved", "reference"].includes(canonical2.status);
    const asset_url = revoked ? null : usableAssetUrl(canonical2?.asset_url) || usableAssetUrl(r.asset_url);
    const usage = r.usage ?? "supplementary_inspiration";
    return {
      ...r,
      usage,
      required_for: usage === "required_evidence" ? r.required_for : [],
      suggested_for: [.../* @__PURE__ */ new Set([...r.suggested_for || [], ...usage === "supplementary_inspiration" ? r.required_for : []])].sort(),
      asset_url,
      availability: asset_url ? usage === "required_evidence" ? "FETCH_REQUIRED" : "FETCH_IF_SELECTED" : "UNAVAILABLE",
      pixel_inspection: "NOT_INSPECTED"
    };
  });
  for (const r of rules) for (const id of r.required_reference_ids || [])
    if (!references.some((ref) => ref.id === id && ref.usage === "required_evidence")) errors.push(`REQUIRED_REFERENCE_UNRESOLVED:${id}`);
  const requiredReferences = references.filter((r) => r.usage === "required_evidence");
  const unresolved = requiredReferences.filter((r) => r.availability === "UNAVAILABLE").map((r) => r.id);
  const contentReady = errors.length === 0;
  const contract = {
    schema_version: QUALITY_SCHEMA,
    compiler_version: QUALITY_COMPILER,
    revision: bundle?.revision ?? null,
    route: { brand, branch },
    source_hashes: hashes,
    status: contentReady ? "COMPILED" : "BLOCKED",
    errors: [...new Set(errors)].sort(),
    rules: contentReady ? rules : [],
    owner_supplemental_rules: contentReady ? [...supplements].sort((a, b) => a.id.localeCompare(b.id)) : [],
    owner_supplemental_policy: {
      layer: "OWNER_APPROVED_VERBATIM_SUPPLEMENT",
      precedence: OWNER_SUPPLEMENTAL_PRECEDENCE,
      semantic_consistency: "NOT_PROVEN_BY_DETERMINISTIC_CHECKS",
      visual_qc_performed: false,
      instruction: "Read the applicable owner-approved supplemental canonical text verbatim alongside the active catalog. This layer adds guidance only; it never replaces or supersedes existing catalog rules, hard gates, verified product truth, safety or scoped brand expression. If supplemental prose conflicts with any of those, keep the hard canonical requirement and stop the conflicting part for clarification. Owner acceptance is not image QC or proof of semantic consistency."
    },
    agent_reviewed_supplemental_rules: contentReady ? [...agentSupplements].sort((a, b) => a.id.localeCompare(b.id)) : [],
    agent_reviewed_supplemental_policy: {
      layer: "OWNER_APPROVED_AGENT_REVIEWED_VERBATIM_SUPPLEMENT",
      precedence: OWNER_SUPPLEMENTAL_PRECEDENCE,
      review_scope: AGENT_REVIEW_SCOPE,
      instruction: "Read agent-reviewed supplemental canonical text verbatim alongside active catalog rules. Its provenance refers only to the exact pinned evidence reviewed for that request and attempt, never future generated output. Preserve all current product-truth, safety, hard gates and scoped brand-expression requirements. Stop conflicting directions for clarification. Deterministic compilation does not inspect media or certify quality."
    },
    superseded_rule_ids: [...superseded].sort(),
    references,
    canonical_visual_reference_catalog: canonicalReferences.map((r) => ({ id: r.id, material_type: r.material_type, status: r.status, usage: "supplementary_inspiration", asset_url: usableAssetUrl(r.asset_url), pixel_inspection: "NOT_INSPECTED" })),
    reference_library_policy: {
      usage: "OPTIONAL_SUPPLEMENTARY_INSPIRATION",
      fixed_seed_set_required: false,
      empty_library_blocks_generation: false,
      overrides_active_brand_or_product_rules: false,
      inspect_selected_images_before_use: true
    },
    reference_gate: { status: unresolved.length ? "BLOCKED_MISSING_REFERENCES" : requiredReferences.length ? "PIXEL_INSPECTION_REQUIRED" : "NO_REQUIRED_STYLE_REFERENCES", missing_reference_ids: unresolved, blocked_asset_slots: [...new Set(references.filter((r) => unresolved.includes(r.id)).flatMap((r) => r.required_for))].sort() },
    gates: {
      content_authoring: contentReady ? "READY_WITH_SOURCE_RESEARCH" : "BLOCKED",
      asset_generation: !contentReady || unresolved.length ? "BLOCKED" : requiredReferences.length ? "REQUIRES_PRODUCT_AND_REFERENCE_PIXEL_INSPECTION" : "REQUIRES_PRODUCT_PIXEL_INSPECTION",
      human_artistic_review: "REQUIRED",
      identical_pixels_guaranteed: false
    },
    provenance: {
      source: "approved_canonical_metadata",
      account_independent: true,
      canonical_branch_version: dna.branch?.version ?? null,
      canonical_brand_version: dna.brand_dna?.version ?? null,
      legacy_library_pointer_count: new Set((String(dna.branch?.content_md || "") + String(dna.brand_dna?.content_md || "")).match(/libfile_[a-zA-Z0-9]+/g) || []).size,
      visual_reference_set_hash: await sha256(stableJson(dna.visual_references || []))
    },
    instruction: "Apply active scoped rules and the explicitly emitted owner-approved and agent-reviewed verbatim supplemental layers. Supplements are subordinate to the active canonical catalog, hard gates, safety and verified product truth; stop conflicting supplemental directions for clarification. Never infer image QC from owner acceptance. Superseded historical prose and metadata do not override this contract. Verify current PDP facts before content. Reference Library images and legacy reference_ids are optional supplementary inspiration, never fixed seeds, universal style or product evidence. An empty library or unavailable inspiration does not block creation. Follow active brand/product rules and inspect current product evidence before assets. Inspect any inspiration actually selected before using it; otherwise omit it. Only explicitly scoped required_evidence references and required_reference_ids may add an evidence gate; fetch and inspect their pixels. URLs/IDs alone are not visual verification. Stop the affected stage and name missing evidence, stale contract or rule conflict. No silent fallback to account memory. Human review is required for artistic quality; a matching policy hash is not an identical-output guarantee."
  };
  return { ...contract, contract_hash: await sha256(stableJson(contract)) };
}

// supabase/functions/_shared/owner-rule-plan.ts
var OWNER_RULE_PLAN_SCHEMA = "uid.owner-rule-plan.v1";
var HEADINGS = ["Generalized Rule", "Expected Behavior", "Reject Conditions", "Scope", "Rule Class", "Confidence"];
var UNCOMPILED_LEAF_BRANCHES = /* @__PURE__ */ new Set(["ldp-system", "home-hero", "ldp-hero", "ugc-image", "recipient-image", "seasonal-banner", "shop-by-product-image", "shop-by-categories", "niche-product-combo"]);
var PlanError = class extends Error {
  constructor(code, message, next_action) {
    super(message);
    this.code = code;
    this.next_action = next_action;
  }
};
var object2 = (v) => !!v && typeof v === "object" && !Array.isArray(v);
var string = (v, max = 1e6) => typeof v === "string" && v.length > 0 && v.length <= max;
var equal = (a, b) => stableJson(a) === stableJson(b);
var fail = (code, message, next_action) => {
  throw new PlanError(code, message, next_action);
};
var clone = (v) => JSON.parse(stableJson(v));
var slug = (v) => typeof v === "string" && /^[a-z0-9][a-z0-9-]{0,79}$/.test(v);
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
var normalizeOwnerRuleText = (s) => s.trim().toLowerCase().replace(/[ \t\r\n]+/g, " ");
function parseCanonicalOwnerRule(value) {
  if (!string(value, 16e3) || value !== value.trim() || value.includes("\r") || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))
    fail("invalid_canonical_rule", "Use the exact bounded six-heading canonical rule format.");
  const input = value;
  const matches = [...input.matchAll(/^## ([^\n]+)\n/gm)];
  if (matches.length !== HEADINGS.length || matches[0]?.index !== 0 || matches.some((m, i) => m[1] !== HEADINGS[i]))
    fail("invalid_canonical_headings", "Expected each canonical heading exactly once, in the documented order.");
  const values = matches.map((match, i) => input.slice(match.index + match[0].length, matches[i + 1]?.index ?? input.length).trim());
  if (values.some((v) => !v || /^#{1,6}\s/m.test(v) || /```|~~~/m.test(v)))
    fail("invalid_canonical_sections", "Every canonical section must contain plain rule text, without nested headings or code blocks.");
  const [generalized_rule, expected_behavior, reject_conditions, scope, rule_class, confidence] = values;
  if ([generalized_rule, expected_behavior, reject_conditions].some((v) => v.length > 4e3) || scope.length > 500)
    fail("rule_text_too_long", "Each canonical rule section must fit 4,000 characters and scope must fit 500; no text is truncated.");
  const rejects = reject_conditions.split("\n");
  if (rejects.length > 12 || rejects.some((v) => !/^- \S/.test(v) || v.length > 802))
    fail("invalid_reject_conditions", "Reject Conditions must have one to twelve nonempty bullet lines, each at most 800 characters.");
  if (!["STRUCTURAL", "BRAND_STYLE", "WORKFLOW"].includes(rule_class))
    fail("unsupported_rule_class", "The supplemental rule needs an explicitly supported creative rule class.");
  if (!["HIGH", "MEDIUM"].includes(confidence))
    fail("uncertain_rule", "The canonical rule needs HIGH or MEDIUM confidence before owner acceptance.");
  if (rejects.some((v) => [generalized_rule, expected_behavior].some((x) => normalizeOwnerRuleText(x) === normalizeOwnerRuleText(v.slice(2)))))
    fail("self_conflicting_rule", "The rule requires and rejects the same exact behavior.");
  return { generalized_rule, expected_behavior, reject_conditions, scope, rule_class, confidence };
}
function metadataForMirror(master, brandName) {
  return {
    ...clone(master),
    active_brand: brandName,
    onepage_master_brand: "PawfectHouse",
    onepage_sync_mode: "PAWFECTHOUSE_MASTER_100_PERCENT",
    cross_brand_onepage_structure: "IDENTICAL_HARD",
    brand_difference_scope: "BRAND_DNA_EXPRESSION_ONLY"
  };
}
function validateNode(node, kind) {
  if (!object2(node) || !string(node.id, 120) || !string(node.brand_id, 120) || !slug(node.slug) || !string(node.version, 120) || typeof node.content_md !== "string" || node.content_md.length > 1e6 || !object2(node.metadata) || !string(node.status, 80) || !Object.hasOwn(node, "input_schema") || !Object.hasOwn(node, "confidence")) fail("invalid_source_node", `Invalid ${kind} source node snapshot.`);
}
function dnaFor(node, brand, dna) {
  return { brand: { slug: brand.slug }, branch: node, brand_dna: dna, visual_references: [] };
}
function checkDirectOpposites(rule, nodes) {
  const clauses = (rule.generalized_rule + "\n" + rule.expected_behavior).split(/[\n.]/).map(normalizeOwnerRuleText).filter((v) => v.length >= 12);
  for (const node of nodes) {
    const stored = node.metadata.creative_quality_contract;
    const bundles = stored?.schema_version === QUALITY_CATALOG_SCHEMA && object2(stored.contracts) ? Object.values(stored.contracts) : [stored];
    const prior = [node.content_md, ...bundles.flatMap((b) => Array.isArray(b?.rules) ? b.rules.map((r) => String(r.instruction || "")) : [])].flatMap((v) => String(v).split(/[\n.]/)).map((v) => normalizeOwnerRuleText(v.replace(/^[#* -]+/, ""))).filter(Boolean);
    for (const clause of clauses) for (const old of prior) for (const prefix of ["never ", "do not ", "must not ", "kh\xF4ng "]) {
      if (old === prefix + clause || clause === prefix + old)
        fail("canonical_conflict", "A proposed clause directly negates existing canonical guidance; resolve the exact conflict before adding it.");
    }
  }
}
async function prepareCanonicalRuleProjection(snapshot) {
  if (!object2(snapshot) || !object2(snapshot.proposal) || !object2(snapshot.scope) || !object2(snapshot.compiler_context) || !string(snapshot.candidate_hash, 300))
    fail("compiler_snapshot_required", "An exact server-generated proposal, scope and compiler snapshot is required.");
  const s = snapshot, p = s.proposal, scope = s.scope, context = s.compiler_context;
  if (!UUID.test(p.id || "") || p.status !== "pending" || p.merged_at != null)
    fail("pending_proposal_required", "A valid pending unmerged proposal is required.");
  const canonical2 = typeof p.proposed_content_md === "string" ? p.proposed_content_md.trim() : p.proposed_content_md;
  const rule = parseCanonicalOwnerRule(canonical2);
  if (rule.scope !== p.proposed_scope || scope.proposed_scope !== p.proposed_scope)
    fail("scope_mismatch", "Canonical, proposal and target scopes differ.");
  if (context.policy_version !== OWNER_RULE_PLAN_SCHEMA || !Array.isArray(s.targets) || !s.targets.length || s.targets.length > 16 || !Array.isArray(context.projected_targets) || context.projected_targets.length !== s.targets.length || !Array.isArray(context.brands) || !Array.isArray(context.brand_dna_nodes))
    fail("compiler_snapshot_invalid", "The compiler snapshot lacks bounded exact target projections or brand sources.");
  const targets = clone(s.targets).sort((a, b) => a.id.localeCompare(b.id));
  const projected = clone(context.projected_targets).sort((a, b) => a.id.localeCompare(b.id));
  targets.forEach((n) => validateNode(n, "branch"));
  projected.forEach((n) => validateNode(n, "projected branch"));
  if (new Set(targets.map((n) => n.id)).size !== targets.length || !equal(targets.map((n) => n.id), projected.map((n) => n.id)) || !equal(targets.map((n) => n.id), [...scope.target_node_ids || []].sort()) || !slug(scope.branch_slug) || targets.some((n) => n.slug !== scope.branch_slug) || !targets.some((n) => n.id === p.knowledge_node_id) || scope.source_node_id !== p.knowledge_node_id)
    fail("target_scope_mismatch", "The source, exact target membership or branch scope changed.");
  if (!["onepage-system", "ldp-system", "home-hero", "ldp-hero", "ugc-image", "recipient-image", "seasonal-banner", "shop-by-product-image", "shop-by-categories", "niche-product-combo"].includes(scope.branch_slug))
    fail("unsupported_branch", "Only a supported canonical leaf or the verified structural Onepage closure can receive this plan.");
  const isOnepage = scope.branch_slug === "onepage-system";
  if (isOnepage && (scope.cross_brand !== true || scope.structural !== true))
    fail("onepage_mirror_scope", "Onepage master/mirror triggers do not permit an isolated brand update.");
  const brands = targets.map((n) => {
    const matches = context.brands.filter((b) => b.id === n.brand_id);
    if (matches.length !== 1 || !slug(matches[0].slug) || !string(matches[0].name, 500) || n.brand_slug !== matches[0].slug || n.brand_name !== matches[0].name)
      fail("brand_source_missing", "Every target needs its exact, unambiguous current brand identity.");
    return matches[0];
  });
  if (new Set(brands.map((b) => b.slug)).size !== brands.length)
    fail("duplicate_brand_target", "Multiple target branches for the same brand need an explicit projection policy.");
  const brandSlugs = brands.map((b) => b.slug).sort();
  const masterIndex = isOnepage ? targets.findIndex((n) => n.id === context.master_node_id) : 0;
  if (masterIndex < 0 || isOnepage && (context.master_count !== 1 || brands[masterIndex].name.toLowerCase() !== "pawfecthouse" || targets.filter((_, i) => brands[i].name.toLowerCase() === "pawfecthouse").length !== 1 || brands.some((b) => !["pawfecthouse", "giftsoul", "soulprise"].includes(b.name.toLowerCase()))))
    fail("onepage_master_invalid", "Onepage requires one verified PawfectHouse master and the actual supported mirrors.");
  const master = targets[masterIndex];
  const block = context.merge_block_text;
  if (typeof block !== "string" || !block.startsWith("\n\n## ACCEPTED ADMIN FEEDBACK \u2014 ") || !/^\n\n## ACCEPTED ADMIN FEEDBACK — \d{4}-\d{2}-\d{2}\n/.test(block) || block !== block.slice(0, block.indexOf("\n", 3) + 1) + canonical2 + "\n")
    fail("merge_projection_invalid", "The SQL merge block is not bound to the exact canonical rule and UTC merge date.");
  const nextContent = (n) => n.content_md.includes(canonical2) ? n.content_md : n.content_md + block;
  const catalogCount = s.targets.filter((n) => Object.hasOwn(n.metadata, "creative_quality_contract")).length;
  if (!isOnepage && catalogCount > 0 && catalogCount < targets.length)
    fail(
      "mixed_quality_scope",
      "Ph\u1EA1m vi n\xE0y c\xF3 c\u1EA3 nh\xE1nh \u0111\xE3 c\xF3 quality contract v\xE0 nh\xE1nh ch\u01B0a c\xF3 contract.",
      "T\xE1ch ph\u1EA1m vi th\xE0nh c\xE1c nh\xF3m \u0111\u1ED3ng nh\u1EA5t ho\u1EB7c chu\u1EA9n b\u1ECB b\u1EA3n c\u1EADp nh\u1EADt bao g\u1ED3m \u0111\u1EA7y \u0111\u1EE7 contract v\xE0 c\xE1c nh\xE1nh ph\u1EE5 thu\u1ED9c."
    );
  const canonicalAppend = !isOnepage && catalogCount === 0;
  if (canonicalAppend) {
    if (!UNCOMPILED_LEAF_BRANCHES.has(scope.branch_slug))
      fail(
        "unsupported_branch",
        "Nh\xE1nh n\xE0y ch\u01B0a h\u1ED7 tr\u1EE3 th\xEAm rule canonical tr\u1EF1c ti\u1EBFp.",
        "D\xF9ng lu\u1ED3ng qu\u1EA3n tr\u1ECB c\u1EE7a nh\xE1nh n\xE0y; Brand DNA c\u1EA7n b\u1EA3n c\u1EADp nh\u1EADt bao g\u1ED3m c\xE1c nh\xE1nh ph\u1EE5 thu\u1ED9c."
      );
    if (!Array.isArray(context.dependent_nodes) || context.dependent_nodes.length || targets.some((n) => targets.some((parent) => n.parent_id === parent.id)))
      fail(
        "unsupported_dependency_scope",
        "Ch\u01B0a x\xE1c minh \u0111\u01B0\u1EE3c ph\u1EA1m vi kh\xF4ng c\xF3 nh\xE1nh con \u0111ang ho\u1EA1t \u0111\u1ED9ng ph\u1EE5 thu\u1ED9c v\xE0o thay \u0111\u1ED5i n\xE0y.",
        "T\u1EA3i l\u1EA1i ph\u1EA1m vi; n\u1EBFu c\xF3 nh\xE1nh ph\u1EE5 thu\u1ED9c, chu\u1EA9n b\u1ECB b\u1EA3n c\u1EADp nh\u1EADt bao g\u1ED3m to\xE0n b\u1ED9 c\xE1c nh\xE1nh \u0111\xF3 tr\u01B0\u1EDBc khi duy\u1EC7t."
      );
    if (typeof scope.cross_brand !== "boolean" || typeof scope.structural !== "boolean" || !scope.cross_brand && targets.length !== 1 || rule.rule_class === "BRAND_STYLE" && scope.cross_brand)
      fail("target_scope_mismatch", "The resolved leaf scope must preserve exact local or cross-brand creative-rule boundaries.");
    if (s.compiler_context.projected_targets.some((n) => Object.hasOwn(n.metadata, "creative_quality_contract")))
      fail("merge_projection_mismatch", "Canonical append cannot create a quality catalog or change its absence.");
  }
  if (!canonicalAppend && !isOnepage && (targets.length !== 1 || scope.cross_brand !== false))
    fail("unsupported_leaf_scope", "A compiled non-Onepage plan must target exactly one canonical leaf.");
  const dnas = canonicalAppend ? [] : targets.map((n) => {
    const matches = context.brand_dna_nodes.filter((d) => d.brand_id === n.brand_id);
    if (matches.length !== 1) fail("brand_dna_ambiguous", "Each target must have exactly one server-resolved latest active brand DNA source.");
    validateNode(matches[0], "brand DNA");
    if (matches[0].slug !== "brand-dna" || matches[0].status !== "active") fail("brand_dna_invalid", "The latest brand DNA source must be active.");
    return clone(matches[0]);
  });
  for (let i = 0; i < targets.length; i++) {
    const before = targets[i], after = projected[i], source = isOnepage ? master : before;
    const expectedMetadata = isOnepage && i !== masterIndex ? metadataForMirror(master.metadata, brands[i].name) : source.metadata;
    if (before.status !== "active" || before.content_md !== source.content_md || !equal(before.metadata, expectedMetadata) || ["version", "input_schema", "status", "confidence"].some((k) => !equal(before[k], source[k])))
      fail("mirror_preservation_blocked", "A target is inactive or diverges from its master; acceptance would change unrelated canonical fields.");
    if (after.brand_id !== before.brand_id || after.slug !== before.slug || after.content_md !== nextContent(source) || !equal(after.metadata, expectedMetadata) || ["version", "input_schema", "status", "confidence"].some((k) => !equal(after[k], source[k])))
      fail("merge_projection_mismatch", "The proposed SQL content, version or metadata projection does not match the supported merge behavior.");
    if (!canonicalAppend) {
      const baseline = await compileCreativeQuality(dnaFor(before, brands[i], dnas[i]));
      if (baseline.status !== "COMPILED")
        fail(
          "preexisting_quality_blocked",
          `${brands[i].slug}: quality contract hi\u1EC7n t\u1EA1i \u0111ang thi\u1EBFu, kh\xF4ng h\u1EE3p l\u1EC7 ho\u1EB7c kh\xF4ng kh\u1EDBp ngu\u1ED3n canonical.`,
          "Kh\xF4i ph\u1EE5c ho\u1EB7c c\u1EADp nh\u1EADt quality contract qua lu\u1ED3ng ki\u1EC3m tra ngu\u1ED3n hi\u1EC7n c\xF3 r\u1ED3i t\u1EA3i l\u1EA1i; kh\xF4ng b\u1ECF qua l\u1ED7i b\u1EB1ng duy\u1EC7t rule tr\u1EF1c ti\u1EBFp."
        );
    }
  }
  checkDirectOpposites(rule, targets);
  return { snapshot: s, proposal: p, scope, context, canonical: canonical2, rule, targets, projected, brands, brandSlugs, master, isOnepage, dnas, canonicalAppend };
}

// supabase/functions/_shared/agent-rule-policy.ts
var RULE_REVIEW_MODE = "agent_rule_review";
var RULE_REVIEW_SCOPE = "RULE_SEMANTICS_AND_COMPILATION_NOT_OUTPUT_QC";
var RULE_REVIEW_EVALUATOR = "dot-agent-v3-rule-semantics";
var RULE_COMPILER = "2026-10-15-agent-rule-pilot-v1";
var PILOT_SCOPE = "STRUCTURAL shared Onepage: PawfectHouse, GiftSoul, SoulPrise; brand expression and verified product truth remain unchanged.";
var PILOT_BRANDS = ["giftsoul", "pawfecthouse", "soulprise"];
var canonical = (rule, behavior, reject) => `## Generalized Rule
${rule}

## Expected Behavior
${behavior}

## Reject Conditions
${reject.map((x) => "- " + x).join("\n")}

## Scope
${PILOT_SCOPE}

## Rule Class
STRUCTURAL

## Confidence
HIGH`;
var PILOT_RULES = Object.freeze({
  "onepage.distinct-product-design.v1": canonical(
    "Plan product and design diversity across non-Product-Details Onepage assets using verified products relevant to the brief. Product Details preserves its one exact product anchor.",
    "Before generation, allocate each product-bearing asset to its verified product URL, SKU, variant and evidence-backed design family. Record its section, responsive creative group and any reuse reason. Prefer relevant unused verified products and designs across non-PD groups when available. Desktop/mobile versions of one creative count as one selection. Changes to personalization names, uploaded photos, sizes, angles or backgrounds alone do not establish a distinct design family. Keep the Product Details quartet on one exact SKU, design, variant and construction; exclude this intentional repetition from non-PD diversity counts. Report unique products/design families and repeated selections with evidence-backed reasons. Inspect generated assets against the allocation before claiming visual compliance. If the verified pool is insufficient, report that limitation without inventing products or specifications. Preserve single-product task scope; do not force product imagery into text-only or icon-only sections.",
    ["Unexplained repeated product/design selection when a relevant verified unused choice exists.", "Counting responsive pairs or personalization-only changes as new designs.", "Breaking the PD anchor or importing another product into a single-product task.", "Claiming image QC from an allocation table or inventing products to meet a quota."]
  ),
  "onepage.banner-product-keyword.v1": canonical(
    "In Onepage banners, the approved product-line keyword is the primary typographic focus, ahead of supporting copy.",
    "Use the verified, approved product-line wording as the strongest text emphasis through hierarchy, size, weight, contrast and placement, consistent with the active brand design system. Keep supporting text subordinate and readable on both desktop and mobile. Preserve product truth, approved copy and layout safety; do not add unsupported claims. Inspect the rendered banner before claiming visual compliance.",
    ["Supporting copy visually dominates the product-line keyword.", "Invented product wording, claims or specifications.", "Claiming a rendered banner passes visual QC without inspecting it."]
  )
});

// supabase/functions/_shared/agent-rule-quality.ts
var RULE_QUALITY_SCHEMA = "uid-creative-quality/4";
var RULE_SUPPLEMENT_SCHEMA = "uid.agent-rule-reviewed-supplemental-rule.v1";
var clone2 = (x) => JSON.parse(stableJson(x));
var obj = (x) => !!x && typeof x === "object" && !Array.isArray(x);
var hash = (x) => typeof x === "string" && /^[a-f0-9]{64}$/.test(x);
function ruleSupplementValid(r, brand, branch) {
  const keys = ["schema_version", "id", "proposal_id", "request_id", "attempt_id", "decision_kind", "evaluator_version", "snapshot_hash", "review_hash", "review_scope", "canonical_text", "declared_scope", "scope", "rule_class", "confidence", "source", "accepted_source_hashes", "precedence", "visual_qc_performed"];
  if (!obj(r) || stableJson(Object.keys(r).sort()) !== stableJson(keys.sort()) || r.schema_version !== RULE_SUPPLEMENT_SCHEMA || r.decision_kind !== "agent_rule_review" || r.visual_qc_performed !== false || r.review_scope !== RULE_REVIEW_SCOPE || r.evaluator_version !== RULE_REVIEW_EVALUATOR || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(r.request_id) || r.attempt_id !== `${r.request_id}:${String(r.attempt_id).split(":")[1]}` || !/^[1-9][0-9]{0,8}$/.test(String(r.attempt_id).split(":")[1]) || r.id !== `agent-rule:${r.attempt_id}` || !/^sha256:[a-f0-9]{64}$/.test(r.snapshot_hash) || !hash(r.review_hash) || r.source?.locator !== `agent-rule:${r.proposal_id}:${r.attempt_id}`) return false;
  const { request_id, attempt_id, evaluator_version, snapshot_hash, review_hash, review_scope, ...body } = r;
  return ownerSupplementalShapeValid({
    ...body,
    schema_version: OWNER_SUPPLEMENTAL_SCHEMA,
    id: `owner:${r.proposal_id}`,
    decision_kind: "owner_direct_rule",
    source: { ...r.source, locator: `owner-rule:${r.proposal_id}` },
    semantic_consistency: "NOT_PROVEN_BY_DETERMINISTIC_CHECKS"
  }, brand, branch);
}
function stripRuleCatalog(metadata) {
  const copy = clone2(metadata);
  const stored = copy.creative_quality_contract;
  const bundles = stored?.schema_version === QUALITY_CATALOG_SCHEMA ? Object.values(stored.contracts || {}) : [stored];
  for (const b of bundles) if (b?.schema_version === RULE_QUALITY_SCHEMA) {
    delete b.agent_rule_reviewed_supplemental_rules;
    b.schema_version = b.agent_reviewed_supplemental_rules?.length ? "uid-creative-quality/3" : b.owner_supplemental_rules?.length ? "uid-creative-quality/2" : "uid-creative-quality/1";
  }
  return copy;
}
async function compileRuleQuality(dna, context = {}) {
  const stored = dna.branch?.metadata?.creative_quality_contract;
  const b = stored?.schema_version === QUALITY_CATALOG_SCHEMA ? stored.contracts?.[dna.brand?.slug] : stored;
  const raw = b?.agent_rule_reviewed_supplemental_rules;
  const rules = Array.isArray(raw) ? raw : [];
  const errors = [];
  if (b?.schema_version === RULE_QUALITY_SCHEMA && (!Array.isArray(raw) || !raw.length) || raw !== void 0 && b?.schema_version !== RULE_QUALITY_SCHEMA) errors.push("RULE_REVIEW_SCHEMA_INVALID");
  if (raw !== void 0 && (!Array.isArray(raw) || rules.length > MAX_OWNER_SUPPLEMENTS || !rules.every((r) => ruleSupplementValid(r, dna.brand?.slug, dna.branch?.slug)))) errors.push("RULE_REVIEW_SUPPLEMENT_INVALID");
  for (const key of ["owner_supplemental_rules", "agent_reviewed_supplemental_rules"]) if (b?.[key] !== void 0 && !Array.isArray(b[key])) errors.push("PRIOR_SUPPLEMENT_ARRAY_INVALID");
  const all = [...Array.isArray(b?.owner_supplemental_rules) ? b.owner_supplemental_rules : [], ...Array.isArray(b?.agent_reviewed_supplemental_rules) ? b.agent_reviewed_supplemental_rules : [], ...rules];
  if (all.length > MAX_OWNER_SUPPLEMENTS || new Set(all.map((r) => r?.proposal_id)).size !== all.length || new Set(all.map((r) => r?.id)).size !== all.length) errors.push("RULE_REVIEW_SUPPLEMENT_COLLISION");
  for (const r of rules) if (ruleSupplementValid(r, dna.brand?.slug, dna.branch?.slug)) {
    if (await sha256(r.canonical_text) !== r.source.canonical_text_hash || (typeof dna.branch?.content_md !== "string" || !dna.branch.content_md.includes(r.canonical_text))) errors.push("RULE_REVIEW_SOURCE_DRIFT");
  }
  const base = await compileCreativeQuality({ ...dna, branch: { ...dna.branch, metadata: stripRuleCatalog(dna.branch?.metadata || {}) } }, context);
  const { contract_hash: _old, ...contract } = base;
  const combined = [.../* @__PURE__ */ new Set([...base.errors, ...errors])].sort();
  const result = {
    ...contract,
    compiler_version: RULE_COMPILER,
    status: combined.length ? "BLOCKED" : "COMPILED",
    errors: combined,
    rules: combined.length ? [] : contract.rules,
    owner_supplemental_rules: combined.length ? [] : contract.owner_supplemental_rules,
    agent_reviewed_supplemental_rules: combined.length ? [] : contract.agent_reviewed_supplemental_rules,
    gates: combined.length ? { ...contract.gates, content_authoring: "BLOCKED", asset_generation: "BLOCKED" } : contract.gates,
    agent_rule_reviewed_supplemental_rules: combined.length ? [] : rules,
    agent_rule_reviewed_supplemental_policy: {
      review_scope: RULE_REVIEW_SCOPE,
      visual_qc_performed: false,
      precedence: OWNER_SUPPLEMENTAL_PRECEDENCE,
      instruction: "Apply the exact delegated rule text alongside existing hard constraints. Semantic review is scoped to its snapshot; no output, media, product claim or future generation has passed QC through this decision."
    }
  };
  return { ...result, contract_hash: await sha256(stableJson(result)) };
}

// supabase/functions/_shared/agent-rule-review-plan.ts
var object3 = (v) => !!v && typeof v === "object" && !Array.isArray(v);
var uuid = (v) => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
var hash2 = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
var clone3 = (v) => JSON.parse(stableJson(v));
var equal2 = (a, b) => stableJson(a) === stableJson(b);
var exact = (v, keys) => object3(v) && equal2(Object.keys(v).sort(), [...keys].sort());
var fail2 = (code, message) => {
  throw Object.assign(new Error(message), { code });
};
var prose = (v) => typeof v === "string" && v.trim().length >= 40 && v.length <= 4e3;
var sorted = (a) => [...a].sort();
function ruleReviewSourceRecords(context) {
  const records = [{ id: "rule-context", record: context }, ...context.targets, ...context.compiler_context.brand_dna_nodes, ...context.compiler_context.dependent_nodes];
  const map = /* @__PURE__ */ new Map();
  for (const record of records) {
    if (!object3(record) || typeof record.id !== "string") fail2("source_record_invalid", "Every canonical source needs an immutable identity.");
    if (map.has(record.id) && !equal2(map.get(record.id), record)) fail2("source_record_collision", "Repeated source identities have different records.");
    map.set(record.id, record);
  }
  return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
}
async function buildAgentRuleReviewPlan(claim, review) {
  try {
    if (!object3(claim) || !uuid(claim.request_id) || !uuid(claim.proposal_id) || !uuid(claim.owner_user_id) || !Number.isInteger(claim.lease_version) || claim.lease_version < 1 || claim.lease_version > 999999999 || claim.attempt_id !== `${claim.request_id}:${claim.lease_version}` || claim.evaluator_version !== RULE_REVIEW_EVALUATOR || !/^sha256:[a-f0-9]{64}$/.test(claim.snapshot_hash || "") || !object3(claim.snapshot)) fail2("invalid_rule_claim", "A fenced v3 rule-review claim is required.");
    const s = claim.snapshot, c = s.rule_context, intent = claim.intent, capability = s.compiler_capability;
    if (!object3(intent) || intent.schema_version !== "uid.review-intent.v3" || intent.review_mode !== RULE_REVIEW_MODE || intent.owner_user_id !== claim.owner_user_id || intent.proposal_id !== claim.proposal_id || !object3(c) || c.proposal?.id !== claim.proposal_id || c.candidate_hash !== claim.candidate_hash || s.candidate_hash !== claim.candidate_hash || intent.proposed_content_md !== c.proposal.proposed_content_md || intent.proposed_scope !== c.proposal.proposed_scope || intent.source_node_id !== c.proposal.knowledge_node_id || !equal2(intent.targets, c.targets.map((t) => ({ id: t.id, brand_id: t.brand_id, slug: t.slug })).sort((a, b) => a.id.localeCompare(b.id))))
      fail2("intent_mode_scope_mismatch", "The exact delegated v3 rule patch and target closure must match the snapshot; v2 is not upgradeable by the host.");
    if (capability?.review_mode !== RULE_REVIEW_MODE || capability?.compiler_version !== RULE_COMPILER || !hash2(capability?.compiler_bundle_hash)) fail2("compiler_capability_missing", "The server must pin the separate rule-review compiler capability.");
    const policy = s.rule_policy, op = policy?.operation;
    if (!Object.hasOwn(PILOT_RULES, op || "") || policy?.enabled !== true || intent.operation !== op || c.proposal.proposed_content_md !== PILOT_RULES[op] || c.proposal.proposed_scope !== PILOT_SCOPE || policy.canonical_sha256 !== await sha256(c.proposal.proposed_content_md) || !equal2(policy.brand_slugs, PILOT_BRANDS) || !equal2(sorted(c.targets.map((t) => t.brand_slug)), PILOT_BRANDS) || c.scope?.branch_slug !== "onepage-system" || c.scope.cross_brand !== true || c.scope.structural !== true || !equal2(policy.target_node_ids, sorted(c.targets.map((t) => t.id)))) fail2("unsupported_rule_policy", "Only an explicitly activated exact pilot operation and its complete three-brand Onepage scope may use rule-only review.");
    if (!exact(review, ["schema_version", "decision", "review_note", "source_receipts", "findings", "visual_qc_performed", "review_scope"]) || review.schema_version !== "uid.agent-rule-review.v1" || review.decision !== "passed" || !prose(review.review_note) || review.visual_qc_performed !== false || review.review_scope !== RULE_REVIEW_SCOPE || !Array.isArray(review.source_receipts) || !Array.isArray(review.findings))
      fail2("invalid_rule_review", "A genuine scoped semantic review is required; image-QC or owner-decision claims are not permitted.");
    const start = Date.parse(claim.leased_at), end = Date.parse(claim.lease_expires_at), expires = Date.parse(claim.expires_at), now = Date.now();
    if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(expires) || start > now || end <= now || end <= start || end - start > 9e5 || end > expires)
      fail2("invalid_lease_window", "A current 900-second-or-shorter fenced lease within the owner intent is required.");
    const records = ruleReviewSourceRecords(c);
    if (records.length > 128 || review.source_receipts.length !== records.length) fail2("source_coverage", "Read every exact canonical, brand DNA and dependency record in this lease.");
    for (const r of records) {
      const receipts = review.source_receipts.filter((x) => x.node_id === r.id), receipt = receipts[0];
      if (receipts.length !== 1 || !exact(receipt, ["node_id", "record_sha256", "read_at", "revalidated_at", "note"]) || receipt.record_sha256 !== await sha256(stableJson(r)) || !prose(receipt.note) || Date.parse(receipt.read_at) < start || Date.parse(receipt.revalidated_at) < Date.parse(receipt.read_at) || !Number.isFinite(Date.parse(receipt.read_at)) || !Number.isFinite(Date.parse(receipt.revalidated_at)) || Date.parse(receipt.revalidated_at) > now || Date.parse(receipt.revalidated_at) >= end)
        fail2("source_receipt_invalid", "Each source receipt must identify the actual read and revalidated immutable record within this lease.");
    }
    if (review.findings.length !== c.targets.length * 3) fail2("finding_coverage", "Every canonical target requires rule semantics, scope fidelity and canonical conflict findings.");
    const recordIds = records.map((r) => r.id);
    for (const t of c.targets) for (const criterion of ["rule_semantics", "scope_fidelity", "canonical_conflicts"]) {
      const findings = review.findings.filter((f2) => f2.node_id === t.id && f2.criterion === criterion), f = findings[0];
      if (findings.length !== 1 || !exact(f, ["node_id", "criterion", "result", "note", "source_node_ids"]) || f.result !== "passed" || !prose(f.note) || !equal2(f.source_node_ids, recordIds))
        fail2("finding_not_passed", "Each target criterion needs a genuine source-linked passed finding; uncertainty cannot pass.");
    }
    for (const t of c.targets) {
      const brand = c.compiler_context.brands.find((b) => b.id === t.brand_id), dna = c.compiler_context.brand_dna_nodes.find((d) => d.brand_id === t.brand_id);
      const result = await compileRuleQuality({ brand, branch: t, brand_dna: dna, visual_references: [] });
      if (result.status !== "COMPILED") fail2("preexisting_quality_blocked", result.errors.join(", "));
    }
    const originalCatalog = c.targets[0]?.metadata?.creative_quality_contract;
    if (!object3(originalCatalog) || c.targets.some((t) => !equal2(t.metadata?.creative_quality_contract, originalCatalog)) || c.compiler_context.projected_targets.some((t) => !equal2(t.metadata?.creative_quality_contract, originalCatalog)))
      fail2("rule_catalog_mirror_drift", "Every target and projected target must retain the identical complete prior catalog and provenance.");
    const adapted = clone3(c);
    adapted.targets.forEach((t) => {
      t.metadata = stripRuleCatalog(t.metadata);
    });
    adapted.compiler_context.projected_targets.forEach((t) => {
      t.metadata = stripRuleCatalog(t.metadata);
    });
    const p = await prepareCanonicalRuleProjection(adapted);
    if (p.canonicalAppend || !p.isOnepage) fail2("compiled_onepage_required", "Pilot rules require the existing three-brand Onepage quality catalog.");
    const originals = new Map(c.compiler_context.projected_targets.map((t) => [t.id, t]));
    p.projected.forEach((t) => {
      t.metadata = clone3(originals.get(t.id).metadata);
    });
    const masterOriginal = c.targets.find((t) => t.id === p.master.id), catalog = clone3(masterOriginal.metadata.creative_quality_contract);
    const reviewHash = await sha256(stableJson(review)), canonicalHash = await sha256(p.canonical), id = `agent-rule:${claim.attempt_id}`;
    for (let i = 0; i < p.projected.length; i++) {
      const bundle = catalog.contracts[p.brands[i].slug];
      const prior = [...bundle.owner_supplemental_rules || [], ...bundle.agent_reviewed_supplemental_rules || [], ...bundle.agent_rule_reviewed_supplemental_rules || []];
      if (prior.length >= MAX_OWNER_SUPPLEMENTS || prior.some((r) => r.proposal_id === claim.proposal_id || r.canonical_text === p.canonical)) fail2("supplement_collision", "Capacity or an existing exact rule prevents adding a second supplemental decision.");
      const hashes = await sourceHashes({ brand: p.brands[i], branch: p.projected[i], brand_dna: p.dnas[i] });
      bundle.schema_version = RULE_QUALITY_SCHEMA;
      bundle.agent_rule_reviewed_supplemental_rules = [...bundle.agent_rule_reviewed_supplemental_rules || [], {
        schema_version: RULE_SUPPLEMENT_SCHEMA,
        id,
        proposal_id: claim.proposal_id,
        request_id: claim.request_id,
        attempt_id: claim.attempt_id,
        decision_kind: RULE_REVIEW_MODE,
        evaluator_version: RULE_REVIEW_EVALUATOR,
        snapshot_hash: claim.snapshot_hash,
        review_hash: reviewHash,
        review_scope: RULE_REVIEW_SCOPE,
        visual_qc_performed: false,
        canonical_text: p.canonical,
        declared_scope: p.rule.scope,
        scope: { brands: p.brandSlugs, branches: [p.scope.branch_slug] },
        rule_class: p.rule.rule_class,
        confidence: p.rule.confidence,
        source: { node: "branch", locator: `agent-rule:${claim.proposal_id}:${claim.attempt_id}`, canonical_text_hash: canonicalHash },
        accepted_source_hashes: hashes,
        precedence: OWNER_SUPPLEMENTAL_PRECEDENCE
      }];
      bundle.source_hashes = hashes;
      bundle.revision = id;
    }
    p.projected.forEach((t) => {
      t.metadata.creative_quality_contract = clone3(catalog);
    });
    const compiled = [];
    for (let i = 0; i < p.projected.length; i++) {
      const result = await compileRuleQuality({ brand: p.brands[i], branch: p.projected[i], brand_dna: p.dnas[i], visual_references: [] });
      if (result.status !== "COMPILED" || !result.agent_rule_reviewed_supplemental_rules.some((r) => r.id === id)) fail2("proposed_quality_blocked", result.errors.join(", "));
      compiled.push({ node_id: p.projected[i].id, brand_slug: p.brands[i].slug, source_hashes: result.source_hashes, contract_hash: result.contract_hash, added_supplement_ids: [id] });
    }
    const identity = { request_id: claim.request_id, attempt_id: claim.attempt_id, proposal_id: claim.proposal_id, candidate_hash: claim.candidate_hash, snapshot_hash: claim.snapshot_hash, review_hash: reviewHash };
    const plan = { schema_version: "uid.agent-rule-review-plan.v1", ...identity, targets: p.projected.map((t) => ({ node_id: t.id, content_md: t.content_md, metadata: t.metadata, version: t.version, input_schema: t.input_schema, status: t.status, confidence: t.confidence })) };
    return { status: "COMPILED", blockers: [], compiler_plan: plan, compiler_receipt: { schema_version: "uid.agent-rule-review-compiler-receipt.v1", status: "COMPILED", proof_scope: "DETERMINISTIC_COMPILATION_ONLY", compiler_version: RULE_COMPILER, compiler_bundle_hash: capability.compiler_bundle_hash, ...identity, plan_hash: await sha256(stableJson(plan)), compiled } };
  } catch (error) {
    return { status: "BLOCKED", compiler_plan: null, compiler_receipt: null, blockers: [{ code: error?.code || "rule_compiler_error", message: error?.message || "Rule compilation failed closed." }] };
  }
}
export {
  buildAgentRuleReviewPlan,
  ruleReviewSourceRecords
};
