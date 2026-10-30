#!/usr/bin/env bash
# What a BCC CI run checks: the files the checked-out commit changes, compared with its first parent. For a pull
# request that is GitHub's merge commit, whose first parent is the base branch; for a push, the commit before it.
# Files under enterprise/ (Metabase Commercial License, which this fork does not use) are left out.
#
#   .github/scripts/bcc-ci-changes.sh files            # every changed file that still exists
#   .github/scripts/bcc-ci-changes.sh clojure          # changed Clojure files to lint and format-check
#   .github/scripts/bcc-ci-changes.sh frontend         # changed JavaScript, TypeScript and CSS files
#   .github/scripts/bcc-ci-changes.sh backend-tests    # what to test for them, as items of a hawk :only vector
#
# BCC_CI_COMMIT checks another commit than HEAD. Needs a checkout with the parent commit (fetch-depth: 2).

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

files() {
  local commit=${BCC_CI_COMMIT:-HEAD}
  git diff --name-only --diff-filter=d "$commit^1" "$commit" -- . ':!enterprise/'
}

clojure() {
  # The same files ./bin/mage kondo-updated lints.
  files | grep -E '\.(clj|cljc|cljs)$' | grep -vE '^(\.clj-kondo|dev)/' || true
}

frontend() {
  files | grep -E '\.(js|jsx|ts|tsx|mjs|cjs|mts|cts|css)$' || true
}

# A changed file in src/metabase/<module>/ or test/metabase/<module>/ selects the module's test directory; a changed
# top-level namespace, its test namespace. Directories are quoted strings and namespaces symbols, as hawk's :only
# takes them.
backend_tests() {
  local file name test
  files | while read -r file; do
    case "$file" in
      src/metabase/*/* | test/metabase/*/*)
        name=${file#*/metabase/}
        test="test/metabase/${name%%/*}"
        [ -d "$test" ] && echo "\"$test\""
        ;;
      src/metabase/*.clj | src/metabase/*.cljc | test/metabase/*.clj | test/metabase/*.cljc)
        name=${file#*/metabase/}
        name=${name%.*}
        name=${name%_test}
        for test in "test/metabase/${name}_test.clj" "test/metabase/${name}_test.cljc"; do
          [ -f "$test" ] && echo "metabase.${name//_/-}-test"
        done
        ;;
      resources/migrations/*)
        echo '"test/metabase/app_db"'
        ;;
      .clj-kondo/src/* | .clj-kondo/test/*)
        echo '".clj-kondo/test"'
        ;;
    esac
  done | sort -u
}

case "${1:-}" in
  files) files ;;
  clojure) clojure ;;
  frontend) frontend ;;
  backend-tests) backend_tests ;;
  *)
    echo "Usage: $0 files|clojure|frontend|backend-tests" >&2
    exit 2
    ;;
esac
