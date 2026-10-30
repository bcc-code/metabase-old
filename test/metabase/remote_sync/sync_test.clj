(ns metabase.remote-sync.sync-test
  "Export and import round trips against a local bare repository, so no network is needed."
  (:require
   [babashka.fs :as fs]
   [clojure.java.io :as io]
   [clojure.string :as str]
   [clojure.test :refer :all]
   [metabase.remote-sync.changes :as changes]
   [metabase.remote-sync.settings :as settings]
   [metabase.remote-sync.storage :as storage]
   [metabase.remote-sync.sync :as sync]
   [metabase.remote-sync.test-util :as remote-sync.tu]
   [metabase.test :as mt]
   [metabase.util :as u]
   [toucan2.core :as t2]))

(set! *warn-on-reflection* true)

(defn- snippet-query [snippet]
  (let [tag (str "snippet: " (:name snippet))]
    (mt/native-query {:query         (str "SELECT * FROM ORDERS WHERE {{" tag "}}")
                      :template-tags {tag {:id           "c6f5c2a1"
                                           :name         tag
                                           :display-name "Snippet"
                                           :type         :snippet
                                           :snippet-name (:name snippet)
                                           :snippet-id   (:id snippet)}}})))

(defn- do-with-synced-content
  "Create synced content and call `f` with a map of it: a synced Collection `:sales` with a child `:region`, a question
  `:orders`, a native question `:native` using the snippet `:snippet` in the snippet folder `:folder`, a dashboard
  `:dash` showing `:orders` and holding the dashboard question `:dq`, and a question `:unsynced` in the Collection
  `:other`, which isn't synced."
  [f]
  (mt/with-temp [:model/Collection         sales    {:name "Sales" :is_remote_synced true :location "/"}
                 :model/Collection         region   {:name             "Region EMEA"
                                                     :is_remote_synced true
                                                     :location         (str "/" (:id sales) "/")}
                 :model/Collection         other    {:name "Scratch" :location "/"}
                 :model/Collection         folder   {:name "Shared SQL" :namespace "snippets" :location "/"}
                 :model/NativeQuerySnippet snippet  {:name          (mt/random-name)
                                                     :content       "TOTAL > 10"
                                                     :collection_id (:id folder)}
                 :model/Card               orders   {:name          "Orders"
                                                     :collection_id (:id sales)
                                                     :dataset_query (mt/mbql-query orders {:limit 10})}
                 :model/Card               native   {:name          "Big orders"
                                                     :collection_id (:id region)
                                                     :dataset_query (snippet-query snippet)}
                 :model/Card               unsynced {:name          "Unsynced"
                                                     :collection_id (:id other)
                                                     :dataset_query (mt/mbql-query venues)}
                 :model/Dashboard          dash     {:name "Sales overview" :collection_id (:id sales)}
                 :model/Card               dq       {:name          "Dashboard question"
                                                     :collection_id (:id sales)
                                                     :dashboard_id  (:id dash)
                                                     :dataset_query (mt/mbql-query venues {:limit 5})}
                 :model/DashboardCard      _        {:dashboard_id (:id dash) :card_id (:id orders) :row 0 :col 0}
                 :model/DashboardCard      _        {:dashboard_id (:id dash) :card_id (:id dq) :row 0 :col 4}]
    (f {:sales sales, :region region, :other other, :folder folder, :snippet snippet, :orders orders, :native native
        :unsynced unsynced, :dash dash, :dq dq})))

(defn- by-entity-id [model entity-id]
  (t2/select-one model :entity_id entity-id))

(defn- delete-synced-content!
  "Delete `content` from the app DB, as if this were a fresh instance."
  [{:keys [sales dash orders native dq snippet folder]}]
  (t2/delete! :model/Dashboard :id (:id dash))
  (t2/delete! :model/Card :id [:in (map :id [orders native dq])])
  (t2/delete! :model/Collection :id (:id sales))
  (t2/delete! :model/NativeQuerySnippet :id (:id snippet))
  (t2/delete! :model/Collection :id (:id folder)))

