(ns metabase.remote-sync.core-test
  "Read-only enforcement and which Collections can be synced."
  (:require
   [clojure.test :refer :all]
   [java-time.api :as t]
   [metabase.models.interface :as mi]
   [metabase.remote-sync.core :as remote-sync]
   [metabase.remote-sync.db :as remote-sync.db]
   [metabase.test :as mt]
   [toucan2.core :as t2]))

(set! *warn-on-reflection* true)

(defmacro ^:private with-sync-type [sync-type & body]
  `(mt/with-temporary-setting-values [remote-sync-url  "https://git.example.com/content.git"
                                      remote-sync-type ~sync-type]
     ~@body))

(deftest collection-syncable-test
  (testing "regular collections can be synced"
    (is (true? (remote-sync/collection-syncable? {:name "Sales" :namespace nil}))))
  (testing "personal collections, other namespaces and special collections can't"
    (is (false? (remote-sync/collection-syncable? {:name "Mine" :personal_owner_id 1})))
    (is (false? (remote-sync/collection-syncable? {:name "SQL" :namespace :snippets})))
    (is (false? (remote-sync/collection-syncable? {:name "Trash" :type "trash"})))
    (is (false? (remote-sync/collection-syncable? {:name "Usage" :type "instance-analytics"})))))

(deftest read-only-locks-synced-content-test
  (mt/with-temp [:model/Collection synced     {:name "Synced" :is_remote_synced true :location "/"}
                 :model/Collection not-synced {:name "Not synced" :location "/"}
                 :model/Card       synced-card {:collection_id (:id synced)}
                 :model/Card       other-card  {:collection_id (:id not-synced)}]
    (mt/with-current-user (mt/user->id :crowberto)
      (testing "a read-write instance edits everything"
        (with-sync-type :read-write
          (is (true? (mi/can-write? synced-card)))
          (is (true? (mi/can-write? synced)))
          (is (true? (remote-sync/collection-editable? (:id synced))))))
      (testing "a read-only instance doesn't edit synced content, even as an admin"
        (with-sync-type :read-only
          (is (false? (mi/can-write? synced-card)))
          (is (false? (mi/can-write? synced)))
          (is (false? (remote-sync/collection-editable? (:id synced))))
          (is (false? (remote-sync/collection-editable? synced)))
          (is (false? (remote-sync/model-editable? :model/Card synced-card)))
          (is (= {(:id synced-card) false, (:id other-card) true}
                 (remote-sync/batch-model-editable? :model/Card [synced-card other-card])))))
      (testing "but edits content that isn't synced, and the root collection"
        (with-sync-type :read-only
          (is (true? (mi/can-write? other-card)))
          (is (true? (remote-sync/collection-editable? nil)))
          (is (true? (remote-sync/collection-editable? (:id not-synced)))))))
    (testing "without a repository, read-only mode does nothing"
      (mt/with-temporary-setting-values [remote-sync-url nil, remote-sync-type :read-only]
        (is (true? (remote-sync/collection-editable? (:id synced))))))))

(deftest read-only-locks-synced-snippets-test
  (mt/with-temp [:model/NativeQuerySnippet synced-snippet {:name (mt/random-name) :content "1 = 1"}
                 :model/NativeQuerySnippet other-snippet  {:name (mt/random-name) :content "2 = 2"}]
    (mt/with-model-cleanup [:model/GitSyncEntity]
      (remote-sync.db/replace-snapshot! [{:model_type          "NativeQuerySnippet"
                                          :model_id            (:id synced-snippet)
                                          :model_name          (:name synced-snippet)
                                          :model_collection_id nil
                                          :model_display       nil
                                          :status              "synced"
                                          :status_changed_at   (t/offset-date-time)
                                          :file_path           "snippets/x.yaml"
                                          :content_hash        "abc"}])
      (testing "a snippet the last sync brought along can't be edited on a read-only instance"
        (with-sync-type :read-only
          (is (= {(:id synced-snippet) false, (:id other-snippet) true}
                 (remote-sync/batch-model-editable? :model/NativeQuerySnippet [synced-snippet other-snippet])))
          (is (false? (remote-sync/model-editable? :model/NativeQuerySnippet synced-snippet)))))
      (testing "any snippet can be edited on a read-write instance"
        (with-sync-type :read-write
          (is (true? (remote-sync/model-editable? :model/NativeQuerySnippet synced-snippet))))))))

(deftest snippets-are-always-eligible-test
  (testing "synced questions take the snippets they use along, wherever those are"
    (is (= {1 true, 2 true}
           (remote-sync/batch-model-eligible? :model/NativeQuerySnippet [{:id 1 :collection_id nil}
                                                                         {:id 2 :collection_id 99}])))))

(deftest models-not-synced-stay-editable-test
  (with-sync-type :read-only
    (is (true? (remote-sync/model-editable? :model/Glossary nil)))
    (is (true? (remote-sync/table-editable? {:id 1})))
    (is (true? (remote-sync/transforms-editable?)))))

(deftest card-in-read-only-synced-collection-is-not-writable-via-api-test
  (mt/with-temp [:model/Collection synced {:name "Synced" :is_remote_synced true :location "/"}
                 :model/Card       card   {:name "Locked" :collection_id (:id synced)}]
    (with-sync-type :read-only
      (mt/user-http-request :crowberto :put 403 (str "card/" (:id card)) {:name "Changed"})
      (is (= "Locked" (t2/select-one-fn :name :model/Card :id (:id card)))))))
