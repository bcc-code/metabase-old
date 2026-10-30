# Development

The code lives in the `bcc-code/metabase` repository, a fork of
[metabase/metabase](https://github.com/metabase/metabase).

## Licensing: why none of this touches `enterprise/`

Code under `enterprise/` is under the Metabase Commercial License and may not be used without a paid license. This
fork **does not use it**: every BCC feature is an independent implementation in the AGPL parts of the repository
(`src/`, `test/`, `resources/`, `frontend/src/`). Build and run the OSS edition only (the default; never set
`MB_EDITION=ee`, never use the `:ee` / `:ee-dev` deps aliases). The `enterprise/` directory is left in the tree only
so upstream merges stay simple.

## How the fork plugs in

The fork keeps its changes to upstream code small, so that upstream merges stay easy:

- `src/metabase/premium_features/fork_features.clj` lists the features the fork provides. Feature checks
  (`has-feature?`, the `token-features` setting the frontend reads) report them as available without a token.
- Backend behaviour lives in the OSS fallback bodies of upstream's `defenterprise` hooks, or in new OSS modules
  (`metabase.custom-viz`, `metabase.data-access`, `metabase.cache.refresh`, ...) owned by team "BCC" in
  `.clj-kondo/config/modules/config.edn`.
- Frontend code lives in `frontend/src/metabase/fork/<feature>/`. `initializeForkPlugins()`
  (`frontend/src/metabase/fork/index.ts`, called from `app.tsx`) fills upstream's `PLUGIN_*` slots, just as the
  enterprise build's `initializePlugins()` would.

## Build

```bash
docker build --build-arg MB_EDITION=oss --build-arg VERSION=v0.66.0-bcc.1 -t bcc-metabase .
```

Without Docker: `./bin/build.sh` (needs Java 21+, the Clojure CLI and Bun), which produces
`target/uberjar/metabase.jar`. In BCC's hosting, the **BCC - Build and deploy Metabase** workflow builds the image
(see [Hosting](../hosting.md)).

## Work on it

```bash
bun install
bun run build:cljs                 # ClojureScript, needed by type-check and Jest
bun run type-check-pure
./bin/test-agent --oss :only '[metabase.sso.integrations.oidc-test]'
```

Always pass `--oss` to the test runner: without it the runner puts `enterprise/` code on the classpath, which this
fork must not use (and whose settings collide with the fork's). The checked-in OpenAPI spec
(`resources/openapi/openapi.json`) describes the fork's API; `bun run generate-openapi` regenerates it, in OSS mode.

`AGENTS.md` and the skills in `.claude/skills/` describe upstream's conventions, which the fork follows.

## GitHub workflows

The repository only keeps BCC's own workflows:

| Workflow | What it does |
|---|---|
| `bcc-provision-project.yml` | Creates the Google Cloud project of an environment on the BCC Infra Platform. |
| `bcc-infra-deploy.yml` | Plans or applies the Terraform in `infra/`. |
| `bcc-app-deploy.yml` | Builds the image and rolls it out on Cloud Run. |
| `bcc-docs.yml` | Publishes this documentation to developer.bcc.no. |
| `bcc-ci.yml` | Checks pull requests and pushes to `master` (see below). |

Upstream Metabase's own CI workflows were removed: they depend on Metabase's runners and secrets.

### CI

**BCC - CI** checks only what a change touches, on the open-source edition. A pull request is compared with its base
branch, a push to `master` with the commit before it.

- **Frontend**, when JavaScript, TypeScript, CSS or ClojureScript changed: builds the ClojureScript, type-checks
  everything, lints and format-checks the changed files, and runs the Jest unit tests in their folders.
- **Backend**, when Clojure changed: runs clj-kondo and cljfmt on the changed files, the module-boundary checks, and
  the tests of each changed module (a change in `src/metabase/cache/` runs `test/metabase/cache/`). Driver tests
  are not run.

`.github/scripts/bcc-ci-changes.sh` decides what is checked; run it locally to see what CI will pick for your last
commit. It is not a full test run: the tests of other modules that use a changed module are not run, so run the
wider tests yourself when you change something many modules use, and after an upstream merge.

## Updating from upstream Metabase

Merge a release tag or `master` of `metabase/metabase` into this repository's `master`, then:

- Upstream changes to files this fork deleted (upstream's workflows, CI scripts and actions under `.github/`) show as
  modify/delete conflicts. Keep them deleted: `git rm` each one.
- Run `./bin/mage fix-modules-config`, the tests of the BCC modules and the frontend type-check, and fix what the
  merge broke.
- Review new upstream upsells: the fork removes them (see [No upgrade advertising](../features/no-upgrade-advertising.md)).

## Documentation

This documentation is the `bcc-docs/` folder of the repository. Upstream's `docs/` folder is Metabase's own
documentation and is left as upstream has it.

The **BCC - Publish documentation** workflow (`.github/workflows/bcc-docs.yml`) publishes `bcc-docs/` to the BCC
developer portal on every change to it on `master`, under `developer.bcc.no/<repository name>/`. The portal asks for a
BCC SignOn login. It uses the organization's `DEVELOPER_DOCS_DEPLOY_PAT` secret.

Write it as if it were public: the portal also serves its markdown to anyone holding an AI access link. Never put
credentials, internal addresses or personal data in it.
