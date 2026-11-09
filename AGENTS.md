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