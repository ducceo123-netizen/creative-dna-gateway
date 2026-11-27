/** Explicit local sandbox credential provisioning. Creates no external identity or permission. */
import { mkdirSync, existsSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { hash, boundedId } from '../core.ts';
const [directory, owner] = process.argv.slice(2);
if (!directory || !owner) throw Error('Usage: node --import tsx v2/scripts/init-local.ts /absolute/isolated-directory owner-id');
boundedId(owner);
const target=resolve(directory);if(target!==directory||['/','/tmp','/var','/Users'].includes(target))throw Error('Use a dedicated absolute local directory.');
mkdirSync(target,{recursive:true,mode:0o700});if(realpathSync(target)!==target)throw Error('Use the real absolute directory, without symlinks.');
const credentials=join(target,'principals.json'),tokenFile=join(target,'reviewer-token.txt'),settings=join(target,'settings.env');
if([credentials,tokenFile,settings].some(existsSync))throw Error('Local credentials already exist; refusing overwrite.');
const token='uidv2_'+randomBytes(32).toString('base64url');
writeFileSync(credentials,JSON.stringify([{tokenSha256:hash(token),owner,subject:owner,role:'reviewer'}],null,2)+'\n',{mode:0o600,flag:'wx'});
writeFileSync(tokenFile,token+'\n',{mode:0o600,flag:'wx'});
writeFileSync(settings,`V2_MODE=isolated-test\nV2_AUTH_MODE=test-token\nV2_DATA_DIR=${target}\nV2_TEST_PRINCIPALS_FILE=${credentials}\nV2_PUBLIC_ORIGIN=http://127.0.0.1:4318\nPORT=4318\n`,{mode:0o600,flag:'wx'});
process.stdout.write(JSON.stringify({status:'LOCAL_TEST_CREDENTIAL_PROVISIONED',settingsFile:settings,credentialFile:tokenFile,productionAccess:false})+'\n');
