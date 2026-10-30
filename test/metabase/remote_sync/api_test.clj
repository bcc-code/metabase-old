(ns metabase.remote-sync.api-test
  "Tests for `/api/remote-sync`."
  (:require
   [clojure.test :refer :all]
   [metabase.remote-sync.git :as git]
   [metabase.remote-sync.settings :as settings]
   [metabase.remote-sync.tasks :as tasks]
   [metabase.remote-sync.test-util :as remote-sync.tu]
   [metabase.test :as mt]
   [metabase.util :as u]
   [toucan2.core :as t2]))

(set! *warn-on-reflection* true)

(deftest endpoints-are-for-admins-test
  (doseq [[method path body] [[:get "remote-sync/settings"]
                              [:put "remote-sync/settings" {:url "https://example.com/r.git" :branch "main"}]
                              [:delete "remote-sync/settings"]
                              [:post "remote-sync/test-connection" {:url "https://example.com/r.git"}]
                              [:get "remote-sync/status"]
                              [:get "remote-sync/task/1"]
                              [:get "remote-sync/changes"]
                              [:post "remote-sync/export" {}]
                              [:post "remote-sync/import" {}]
                              [:get "remote-sync/collections"]
                              [:put "remote-sync/collection/1" {:synced true}]]]
    (testing (str method " " path)
      (is (= "You don't have permissions to do that."
             (apply mt/user-http-request :rasta method 403 path (when body [body])))))))

