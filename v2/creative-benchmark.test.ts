import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { draftProtocol, prepareStudy, readiness, summarizeStudy, RUBRIC, GATES, type Attempt } from './creative-benchmark.ts';

const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
function fixture(){
  const p=draftProtocol();p.ownerRatificationRef='TEST_ONLY:owner-ratification';p.resourceAuthorizationRef='TEST_ONLY:resource-authorization';p.ownerFinalReviewRef='TEST_ONLY:owner-review';p.ownerVerdict='PASS';
  p.controls={model:'test-model',effort:null,effortAvailability:'UNAVAILABLE',imageTool:'test-image-tool',imageSettings:{size:'test'},baselineCommit:'a'.repeat(40),experimentCommit:'b'.repeat(40)};
  for(const c of p.cases){c.sourceUrl=`https://${c.brand==='pawfecthouse'?'pawfecthouse.com':c.brand+'.co'}/${c.kind==='collection'?'collections':'products'}/test`;c.sourceVerifiedAt='2026-11-28T00:00:00Z';c.verificationEvidenceRef='TEST_ONLY:source';c.realismScoring=c.humanImagery?'Anatomy, contact, physical interaction':'Human subcriteria N/A; material, gravity, construction';c.artworkIds=['fixture-a','fixture-b','fixture-c'];for(const k of ['evidenceManifestSha256','canonicalSnapshotSha256','briefSha256','referenceAccessManifestSha256','approvedContentConstraintsSha256'] as const)c[k]=sha(k+c.id);}
  const study=prepareStudy(p);
  for(const r of study.runs){r.status='COMPLETED';r.outputSha256=sha(r.label);r.outputArtifactRef='TEST_ONLY:artifact';r.independentExecutionEvidenceRef='TEST_ONLY:independent-session';r.feedbackEvidenceRef='TEST_ONLY:feedback';r.resumeEvidenceRef='TEST_ONLY:resume';r.unapprovedMissingAssets=0;r.ownerEoVerdict='PASS';r.ownerReviewRef='TEST_ONLY:review';for(const g of GATES)r.gates[g]={status:'PASS',evidenceRef:'TEST_ONLY:'+g};r.attempts=[{stage:'research',status:'COMPLETED',model:'test-model',effort:null,inputTokens:10,outputTokens:2,reasoningTokens:null,cachedInputTokens:null,toolSchemaBytes:123,toolResponseBytes:500,toolSchemaCharacters:100,toolResponseCharacters:400,imageCalls:1,imageRegenerations:0,fallbackCalls:0,wallTimeMs:100,cost:null,currency:null,telemetryEvidenceRef:'TEST_ONLY:telemetry'}];}
  for(let i=0;i<study.scorecards.length;i++){const card=study.scorecards[i];card.completed=true;card.reviewerAlias='reviewer-'+(i%2);card.reviewedArtifactSha256=sha(card.label);card.scores={...RUBRIC};}
  return {p,...study};
}

test('36 randomized assignments remain paired and blinded; drafts never claim execution',()=>{
  const p=draftProtocol(),s=prepareStudy(p);assert.equal(s.runs.length,36);assert.equal(s.scorecards.length,72);assert.equal(new Set(s.runs.map(r=>r.label)).size,36);
  assert.ok(!JSON.stringify(s.scorecards).includes('"arm"'));assert.ok(!JSON.stringify(s.runs).includes('"arm"'));
  for(const c of p.cases)for(const repeat of [1,2])assert.deepEqual(s.allocation.assignments.filter(a=>a.caseId===c.id&&a.repeat===repeat).map(a=>a.arm).sort(),['baseline','v2']);
  assert.ok(s.readiness.blockingIssues.includes('SAME_MODEL_IDENTITY_UNKNOWN'));assert.equal(s.readiness.paidCallsMade,0);
  const report=summarizeStudy(p,s.allocation,s.runs,s.scorecards);assert.equal(report.status,'BLOCKED');assert.equal(report.arms.baseline.completedEoPassingOnepages,0);assert.equal(report.arms.v2.metrics.inputTokens.total,null);assert.equal(report.medianDelta,null);
});

test('valid records aggregate every failed attempt and retry without inventing unknown telemetry',()=>{
  const f=fixture();assert.deepEqual(readiness(f.p),[]);
  const r=f.runs.find(r=>f.allocation.assignments.find(a=>a.label===r.label)?.arm==='v2')!;
  r.attempts.unshift({...r.attempts[0],stage:'revision',status:'FAILED',inputTokens:20,fallbackCalls:1});
  const report=summarizeStudy(f.p,f.allocation,f.runs,f.scorecards);assert.equal(report.status,'PASS');assert.equal(report.pairs.length,18);assert.equal(report.arms.v2.metrics.inputTokens.total,200);assert.equal(report.arms.v2.metrics.inputTokens.perCompletedEoPassingOnepage,200/18);assert.equal(report.arms.v2.metrics.reasoningTokens.total,null);assert.equal(report.arms.v2.fallbackRunFrequency,1/18);
});

test('baseline hard-gate failure cannot establish parity and stale review cannot count as EO pass',()=>{
  const f=fixture(),baseline=f.allocation.assignments.find(a=>a.arm==='baseline')!;f.runs.find(r=>r.label===baseline.label)!.gates.evidence.status='FAIL';
  f.scorecards[0].reviewedArtifactSha256='f'.repeat(64);
  const report=summarizeStudy(f.p,f.allocation,f.runs,f.scorecards);assert.equal(report.status,'FAIL');assert.ok(report.failures.some(x=>x.includes('HARD_GATE_FAILED:evidence')));assert.ok(report.blocked.some(x=>x.includes('TWO_INDEPENDENT_BOUND_REVIEWS_REQUIRED')));assert.ok(report.results.find(r=>r.label===f.scorecards[0].label)?.eoPass===false);
});

test('source domains, model parity, independent output and owner margin are fail-closed',()=>{
  const f=fixture();f.p.cases.find(c=>c.brand==='giftsoul')!.sourceUrl='https://giftsoul.com/products/test';f.runs[0].attempts[0].model=null;f.runs[1].outputSha256=f.runs[0].outputSha256;
  const report=summarizeStudy(f.p,f.allocation,f.runs,f.scorecards);assert.equal(report.status,'FAIL');assert.ok(report.blocked.some(x=>x.includes('SAME_BRAND_VERIFIED_SOURCE_REQUIRED')));assert.ok(report.blocked.some(x=>x.includes('MODEL_PARITY_UNVERIFIED')));assert.ok(report.failures.includes('IDENTICAL_OUTPUTS_REQUIRE_INDEPENDENCE_INVESTIGATION'));
  const g=fixture();for(const c of g.scorecards)if(g.allocation.assignments.find(a=>a.label===c.label)?.arm==='v2')c.scores.productFidelity=20;
  const low=summarizeStudy(g.p,g.allocation,g.runs,g.scorecards);assert.equal(low.medianDelta,-5);assert.ok(low.failures.includes('NONINFERIORITY_MARGIN_EXCEEDED'));
});

test('out-of-range and incomplete scores never silently become zero-valued passing reviews',()=>{
  const f=fixture();f.scorecards[0].scores.humanPhysicalRealism=null;f.scorecards[1].scores.productFidelity=100;
  const report=summarizeStudy(f.p,f.allocation,f.runs,f.scorecards);assert.equal(report.status,'BLOCKED');assert.equal(report.results.find(r=>r.label===f.scorecards[0].label)?.score,null);
});
