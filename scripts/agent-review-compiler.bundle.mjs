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
  const hash2 = async (node) => {
    const { creative_quality_contract: _contract, ...metadata } = node?.metadata || {};
    return sha256(stableJson({ slug: node?.slug ?? null, version: node?.version ?? null, content_md: node?.content_md ?? "", metadata }));
  };
  return { branch: await hash2(dna.branch), brand_dna: await hash2(dna.brand_dna) };
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
    const canonical = allCanonicalReferences.find((e) => e.id === r.id || !!r.reference_id && (e.id === r.reference_id || e.metadata?.reference_id === r.reference_id));
    const revoked = canonical && !["approved", "reference"].includes(canonical.status);
    const asset_url = revoked ? null : usableAssetUrl(canonical?.asset_url) || usableAssetUrl(r.asset_url);
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
  const canonical = typeof p.proposed_content_md === "string" ? p.proposed_content_md.trim() : p.proposed_content_md;
  const rule = parseCanonicalOwnerRule(canonical);
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
  if (typeof block !== "string" || !block.startsWith("\n\n## ACCEPTED ADMIN FEEDBACK \u2014 ") || !/^\n\n## ACCEPTED ADMIN FEEDBACK — \d{4}-\d{2}-\d{2}\n/.test(block) || block !== block.slice(0, block.indexOf("\n", 3) + 1) + canonical + "\n")
    fail("merge_projection_invalid", "The SQL merge block is not bound to the exact canonical rule and UTC merge date.");
  const nextContent = (n) => n.content_md.includes(canonical) ? n.content_md : n.content_md + block;
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
  return { snapshot: s, proposal: p, scope, context, canonical, rule, targets, projected, brands, brandSlugs, master, isOnepage, dnas, canonicalAppend };
}

