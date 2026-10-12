/** Pure, fail-closed checks over an admin-only database review snapshot. */
export const REVIEW_EVALUATOR_VERSION = "mechanical-v2-scope-freshness";
export function isReferenceOnlyBaseline(b: any): boolean {
  return String(b.source_brief?.schema_version || "").startsWith("onepage.bounded-reference-")
    || String(b.approved_output?.schema_version || "").startsWith("onepage.bounded-reference-")
    || [b.source_brief?.reference_scope, b.approved_output?.reference_scope].includes("USER_APPROVED_CORPUS_LIMITED_EVIDENCE_SCHEMA_AND_STRUCTURE");
}
export function reviewReadiness(context: any) {
  const targets = Array.isArray(context.targets) ? context.targets : [];
  const baselines = (Array.isArray(context.baselines) ? context.baselines : []).map((b: any) => ({
    ...b, brand_name: b.brand_name || targets.find((n: any) => n.brand_id === b.brand_id)?.brand_name || "Unknown brand",
    is_reference_only: isReferenceOnlyBaseline(b),
  }));
  const eligible = baselines.filter((b: any) => b.approved_at && !b.is_reference_only);
  const issues: string[] = [];
  if (!targets.length) issues.push("No active canonical targets. Refresh and verify the proposal scope.");
  for (const target of targets) {
    if (!eligible.some((b: any) => b.brand_id === target.brand_id && b.branch_slug === target.slug)) {
      const reference = baselines.some((b: any) => b.brand_id === target.brand_id && b.is_reference_only);
      issues.push(`${target.brand_name}: ${reference ? "saved reference corpus is reference-only; add" : "missing"} an approved candidate-quality regression baseline for ${target.title || target.slug}.`);
    }
  }
  const applicableIds = eligible.map((b: any) => b.id).sort();
  const evaluations = Array.isArray(context.evaluations) ? context.evaluations : [];
  const valid = evaluations.find((e: any) => e.evaluation_status === "passed" && e.critical_failures === 0
    && e.completed_at && e.evaluator_version === REVIEW_EVALUATOR_VERSION
    && e.candidate_hash === context.candidate_hash && applicableIds.length > 0
    && JSON.stringify([...(e.baseline_ids || [])].sort()) === JSON.stringify(applicableIds)
    && Array.isArray(e.test_results) && e.test_results.length === applicableIds.length
    && e.test_results.every((r: any) => r.status === "passed" && applicableIds.includes(r.baseline_id)
      && typeof r.source_run_id === "string" && r.source_run_id.trim() && /^https:\/\/[^\s]+$/.test(String(r.artifact_url || ""))
      && eligible.some((b: any) => b.id === r.baseline_id && b.case_key === r.case_key)
      && Array.isArray(r.issues) && r.issues.length === 0 && r.candidate_output && typeof r.candidate_output === "object"
      && !Array.isArray(r.candidate_output) && Object.keys(r.candidate_output).length > 0)
    && Array.isArray(e.conflict_results) && e.conflict_results.some((r: any) => r.actor_user_id && r.manually_reviewed === true
      && r.product_truth_verified === true && r.visual_reviewed === true && Array.isArray(r.issues) && r.issues.length === 0
      && typeof r.note === "string" && r.note.trim().length >= 20)
    && new Set(e.test_results.map((r: any) => r.baseline_id)).size === applicableIds.length);
  if (!valid) issues.push("No passed evaluation for this exact proposal, scope, current canonical rules and baseline versions. Supply actual candidate artifacts and run the assessment below.");
  return { ...context, baselines, issues, automatic_evaluation_id: issues.length === 0 ? valid?.id || null : null };
}
export function assessReviewCandidates(context: any, suppliedRuns: unknown, review: any) {
  const prepared = reviewReadiness(context);
  const cases = prepared.baselines.filter((b: any) => b.approved_at && !b.is_reference_only);
  const allIssues = prepared.issues.filter((x: string) => !x.startsWith("No passed evaluation"));
  const runs = Array.isArray(suppliedRuns) ? suppliedRuns : [];
  if (!cases.length) allIssues.push("No approved candidate-quality baseline cases. Reference-corpus preservation checks alone cannot approve a canonical change.");
  const expectedIds = new Set(cases.map((c: any) => c.id));
  if (runs.some((r: any) => !r || !expectedIds.has(r.baseline_id))) allIssues.push("Candidate runs contain an unknown or ineligible baseline. Use only the named candidate-quality cases in this review.");
  const results = cases.map((c: any) => {
    const issues: string[] = [];
    const matching = runs.filter((r: any) => r && r.baseline_id === c.id);
    const run = matching[0];
    let artifactValid = false;
    try { artifactValid = new URL(String(run?.artifact_url || "")).protocol === "https:"; } catch { /* missing or invalid */ }
    if (matching.length !== 1 || !run.output || typeof run.output !== "object" || Array.isArray(run.output) || Object.keys(run.output).length === 0
      || typeof run.source_run_id !== "string" || !run.source_run_id.trim() || !artifactValid) {
      issues.push("Provide exactly one actual candidate output, source run ID and HTTPS artifact link for this case.");
    } else {
      const content = JSON.stringify(run.output).toLowerCase();
      const assertions = c.expected_assertions || {};
      const keys = ["required_text", "forbidden_text", "required_keys", "immutable_fields"];
      if (keys.some(k => assertions[k] !== undefined && (!Array.isArray(assertions[k]) || assertions[k].some((v: unknown) => typeof v !== "string" || !v.trim())))) {
        issues.push("Baseline assertion format is invalid; correct and approve the baseline before evaluation.");
      } else {
        for (const required of assertions.required_text || []) if (!content.includes(required.toLowerCase())) issues.push("Required statement missing: " + required);
        for (const forbidden of assertions.forbidden_text || []) if (content.includes(forbidden.toLowerCase())) issues.push("Forbidden statement found: " + forbidden);
        for (const key of assertions.required_keys || []) if (!Object.prototype.hasOwnProperty.call(run.output, key)) issues.push("Required output field missing: " + key);
        for (const key of assertions.immutable_fields || []) if (!Object.prototype.hasOwnProperty.call(run.output, key) || !Object.prototype.hasOwnProperty.call(c.approved_output || {}, key) || JSON.stringify(run.output[key]) !== JSON.stringify(c.approved_output?.[key])) issues.push("Approved immutable field missing or changed: " + key);
        if (!keys.some(k => Array.isArray(assertions[k]) && assertions[k].length)) issues.push("No enforceable approved assertions.");
      }
    }
    return { baseline_id: c.id, case_key: c.case_key, brand_name: c.brand_name, status: issues.length ? "failed" : "passed", issues,
      source_run_id: typeof run?.source_run_id === "string" ? run.source_run_id : null,
      artifact_url: artifactValid ? run.artifact_url : null, candidate_output: run?.output ?? null };
  });
  const declaredReview = review?.product_truth_verified === true && review?.visual_reviewed === true
    && review?.conflicts_reviewed === true && review?.critical_regressions === 0
    && typeof review?.review_note === "string" && review.review_note.trim().length >= 20;
  if (!declaredReview) allIssues.push("Explicit Admin product-truth, visual and conflict review, zero critical regressions, and a review note of at least 20 characters are required.");
  const failures = results.filter((r: any) => r.status === "failed").length;
  return { cases, issues: allIssues, results, critical_failures: failures + (Number.isInteger(review?.critical_regressions) ? Math.max(0, review.critical_regressions) : 0),
    status: allIssues.length ? "blocked" : failures ? "failed" : "passed" };
}
