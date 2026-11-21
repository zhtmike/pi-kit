# Contributing to pi-kit

Personal repo, public discipline.

## Development

```
npm test          # plain-node suites on the pure cores (no framework, no install)
npx tsc --noEmit  # after: npm install --no-save typescript@7.0.2 @types/node@24 @earendil-works/pi-coding-agent
```

The pure modules under `src/**` import no host package — only `src/index.ts`,
the glue entry, does — which is what keeps the tests zero-install
and the typecheck the only place host drift shows. Node ≥ 22.19.0 (unflagged
type-stripping floor).

Every behavior change ships with a unit test in the same change. Tool
schemas, `docs/api.md`, and `AGENTS.md` move together — they are one contract
in three places.

## Landing a change

1. Branch from `main`.
2. `npm test` + typecheck green locally; CI runs both (test matrix + a
   typecheck floor against pi 1.4.0 + a `continue-on-error` canary against
   pi latest).
3. PR → review → merge to `main`. The repo is never published to npm and
   carries no release workflow; version bumps in `package.json` mark install
   points for the owner's machines (`pi update --extensions` reconciles).

## Design invariants (the short list)

- API-first: a guard's error names the tool that performs the operation correctly; a refusal with no tool names the tier row and the escape.
- Fail loudly on misuse; fail closed at gate and init.
- In `src/index.ts`, handler registration order is the short-circuit order — the claim floor registers first.
- Descriptions are lean API docs; the full reference lives in `docs/api.md`, never in context; workflow mechanics ride runtime refusals and the `[next: …]` hints.
- One footer status key (`pi-kit`), merged from parts; no widget, no custom header/footer.
