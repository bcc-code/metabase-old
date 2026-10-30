(ns metabase.permissions.application-permissions-test
  "Tests for application permissions: the graph API, and the access to Settings, Monitoring tools, and subscriptions
  and alerts they grant."
  (:require
   [clojure.test :refer :all]
   [metabase.permissions.advanced-test-util :as advanced-test-util]
   [metabase.permissions.core :as perms]
   [metabase.settings.core :as setting]
   [metabase.test :as mt]
   [metabase.test.fixtures :as fixtures]
   [metabase.util :as u]
   [toucan2.core :as t2]))

(use-fixtures :once (fixtures/initialize :db :test-users))

(defn- graph-for-group [graph group-id]
  (get-in graph [:groups group-id]))

(deftest application-graph-read-test
  (advanced-test-util/with-advanced-permissions
    (mt/with-temp [:model/PermissionsGroup {group-id :id} {}]
      (testing "GET /api/permissions/application/graph"
        (let [graph (mt/user-http-request :crowberto :get 200 "permissions/application/graph")]
          (is (nat-int? (:revision graph)))
          (testing "Administrators hold every application permission"
            (is (= {:setting "yes", :monitoring "yes", :subscription "yes"}
                   (graph-for-group graph (u/the-id (perms/admin-group))))))
          (testing "All Users can create subscriptions and alerts by default"
            (is (= "yes" (:subscription (graph-for-group graph (u/the-id (perms/all-users-group)))))))
          (testing "a new group holds no application permissions"
            (is (= {:setting "no", :monitoring "no", :subscription "no"}
                   (graph-for-group graph group-id)))))
        (testing "requires superuser"
          (is (= "You don't have permissions to do that."
                 (mt/user-http-request :rasta :get 403 "permissions/application/graph")))))))
  (testing "requires the advanced-permissions feature"
    (advanced-test-util/without-advanced-permissions
      (mt/user-http-request :crowberto :get 402 "permissions/application/graph"))))

(deftest application-graph-update-test
  (advanced-test-util/with-advanced-permissions
    (mt/with-temp [:model/PermissionsGroup {group-id :id} {}]
      (let [{:keys [revision]} (mt/user-http-request :crowberto :get 200 "permissions/application/graph")
            put-graph!         (fn [expected-status graph]
                                 (mt/user-http-request :crowberto :put expected-status
                                                       "permissions/application/graph" graph))]
        (testing "granting and revoking round-trips through the graph"
          (let [updated (put-graph! 200 {:revision revision
                                         :groups   {group-id {:setting "yes" :monitoring "yes"}}})]
            (is (= {:setting "yes", :monitoring "yes", :subscription "no"}
                   (graph-for-group updated group-id)))
            (is (= (inc revision) (:revision updated)))
            (is (= {:setting :yes, :monitoring :yes, :subscription :no}
                   (get-in (perms/application-permissions-graph) [:groups group-id])))
            (testing "the change is recorded as a revision"
              (is (= {(keyword (str group-id)) {:setting "yes", :monitoring "yes"}}
                     (t2/select-one-fn :after :model/ApplicationPermissionsRevision :id (:revision updated)))))
            (let [revoked (put-graph! 200 {:revision (:revision updated)
                                           :groups   {group-id {:monitoring "no"}}})]
              (is (= {:setting "yes", :monitoring "no", :subscription "no"}
                     (graph-for-group revoked group-id))))))
        (testing "a graph based on an old revision is rejected"
          (put-graph! 409 {:revision revision
                           :groups   {group-id {:subscription "yes"}}})
          (is (= :no (get-in (perms/application-permissions-graph) [:groups group-id :subscription]))))
        (testing "unless forced"
          (put-graph! 200 {:revision revision
                           :force    true
                           :groups   {group-id {:subscription "yes"}}})
          (is (= :yes (get-in (perms/application-permissions-graph) [:groups group-id :subscription]))))
        (let [revision (:revision (perms/application-permissions-graph))]
          (testing "the Administrators group can't lose application permissions"
            (put-graph! 400 {:revision revision
                             :groups   {(u/the-id (perms/admin-group)) {:setting "no"}}}))
          (testing "unknown groups are rejected"
            (put-graph! 404 {:revision revision
                             :groups   {Integer/MAX_VALUE {:setting "yes"}}}))
          (testing "requires superuser"
            (mt/user-http-request :rasta :put 403 "permissions/application/graph"
                                  {:revision revision
                                   :groups   {group-id {:setting "no"}}})
            (is (= :yes (get-in (perms/application-permissions-graph) [:groups group-id :setting])))))))))

