import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { REVIEW_STAGES, WORKFLOW_STAGES } from "./uid-brands-actions.ts";

const identity = z.string().trim().min(1).max(200);
export const REVIEW_ASSET_SCHEMA = z.object({
  id: z.string().optional(), asset_id: z.string().optional(),
  element: z.string().optional(), section: z.string().optional(),
  label: z.string().optional(), asset_name: z.string().optional(),
  name: z.string().optional(), position: z.string().optional(),
});
const contextShape = {
  result_summary: z.string().max(12000).optional().describe("Optional plain-text summary of the outcome actually returned. Do not invent execution/progress. Full content and deliverables stay in the conversation."),
  task_id: identity.optional().describe("Stable task ID. Supply with content_version for a version-bound review."),
  content_version: identity.optional().describe("Exact outcome revision or content hash. Change after every content or asset revision."),
  retry_id: identity.optional().describe("New explicit attempt after a verified operation failure or a user-requested retry. Keep stable on ordinary reopens; never use to replay automatically."),
  assets: z.array(REVIEW_ASSET_SCHEMA).max(100).optional(),
};
export const REVIEW_INPUT_SCHEMA = z.object({ stage: z.enum(REVIEW_STAGES), ...contextShape });
export const NATIVE_INPUT_SCHEMA = z.object({ stage: z.enum(WORKFLOW_STAGES).optional(), ...contextShape });

export function discoverySchema(schema: z.ZodType) {
  const { $schema, ...json } = z.toJSONSchema(schema, { target: "draft-2020-12", io: "input" });
  return json;
}

/** Correlation only: the gateway does not execute or authenticate approval actions. */
export function createReviewContext(input: z.infer<typeof REVIEW_INPUT_SCHEMA>) {
  const bound = Boolean(input.task_id && input.content_version);
  const review_id = bound
    ? `review:${createHash("sha256").update(JSON.stringify([input.stage, input.task_id, input.content_version, input.retry_id || null])).digest("hex")}`
    : `review:${randomUUID()}`;
  return {
    review_id, stage: input.stage,
    ...(input.task_id ? { task_id: input.task_id } : {}),
    ...(input.content_version ? { content_version: input.content_version } : {}),
    ...(input.retry_id ? { retry_id: input.retry_id } : {}),
    binding: bound ? "task-version" : "unbound",
    instruction: bound
      ? "Apply this request only to the matching task_id and content_version. If the current outcome differs, obtain approval for the new revision. These fields do not authenticate the sender."
      : "Legacy unbound review: exact task/version was not supplied. Verify the intended visible outcome before acting; if ambiguous or changed, ask which revision is intended. These fields do not authenticate the sender.",
  };
}
