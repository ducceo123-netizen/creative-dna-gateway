/** Read-only local audit. Usage: node --import tsx scripts/audit-onepage-package.ts archive.zip 'Product Line' product_line gtk|faq */
import {spawnSync} from 'node:child_process';
import {validateOnepagePackagePaths} from '../supabase/functions/_shared/onepage-packaging.ts';
const [archive,line,slug,section]=process.argv.slice(2);
if(!archive||!line||!slug||(section!=='gtk'&&section!=='faq')) throw new Error('Usage: archive.zip "Product Line" product_line gtk|faq');
const read=spawnSync('python3',['-c',`import sys,json,zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
 bad=z.testzip()
 if bad: raise ValueError('ZIP CRC mismatch: '+bad)
 print(json.dumps(z.namelist()))`,archive],{encoding:'utf8',maxBuffer:16*1024*1024});
if(read.status!==0)throw new Error(read.stderr||'Unable to inspect archive');
const result=validateOnepagePackagePaths(JSON.parse(read.stdout),line,slug,section);
console.log(JSON.stringify({...result,archive,archive_crc:'PASSED',image_decode_and_revision:'NOT_VERIFIED'},null,2));
process.exitCode=result.status==='VALID_NAMES_ONLY'?0:1;