(deftest settings-test
  (mt/with-temporary-setting-values [remote-sync-url                "https://git.example.com/old.git"
                                     remote-sync-token              "old-secret-token"
                                     remote-sync-branch             "main"
                                     remote-sync-type               :read-write
                                     remote-sync-auto-import        false
                                     remote-sync-last-synced-commit "abc"]
    (testing "GET never returns the token"
      (let [response (mt/user-http-request :crowberto :get 200 "remote-sync/settings")]
        (is (=? {:enabled true, :url "https://git.example.com/old.git", :branch "main", :token_set true
                 :type "read-write", :auto_import false}
                response))
        (is (not (re-find #"old-secret-token" (pr-str response))))))
    (testing "PUT rejects a URL that isn't HTTPS"
      (is (=? #"Enter the HTTPS URL of the repository.*"
              (mt/user-http-request :crowberto :put 400 "remote-sync/settings"
                                    {:url "git@github.com:org/repo.git" :branch "main"}))))
    (testing "PUT rejects an invalid branch name"
      (mt/user-http-request :crowberto :put 400 "remote-sync/settings"
                            {:url "https://git.example.com/new.git" :branch "bad branch"}))
    (testing "PUT saves nothing when the repository can't be reached"
      (mt/with-dynamic-fn-redefs [git/remote-heads (fn [_] (throw (ex-info "Git operation failed: not authorized"
                                                                           {:status-code 400})))]
        (is (= "Git operation failed: not authorized"
               (mt/user-http-request :crowberto :put 400 "remote-sync/settings"
                                     {:url "https://git.example.com/new.git" :branch "main" :token "bad"}))))
      (is (= "https://git.example.com/old.git" (settings/remote-sync-url))))
    (testing "PUT checks the connection with the saved token when none is given, then saves"
      (let [used-config (atom nil)]
        (mt/with-dynamic-fn-redefs [git/remote-heads (fn [config]
                                                       (reset! used-config config)
                                                       {"develop" "123", "main" "456"})]
          (is (=? {:branches      ["develop" "main"]
                   :branch_exists true
                   :settings      {:url "https://git.example.com/new.git", :type "read-only", :auto_import true
                                   :auto_import_interval 30, :token_set true}}
                  (mt/user-http-request :crowberto :put 200 "remote-sync/settings"
                                        {:url                  "https://git.example.com/new.git"
                                         :branch               "main"
                                         :type                 "read-only"
                                         :auto_import          true
                                         :auto_import_interval 30}))))
        (is (= "old-secret-token" (:token @used-config)))
        (is (= "old-secret-token" (settings/remote-sync-token)))
        (testing "a new repository forgets the commit last synced"
          (is (nil? (settings/remote-sync-last-synced-commit))))))
    (testing "DELETE disconnects"
      (is (=? {:enabled false, :url nil, :token_set false, :type "read-write"}
              (mt/user-http-request :crowberto :delete 200 "remote-sync/settings"))))))

(deftest test-connection-test
  (mt/with-dynamic-fn-redefs [git/remote-heads (fn [{:keys [url token]}]
                                                 (is (= "https://git.example.com/r.git" url))
                                                 (is (= "tok" token))
                                                 {"main" "1"})]
    (is (= {:branches ["main"], :branch_exists false}
           (mt/user-http-request :crowberto :post 200 "remote-sync/test-connection"
                                 {:url "https://git.example.com/r.git" :token "tok" :branch "develop"})))))

(deftest choose-synced-collections-test
  (mt/with-temp [:model/Collection parent  {:name "Parent" :location "/"}
                 :model/Collection child   {:name "Child" :location (format "/%d/" (:id parent))}
                 :model/Collection outside {:name "Outside" :location "/"}
                 :model/Card       base    {:name "Base" :collection_id (:id outside)}
                 :model/Card       derived {:name          "Derived"
                                            :collection_id (:id child)
                                            :dataset_query (mt/mbql-query nil {:source-table (str "card__" (:id base))})}]
    (testing "top-level collections are listed"
      (is (=? [{:id (:id parent), :name "Parent", :is_remote_synced false}]
              (filter #(= (:id parent) (:id %))
                      (mt/user-http-request :crowberto :get 200 "remote-sync/collections")))))
    (testing "a collection using content outside synced collections can't be synced"
      (is (re-find #"Card \"Base\""
                   (mt/user-http-request :crowberto :put 400 (str "remote-sync/collection/" (:id parent))
                                         {:synced true})))
      (is (false? (t2/select-one-fn :is_remote_synced :model/Collection :id (:id child)))))
    (t2/update! :model/Card (:id derived) {:dataset_query (mt/mbql-query venues)})
    (testing "syncing a collection syncs everything under it"
      (is (=? {:id (:id parent) :is_remote_synced true}
              (mt/user-http-request :crowberto :put 200 (str "remote-sync/collection/" (:id parent)) {:synced true})))
      (is (true? (t2/select-one-fn :is_remote_synced :model/Collection :id (:id child)))))
    (testing "only top-level collections are chosen"
      (mt/user-http-request :crowberto :put 400 (str "remote-sync/collection/" (:id child)) {:synced false}))
    (testing "a read-only instance takes its synced collections from the repository"
      (mt/with-temporary-setting-values [remote-sync-url "https://git.example.com/r.git" remote-sync-type :read-only]
        (mt/user-http-request :crowberto :put 400 (str "remote-sync/collection/" (:id parent)) {:synced false})))
    (testing "unsyncing"
      (is (=? {:is_remote_synced false}
              (mt/user-http-request :crowberto :put 200 (str "remote-sync/collection/" (:id parent)) {:synced false})))
      (is (false? (t2/select-one-fn :is_remote_synced :model/Collection :id (:id child)))))))

(defn- wait-for-task [task-id]
  (u/poll {:thunk       #(mt/user-http-request :crowberto :get 200 (str "remote-sync/task/" task-id))
           :done?       #(not= "running" (:status %))
           :timeout-ms  30000
           :interval-ms 100}))

(deftest export-and-import-through-the-api-test
  (remote-sync.tu/with-sync-cleanup
    (remote-sync.tu/do-with-git-repo! (fn [repo]
                                        ;; not `with-temp`: exports and imports run on threads of their own, which must see this content
                                        (let [synced (t2/insert-returning-instance! :model/Collection {:name "Synced" :is_remote_synced true :location "/"})
                                              card   (t2/insert-returning-instance! :model/Card (assoc (mt/with-temp-defaults :model/Card)
                                                                                                       :name "Synced card"
                                                                                                       :collection_id (:id synced)))]
                                          (testing "the new content shows as changed"
                                            (is (=? {:dirty               [{:name "Synced" :model "collection" :sync_status "create"}
                                                                           {:name "Synced card" :model "card" :sync_status "create"}]
                                                     :changed_collections {(:id synced) true}}
                                                    (mt/user-http-request :crowberto :get 200 "remote-sync/changes"))))
                                          (testing "export"
                                            (let [task (mt/user-http-request :crowberto :post 200 "remote-sync/export" {:message "From the API"})]
                                              (is (=? {:sync_task_type "export", :initiated_by (mt/user->id :crowberto)} task))
                                              (is (=? {:status            "successful"
                                                       :outcome           {:kind "pushed", :count 2, :branch "main"}
                                                       :initiated_by_user {:email "crowberto@metabase.com"}}
                                                      (wait-for-task (:id task))))
                                              (is (= 2 (count (remote-sync.tu/repo-files! repo))))))
                                          (testing "status"
                                            (is (=? {:enabled            true
                                                     :branch             "main"
                                                     :type               "read-write"
                                                     :last_synced_commit string?
                                                     :current_task       nil
                                                     :last_export        {:status "successful"}}
                                                    (mt/user-http-request :crowberto :get 200 "remote-sync/status")))
                                            (is (= {:dirty [], :changed_collections {}}
                                                   (mt/user-http-request :crowberto :get 200 "remote-sync/changes"))))
                                          (testing "a forced import discards a local change"
                                            (t2/update! :model/Card (:id card) {:name "Changed here"})
                                            (let [task (mt/user-http-request :crowberto :post 200 "remote-sync/import" {:force true})]
                                              (is (=? {:status "successful", :outcome {:kind "pulled"}} (wait-for-task (:id task)))))
                                            (is (= "Synced card" (t2/select-one-fn :name :model/Card :id (:id card)))))
                                          (testing "only one task runs at a time"
                                            (let [running (tasks/claim-task! :import nil)]
                                              (is (re-find #"Another Git sync export or import is running"
                                                           (mt/user-http-request :crowberto :post 409 "remote-sync/export" {})))
                                              (tasks/run-task! running "remote-sync-import" (fn [_] {:outcome {:kind "pull-skipped"}}))))
                                          (testing "a read-only instance doesn't export"
                                            (mt/with-temporary-setting-values [remote-sync-type :read-only]
                                              (mt/user-http-request :crowberto :post 400 "remote-sync/export" {}))))))))