// supabase/functions/_shared/agent-review-plan.ts
var AGENT_RULE_PLAN_SCHEMA = "uid.agent-rule-plan.v1";
var AGENT_COMPILER_RECEIPT_SCHEMA = "uid.agent-compiler-receipt.v1";
var AgentPlanError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
};
var fail2 = (code, message) => {
  throw new AgentPlanError(code, message);
};
var object3 = (v) => !!v && typeof v === "object" && !Array.isArray(v);
var text2 = (v, max = 4e3) => typeof v === "string" && !!v.trim() && v.length <= max;
var uuid = (v) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
var hash = (v) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
var clone2 = (v) => JSON.parse(stableJson(v));
var equal2 = (a, b) => stableJson(a) === stableJson(b);
var sameIds = (a, b) => Array.isArray(a) && a.every((x) => typeof x === "string") && equal2([...a].sort(), [...b].sort());
var timestamp = (v) => typeof v === "string" && /[TZ]|[+-]\d\d:\d\d$/.test(v) ? Date.parse(v) : NaN;
var coreKeys = ["schema_version", "decision", "review_note", "media_receipts", "findings"];
function agentReviewCore(review) {
  if (!object3(review) || Object.keys(review).some((k) => ![...coreKeys, "compiler_plan", "compiler_receipt"].includes(k)) || coreKeys.some((k) => !Object.hasOwn(review, k)) || review.schema_version !== "uid.agent-review.v1" || !["passed", "blocked"].includes(review.decision) || !text2(review.review_note) || review.review_note.trim().length < 20 || !Array.isArray(review.media_receipts) || review.media_receipts.length > 256 || !Array.isArray(review.findings) || review.findings.length > 48 || stableJson(review).length > 3e6)
    fail2("invalid_review_core", "A bounded genuine-review core is required; manual or caller approval flags cannot substitute for evidence.");
  const validated = review;
  return Object.fromEntries(coreKeys.map((k) => [k, clone2(validated[k])]));
}
function validateReviewEvidence(claim, core) {
  const snapshot = claim.snapshot;
  if (core.decision !== "passed") fail2("review_not_passed", "The review contains unresolved findings; compilation cannot approve them.");
  const manifest = snapshot.media_manifest;
  if (!Array.isArray(manifest) || !manifest.length || manifest.length > 256 || manifest.some((m) => !object3(m) || !text2(m.evidence_id, 120) || !text2(m.locator, 4e3) || !text2(m.record_version, 300)) || new Set(manifest.map((m) => m.evidence_id)).size !== manifest.length || core.media_receipts.length !== manifest.length)
    fail2("media_coverage", "Receipts must exactly cover the pinned nonempty source, baseline and candidate manifest.");
  const leasedAt = timestamp(claim.leased_at), expires = timestamp(claim.lease_expires_at), intentExpires = timestamp(claim.expires_at);
  if (!Number.isFinite(leasedAt) || !Number.isFinite(expires) || expires <= leasedAt || !Number.isFinite(intentExpires) || expires > intentExpires)
    fail2("invalid_lease_window", "A valid immutable lease window is required.");
  const locatorHashes = /* @__PURE__ */ new Map();
  for (const m of manifest) {
    const matches = core.media_receipts.filter((r2) => object3(r2) && r2.evidence_id === m.evidence_id), r = matches[0];
    const fetched = timestamp(r?.retrieved_at), revalidated = timestamp(r?.revalidated_at);
    const inspectionMatches = object3(r) && (/^image\//.test(r.media_type) && r.inspection_method === "image" || /^video\//.test(r.media_type) && r.inspection_method === "video" || ["application/pdf", "text/html"].includes(r.media_type) && r.inspection_method === "rendered" || m.kind === "source" && /^text\//.test(r.media_type) && ["read", "rendered"].includes(r.inspection_method));
    if (matches.length !== 1 || !object3(r) || r.locator !== m.locator || r.record_version !== m.record_version || !hash(r.content_sha256) || r.revalidated_sha256 !== r.content_sha256 || m.expected_content_sha256 != null && m.expected_content_sha256 !== r.content_sha256 || m.object_version != null && m.object_version !== r.object_version || r.inspected !== true || !text2(r.note) || r.note.trim().length < 20 || !inspectionMatches || !Number.isFinite(fetched) || !Number.isFinite(revalidated) || fetched < leasedAt || revalidated < fetched || revalidated > expires)
      fail2("invalid_media_receipt", `Pinned evidence ${m.evidence_id} lacks a matching current-lease byte and inspection receipt.`);
    if (locatorHashes.has(r.locator) && locatorHashes.get(r.locator) !== r.content_sha256)
      fail2("inconsistent_media_bytes", "Repeated locators must refer to identical revalidated bytes.");
    locatorHashes.set(r.locator, r.content_sha256);
  }
  if (core.media_receipts.some((r) => !manifest.some((m) => m.evidence_id === r.evidence_id))) fail2("unknown_media_receipt", "An inspection receipt is outside the pinned manifest.");
  const targets = snapshot.rule_context.targets;
  const brands = [...new Set(targets.map((t) => t.brand_id))];
  if (core.findings.length !== brands.length * 3) fail2("criterion_coverage", "Every affected brand needs exactly three evidence-linked review criteria.");
  for (const brand of brands) {
    const brandMedia = manifest.filter((m) => m.brand_id === brand);
    if (!["source", "baseline", "candidate"].every((kind) => brandMedia.some((m) => m.kind === kind)))
      fail2("missing_brand_media", "Every affected brand needs actual source, approved-baseline and candidate evidence.");
    const evidenceIds = brandMedia.map((m) => m.evidence_id), nodeIds = targets.filter((t) => t.brand_id === brand).map((t) => t.id);
    for (const criterion of ["product_truth", "visual_quality", "canonical_conflicts"]) {
      const matches = core.findings.filter((f2) => object3(f2) && f2.brand_id === brand && f2.criterion === criterion), f = matches[0];
      if (matches.length !== 1 || !object3(f) || f.result !== "passed" || f.critical !== false || !text2(f.note) || f.note.trim().length < 20 || !sameIds(f.evidence_ids, evidenceIds) || !sameIds(f.canonical_node_ids, nodeIds))
        fail2("criterion_not_passed", `${criterion} must have a passed, evidence-linked finding for every exact target of this brand.`);
    }
  }
}
async function buildAgentReviewedRulePlan(inputClaim, review) {
  try {
    const claim = inputClaim;
    if (!object3(inputClaim) || !uuid(claim.request_id) || !uuid(claim.proposal_id) || !(typeof claim.snapshot_hash === "string" && /^sha256:[0-9a-f]{64}$/.test(claim.snapshot_hash)) || !Number.isSafeInteger(claim.lease_version) || claim.lease_version < 1 || claim.lease_version > 999999999 || claim.attempt_id !== `${claim.request_id}:${claim.lease_version}` || claim.evaluator_version !== AGENT_REVIEW_EVALUATOR || !text2(claim.candidate_hash, 300) || !object3(claim.snapshot) || !object3(claim.snapshot.rule_context) || claim.snapshot.candidate_hash !== claim.candidate_hash || claim.snapshot.rule_context.candidate_hash !== claim.candidate_hash || claim.snapshot.rule_context.proposal?.id !== claim.proposal_id || claim.snapshot.proposal?.id !== claim.proposal_id || claim.snapshot.compiler_capability?.compiler_version !== QUALITY_COMPILER || !hash(claim.snapshot.compiler_capability?.compiler_bundle_hash))
      fail2("agent_claim_invalid", "An exact fenced SQL claim and pinned compiler capability are required.");
    const core = agentReviewCore(review);
    if (!sameIds(claim.snapshot.targets?.map((t) => t.id), claim.snapshot.rule_context.targets?.map((t) => t.id) || []))
      fail2("review_scope_mismatch", "Reviewed targets differ from the actual compiler trigger closure.");
    validateReviewEvidence(claim, core);
    const prepared = await prepareCanonicalRuleProjection(claim.snapshot.rule_context);
    const { proposal, scope, canonical, rule, projected, brands, brandSlugs, master, isOnepage, dnas } = prepared;
    if (prepared.canonicalAppend)
      fail2("catalog_required", "Agent-reviewed canonical changes need an existing valid brand-keyed catalog; direct owner canonical append does not create compiler capability.");
    const shared = clone2(master.metadata.creative_quality_contract);
    if (shared?.schema_version !== QUALITY_CATALOG_SCHEMA || !object3(shared.contracts))
      fail2("catalog_required", "Agent-reviewed canonical changes need an existing valid brand-keyed catalog.");
    const reviewHash = await sha256(stableJson(core)), canonicalHash = await sha256(canonical);
    const supplementId = `agent-review:${claim.attempt_id}`;
    for (let i = 0; i < projected.length; i++) {
      const catalog = isOnepage ? shared : clone2(projected[i].metadata.creative_quality_contract);
      const bundle = catalog?.schema_version === QUALITY_CATALOG_SCHEMA ? catalog.contracts?.[brands[i].slug] : null;
      if (!object3(bundle)) fail2("quality_bundle_missing", "The exact reviewed brand bundle is missing.");
      const owners = bundle.owner_supplemental_rules || [], agents = bundle.agent_reviewed_supplemental_rules || [];
      if (owners.length + agents.length >= MAX_OWNER_SUPPLEMENTS) fail2("supplement_capacity_exceeded", "The combined supplemental capacity is full; no prior rule is removed or truncated.");
      if ([...owners, ...agents].some((r) => r.proposal_id === proposal.id || r.canonical_text === canonical))
        fail2("supplement_identity_collision", "This proposal or exact canonical text already has a supplemental decision.");
      const hashes = await sourceHashes({ brand: brands[i], branch: projected[i], brand_dna: dnas[i], visual_references: [] });
      const supplement = {
        schema_version: AGENT_REVIEWED_SCHEMA,
        id: supplementId,
        proposal_id: proposal.id,
        request_id: claim.request_id,
        attempt_id: claim.attempt_id,
        evaluator_version: AGENT_REVIEW_EVALUATOR,
        decision_kind: "owner_approved_agent_review",
        snapshot_hash: claim.snapshot_hash,
        review_hash: reviewHash,
        review_scope: AGENT_REVIEW_SCOPE,
        canonical_text: canonical,
        declared_scope: rule.scope,
        scope: { brands: brandSlugs, branches: [scope.branch_slug] },
        rule_class: rule.rule_class,
        confidence: rule.confidence,
        source: { node: "branch", locator: `agent-review:${proposal.id}:${claim.attempt_id}`, canonical_text_hash: canonicalHash },
        accepted_source_hashes: hashes,
        precedence: OWNER_SUPPLEMENTAL_PRECEDENCE
      };
      bundle.schema_version = QUALITY_AGENT_REVIEWED_SCHEMA;
      bundle.agent_reviewed_supplemental_rules = [...agents, supplement];
      bundle.revision = `agent-review:${claim.attempt_id}`;
      bundle.source_hashes = hashes;
      if (!isOnepage) projected[i].metadata.creative_quality_contract = catalog;
    }
    if (isOnepage) projected.forEach((n) => {
      n.metadata.creative_quality_contract = clone2(shared);
    });
    const compiled = [];
    for (let i = 0; i < projected.length; i++) {
      const result = await compileCreativeQuality({ brand: brands[i], branch: projected[i], brand_dna: dnas[i], visual_references: [] });
      if (result.status !== "COMPILED" || !result.agent_reviewed_supplemental_rules.some((r) => r.id === supplementId && r.canonical_text === canonical))
        fail2("proposed_quality_blocked", `${brands[i].slug}: the exact agent-reviewed supplement did not compile (${result.errors.join(", ")}).`);
      compiled.push({ node_id: projected[i].id, brand_slug: brands[i].slug, source_hashes: result.source_hashes, contract_hash: result.contract_hash, added_supplement_ids: [supplementId] });
    }
    const identities = {
      request_id: claim.request_id,
      attempt_id: claim.attempt_id,
      proposal_id: proposal.id,
      candidate_hash: claim.candidate_hash,
      snapshot_hash: claim.snapshot_hash,
      review_hash: reviewHash
    };
    const plan = { schema_version: AGENT_RULE_PLAN_SCHEMA, ...identities, targets: projected.map((n) => ({
      node_id: n.id,
      content_md: n.content_md,
      metadata: n.metadata,
      version: n.version,
      input_schema: n.input_schema,
      status: n.status,
      confidence: n.confidence
    })) };
    const receipt = {
      schema_version: AGENT_COMPILER_RECEIPT_SCHEMA,
      status: "COMPILED",
      proof_scope: "DETERMINISTIC_COMPILATION_ONLY",
      compiler_version: QUALITY_COMPILER,
      compiler_bundle_hash: claim.snapshot.compiler_capability.compiler_bundle_hash,
      ...identities,
      plan_hash: await sha256(stableJson(plan)),
      compiled
    };
    return { status: "COMPILED", blockers: [], compiler_plan: plan, compiler_receipt: receipt };
  } catch (error) {
    return { status: "BLOCKED", compiler_plan: null, compiler_receipt: null, blockers: [{
      code: error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "agent_compiler_error",
      message: error instanceof Error ? error.message : "The deterministic agent-review plan could not be safely compiled.",
      next_action: "Keep the proposal pending; resolve the exact source, scope, schema or evidence blocker before a fresh review attempt."
    }] };
  }
}
export {
  AGENT_COMPILER_RECEIPT_SCHEMA,
  AGENT_RULE_PLAN_SCHEMA,
  agentReviewCore,
  buildAgentReviewedRulePlan
};
