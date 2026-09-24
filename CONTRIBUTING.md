# Contributing to @acegalaxy/lib-db-gateway

Thanks for your interest! This package is part of the
[lib-*](https://github.com/acegalaxy-co) family of cross-project
libraries.

## Ground rules

- Be kind. See [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
- Open an issue before large changes — alignment first, code second.
- Security issues: **do not** open a public issue. See [SECURITY.md](./SECURITY.md).

## Development

```bash
git clone https://github.com/acegalaxy-co/lib-db-gateway.git
cd lib-db-gateway
npm install
npm test
```

Node.js >= 20 is required.

## Pull requests

1. Fork + branch from `main` (`feat/...`, `fix/...`, `docs/...`).
2. Keep diffs focused. One concern per PR.
3. Add or update tests for behavior changes.
4. Update `README.md` / docs if the public surface changes.
5. Run `npm test` locally before pushing.
6. Fill in the PR template.

## Adapter contributions

New adapters live under `adapters/<store>.js` and **must**:

- Be the only file that imports the underlying driver.
- Implement the full `Adapter` contract (see `types.ts`).
- Ship with a default-deny policy YAML example.
- Never call destructive driver methods directly — go through the policy layer.

## Commit style

Conventional Commits preferred:

```
feat(adapter): add mysql adapter
fix(authz): treat missing policy as deny
docs(readme): clarify rate-limit knobs
```

## License

By contributing you agree your contribution is licensed under the
[MIT License](./LICENSE).
