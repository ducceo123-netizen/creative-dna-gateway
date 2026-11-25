import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync("src/oauth-consent.tsx","utf8");

test("happyuid OAuth entry only accepts the corporate email domain",()=>{
 assert.match(source,/\@happyuid\\\.com/);
 assert.match(source,/signInWithOtp/);
 assert.match(source,/shouldCreateUser:true/);
 assert.match(source,/email_confirmed_at/);
 assert.match(source,/creative_dna_team_members/);
 assert.doesNotMatch(source,/signInWithPassword/);
 assert.doesNotMatch(source,/type="password"/);
});
