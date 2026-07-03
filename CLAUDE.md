## Architecture

This project uses Clean Architecture with four layers per feature:
- `views/` — UI only, no logic
- `services/` — pure TypeScript business logic, no JSX
- `use-cases/` — orchestration, event handlers
- `data/` — RTK Query, Redux, API calls, transformers

Never mix concerns between layers. A view must not contain business logic.
A service must not render JSX.

## Code Quality Rules

- Magic numbers are banned — use named constants
- Anything repeated more than twice must be extracted to a shared implementation
- Business logic must never be duplicated
- Every view and use-case must use comment blocks to organise meaningful sections
- Locality of behaviour: minimise and co-locate side effects

## Testing

- Tests are written before implementation (TDD)
- Unit tests only — no integration tests
- Target 85% coverage, minimum 80%
- Bug fixes require a regression unit test first that reproduces the bug

## TDD Workflow

When implementing any feature:

1. **Plan** — clarify scope and acceptance criteria
2. **Test first** — spawn `test-writer` with the feature spec. Wait for confirmation tests are failing
3. **Implement** — spawn `code-writer` with the failing test files. Wait for confirmation all tests pass
4. **Review** — spawn `code-reviewer` with the implementation files. Only consider the feature done when verdict is APPROVED or APPROVED WITH SUGGESTIONS

Never skip step 2. Never run code-writer before test-writer finishes. Never merge without a code-reviewer pass.

### Sub-Agent Routing Rules

- These two agents must run **sequentially** — code-writer depends on test-writer's output
- Do not parallelize them
- Pass the test file paths explicitly when invoking code-writer