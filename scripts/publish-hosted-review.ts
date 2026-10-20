/** Stage an authorized actual output for the normal reviewed Git -> Render deploy. Never uploads. */
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {prepareHostedReview,writeHostedReview} from '../uid-hosted-review.ts';
const [inputFile,sourceRoot]=process.argv.slice(2);
if(!inputFile||!sourceRoot)throw Error('Usage: node --import tsx scripts/publish-hosted-review.ts delivery-input.json actual-output-directory');
const prepared=prepareHostedReview(JSON.parse(readFileSync(inputFile,'utf8')),path.resolve(sourceRoot),process.cwd());
const urlPath=writeHostedReview(prepared,path.join(process.cwd(),'public'));
console.log(JSON.stringify({status:'STAGED_NOT_DEPLOYED',url_path:urlPath,bundle_sha256:prepared.bundleHash,identity:prepared.receipt.identity,content_version:prepared.receipt.content_version,render_hash:prepared.receipt.render_hash,next:'Review and deploy this repository change through the authorized main/Render flow. Fetch URL and delivery.json after deployment and verify hashes before reporting a working preview link.'},null,2));
