(ns metabase.sso.init
  (:require
   [metabase.sso.ldap.settings]
   [metabase.sso.providers.google]
   [metabase.sso.providers.jwt]
   [metabase.sso.providers.ldap]
   [metabase.sso.providers.oidc]
   [metabase.sso.providers.slack-connect]
   [metabase.sso.providers.sso-oidc]
   [metabase.sso.settings]))
