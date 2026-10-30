(ns metabase.metabot.tools.sql.masking-test
  (:require
   [clojure.test :refer :all]
   [metabase.metabot.tools.sql.masking :as masking]))

(deftest mask-data-values-test
  (let [sql "SELECT custmer_name FROM orders WHERE city = 'Oslo'"]
    (testing "What the query itself says stays, so the model can fix it"
      (is (= "ERROR: column \"custmer_name\" does not exist"
             (masking/mask-data-values "ERROR: column \"custmer_name\" does not exist" sql)))
      (is (= "Unknown column 'oslo' in 'where clause'"
             (masking/mask-data-values "Unknown column 'oslo' in 'where clause'" sql))))
    (testing "Values from the data are masked"
      (is (= "invalid input syntax for type integer: \"<value>\""
             (masking/mask-data-values "invalid input syntax for type integer: \"Gerard Lam\"" sql)))
      (is (= "Data conversion error converting `<value>`"
             (masking/mask-data-values "Data conversion error converting `Gerard Lam`" sql)))
      (is (= "Key (email)=(<value>) already exists"
             (masking/mask-data-values "Key (email)=(gerard@example.com) already exists" sql)))
      (is (= "no match for <email> or <number>"
             (masking/mask-data-values "no match for gerard@example.com or 4712345678" sql))))
    (testing "An expression the database writes back in its own words stays"
      (is (= "Division by zero: \"CAST(10 AS BIGINT)\""
             (masking/mask-data-values "Division by zero: \"CAST(10 AS BIGINT)\"" sql))))
    (testing "Short numbers, such as positions and error codes, stay"
      (is (= "SQLSTATE 42703, position 8"
             (masking/mask-data-values "SQLSTATE 42703, position 8" sql)))))
  (testing "Without the query, every quoted value is masked"
    (is (= "column \"<value>\" does not exist"
           (masking/mask-data-values "column \"custmer_name\" does not exist" nil))))
  (is (nil? (masking/mask-data-values nil "SELECT 1"))))
