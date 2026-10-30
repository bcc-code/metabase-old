(ns metabase.data-access.core
  "Row and column security (sandboxes), connection impersonation and blocked data access, as the rest of the app
  uses them. The `defenterprise` hooks of other modules call these through `requiring-resolve`, so loading them never
  depends on this module being initialized first."
  (:require
   [metabase.data-access.impersonation]
   [metabase.data-access.permissions-graph]
   [metabase.data-access.query-processor]
   [metabase.data-access.questions]
   [metabase.data-access.sandbox]
   [potemkin :as p]))

(comment
  metabase.data-access.impersonation/keep-me
  metabase.data-access.permissions-graph/keep-me
  metabase.data-access.query-processor/keep-me
  metabase.data-access.questions/keep-me
  metabase.data-access.sandbox/keep-me)

(p/import-vars
 [metabase.data-access.sandbox
  batch-filter-sandboxed-fields
  current-user-sandboxes
  enforced-sandboxes-for-user
  filter-sandboxed-fields
  hash-input-for-sandbox
  sandbox-restricted-fields
  sandbox-token-for-table
  sandboxed-group-ids-in-database
  sandboxed-user-for-db?
  sandboxed-user?]
 [metabase.data-access.impersonation
  apply-impersonation
  apply-impersonation-postprocessing
  currently-impersonated?
  hash-input-for-impersonation
  impersonated-user?
  impersonation-enforced-for-db?
  impersonation-token-for-db
  set-role-if-supported!]
 [metabase.data-access.query-processor
  apply-sandboxing
  check-block-permissions
  merge-sandboxing-metadata]
 [metabase.data-access.permissions-graph
  add-impersonations-to-permissions-graph
  add-sandboxes-to-permissions-graph
  check-native-access-without-sandboxes!
  delete-impersonations-if-needed-after-permissions-change!
  delete-sandboxes-if-needed-after-permissions-change!
  insert-impersonations!
  upsert-sandboxes!]
 [metabase.data-access.questions
  pre-delete-check-sandbox-constraints
  pre-update-check-sandbox-constraints])
