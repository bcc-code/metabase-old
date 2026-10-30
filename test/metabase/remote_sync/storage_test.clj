(ns metabase.remote-sync.storage-test
  (:require
   [clojure.string :as str]
   [clojure.test :refer :all]
   [metabase.remote-sync.storage :as storage]))

(set! *warn-on-reflection* true)

(deftest ^:parallel yaml-round-trip-test
  (let [entity {:serdes/meta            [{:model "Card" :id "aaaaaaaaaaaaaaaaaaaaa" :label "orders"}]
                :name                   "Orders"
                :entity_id              "aaaaaaaaaaaaaaaaaaaaa"
                :type                   :question
                :result_metadata        [{:base_type :type/Integer}]
                :visualization_settings {:column_settings {"[\"name\",\"TOTAL\"]" {:column_title "Total"}}
                                         :click_behavior  {:parameterMapping
                                                           {"[\"dimension\",[\"field\",1,null]]" {:id "x"}}}
                                         :graph.dimensions ["CREATED_AT"]
                                         :series_settings  {"Sum of Total" {:color "#509EE3"}}}}
        text   (storage/entity->yaml entity)
        back   (storage/yaml->entity text "cards/x.yaml")]
    (testing "keywords are written with their namespace"
      (is (str/includes? text "base_type: type/Integer"))
      (is (str/includes? text "type: question")))
    (testing "keys are sorted, so the same content always renders the same file"
      (is (= text (storage/entity->yaml (into {} (reverse (seq entity)))))))
    (testing "identifier-like keys come back as keywords, other keys as strings"
      (is (= {:column_settings  {"[\"name\",\"TOTAL\"]" {:column_title "Total"}}
              :click_behavior   {:parameterMapping {"[\"dimension\",[\"field\",1,null]]" {:id "x"}}}
              :graph.dimensions ["CREATED_AT"]
              :series_settings  {"Sum of Total" {:color "#509EE3"}}}
             (:visualization_settings back)))
      (is (= [{:model "Card" :id "aaaaaaaaaaaaaaaaaaaaa" :label "orders"}] (:serdes/meta back))))
    (testing "keyword values come back as strings, which the importers accept"
      (is (= "question" (:type back)))
      (is (= [{:base_type "type/Integer"}] (:result_metadata back))))
    (testing "the hash depends only on the content"
      (is (= (storage/content-hash text) (storage/content-hash (storage/entity->yaml back)))))))

(deftest ^:parallel not-an-entity-test
  (is (thrown-with-msg? clojure.lang.ExceptionInfo #"notes.yaml is not a Metabase entity"
                        (storage/yaml->entity "title: notes\n" "collections/notes.yaml")))
  (is (thrown-with-msg? clojure.lang.ExceptionInfo #"Could not read broken.yaml"
                        (storage/yaml->entity "a: [unclosed\n" "broken.yaml"))))

(deftest ^:parallel paths-test
  (let [sales    {:serdes/meta [{:model "Collection" :id "sales0000000000000000"}]
                  :entity_id   "sales0000000000000000" :name "Sales & Marketing" :parent_id nil}
        child    {:serdes/meta [{:model "Collection" :id "child0000000000000000"}]
                  :entity_id   "child0000000000000000" :name "Øst/Vest" :parent_id "sales0000000000000000"}
        folder   {:serdes/meta [{:model "Collection" :id "folder000000000000000"}]
                  :entity_id   "folder000000000000000" :name "SQL" :namespace "snippets" :parent_id nil}
        dirs     (storage/collection-dirs [sales child folder])
        path-of  #(storage/entity-path % dirs)]
    (is (= "collections/sales0000000000000000_sales___marketing/collection.yaml" (path-of sales)))
    (is (= "collections/sales0000000000000000_sales___marketing/child0000000000000000_øst_vest/collection.yaml"
           (path-of child)))
    (is (= "snippets/folder000000000000000_sql/collection.yaml" (path-of folder)))
    (is (= "collections/sales0000000000000000_sales___marketing/child0000000000000000_øst_vest/cards/card0000000000000000x_q1.yaml"
           (path-of {:serdes/meta   [{:model "Card" :id "card0000000000000000x"}]
                     :entity_id     "card0000000000000000x" :name "Q1" :collection_id "child0000000000000000"})))
    (is (= "collections/sales0000000000000000_sales___marketing/dashboards/dash0000000000000000x_overview.yaml"
           (path-of {:serdes/meta   [{:model "Dashboard" :id "dash0000000000000000x"}]
                     :entity_id     "dash0000000000000000x" :name "Overview" :collection_id "sales0000000000000000"})))
    (is (= "snippets/snip0000000000000000x_unnamed.yaml"
           (path-of {:serdes/meta   [{:model "NativeQuerySnippet" :id "snip0000000000000000x"}]
                     :entity_id     "snip0000000000000000x" :name "" :collection_id nil})))
    (is (= "snippets/folder000000000000000_sql/snip0000000000000000x_active_users.yaml"
           (path-of {:serdes/meta   [{:model "NativeQuerySnippet" :id "snip0000000000000000x"}]
                     :entity_id     "snip0000000000000000x" :name "Active users" :collection_id "folder000000000000000"})))))
