import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
const launcher = readFileSync(new URL("../task-launcher.ts", import.meta.url), "utf8");

test("canonical and feedback tools retain their registered names", () => {
  for (const tool of ["resolve_creative_dna", "compile_onepage_job", "submit_training_feedback", "list_creative_dna_routes"]) {
    assert.match(source, new RegExp('server\\.registerTool\\(["\\x27]' + tool + '["\\x27]'));
  }
});

test("launcher tool and resource remain registered", () => {
  assert.match(source, /server\.registerTool\("launch_creative_dna"/);
  assert.match(source, /server\.registerResource\("creative-dna-task-launcher"/);
  assert.match(source, /name: "launch_creative_dna"/);
  assert.match(launcher, /sendFollowUpMessage/);
});

test("launcher routes remain dynamic and do not mutate canonical", () => {
  assert.match(source, /const safe = sanitizeRoutesData\(upstream\.data\)/);
  assert.match(launcher, /routes\.filter\(r=>r\.brand===brand\)/);
  assert.match(launcher, /compile_onepage_job first/);
  assert.doesNotMatch(launcher, /SUPABASE_SERVICE_ROLE_KEY|CREATIVE_DNA_UPSTREAM_URL/);
});
