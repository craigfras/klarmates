---
name: plan-to-spec
description: Convert the current conversation context into a structured spec document at spec/<feature-name>/spec.md. Run after /grill-me or any planning discussion.
disable-model-invocation: true
---

# Plan to Spec

Your job is to convert the design decisions already reached in the current conversation into a written spec document.

Do not re-interview the user. Do not ask clarifying questions unless the feature name or subfolder name is genuinely ambiguous.

## Step 1 — Determine the subfolder name

Derive a short kebab-case folder name from the feature discussed (e.g. `auth-flow`, `seller-onboarding`, `review-system`). If it is not obvious from context, ask the user for it before proceeding.

## Step 2 — Create the spec document

1. Create the directory `spec/<subfolder-name>/`
2. Write `spec/<subfolder-name>/spec.md` using the structure below

## Spec structure

```
# <Feature Name> Spec

## Overview
One paragraph summary of what this feature is and why it exists.

## <Sections based on what was discussed>
Use clear headings. Include tables, code blocks, and flow steps where they aid clarity.
Cover whichever of these are relevant:
- User flows (step by step)
- Data model changes
- UI changes (components affected, new components, removed components)
- New and removed routes
- Navbar or layout behaviour changes
- Auth and permissions
- Backend requirements and endpoints
- Mock strategy (how the frontend handles missing backend)
- Implementation order
```

The spec must be detailed enough that a developer could implement from it without needing to revisit the conversation.
