# Dark Chess — Agent Instructions

## Project Context

This is a Chinese Dark Chess application.

## Documentation

- For product requirements, read docs/product-spec.md.
- For game rules, read docs/game-rules.md.
- For architecture changes, read docs/architecture.md.
- For the current milestone, read the relevant task file.

## Engineering Principles

- Keep game logic independent from UI.
- Add tests for changes to game behavior.
- Run relevant tests before declaring completion.
- Do not silently change approved game rules.
- Keep changes scoped to the current task.

## Approval Boundaries

- Propose major architecture changes before implementing.
- Do not deploy, push, or delete files without approval.

## Coding Conventions

### Language

- Use TypeScript with strict type checking.
- Prefer explicit domain types over `any`.
- Use camelCase for variables and functions.
- Use PascalCase for types and React components.
- Use UPPER_SNAKE_CASE for true constants only.

### Code Organization

- Prefer small, focused functions.
- Prefer pure functions for game rules.
- Keep domain logic independent of React.
- Avoid speculative abstractions.
- Prefer composition over inheritance.
- Do not introduce classes without a concrete reason.

### State Management

- Treat GameState as immutable.
- Maintain one authoritative source of game state.
- Derive UI data instead of duplicating it.
- Keep temporary UI state out of Game Core.

### Error Handling

- Use typed Result objects for expected
  game validation failures.
- Do not silently swallow unexpected errors.
- Never mutate state on invalid actions.

### Testing

- Use Vitest for unit tests.
- Prefer table-driven tests for game rules.
- Test observable behavior, not implementation.
- Cover important edge cases and invariants.

### Dependencies

- Reuse existing dependencies when reasonable.
- Avoid adding packages for trivial functionality.
- Request approval for major new dependencies.

### Code Review

- Keep changes scoped to the assigned task.
- Preserve existing public interfaces.
- Explain meaningful trade-offs.
- Run relevant tests before completion.

## Phase 1.5 Quality and Release Gates

- Run `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, and `pnpm build` after changes; use `pnpm test:e2e` for affected UI/integration flows and `pnpm verify:release` for release artifact checks.
- ESLint is syntax-only with a Babel TypeScript parser; TypeScript 7 remains the type/name/unused-declaration checker. Do not change the production compiler/build to satisfy a linter.
- Use the committed Prettier configuration. Keep mechanical formatting separate from tooling/behavioral changes and request owner approval before commits or pushes.
- Release preparation may proceed without hosted CI/devices. Production publication requires a hosted CI pass for the release revision, device evidence or explicit owner acceptance of gaps, and explicit publication approval.
- Do not create hosting resources, connect external accounts, deploy even previews, or begin Phase 2 without owner authorization.
