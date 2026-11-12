import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const ui=readFileSync(new URL("../src/components/AdminFeedback.tsx",import.meta.url),"utf8");
const server=readFileSync(new URL("../server.ts",import.meta.url),"utf8");

test("Delete all appears only in the Rejected tab and not hidden in advanced tools",()=>{
  assert.match(ui, /filter === "rejected" && <div[^>]*data-admin-tool="rejected-delete-all"/);
  assert.match(ui, /aria-label="Delete all rejected feedback"/);
  assert.match(ui, /onClick=\{deleteAllRejected\}/);
  assert.equal((ui.match(/onClick=\{deleteAllRejected\}/g)||[]).length,1);
  assert.match(ui, /rejectedCount === 0/);
});

test("bulk rejection cleanup is scoped to rejected only, with explicit confirmation",()=>{
  const start=ui.indexOf("const deleteAllRejected = async");
  const end=ui.indexOf("  useEffect(",start);
  const handler=ui.slice(start,end);
  assert.match(handler, /confirm\(/);
  assert.match(handler, /body:JSON\.stringify\(\{ status:"rejected" \}\)/);
  assert.match(handler, /\/api\/admin\/feedback\/delete-all/);
  assert.match(handler, /setBulkDeleting\(true\)/);
  assert.match(handler, /await load\(undefined, true, true\)/);
  assert.match(server, /app\.post\("\/api\/admin\/feedback\/delete-all"/);
  assert.match(server, /authorization\?\.startsWith\("Bearer "\)/);
});