(deftest export-writes-one-yaml-file-per-entity-test
  (remote-sync.tu/with-sync-cleanup
    (remote-sync.tu/do-with-git-repo! (fn [repo]
                                        (do-with-synced-content (fn [{:keys [sales region folder snippet orders native unsynced dash dq]}]
                                                                  (let [{:keys [commit outcome]} (sync/export! {:message "First export"})
                                                                        files                    (remote-sync.tu/repo-files! repo)
                                                                        sales-dir                (str "collections/" (:entity_id sales) "_sales")]
                                                                    (testing "the export commits and pushes"
                                                                      (is (=? {:kind "pushed", :count 8, :branch "main"} outcome))
                                                                      (is (string? commit))
                                                                      (is (= commit (settings/remote-sync-last-synced-commit))))
                                                                    (testing "the files mirror the collection tree"
                                                                      (is (= #{(str sales-dir "/collection.yaml")
                                                                               (str sales-dir "/" (:entity_id region) "_region_emea/collection.yaml")
                                                                               (str sales-dir "/cards/" (:entity_id orders) "_orders.yaml")
                                                                               (str sales-dir "/cards/" (:entity_id dq) "_dashboard_question.yaml")
                                                                               (str sales-dir "/" (:entity_id region) "_region_emea/cards/" (:entity_id native) "_big_orders.yaml")
                                                                               (str sales-dir "/dashboards/" (:entity_id dash) "_sales_overview.yaml")
                                                                               (str "snippets/" (:entity_id folder) "_shared_sql/collection.yaml")
                                                                               (str "snippets/" (:entity_id folder) "_shared_sql/" (:entity_id snippet) "_"
                                                                                    (u/slugify (:name snippet)) ".yaml")}
                                                                             (set (keys files)))))
                                                                    (testing "content outside synced collections stays out"
                                                                      (is (not-any? #(str/includes? % (:entity_id unsynced)) (keys files))))
                                                                    (testing "files hold portable references"
                                                                      (let [card (storage/yaml->entity (get files (str sales-dir "/cards/" (:entity_id orders) "_orders.yaml")) "x")]
                                                                        (is (=? {:name          "Orders"
                                                                                 :entity_id     (:entity_id orders)
                                                                                 :collection_id (:entity_id sales)
                                                                                 :serdes/meta   [{:model "Card" :id (:entity_id orders)}]
                                                                                 :dataset_query {:database string?}}
                                                                                card))))
                                                                    (testing "nothing is left to export"
                                                                      (is (= [] (changes/local-changes)))
                                                                      (is (= {:kind "push-skipped"} (:outcome (sync/export! {}))))))))))))

(deftest round-trip-test
  (testing "importing into an instance without the content recreates it with the same entity ids"
    (remote-sync.tu/with-sync-cleanup
      (remote-sync.tu/do-with-git-repo! (fn [_repo]
                                          (do-with-synced-content (fn [{:keys [sales region folder snippet orders native dash dq] :as content}]
                                                                    (sync/export! {})
                                                                    (delete-synced-content! content)
                                                                    (is (=? {:outcome {:kind "pulled", :count 8}} (sync/import! {:force? true})))
                                                                    (let [sales'   (by-entity-id :model/Collection (:entity_id sales))
                                                                          region'  (by-entity-id :model/Collection (:entity_id region))
                                                                          folder'  (by-entity-id :model/Collection (:entity_id folder))
                                                                          snippet' (by-entity-id :model/NativeQuerySnippet (:entity_id snippet))
                                                                          orders'  (by-entity-id :model/Card (:entity_id orders))
                                                                          native'  (by-entity-id :model/Card (:entity_id native))
                                                                          dash'    (by-entity-id :model/Dashboard (:entity_id dash))
                                                                          dq'      (by-entity-id :model/Card (:entity_id dq))]
                                                                      (testing "collections, with their hierarchy and sync flag"
                                                                        (is (=? {:name "Sales" :location "/" :is_remote_synced true} sales'))
                                                                        (is (=? {:name "Region EMEA" :location (str "/" (:id sales') "/") :is_remote_synced true} region'))
                                                                        (is (=? {:name "Shared SQL" :namespace :snippets} folder')))
                                                                      (testing "questions and the snippet they use"
                                                                        (is (=? {:name "Orders" :collection_id (:id sales') :dataset_query {:stages [{:limit 10}]}} orders'))
                                                                        (is (=? {:name (:name snippet) :collection_id (:id folder') :content "TOTAL > 10"} snippet'))
                                                                        (is (= (:id snippet')
                                                                               (let [tags (-> native' :dataset_query :stages first :template-tags)]
                                                                                 (some :snippet-id (if (map? tags) (vals tags) tags))))))
                                                                      (testing "the dashboard and its dashboard question, which depend on each other"
                                                                        (is (=? {:name "Dashboard question" :dashboard_id (:id dash') :collection_id (:id sales')} dq'))
                                                                        (is (= #{(:id orders') (:id dq')}
                                                                               (set (map :card_id (t2/select :model/DashboardCard :dashboard_id (:id dash')))))))
                                                                      (testing "nothing changed since the import"
                                                                        (is (= [] (changes/local-changes))))))))))))

(defn- edit-yaml-file!
  "Apply `f` to the serialized entity in the file at `path` in the checkout `dir`."
  [dir path f]
  (let [file (io/file dir path)]
    (spit file (storage/entity->yaml (f (storage/yaml->entity (slurp file) path))))))

(defn- file-of [dir entity-id]
  (some #(when (str/includes? (str %) entity-id) (str (fs/relativize (fs/path dir) %)))
        (fs/glob dir "**.yaml")))

(deftest import-applies-changes-made-elsewhere-test
  (remote-sync.tu/with-sync-cleanup
    (remote-sync.tu/do-with-git-repo! (fn [repo]
                                        (do-with-synced-content (fn [{:keys [sales orders native dash dq]}]
                                                                  (sync/export! {})
                                                                  (let [base-eid    (u/generate-nano-id)
                                                                        derived-eid (u/generate-nano-id)]
                                                                    (remote-sync.tu/do-with-other-checkout! repo (fn [dir]
                                                                                                                   (testing "rename a question"
                                                                                                                     (edit-yaml-file! dir (file-of dir (:entity_id orders)) #(assoc % :name "Orders (renamed)")))
                                                                                                                   (testing "delete the dashboard, with its dashboard question"
                                                                                                                     (fs/delete (io/file dir (file-of dir (:entity_id dash))))
                                                                                                                     (fs/delete (io/file dir (file-of dir (:entity_id dq)))))
                                                                                                                   (testing "add a question based on another new question; the derived one sorts first"
                                                                                                                     (let [template (storage/yaml->entity (slurp (io/file dir (file-of dir (:entity_id orders)))) "x")
                                                                                                                           card     (fn [eid card-name query]
                                                                                                                                      (-> template
                                                                                                                                          (assoc :entity_id eid, :name card-name, :dataset_query query
                                                                                                                                                 :serdes/meta [{:model "Card" :id eid}])
                                                                                                                                          (dissoc :result_metadata)))
                                                                                                                           dir-path (str (fs/parent (io/file dir (file-of dir (:entity_id orders)))))]
                                                                                                                       (spit (io/file dir-path (str "0_" derived-eid ".yaml"))
                                                                                                                             (storage/entity->yaml (card derived-eid "Derived"
                                                                                                                                                         (-> (:dataset_query template)
                                                                                                                                                             (assoc-in [:stages 0] {:lib/type    "mbql.stage/mbql"
                                                                                                                                                                                    :source-card base-eid})))))
                                                                                                                       (spit (io/file dir-path (str "1_" base-eid ".yaml"))
                                                                                                                             (storage/entity->yaml (card base-eid "Base" (:dataset_query template))))))))
                                                                    (testing "the import applies every change"
                                                                      (is (=? {:outcome {:kind "pulled"}} (sync/import! {})))
                                                                      (is (= "Orders (renamed)" (:name (t2/select-one :model/Card :id (:id orders)))))
                                                                      (is (nil? (t2/select-one :model/Dashboard :id (:id dash))))
                                                                      (is (nil? (t2/select-one :model/Card :id (:id dq))))
                                                                      (is (some? (t2/select-one :model/Card :id (:id native))))
                                                                      (let [base    (by-entity-id :model/Card base-eid)
                                                                            derived (by-entity-id :model/Card derived-eid)]
                                                                        (is (=? {:name "Base" :collection_id (:id sales)} base))
                                                                        (is (=? {:name "Derived" :dataset_query {:stages [{:source-card (:id base)}]}} derived)))
                                                                      (is (= [] (changes/local-changes)))))))))))

(deftest import-refuses-to-overwrite-local-changes-test
  (remote-sync.tu/with-sync-cleanup
    (remote-sync.tu/do-with-git-repo! (fn [repo]
                                        (do-with-synced-content (fn [{:keys [orders native]}]
                                                                  (sync/export! {})
                                                                  (remote-sync.tu/do-with-other-checkout! repo (fn [dir]
                                                                                                                 (edit-yaml-file! dir (file-of dir (:entity_id native)) #(assoc % :name "Renamed elsewhere"))))
                                                                  (t2/update! :model/Card (:id orders) {:name "Renamed here"})
                                                                  (testing "without force, the import stops and names the local changes"
                                                                    (let [e (is (thrown? clojure.lang.ExceptionInfo (sync/import! {})))]
                                                                      (is (=? {::sync/conflict :local-changes
                                                                               :conflicts      [#".*Renamed here"]}
                                                                              (ex-data e))))
                                                                    (is (= "Big orders" (t2/select-one-fn :name :model/Card :id (:id native)))))
                                                                  (testing "with force, the branch wins"
                                                                    (sync/import! {:force? true})
                                                                    (is (= "Orders" (t2/select-one-fn :name :model/Card :id (:id orders))))
                                                                    (is (= "Renamed elsewhere" (t2/select-one-fn :name :model/Card :id (:id native)))))))))))

(deftest import-removes-local-content-missing-from-the-branch-test
  (remote-sync.tu/with-sync-cleanup
    (remote-sync.tu/do-with-git-repo! (fn [_repo]
                                        (do-with-synced-content (fn [{:keys [sales unsynced]}]
                                                                  (sync/export! {})
                                                                  (mt/with-temp [:model/Card local-only {:name "Local only" :collection_id (:id sales)}]
                                                                    (testing "a question created here is a local change"
                                                                      (is (=? [{:name "Local only" :sync_status "create"}] (changes/local-changes))))
                                                                    (testing "a forced import discards it, and leaves content that isn't synced alone"
                                                                      (sync/import! {:force? true})
                                                                      (is (nil? (t2/select-one :model/Card :id (:id local-only))))
                                                                      (is (some? (t2/select-one :model/Card :id (:id unsynced))))))))))))

(deftest export-refuses-to-overwrite-changes-on-the-branch-test
  (remote-sync.tu/with-sync-cleanup
    (remote-sync.tu/do-with-git-repo! (fn [repo]
                                        (do-with-synced-content (fn [{:keys [orders native]}]
                                                                  (sync/export! {})
                                                                  (testing "a commit that doesn't touch synced content doesn't get in the way"
                                                                    (remote-sync.tu/do-with-other-checkout! repo (fn [dir]
                                                                                                                   (spit (io/file dir "README.md") "Metabase content")))
                                                                    (t2/update! :model/Card (:id orders) {:name "Orders v2"})
                                                                    (is (=? {:outcome {:kind "pushed" :count 1}} (sync/export! {})))
                                                                    (is (contains? (remote-sync.tu/repo-files! repo) "README.md")))
                                                                  (testing "a change to synced content on the branch stops the export"
                                                                    (remote-sync.tu/do-with-other-checkout! repo (fn [dir]
                                                                                                                   (edit-yaml-file! dir (file-of dir (:entity_id native)) #(assoc % :name "Renamed elsewhere"))))
                                                                    (t2/update! :model/Card (:id orders) {:name "Orders v3"})
                                                                    (let [e (is (thrown? clojure.lang.ExceptionInfo (sync/export! {})))]
                                                                      (is (=? {::sync/conflict :remote-changed
                                                                               :conflicts      [#".*_big_orders\.yaml"]}
                                                                              (ex-data e)))))
                                                                  (testing "a forced export overwrites it"
                                                                    (is (=? {:outcome {:kind "pushed"}} (sync/export! {:force? true})))
                                                                    (is (some #(str/includes? % "name: Big orders") (vals (remote-sync.tu/repo-files! repo)))))))))))

(deftest import-of-a-missing-branch-test
  (remote-sync.tu/do-with-git-repo! (fn [_repo]
                                      (is (thrown-with-msg? clojure.lang.ExceptionInfo #"doesn't exist in the repository yet"
                                                            (sync/import! {}))))))

(deftest sync-requires-a-repository-test
  (mt/with-temporary-setting-values [remote-sync-url nil]
    (is (thrown-with-msg? clojure.lang.ExceptionInfo #"Connect a repository first" (sync/export! {})))
    (is (thrown-with-msg? clojure.lang.ExceptionInfo #"Connect a repository first" (sync/import! {})))))

(deftest timelines-and-documents-round-trip-test
  (testing "timelines with their events, and documents, round-trip with their collection"
    (remote-sync.tu/with-sync-cleanup
      (remote-sync.tu/do-with-git-repo!
       (fn [_repo]
         (mt/with-temp [:model/Collection    coll     {:name "Launches" :is_remote_synced true :location "/"}
                        :model/Timeline      timeline {:name "Releases" :collection_id (:id coll)}
                        :model/TimelineEvent event    {:name "v1.0" :timeline_id (:id timeline)}
                        :model/Document      document {:name "Release notes" :collection_id (:id coll)}]
           (sync/export! {})
           (t2/delete! :model/Timeline :id (:id timeline))
           (t2/delete! :model/Document :id (:id document))
           (t2/delete! :model/Collection :id (:id coll))
           (sync/import! {:force? true})
           (let [coll'     (by-entity-id :model/Collection (:entity_id coll))
                 timeline' (by-entity-id :model/Timeline (:entity_id timeline))]
             (is (=? {:name "Releases" :collection_id (:id coll')} timeline'))
             (is (=? {:name "v1.0" :timeline_id (:id timeline')} (by-entity-id :model/TimelineEvent (:entity_id event))))
             (is (=? {:name "Release notes" :collection_id (:id coll')}
                     (by-entity-id :model/Document (:entity_id document))))
             (is (= [] (changes/local-changes))))))))))
