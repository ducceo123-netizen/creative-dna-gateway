import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const old=readFileSync('supabase/migrations/20261020052603_uid_rule_cache_normalized_clauses.sql','utf8');
const next=readFileSync('supabase/migrations/20261022034808_uid_rule_replacement_context.sql','utf8');
test('replacement-context correction leaves other eligibility checks and access attributes unchanged',()=>{
 const normalize=(sql:string)=>sql.slice(sql.indexOf('create or replace function'))
  .replace(' replacement_text text;\n','')
  .replace(/ -- Uncertainty about research\/SKU evidence[\s\S]*?(?= if spec->>'confidence')/,'[replacement detector]\n')
  .replace(/ if normative ~\*[\s\S]*?(?= if spec->>'confidence')/,'[replacement detector]\n');
 assert.equal(normalize(next),normalize(old));
 assert.doesNotMatch(next,/^[ \t]*(?:grant|revoke|alter role|create role)\b/im);
});
