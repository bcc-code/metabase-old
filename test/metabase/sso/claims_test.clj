(ns metabase.sso.claims-test
  (:require
   [clojure.test :refer :all]
   [metabase.sso.claims :as sso.claims]))

(def ^:private claims
  {"email"                            "ada@example.com"
   "given_name"                       "Ada"
   "https://example.com/claims/roles" ["admin" "analyst"]
   "https://example.com/claims/org"   {"id" 42, "country" "NO"}
   "realm_access"                     {"roles" ["viewer"]}
   "groups"                           "single-group"
   "empty_groups"                     []
   "number"                           7
   "flag"                             true
   "a"                                {"b" {"c" "deep"}}
   "a.b"                              "literal key wins"})

(deftest ^:parallel stringify-keys-test
  (testing "keyword keys from a JSON parser keep the namespace a namespaced claim name was split into"
    (is (= {"https://example.com/roles" ["x"]
            "nested"                    {"inner" 1}
            "list"                      [{"k" "v"}]}
           (sso.claims/stringify-keys {(keyword "https://example.com/roles") ["x"]
                                       :nested                               {:inner 1}
                                       :list                                 [{:k "v"}]})))))

(deftest ^:parallel claim-value-test
  (are [path expected] (= expected (sso.claims/claim-value claims path))
    "email"                                 "ada@example.com"
    "https://example.com/claims/roles"      ["admin" "analyst"]
    "https://example.com/claims/org.id"     42
    "https://example.com/claims/org.country" "NO"
    "realm_access.roles"                    ["viewer"]
    "a.b.c"                                 "deep"
    "a.b"                                   "literal key wins"
    "missing"                               nil
    "email.nested"                          nil
    ""                                      nil
    nil                                     nil)
  (testing "a claim name with a dot in it is found before a nested path"
    (is (= "literal key wins" (sso.claims/claim-value claims "a.b")))))

(deftest ^:parallel claim-string-test
  (is (= "Ada" (sso.claims/claim-string claims "given_name")))
  (is (= "7" (sso.claims/claim-string claims "number")))
  (is (= "true" (sso.claims/claim-string claims "flag")))
  (testing "lists and objects are not single values"
    (is (nil? (sso.claims/claim-string claims "https://example.com/claims/roles")))
    (is (nil? (sso.claims/claim-string claims "realm_access"))))
  (testing "blank strings count as missing"
    (is (nil? (sso.claims/claim-string {"name" "  "} "name")))))

(deftest ^:parallel claim-strings-test
  (is (= ["admin" "analyst"] (sso.claims/claim-strings claims "https://example.com/claims/roles")))
  (is (= ["viewer"] (sso.claims/claim-strings claims "realm_access.roles")))
  (testing "a single value is a list of one"
    (is (= ["single-group"] (sso.claims/claim-strings claims "groups"))))
  (testing "an empty list is not the same as a missing claim"
    (is (= [] (sso.claims/claim-strings claims "empty_groups")))
    (is (nil? (sso.claims/claim-strings claims "no_such_claim")))))

(deftest ^:parallel parse-attribute-mappings-test
  (is (= [] (sso.claims/parse-attribute-mappings nil)))
  (is (= [] (sso.claims/parse-attribute-mappings "  ")))
  (is (= [["country" "country"]
          ["org_id" "https://example.com/claims/org.id"]
          ["roles" "realm_access.roles"]]
         (sso.claims/parse-attribute-mappings
          "country, org_id = https://example.com/claims/org.id\nroles=realm_access.roles\n")))
  (testing "malformed entries are refused"
    (are [s message] (thrown-with-msg? clojure.lang.ExceptionInfo message (sso.claims/parse-attribute-mappings s))
      "=claim"          #"must look like name=claim"
      "name="           #"must look like name=claim"
      "@tenant=claim"   #"can't start with @"
      "a=x, a=y"        #"listed more than once")))

(deftest ^:parallel claims->attributes-test
  (let [mappings (sso.claims/parse-attribute-mappings
                  (str "email, roles=https://example.com/claims/roles, org_id=https://example.com/claims/org.id, "
                       "flag, org=https://example.com/claims/org, missing, mixed"))]
    (is (= {"email"  "ada@example.com"
            "roles"  "admin,analyst"
            "org_id" "42"
            "flag"   "true"}
           (sso.claims/claims->attributes (assoc claims "mixed" ["a" {"b" 1}]) mappings))
        "lists of values are joined with commas; objects, lists holding objects and missing claims are left out")))
