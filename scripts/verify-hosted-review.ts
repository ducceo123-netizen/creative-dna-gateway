/** Verify a deployed immutable bundle, not a staging path. No credentials or signed URLs. */
import {createHash} from 'node:crypto';
import {HOSTED_REVIEW_ORIGIN} from '../uid-hosted-review-contract.ts';
const [url,identityType,identityId,version,renderHash]=process.argv.slice(2);
if(!url||!['task','outcome'].includes(identityType)||!identityId||!version||!renderHash)throw Error('Usage: node --import tsx scripts/verify-hosted-review.ts URL task|outcome ID CONTENT_VERSION RENDER_HASH');
const parsed=new URL(url);
if(parsed.origin!==HOSTED_REVIEW_ORIGIN||parsed.search||parsed.hash||!/^\/reviews\/(ldp|onepage)\/(task|outcome)\/[A-Za-z0-9_-]+\/v-[a-f0-9]{20}\/[a-f0-9]{64}\/index\.html$/.test(parsed.pathname))throw Error('EXPECTED_IMMUTABLE_RENDER_URL_REQUIRED');
const digest=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
async function read(target:string,limit:number){const res=await fetch(target,{redirect:'error',signal:AbortSignal.timeout(30000)});if(!res.ok||!res.body)throw Error('HTTP_FAILED '+target+' '+res.status);if(Number(res.headers.get('content-length')||0)>limit)throw Error('RESPONSE_TOO_LARGE');const chunks:Uint8Array[]=[];let size=0;for await(const c of res.body as any){size+=c.length;if(size>limit)throw Error('RESPONSE_TOO_LARGE');chunks.push(c);}return Buffer.concat(chunks);}
const receipt=JSON.parse((await read(new URL('delivery.json',parsed).href,2_000_000)).toString());
if(receipt.schema_version!=='uid-hosted-review/1'||receipt.identity?.type!==identityType||receipt.identity?.id!==identityId||receipt.content_version!==version||receipt.render_hash!==renderHash)throw Error('STALE_OR_WRONG_DEPLOYMENT');
if(digest(JSON.stringify(receipt))!==parsed.pathname.split('/').at(-2))throw Error('BUNDLE_RECEIPT_HASH_MISMATCH');
if(!Array.isArray(receipt.files)||receipt.files.length>150||!receipt.files.some((f:any)=>f.path==='index.html'))throw Error('INVALID_FILE_INVENTORY');
let total=0;for(const file of receipt.files){if(!/^[A-Za-z0-9_./-]+$/.test(file.path)||file.path.startsWith('/')||file.path.split('/').some((v:string)=>!v||v==='..'||v==='.')||! /^[a-f0-9]{64}$/.test(file.sha256))throw Error('UNSAFE_FILE_PATH');const bytes=await read(new URL(file.path,parsed).href,20_000_000);total+=bytes.length;if(total>250_000_000)throw Error('BUNDLE_TOO_LARGE');if(digest(bytes)!==file.sha256)throw Error('DEPLOYED_FILE_HASH_MISMATCH '+file.path);}
console.log(JSON.stringify({status:'HTTP_AND_ASSET_BYTES_VERIFIED_BROWSER_QA_STILL_REQUIRED',url,identity:receipt.identity,content_version:version,render_hash:renderHash,files_verified:receipt.files.length,bytes_verified:total,browser_visual_qc_performed:false},null,2));
