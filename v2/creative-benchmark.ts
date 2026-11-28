/** Offline study preparation/reporting only. Never invokes a model, generates an image, or publishes. */
import { randomBytes, randomInt, createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const RUBRIC = { productFidelity:25, bannerTypography:20, humanPhysicalRealism:15, contentInsights:15, visualProofArtworkDiversity:10, brandDna:10, overallUi:5 } as const;
export const GATES = ['isolation','canonicalCoverage','compilerRoundtrip','stageState','evidence','gtkFaq','render','packaging','feedback','mcp'] as const;
const BRANDS = ['pawfecthouse','giftsoul','soulprise'] as const;
const CASES = ['simple-ornament','complex-mechanism','collection'] as const;
const DOMAINS = {pawfecthouse:'pawfecthouse.com',giftsoul:'giftsoul.co',soulprise:'soulprise.co'} as const;
type Scores = Record<keyof typeof RUBRIC, number|null>;
type Gate = { status:'PASS'|'FAIL'|'BLOCKED'|'NOT_RUN'; evidenceRef:string|null };
type Hash = string|null;
export type Case = {
  id:string; brand:typeof BRANDS[number]; kind:typeof CASES[number]; template:'gtk'|'faq';
  sourceUrl:string|null; sourceVerifiedAt:string|null; verificationEvidenceRef:string|null;
  evidenceManifestSha256:Hash; canonicalSnapshotSha256:Hash; briefSha256:Hash;
  referenceAccessManifestSha256:Hash; approvedContentConstraintsSha256:Hash;
  artworkIds:string[]; humanImagery:boolean; realismScoring:string|null; feedbackRevision:boolean; interruptedResume:boolean;
};
export type Protocol = {
  schemaVersion:'uid-brands-v2.creative-study/1'; studyId:string; repeats:2;
  proposedMarginPoints:number; ownerRatificationRef:string|null; resourceAuthorizationRef:string|null;
  ownerFinalReviewRef:string|null; ownerVerdict:'PASS'|'FAIL'|'PENDING';
  controls:{ model:string|null; effort:string|null; effortAvailability:'EXPOSED'|'UNAVAILABLE'|'UNKNOWN'; imageTool:string|null; imageSettings:Record<string,unknown>|null; baselineCommit:string|null; experimentCommit:string|null };
  cases:Case[];
};
export type Attempt = {
  stage:string; status:'COMPLETED'|'FAILED'|'RETRIED'; model:string|null; effort:string|null;
  inputTokens:number|null; outputTokens:number|null; reasoningTokens:number|null; cachedInputTokens:number|null;
  toolSchemaBytes:number|null; toolResponseBytes:number|null; toolSchemaCharacters:number|null; toolResponseCharacters:number|null;
  imageCalls:number|null; imageRegenerations:number|null; fallbackCalls:number|null; wallTimeMs:number|null; cost:number|null; currency:string|null;
  telemetryEvidenceRef:string|null;
};
export type Run = {
  label:string; caseId:string; repeat:number; status:'NOT_RUN'|'FAILED'|'COMPLETED';
  outputSha256:Hash; outputArtifactRef:string|null; independentExecutionEvidenceRef:string|null;
  feedbackEvidenceRef:string|null; resumeEvidenceRef:string|null;
  gates:Record<typeof GATES[number],Gate>; attempts:Attempt[];
  criticalDefects:string[]; unapprovedMissingAssets:number|null; ownerEoVerdict:'PASS'|'FAIL'|'PENDING'; ownerReviewRef:string|null;
};
export type Scorecard = { label:string; caseId:string; reviewerAlias:string|null; reviewedArtifactSha256:Hash; scores:Scores; observations:string; criticalDefects:string[]; completed:boolean };
export type Allocation = { schemaVersion:'uid-brands-v2.private-allocation/1'; studyId:string; assignments:{label:string;caseId:string;repeat:number;arm:'baseline'|'v2'}[] };
const hash = (v:unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const hasHash = (v:unknown) => typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const present = (v:unknown) => typeof v==='string'&&v.trim().length>0;

export function draftProtocol():Protocol {
  return { schemaVersion:'uid-brands-v2.creative-study/1',studyId:'creative-eo-'+randomBytes(8).toString('hex'),repeats:2,proposedMarginPoints:3,
    ownerRatificationRef:null,resourceAuthorizationRef:null,ownerFinalReviewRef:null,ownerVerdict:'PENDING',
    controls:{model:null,effort:null,effortAvailability:'UNKNOWN',imageTool:null,imageSettings:null,baselineCommit:'87bf39d1f38eb1d0baee159b921efbd7e3aaf923',experimentCommit:null},
    cases:BRANDS.flatMap(brand=>CASES.map(kind=>({ id:`${brand}-${kind}`,brand,kind,template:kind==='complex-mechanism'?'faq':'gtk',
      sourceUrl:null,sourceVerifiedAt:null,verificationEvidenceRef:null,evidenceManifestSha256:null,canonicalSnapshotSha256:null,briefSha256:null,referenceAccessManifestSha256:null,approvedContentConstraintsSha256:null,
      artworkIds:[],humanImagery:kind!=='simple-ornament',realismScoring:null,feedbackRevision:kind==='collection',interruptedResume:kind==='complex-mechanism' }))) };
}

/** Checks readiness records; references still require a human to inspect their underlying evidence. */
export function readiness(p:Protocol):string[] {
  const issues:string[]=[];
  if(p.schemaVersion!=='uid-brands-v2.creative-study/1'||p.repeats!==2)issues.push('MATRIX_VERSION_OR_REPEATS');
  if(p.cases.length!==9||new Set(p.cases.map(c=>c.id)).size!==9)issues.push('NINE_UNIQUE_CASES_REQUIRED');
  for(const brand of BRANDS)for(const kind of CASES)if(p.cases.filter(c=>c.brand===brand&&c.kind===kind).length!==1)issues.push(`MATRIX:${brand}:${kind}`);
  if(!present(p.ownerRatificationRef))issues.push('OWNER_RUBRIC_MARGIN_RATIFICATION_REQUIRED');
  if(!present(p.resourceAuthorizationRef))issues.push('RESOURCE_AUTHORIZATION_REQUIRED');
  if(!Number.isFinite(p.proposedMarginPoints)||p.proposedMarginPoints<0||p.proposedMarginPoints>3)issues.push('NONINFERIORITY_MARGIN_OUT_OF_PROPOSED_RANGE');
  if(!present(p.controls.model))issues.push('SAME_MODEL_IDENTITY_UNKNOWN');
  if(p.controls.effortAvailability==='UNKNOWN'||(p.controls.effortAvailability==='EXPOSED'&&!present(p.controls.effort))||(p.controls.effortAvailability==='UNAVAILABLE'&&p.controls.effort!==null))issues.push('EFFORT_CONTROL_UNRESOLVED');
  if(!present(p.controls.imageTool)||!p.controls.imageSettings)issues.push('IMAGE_TOOL_SETTINGS_UNPINNED');
  for(const field of ['baselineCommit','experimentCommit'] as const)if(!/^[a-f0-9]{40}$/.test(p.controls[field]||''))issues.push(`COMMIT_UNPINNED:${field}`);
  for(const c of p.cases){
    let u:URL|undefined;try{u=new URL(c.sourceUrl||'');}catch{}
    if(!u||u.protocol!=='https:'||u.username||u.password||!([DOMAINS[c.brand],`www.${DOMAINS[c.brand]}`].includes(u.hostname))||!u.pathname.startsWith(c.kind==='collection'?'/collections/':'/products/'))issues.push(`${c.id}:SAME_BRAND_VERIFIED_SOURCE_REQUIRED`);
    if(!c.sourceVerifiedAt||!Number.isFinite(Date.parse(c.sourceVerifiedAt))||!present(c.verificationEvidenceRef))issues.push(`${c.id}:LIVE_VERIFICATION_EVIDENCE_REQUIRED`);
    for(const field of ['evidenceManifestSha256','canonicalSnapshotSha256','briefSha256','referenceAccessManifestSha256','approvedContentConstraintsSha256'] as const)if(!hasHash(c[field]))issues.push(`${c.id}:UNPINNED:${field}`);
    if(c.kind==='collection'&&new Set(c.artworkIds).size<3)issues.push(`${c.id}:THREE_REAL_ARTWORKS_REQUIRED`);
    if(!present(c.realismScoring))issues.push(`${c.id}:PREDECLARE_REALISM_SCORING`);
  }
  if(!p.cases.some(c=>c.template==='gtk')||!p.cases.some(c=>c.template==='faq')||!p.cases.some(c=>c.humanImagery)||!p.cases.some(c=>c.feedbackRevision)||!p.cases.some(c=>c.interruptedResume))issues.push('REQUIRED_WORKFLOW_COVERAGE_MISSING');
  return issues;
}

/** Produces randomized review labels without exposing arms; private key must never be given to reviewers. */
export function prepareStudy(p:Protocol) {
  const assignments:Allocation['assignments']=[];
  for(const c of p.cases)for(let repeat=1;repeat<=p.repeats;repeat++)for(const arm of ['baseline','v2'] as const)assignments.push({label:'R-'+randomBytes(12).toString('hex'),caseId:c.id,repeat,arm});
  for(let i=assignments.length-1;i>0;i--){const j=randomInt(i+1);[assignments[i],assignments[j]]=[assignments[j],assignments[i]];}
  const runs:Run[]=assignments.map(a=>({label:a.label,caseId:a.caseId,repeat:a.repeat,status:'NOT_RUN',outputSha256:null,outputArtifactRef:null,independentExecutionEvidenceRef:null,feedbackEvidenceRef:null,resumeEvidenceRef:null,
    gates:Object.fromEntries(GATES.map(g=>[g,{status:'NOT_RUN',evidenceRef:null}])) as Run['gates'],attempts:[],criticalDefects:[],unapprovedMissingAssets:null,ownerEoVerdict:'PENDING',ownerReviewRef:null}));
  const scorecards:Scorecard[]=assignments.flatMap(a=>Array.from({length:2},()=>({label:a.label,caseId:a.caseId,reviewerAlias:null,reviewedArtifactSha256:null,scores:Object.fromEntries(Object.keys(RUBRIC).map(k=>[k,null])) as Scores,observations:'',criticalDefects:[],completed:false})));
  return {allocation:{schemaVersion:'uid-brands-v2.private-allocation/1',studyId:p.studyId,assignments} as Allocation,runs,scorecards,
    readiness:{status:'NOT_RUN',protocolSha256:hash(p),blockingIssues:readiness(p),taskRuns:assignments.length,paidCallsMade:0,creativeEo:'NOT_RUN'}};
}

const median=(xs:number[])=>{if(!xs.length)return null;const s=[...xs].sort((a,b)=>a-b),m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const percentile=(xs:number[],q:number)=>{if(!xs.length)return null;const s=[...xs].sort((a,b)=>a-b);return s[Math.max(0,Math.ceil(q*s.length)-1)];};
const sumKnown=(xs:(number|null)[])=>xs.length&&xs.every(x=>typeof x==='number'&&Number.isFinite(x)&&x>=0)?xs.reduce<number>((sum,x)=>sum+(x as number),0):null;

export function summarizeStudy(p:Protocol,allocation:Allocation,runs:Run[],cards:Scorecard[]) {
  const blocked=readiness(p), failures:string[]=[];
  if(allocation.studyId!==p.studyId||allocation.assignments.length!==36||new Set(allocation.assignments.map(a=>a.label)).size!==36)blocked.push('ALLOCATION_INVALID');
  if(runs.length!==36||new Set(runs.map(r=>r.label)).size!==36)blocked.push('RUN_SET_INVALID');
  for(const c of p.cases)for(let repeat=1;repeat<=2;repeat++)for(const arm of ['baseline','v2'])if(allocation.assignments.filter(a=>a.caseId===c.id&&a.repeat===repeat&&a.arm===arm).length!==1)blocked.push(`ALLOCATION_PAIR_INVALID:${c.id}:${repeat}:${arm}`);
  if(cards.some(c=>!allocation.assignments.some(a=>a.label===c.label&&a.caseId===c.caseId)))blocked.push('UNEXPECTED_SCORECARD');
  const results=allocation.assignments.map(a=>{
    const r=runs.find(r=>r.label===a.label),c=p.cases.find(c=>c.id===a.caseId);
    if(!r||!c||r.caseId!==a.caseId||r.repeat!==a.repeat){blocked.push(`${a.label}:RUN_BINDING_INVALID`);return { ...a,score:null,categories:null,eoPass:false,missingAssets:null,metrics:null,cost:null,currency:null };}
    const reviews=cards.filter(x=>x.label===a.label&&x.caseId===a.caseId);
    const boundReviews=reviews.length===2&&reviews.every(x=>x.completed&&present(x.reviewerAlias)&&hasHash(x.reviewedArtifactSha256)&&x.reviewedArtifactSha256===r.outputSha256)&&new Set(reviews.map(x=>x.reviewerAlias)).size===2;
    if(!boundReviews)blocked.push(`${a.label}:TWO_INDEPENDENT_BOUND_REVIEWS_REQUIRED`);
    let validScores=reviews.length===2&&reviews.every(x=>x.completed);
    for(const x of reviews)for(const [k,max] of Object.entries(RUBRIC)){const n=x.scores[k as keyof Scores];if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>max)validScores=false;}
    if(!validScores)blocked.push(`${a.label}:SCORES_INCOMPLETE_OR_INVALID`);
    if(r.status!=='COMPLETED'||!hasHash(r.outputSha256)||!present(r.outputArtifactRef)||!present(r.independentExecutionEvidenceRef))blocked.push(`${a.label}:INDEPENDENT_COMPLETION_EVIDENCE_REQUIRED`);
    if(c.feedbackRevision&&!present(r.feedbackEvidenceRef))blocked.push(`${a.label}:FEEDBACK_EVIDENCE_REQUIRED`);
    if(c.interruptedResume&&!present(r.resumeEvidenceRef))blocked.push(`${a.label}:RESUME_EVIDENCE_REQUIRED`);
    for(const gate of GATES){if(r.gates[gate]?.status==='FAIL')failures.push(`${a.label}:HARD_GATE_FAILED:${gate}`);else if(r.gates[gate]?.status!=='PASS'||!present(r.gates[gate]?.evidenceRef))blocked.push(`${a.label}:HARD_GATE_UNVERIFIED:${gate}`);}
    if(r.criticalDefects.length||reviews.some(x=>x.criticalDefects.length))failures.push(`${a.label}:CRITICAL_DEFECT`);
    if(r.unapprovedMissingAssets===null)blocked.push(`${a.label}:MISSING_ASSET_COUNT_UNKNOWN`);else if(!Number.isInteger(r.unapprovedMissingAssets)||r.unapprovedMissingAssets<0)blocked.push(`${a.label}:MISSING_ASSET_COUNT_INVALID`);
    if(r.ownerEoVerdict==='FAIL')failures.push(`${a.label}:OWNER_EO_FAIL`);else if(r.ownerEoVerdict!=='PASS'||!present(r.ownerReviewRef))blocked.push(`${a.label}:OWNER_EO_REVIEW_PENDING`);
    if(!r.attempts.length)blocked.push(`${a.label}:EXECUTION_LOG_MISSING`);
    for(const attempt of r.attempts){
      if(attempt.model!==p.controls.model||!attempt.model)blocked.push(`${a.label}:MODEL_PARITY_UNVERIFIED`);
      if(attempt.effort!==p.controls.effort)blocked.push(`${a.label}:EFFORT_PARITY_UNVERIFIED`);
      if(!present(attempt.telemetryEvidenceRef))blocked.push(`${a.label}:EXECUTION_PROVENANCE_REQUIRED`);
    }
    const categories=validScores?Object.fromEntries(Object.keys(RUBRIC).map(k=>[k,median(reviews.map(x=>x.scores[k as keyof Scores] as number))])):null;
    const score=categories?Object.values(categories).reduce<number>((s,n)=>s+(n||0),0):null;
    const metrics=Object.fromEntries(['inputTokens','outputTokens','reasoningTokens','cachedInputTokens','toolSchemaBytes','toolResponseBytes','toolSchemaCharacters','toolResponseCharacters','imageCalls','imageRegenerations','fallbackCalls','wallTimeMs'].map(k=>[k,sumKnown(r.attempts.map(x=>x[k as keyof Attempt] as number|null))]));
    const currencies=[...new Set(r.attempts.map(a=>a.currency))];
    const eoPass=r.status==='COMPLETED'&&hasHash(r.outputSha256)&&present(r.outputArtifactRef)&&present(r.independentExecutionEvidenceRef)&&r.ownerEoVerdict==='PASS'&&present(r.ownerReviewRef)&&boundReviews&&validScores&&GATES.every(g=>r.gates[g]?.status==='PASS'&&present(r.gates[g]?.evidenceRef))&&!r.criticalDefects.length&&!reviews.some(x=>x.criticalDefects.length);
    return {...a,score,categories,individualReviews:reviews.map(x=>({reviewerAlias:x.reviewerAlias,scores:x.scores,observations:x.observations,criticalDefects:x.criticalDefects})),reviewerTotalDisagreement:validScores?Math.abs(Object.values(reviews[0].scores).reduce<number>((s,n)=>s+(n||0),0)-Object.values(reviews[1].scores).reduce<number>((s,n)=>s+(n||0),0)):null,eoPass,missingAssets:r.unapprovedMissingAssets,metrics:metrics as Record<string,number|null>,cost:currencies.length===1&&present(currencies[0])?sumKnown(r.attempts.map(a=>a.cost)):null,currency:currencies.length===1?currencies[0]:null,contextStages:r.attempts};
  });
  const hashes=runs.filter(r=>hasHash(r.outputSha256)).map(r=>r.outputSha256);
  if(new Set(hashes).size!==hashes.length)failures.push('IDENTICAL_OUTPUTS_REQUIRE_INDEPENDENCE_INVESTIGATION');
  const pairs=p.cases.flatMap(c=>[1,2].map(repeat=>{const b=results.find(r=>r.caseId===c.id&&r.repeat===repeat&&r.arm==='baseline'),v=results.find(r=>r.caseId===c.id&&r.repeat===repeat&&r.arm==='v2');return {caseId:c.id,repeat,baselineScore:b?.score??null,v2Score:v?.score??null,delta:b?.score!=null&&v?.score!=null?v.score-b.score:null};}));
  const arms=Object.fromEntries((['baseline','v2'] as const).map(arm=>{
    const rows=results.filter(r=>r.arm===arm),scores=rows.flatMap(r=>r.score===null?[]:[r.score]),completed=rows.filter(r=>r.eoPass).length;
    const metrics=Object.fromEntries(['inputTokens','outputTokens','reasoningTokens','cachedInputTokens','toolSchemaBytes','toolResponseBytes','imageCalls','imageRegenerations','fallbackCalls','wallTimeMs'].map(k=>{
      const vals=rows.map(r=>r.metrics?.[k]??null),total=sumKnown(vals);return [k,{total,p50:vals.every(x=>x!==null)?percentile(vals as number[],.5):null,p90:vals.every(x=>x!==null)?percentile(vals as number[],.9):null,perCompletedEoPassingOnepage:total!==null&&completed?total/completed:null}];
    }));
    const currencies=[...new Set(rows.map(r=>r.currency))],totalCost=currencies.length===1&&present(currencies[0])?sumKnown(rows.map(r=>r.cost)):null;
    return [arm,{runs:rows.length,completedEoPassingOnepages:completed,completionRate:rows.length?completed/rows.length:null,scoreMedian:median(scores),scoreP10:percentile(scores,.1),scoreP90:percentile(scores,.9),individualScores:scores,categoryMedians:Object.fromEntries(Object.keys(RUBRIC).map(k=>[k,median(rows.flatMap(r=>r.categories?.[k]===null||!r.categories?[]:[r.categories[k] as number]))])),metrics,cost:{total:totalCost,currency:currencies.length===1?currencies[0]:null,perCompletedEoPassingOnepage:totalCost!==null&&completed?totalCost/completed:null},fallbackRunFrequency:rows.every(r=>r.metrics?.fallbackCalls!=null)?rows.filter(r=>(r.metrics?.fallbackCalls||0)>0).length/rows.length:null}];
  }));
  const baseline=arms.baseline,v2=arms.v2,medianDelta=baseline.scoreMedian!==null&&v2.scoreMedian!==null?v2.scoreMedian-baseline.scoreMedian:null;
  if(medianDelta!==null&&medianDelta < -p.proposedMarginPoints)failures.push('NONINFERIORITY_MARGIN_EXCEEDED');
  for(const k of Object.keys(RUBRIC)){const b=baseline.categoryMedians[k],v=v2.categoryMedians[k];if(b!==null&&v!==null&&v<b)blocked.push(`CATEGORY_DOWNGRADE_REQUIRES_OWNER_ADJUDICATION:${k}`);}
  for(const pair of pairs){const b=results.find(r=>r.caseId===pair.caseId&&r.repeat===pair.repeat&&r.arm==='baseline'),v=results.find(r=>r.caseId===pair.caseId&&r.repeat===pair.repeat&&r.arm==='v2');if(b?.missingAssets!=null&&v?.missingAssets!=null&&v.missingAssets>b.missingAssets)failures.push(`${pair.caseId}:${pair.repeat}:MISSING_ASSETS_INCREASED`);}
  if(p.ownerVerdict==='FAIL')failures.push('OWNER_FINAL_REVIEW_FAILED');else if(p.ownerVerdict!=='PASS'||!present(p.ownerFinalReviewRef))blocked.push('OWNER_FINAL_REVIEW_REQUIRED');
  return {schemaVersion:'uid-brands-v2.creative-report/1',studyId:p.studyId,protocolSha256:hash(p),status:failures.length?'FAIL':blocked.length?'BLOCKED':'PASS',failures:[...new Set(failures)],blocked:[...new Set(blocked)],arms,pairs,pairedMedianDelta:median(pairs.flatMap(x=>x.delta===null?[]:[x.delta])),medianDelta,results,
    limitations:['This offline report validates supplied records; it does not inspect product pixels or prove human attestations.','Unknown provider metrics remain null; payload bytes/characters are never converted to measured tokens.','Every attempt, failure, retry, regeneration and fallback must be logged.','Scores do not override failed hard gates or owner review.','Reviewer aliases protect privacy; the private arm key must remain sealed until review completion.']};
}

async function save(directory:string,name:string,value:unknown,privateFile=false){await writeFile(resolve(directory,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:privateFile?0o600:0o644});}
async function main(){
  const [command,...args]=process.argv.slice(2);
  if(command==='init'&&args.length===1){await save(resolve(args[0],'..'),args[0].split('/').pop()!,draftProtocol());return;}
  if(command==='prepare'&&args.length===2){const protocol=JSON.parse(await readFile(args[0],'utf8')) as Protocol;const prepared=prepareStudy(protocol);await mkdir(args[1],{recursive:true});await save(args[1],'private-allocation.json',prepared.allocation,true);await save(args[1],'execution-log.json',prepared.runs,true);await save(args[1],'blinded-scorecards.json',prepared.scorecards);await save(args[1],'readiness.json',prepared.readiness);console.log(JSON.stringify(prepared.readiness));return;}
  if(command==='report'&&args.length===4){const [p,a,r,c]=await Promise.all(args.map(x=>readFile(x,'utf8').then(JSON.parse)));console.log(JSON.stringify(summarizeStudy(p,a,r,c),null,2));return;}
  throw new Error('Usage: node --import tsx creative-benchmark.ts init protocol.json | prepare protocol.json NEW_DIRECTORY | report protocol.json private-allocation.json execution-log.json blinded-scorecards.json');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