(deftest settings-access-test
  (advanced-test-util/with-advanced-permissions
    (mt/with-user-in-groups [group {:name "Settings managers"}
                             user  [group]]
      (mt/with-temporary-setting-values [site-name "Bird Watchers"]
        (testing "without the Settings permission"
          (mt/user-http-request user :get 403 "setting")
          (mt/user-http-request user :put 403 "setting/site-name" {:value "Pigeon Fanciers"})
          (is (= "Bird Watchers" (setting/get :site-name))))
        (perms/grant-application-permissions! group :setting)
        (testing "with the Settings permission"
          (testing "can list and change the settings settings managers may manage"
            (let [settings (into #{} (map :key) (mt/user-http-request user :get 200 "setting"))]
              (is (contains? settings "site-name"))
              (is (not (contains? settings "hide-stacktraces"))))
            (mt/user-http-request user :put 204 "setting/site-name" {:value "Pigeon Fanciers"})
            (is (= "Pigeon Fanciers" (setting/get :site-name))))
          (testing "can't change admin-only settings"
            (mt/user-http-request user :put 403 "setting/hide-stacktraces" {:value true}))
          (testing "can't escalate: permissions, people and API keys stay admin-only"
            (mt/user-http-request user :get 403 "permissions/graph")
            (mt/user-http-request user :put 403 "permissions/application/graph"
                                  {:revision (:revision (perms/application-permissions-graph))
                                   :groups   {(u/the-id group) {:monitoring "yes"}}})
            (mt/user-http-request user :get 403 "user")
            (mt/user-http-request user :post 403 "permissions/membership"
                                  {:group_id (u/the-id (perms/admin-group))
                                   :user_id  (u/the-id user)})
            (mt/user-http-request user :get 403 "api-key"))
          (testing "while the feature is disabled the permission grants nothing"
            (advanced-test-util/without-advanced-permissions
              (mt/user-http-request user :get 403 "setting"))))))))

(deftest admin-only-setting?-test
  (testing "settings that decide who can sign in or what code runs stay with admins"
    (doseq [setting-name ["mfa-enforcement" "oidc-enabled" "enable-password-login" "remote-sync-token" "session-timeout"
                          "google-auth-client-id" "site-url" "email-smtp-host" "api-key-prefix" "embedding-app-origins-sdk"
                          "allowed-iframe-hosts" "slack-connect-client-secret" "mcp-enabled?"
                          "llm-anthropic-api-key" "llm-proxy-base-url" "metabot-sql-system-prompt"]]
      (testing setting-name
        (is (true? (setting/admin-only-setting? setting-name))))))
  (testing "other settings don't"
    (doseq [setting-name ["site-name" "email-from-name" "report-timezone" "enable-public-sharing" "slack-app-token"]]
      (testing setting-name
        (is (false? (setting/admin-only-setting? setting-name)))))))

(deftest settings-managers-cannot-change-sign-in-or-code-settings-test
  (advanced-test-util/with-advanced-permissions
    (mt/with-user-in-groups [group {:name "Settings managers"}
                             user  [group]]
      (perms/grant-application-permissions! group :setting)
      (mt/with-temporary-setting-values [site-name "Bird Watchers"]
        (testing "settings managers can't write authentication, session or code settings"
          (doseq [[setting-name value] {"mfa-enforcement"       "off"
                                        "oidc-enabled"          false
                                        "enable-password-login" false
                                        "remote-sync-token"     "a-token"
                                        "site-url"              "https://attacker.example"
                                        "email-smtp-host"       "smtp.attacker.example"}]
            (testing setting-name
              (is (= "You don't have permissions to do that."
                     (mt/user-http-request user :put 403 (str "setting/" setting-name) {:value value}))))))
        (testing "nor read them through the settings API"
          (mt/user-http-request user :get 403 "setting/oidc-enabled")
          (let [listed (into #{} (map :key) (mt/user-http-request user :get 200 "setting"))]
            (is (contains? listed "site-name"))
            (is (not-any? listed ["mfa-enforcement" "site-url" "enable-password-login" "email-smtp-host"]))))
        (testing "nor sneak one into a bulk update"
          (mt/user-http-request user :put 403 "setting" {:site-name             "Pigeon Fanciers"
                                                         :enable-password-login false})
          (is (= "Bird Watchers" (setting/get :site-name))))
        (testing "nor configure the SMTP server or Slack Connect through their own endpoints"
          (mt/user-http-request user :put 403 "email" {:email-smtp-host "smtp.attacker.example"
                                                       :email-smtp-port 587})
          (mt/user-http-request user :delete 403 "email")
          (mt/user-http-request user :put 403 "metabot/slack/settings" {:slack-connect-client-id      nil
                                                                        :slack-connect-client-secret  nil
                                                                        :metabot-slack-signing-secret nil}))
        (testing "but can still change harmless settings"
          (mt/user-http-request user :put 204 "setting/site-name" {:value "Pigeon Fanciers"})
          (is (= "Pigeon Fanciers" (setting/get :site-name))))
        (testing "admins can still change them"
          (mt/with-temporary-setting-values [enable-password-login true]
            (mt/user-http-request :crowberto :put 204 "setting/enable-password-login" {:value true})))))))

(deftest monitoring-access-test
  (advanced-test-util/with-advanced-permissions
    (mt/with-user-in-groups [group {:name "Monitors"}
                             user  [group]]
      (testing "without the Monitoring permission"
        (mt/user-http-request user :get 403 "task")
        (mt/user-http-request user :get 403 "logger/logs"))
      (perms/grant-application-permissions! group :monitoring)
      (testing "with the Monitoring permission"
        (is (map? (mt/user-http-request user :get 200 "task")))
        (testing "it doesn't grant access to settings"
          (mt/user-http-request user :get 403 "setting"))))))

(deftest subscription-access-test
  (advanced-test-util/with-advanced-permissions
    (mt/with-model-cleanup [:model/Pulse]
      (mt/with-user-in-groups [group {:name "Subscribers"}
                               user  [group]]
        (mt/with-non-admin-groups-no-root-collection-perms
          (mt/with-temp [:model/Collection {collection-id :id} {}
                         :model/Card       card {:collection_id collection-id}]
            (perms/grant-collection-read-permissions! group collection-id)
            (let [create-pulse! (fn [expected-status]
                                  (mt/user-http-request user :post expected-status "pulse"
                                                        {:name     "Birds"
                                                         :cards    [{:id                (u/the-id card)
                                                                     :include_csv       false
                                                                     :include_xls       false
                                                                     :dashboard_card_id nil}]
                                                         :channels [{:enabled       true
                                                                     :channel_type  "email"
                                                                     :schedule_type "daily"
                                                                     :schedule_hour 12
                                                                     :schedule_day  nil
                                                                     :recipients    []}]}))]
              (try
                (perms/revoke-application-permissions! (perms/all-users-group) :subscription)
                (testing "without the subscriptions permission"
                  (create-pulse! 403))
                (perms/grant-application-permissions! group :subscription)
                (testing "with the subscriptions permission"
                  (create-pulse! 200))
                (finally
                  (perms/grant-application-permissions! (perms/all-users-group) :subscription))))))))))

(deftest current-user-advanced-permissions-test
  (testing "GET /api/user/current reports the user's advanced permissions"
    (mt/with-user-in-groups [group {:name "Settings and monitoring"}
                             user  [group]]
      (perms/grant-application-permissions! group :setting)
      (perms/grant-application-permissions! group :monitoring)
      (advanced-test-util/with-advanced-permissions
        (is (=? {:can_access_setting      true
                 :can_access_monitoring   true
                 :can_access_subscription true
                 :can_access_data_model   false
                 :can_access_db_details   false
                 :is_group_manager        false}
                (:permissions (mt/user-http-request user :get 200 "user/current"))))
        (is (=? {:can_access_setting    true
                 :can_access_monitoring true
                 :can_access_data_model true
                 :can_access_db_details true}
                (:permissions (mt/user-http-request :crowberto :get 200 "user/current")))))
      (testing "the flags are left out while the feature is disabled"
        (advanced-test-util/without-advanced-permissions
          (is (not (contains? (:permissions (mt/user-http-request user :get 200 "user/current"))
                              :can_access_setting))))))))
