(ns metabase.cache.refresh.api-test
  (:require
   [clojure.test :refer :all]
   [metabase.test :as mt]))

(def ^:private secret (apply str (repeat 64 "a")))

(defn- run-refresh! [expected-status & [sent-secret]]
  (apply mt/client :post expected-status "cache-refresh/run"
         (when sent-secret
           [{:request-options {:headers {"x-metabase-cache-refresh-secret" sent-secret}}}])))

(deftest disabled-without-a-secret-test
  (testing "Without a secret, or with one too short to be safe, the endpoint doesn't exist"
    (mt/with-temp-env-var-value! [mb-cache-refresh-trigger-secret nil]
      (run-refresh! 404 secret))
    (mt/with-temp-env-var-value! [mb-cache-refresh-trigger-secret "too-short"]
      (run-refresh! 404 "too-short"))))

(deftest needs-the-secret-test
  (mt/with-temp-env-var-value! [mb-cache-refresh-trigger-secret secret]
    (testing "Requests without the secret, or with another, are refused"
      (run-refresh! 403)
      (run-refresh! 403 (apply str (repeat 64 "b")))
      (run-refresh! 403 (subs secret 1)))
    (testing "Requests with the secret run a refresh pass, without a session"
      (is (=? {:policies_refreshed int?
               :queries_refreshed  int?
               :queries_failed     int?
               :duration_ms        int?}
              (run-refresh! 200 secret))))
    (testing "A session doesn't stand in for the secret"
      (mt/user-http-request :crowberto :post 403 "cache-refresh/run"))))
