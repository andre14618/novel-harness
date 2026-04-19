# Invariants fixtures

These files intentionally violate the invariants declared in
`docs/invariants.md`. They are excluded from the default
`bun scripts/lint/invariants-check.ts` scan and are fed only through
`--self-test`, which asserts each file fires its declared
`// expected-invariant-failure: <slug>` header. This guards against the
fixtures themselves rotting out of sync with the checker.
