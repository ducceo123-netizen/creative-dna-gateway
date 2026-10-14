import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {onepagePackagePaths} from '../supabase/functions/_shared/onepage-packaging.ts';

test('actual ZIP CLI rejects missing, duplicate, unsafe, wrong-root and CRC-corrupt archives without claiming image verification',()=>{
 const directory=mkdtempSync(join(tmpdir(),'onepage-cli-'));
 try {
  const names=onepagePackagePaths('Test Product','test_product','gtk');
  for(const mode of ['valid','missing','duplicate','unsafe','wrong-root','corrupt']){
   const archive=join(directory,`${mode}.zip`);
   const create=spawnSync('python3',['-c',`import sys,json,zipfile,struct
names=json.loads(sys.argv[2]); mode=sys.argv[3]
if mode=='missing': names=names[:-1]
if mode=='duplicate': names=names+[names[0]]
if mode=='unsafe': names=names+['../escape.webp']
if mode=='wrong-root': names=[n.replace('Onepage - Test Product/','Onepage-Test-Product/') for n in names]
with zipfile.ZipFile(sys.argv[1],'w',compression=zipfile.ZIP_STORED) as z:
 for name in names: z.writestr(name,b'not-image-bytes')
if mode=='corrupt':
 with open(sys.argv[1],'r+b') as f:
  header=f.read(30); name,extra=struct.unpack_from('<HH',header,26); f.seek(30+name+extra); f.write(b'X')
`,archive,JSON.stringify(names),mode],{encoding:'utf8'});
   assert.equal(create.status,0,create.stderr);
   const run=spawnSync(process.execPath,['--import','tsx','scripts/audit-onepage-package.ts',archive,'Test Product','test_product','gtk'],{encoding:'utf8'});
   assert.equal(run.status,mode==='valid'?0:1,`${mode}: ${run.stderr}`);
   if(mode==='valid'){
    const report=JSON.parse(run.stdout);
    assert.equal(report.status,'VALID_NAMES_ONLY');
    assert.equal(report.archive_crc,'PASSED');
    assert.equal(report.image_decode_and_revision,'NOT_VERIFIED');
    assert.equal(report.byte_validation,'NOT_PERFORMED');
   }
   if(mode==='corrupt')assert.match(run.stderr,/CRC/);
  }
 } finally {rmSync(directory,{recursive:true,force:true});}
});
