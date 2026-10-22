# Owner rule unknown-outcome recovery

This is a separate owner action, not a queue handoff and not a second merge.

1. Before sending an approval, the browser persists the proposal, authenticated owner, candidate/rule/plan hashes, recovery generation and client operation ID. If persistence fails, it does not send.
2. A transport timeout keeps the approval locked. Ordinary pending reads do not prove failure. A matching immutable owner receipt can reconcile a complete saved identity.
3. The explicit recovery button persists a recovery UUID and sends only that recovery request. It never submits approval or a replacement plan.
4. The protected RPC authenticates the enabled configured owner and active admin, then acquires the same locks as owner acceptance. It returns a committed owner receipt, a closed terminal status, or a new fence proving older attempts cannot commit. A repeated UUID does not rotate the fence. A superseded UUID stays locked until the user explicitly starts a new recovery.
5. After `fenced_not_applied`, the browser fetches a new owner preview. A new approval still requires one explicit confirmation of the current rule and scope. Token-aware acceptance verifies the fence and all existing hashes/compiler/scope/audit invariants.

Legacy hashless owner locks use explicit recovery, never automatic replay. Queue, cancellation and covered-resolution locks remain in their own lane. Background status reads retain the visible content and do not show the initial-loading screen.

## Deployment order

Apply the reviewed migration, deploy the authenticated Edge handler with its existing JWT configuration unchanged, then deploy the gateway/UI. No owner config or other account permission is changed. The existing six-argument acceptance entry remains compatible until a recovery fence exists; after that, old null-token requests fail before commit.

The immutable owner-decision insertion guard also fences a pre-upgrade invocation that retained the original function body. The entire transaction rolls back on a mismatch, including canonical changes, snapshots and training events. Recovery and the audit guard require READ COMMITTED isolation; unsupported isolation fails closed rather than relying on an old transaction snapshot.

Verify migration function bodies/ACLs, private-table RLS, exact Edge file bytes, gateway/UI commit, and unauthorized HTTP rejection. Do not use a real pending proposal as a smoke test: recovery mutates its fence and approval merges its rule. Use disposable PostgreSQL and synthetic browser fixtures for those behaviors.
