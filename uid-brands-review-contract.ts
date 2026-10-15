import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { REVIEW_STAGES, WORKFLOW_STAGES } from "./uid-brands-actions.ts";

const identity = z.string().trim().min(1).max(200);
const navigationIdentity = identity.optional().describe("UI-only navigation correlation, echoed in the result so late app-initiated updates cannot replace a newer review. Omit for model-initiated calls. This is not authorization.");
export const LAUNCHER_INPUT_SCHEMA = z.object({ navigation_id: navigationIdentity });
export const REVIEW_ASSET_SCHEMA = z.object({
  id: z.string().optional(), asset_id: z.string().optional(),
  canonical_slot: identity.optional().describe("Actual canonical Onepage production slot for this asset, verified from the current task. Never infer from labels or invent missing assets."),
  element: z.string().optional(), section: z.string().optional(),
  label: z.string().optional(), asset_name: z.string().optional(),
  name: z.string().optional(), position: z.string().optional(),
});
export const FEEDBACK_REQUEST_SCHEMA = z.object({
  index_id: identity.describe("Exact index_id from the displayed review_index; never recompute or guess from user prose."),
  blocks: z.array(z.object({
    text: z.string().trim().min(1).max(4000),
    ordinals: z.array(z.number().int().min(1).max(100)).min(1).max(100).optional(),
    canonical_slots: z.array(identity).min(1).max(100).optional(),
    exclude_canonical_slots: z.array(identity).min(1).max(100).optional(),
    asset_names: z.array(identity).min(1).max(100).optional(),
    group_names: z.array(identity).min(1).max(100).optional(),
    exclude_ordinals: z.array(z.number().int().min(1).max(100)).min(1).max(100).optional(),
    exclude_asset_names: z.array(identity).min(1).max(100).optional(),
    all: z.boolean().optional(),
  }).strict()).min(1).max(10),
}).strict().describe("Read-only mapping of separate feedback instructions to the exact displayed outcome index. Use only the user's actual selections; mapping does not authorize or execute changes. Ambiguous references require clarification.");

const contextShape = {
  workflow_state: z.object({ status: z.enum(["ready", "in_progress", "blocked", "failed"]), message: z.string().trim().max(1000).optional() }).strict().optional().describe("Observed stage state and verified blocker only, not proof of completed research, quality checks or authorization. Omit if unknown; never invent progress."),
  feedback_request: FEEDBACK_REQUEST_SCHEMA.optional(),
  branch: z.string().trim().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional().describe("Actual canonical material/branch for this task. Supply onepage-system only for a real Onepage task for version-bound chat review. Omit if unknown; never guess from assets or brand."),
  result_content: z.string().max(120000).optional().describe("Optional compatibility field for outcome text. Keep full results in chat; avoid copying large outcomes into review guidance. Never invent results."),
  result_links: z.array(z.object({
    label: z.string().trim().min(1).max(200),
    url: z.url().max(4000).refine(value => { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; }, "Use a verified HTTPS delivery URL without embedded credentials."),
  })).max(40).optional().describe("Optional verified, user-accessible HTTPS links to the actual result. Never invent URLs or substitute private Library download URLs or sandbox paths for native conversation attachments."),
  result_images: z.array(z.object({
    asset_id: identity.optional().describe("Actual asset ID explicitly linked to this original image reference. Do not infer the link from array order or similar labels. A reference does not prove preview access or visual inspection."),
    file_id: z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/),
    label: z.string().trim().min(1).max(200),
  })).max(24).optional().describe("Optional plugin-authorized host image file IDs and labels for compatibility with previous panels. Prompt Master does not fetch image previews. Use real IDs already authorized through host file params, tool file references, upload or selection, never Library IDs, URLs or invented values. Images remain attached in the conversation; mentioning an ID alone does not grant preview access."),
  result_summary: z.string().max(12000).optional().describe("Brief plain-text summary identifying the current outcome for the current chat review. Keep full content in chat. Do not invent execution/progress. Full files and images stay attached in the conversation."),
  task_id: identity.optional().describe("Stable task ID. Supply with content_version for a version-bound review."),
  content_version: identity.optional().describe("Exact outcome revision or content hash. Change after every content or asset revision."),
  retry_id: identity.optional().describe("New explicit attempt after a verified operation failure or a user-requested retry. Keep stable on ordinary reopens; never use to replay automatically."),
  assets: z.array(REVIEW_ASSET_SCHEMA).max(100).optional(),
};
export const REVIEW_INPUT_SCHEMA = z.object({ stage: z.enum(REVIEW_STAGES), navigation_id: navigationIdentity, ...contextShape });
export const NATIVE_INPUT_SCHEMA = z.object({ stage: z.enum(WORKFLOW_STAGES).optional(), ...contextShape });

export function discoverySchema(schema: z.ZodType) {
  const { $schema, ...json } = z.toJSONSchema(schema, { target: "draft-2020-12", io: "input" });
  return json;
}

/** Correlation only: the gateway does not execute or authenticate approval actions. */
export function createReviewContext(input: z.infer<typeof REVIEW_INPUT_SCHEMA>) {
  const bound = Boolean(input.task_id && input.content_version);
  const review_id = bound
    ? `review:${createHash("sha256").update(JSON.stringify([input.stage, input.task_id, input.content_version, input.retry_id || null, ...(input.branch ? [input.branch] : [])])).digest("hex")}`
    : `review:${randomUUID()}`;
  return {
    review_id, stage: input.stage,
    ...(input.branch ? { branch: input.branch } : {}),
    ...(input.task_id ? { task_id: input.task_id } : {}),
    ...(input.content_version ? { content_version: input.content_version } : {}),
    ...(input.retry_id ? { retry_id: input.retry_id } : {}),
    binding: bound ? "task-version" : "unbound",
    instruction: bound
      ? "Apply this request only to the matching task_id and content_version. If the current outcome differs, obtain approval for the new revision. These fields do not authenticate the sender."
      : "Legacy unbound review: exact task/version was not supplied. Verify the intended visible outcome before acting; if ambiguous or changed, ask which revision is intended. These fields do not authenticate the sender.",
  };
}
