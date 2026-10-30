(ns metabase.metabot.tools.sql.test-run-test
  (:require
   [clojure.string :as str]
   [clojure.test :refer :all]
   [metabase.api-scope.core :as api-scope]
   [metabase.metabot.query-execution :as query-execution]
   [metabase.metabot.scope :as scope]
   [metabase.metabot.settings :as metabot.settings]
   [metabase.metabot.tools :as tools]
   [metabase.metabot.tools.sql.test-run :as test-run]
   [metabase.test :as mt]))

(defn- sql-tool
  "The `create_sql_query` tool of the chat profile, sharing `memory-atom`, as a function of its arguments."
  [memory-atom]
  (binding [scope/*current-user-scope* api-scope/unrestricted]
    (get-in (tools/->entries [#'tools/create-sql-query-tool] memory-atom nil :internal)
            ["create_sql_query" :fn])))

(defn- create! [create-fn sql]
  (binding [scope/*current-user-scope* api-scope/unrestricted]
    (create-fn {:database_id (mt/id) :sql_query sql :title "Venues"})))

(defmacro ^:private with-sql-errors-shown
  "Run `body` as the current user with their `metabot-show-sql-errors` setting at `shown?`, putting it back after."
  [shown? & body]
  `(try
     (metabot.settings/metabot-show-sql-errors! ~shown?)
     ~@body
     (finally
       (metabot.settings/metabot-show-sql-errors! nil))))

(deftest show-sql-errors-defaults-test
  (testing "Admins see SQL errors unless they turn them off; other people don't unless they turn them on"
    (mt/with-current-user (mt/user->id :crowberto)
      (is (true? (metabot.settings/metabot-show-sql-errors)))
      (with-sql-errors-shown false
        (is (false? (metabot.settings/metabot-show-sql-errors)))))
    (mt/with-current-user (mt/user->id :rasta)
      (is (false? (metabot.settings/metabot-show-sql-errors)))
      (with-sql-errors-shown true
        (is (true? (metabot.settings/metabot-show-sql-errors)))))))

(deftest working-sql-is-shown-test
  (mt/with-current-user (mt/user->id :rasta)
    (let [result (create! (sql-tool (atom {})) "SELECT NAME FROM VENUES")]
      (is (nil? (:error result)))
      (is (some? (get-in result [:structured-output :query-id]))))))

(deftest failing-sql-goes-back-to-the-model-test
  (mt/with-current-user (mt/user->id :rasta)
    (let [create-fn (sql-tool (atom {}))
          failing   "SELECT NO_SUCH_COLUMN FROM VENUES"]
      (testing "The first failures go back to the model, to fix, and nothing is shown"
        (dotimes [_ (dec test-run/max-failed-runs)]
          (let [result (create! create-fn failing)]
            (is (= {:class :recoverable :code ::test-run/query-failed-to-run} (:error result)))
            (is (str/includes? (:output result) "NO_SUCH_COLUMN"))
            (is (str/includes? (:output result) "Fix the SQL and try again"))
            (is (empty? (:data-parts result))))))
      (testing "The last one allowed tells the model to stop and explain in plain words"
        (let [result (create! create-fn failing)]
          (is (= {:class :recoverable :code ::test-run/query-keeps-failing-to-run} (:error result)))
          (is (str/includes? (:output result) "Stop writing SQL for this request"))))
      (testing "After that, the reply ends with a plain-language message"
        (let [result (create! create-fn failing)]
          (is (= {:class        :unrecoverable
                  :code         ::test-run/query-keeps-failing
                  :user-message "Metabot could not build a query that works for this. Try asking in a different way."}
                 (:error result)))))
      (testing "Each reply starts counting again"
        (is (= ::test-run/query-failed-to-run
               (get-in (create! (sql-tool (atom {})) failing) [:error :code])))))))

(deftest values-from-the-data-are-masked-test
  (mt/with-current-user (mt/user->id :rasta)
    (let [result (create! (sql-tool (atom {})) "SELECT CAST(NAME AS INTEGER) FROM VENUES ORDER BY ID")
          output (:output result)]
      (is (= ::test-run/query-failed-to-run (get-in result [:error :code])))
      (is (str/includes? output "<value>"))
      (is (not (str/includes? output "Red Medicine"))))))

(deftest people-who-see-sql-errors-get-the-query-as-before-test
  (doseq [[user shown?] [[:crowberto nil] [:rasta true]]]
    (mt/with-current-user (mt/user->id user)
      (with-sql-errors-shown shown?
        (testing (str user " with SQL errors shown: the query isn't run first")
          (let [result (create! (sql-tool (atom {})) "SELECT NO_SUCH_COLUMN FROM VENUES")]
            (is (nil? (:error result)))
            (is (seq (:data-parts result)))))))))

(deftest only-read-only-selects-run-test
  (mt/with-current-user (mt/user->id :rasta)
    (let [runs (atom 0)]
      (mt/with-dynamic-fn-redefs [query-execution/execute-page! (fn [& _] (swap! runs inc) {:rows []})]
        (testing "SQL that could change data, or that runs other SQL than it shows, isn't run first"
          (doseq [sql ["UPDATE VENUES SET NAME = 'x' WHERE 1 = 0"
                       "SELECT NAME FROM VENUES WHERE ID = {{id}}"]]
            (testing sql
              (create! (sql-tool (atom {})) sql)
              (is (zero? @runs)))))
        (testing "A plain SELECT is"
          (create! (sql-tool (atom {})) "SELECT NAME FROM VENUES")
          (is (= 1 @runs)))))))
