import type { CallToolResult } from "@modelcontextprotocol/server";

/** Gateway/host communication guidance, not backend job state or proof of execution. */
export const UID_PROGRESS_GUIDANCE = "PROGRESS: Give a brief factual update before a real operation, after a verified milestone, or when a material blocker appears. Research-before-output gates creative deliverables, not progress updates. For partial work, state done / pending / blocked and the next action; name actual sources or deliverables only when verified. Keep updates concise and in the user's language; do not repeat unchanged status or full results. Never expose private reasoning, invent percentages, timers or completion, or infer execution from an accepted send. If an operation is slow or its outcome unknown, say only what is verified and follow the returned recovery instructions; do not replay writes. Preserve research, quality, source/media, canonical and approval gates. Continue authorized work without redundant confirmation; ask only for a genuinely missing permission or essential input. Host-native activity rendering is host-controlled.";

export const UID_PROGRESS_REMINDER = "PROGRESS: Briefly update before real work and after verified milestones/blockers. For partial work, state verified done/pending/blocked and next action. Research gates creative deliverables, not progress updates; evidence, quality and approval gates still apply. Never reveal private reasoning, invent percentages/timers/completion, or treat accepted sends as execution. On slow/unknown outcomes follow recovery; never replay writes. Continue authorized work without redundant confirmation. Keep updates concise; do not repeat unchanged status.";

export const UID_PROGRESS_DESCRIPTION = " Give concise factual progress before real work and after verified milestones or blockers; for partial work state done/pending/blocked and next action. Research gates creative deliverables, not progress updates.";

// Static completion labels describe the end of a call, never success of the task.
// They remain true for isError, auth failures, missing evidence and unknown outcomes.
export const UID_TOOL_INVOCATION_LABELS = {
  ingest_uid_brands_attachment: ["Reading attachment reference…", "Attachment call ended"],
  show_uid_brands_review: ["Preparing outcome and actions…", "Review call ended"],
  get_uid_brands_native_workflow: ["Loading workflow controls…", "Workflow call ended"],
  launch_creative_dna: ["Loading task launcher…", "Launcher call ended"],
  get_onepage_ui_template: ["Reading Onepage template…", "Template call ended"],
  resolve_creative_dna: ["Reading canonical creative rules…", "Creative rules call ended"],
  compile_onepage_job: ["Compiling Onepage task packet…", "Task packet call ended"],
  submit_training_feedback: ["Submitting pending training proposal…", "Training submission call ended"],
  list_creative_dna_routes: ["Looking up creative routes…", "Route lookup call ended"],
} as const;

export function uidProgressTool<T extends { description?: string; _meta?: Record<string, unknown> }>(name: string, tool: T) {
  const labels = UID_TOOL_INVOCATION_LABELS[name as keyof typeof UID_TOOL_INVOCATION_LABELS];
  if (!labels) throw new Error(`Missing invocation labels for ${name}`);
  return {
    ...tool,
    description: (tool.description || "") + UID_PROGRESS_DESCRIPTION,
    _meta: {
      ...tool._meta,
      "openai/toolInvocation/invoking": labels[0],
      "openai/toolInvocation/invoked": labels[1],
    },
  };
}

/** Model-visible even when a connected host has cached discovery metadata.
 * Preserve result payload, ordering, errors, recovery and schemas without inferring status.
 */
export function withUidProgress<T extends CallToolResult>(result: T) {
  return { ...result, content: [...result.content, { type: "text" as const, text: UID_PROGRESS_REMINDER }] };
}
