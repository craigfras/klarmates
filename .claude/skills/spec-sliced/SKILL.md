---
name: spec-sliced
description: Break a spec document into tracer bullet issues — thin vertical slices that each cut through all integration layers end-to-end. Run after /plan-to-spec.
disable-model-invocation: true
---

# Spec Sliced

Convert a spec document into numbered tracer bullet issue files. Each issue is a thin vertical slice — not a horizontal layer.

## Step 1 — Find the spec

If the user has a spec file open or references one, use that. Otherwise ask which spec to slice.

## Step 2 — Read the spec and the codebase

Read the spec document in full. Then read relevant existing source files to understand what currently exists — this prevents creating tasks for things already built and ensures tasks reference real file paths.

## Step 3 — Design the slices

Each slice must be:

- **Vertical, not horizontal** — cuts through ALL relevant layers (types, services/mock, components, routes) in one slice. Never a slice that is only "update the types" or "build the UI".
- **Thin** — the smallest unit that delivers something demoable or verifiable on its own
- **Complete** — a finished slice can be reviewed, merged, or demoed without waiting for another slice
- **Classified** as either:
  - `HITL` — requires human interaction (Auth provider setup, design review, external service config, credentials, admin approval). Minimize these.
  - `AFK` — pure code changes, can be implemented and merged without human interaction. Prefer these.

Order slices so dependencies flow forward. A slice should only depend on lower-numbered slices.

## Step 4 — Write the slice files

For each slice, create a file named `NN-kebab-slice-name.md` in the **same directory as the spec file**.

Each file must follow this exact structure:

```markdown
# NN — Slice Name

**Type:** HITL | AFK
**Depends on:** NN-previous-slice | nothing

## What this delivers

One sentence describing the demoable or verifiable outcome of this slice alone.

## Layers touched

Bullet list of files and directories affected (use real paths from the codebase).

## Tasks

### Group tasks by layer or file. Use checkboxes.
- [ ] Specific, concrete task
- [ ] Include code snippets where the shape of the change is non-obvious
- [ ] Reference real file paths, type names, and component names from the codebase

## Verifiable outcome

Bullet list of specific, testable things that are true when this slice is complete.
Each point should be something a developer can confirm in the browser or by reading the code.
```

## Rules

- Number slices starting at `01`, zero-padded
- HITL slices must state exactly what human action is required and why it cannot be automated
- AFK slices must contain only tasks a developer can execute from the code alone
- Every slice must have at least one entry under "Verifiable outcome"
- Do not create a slice just to delete or clean up code — fold cleanup into the slice that makes it obsolete
- Prefer many thin slices over few thick ones
