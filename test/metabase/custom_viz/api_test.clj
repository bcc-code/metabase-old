(ns metabase.custom-viz.api-test
  (:require
   [clojure.string :as str]
   [clojure.test :refer :all]
   [metabase.custom-viz.manifest :as custom-viz.manifest]
   [metabase.test :as mt]
   [metabase.util.json :as json]
   [toucan2.core :as t2]))

(set! *warn-on-reflection* true)

(def ^:private multipart
  {:request-options {:headers {"content-type" "multipart/form-data"}}})

(defn- manifest
  [& {:as overrides}]
  (merge {:apiVersion 1
          :identifier "heron-ring"
          :name       "Heron ring"
          :icon       "progress"
          :settings   [{:id "goal" :type "number" :title "Goal" :default 100}]}
         overrides))

(defn- bundle-source
  ([m]
   (bundle-source m "heron"))
  ([m marker]
   (str "/* metabase-custom-viz\n" (json/encode m) "\n*/\n"
        "window.MetabaseCustomViz.define(" (json/encode (:identifier m)) ", {mount: function (container) {"
        " container.textContent = " (json/encode marker) "; return {update: function () {}, unmount: function () {}}; }});")))

(defn- upload!
  "Install the bundle `source` as `user`, expecting `status`."
  [user status source]
  (mt/user-http-request user :post status "custom-viz-plugin" multipart {:file (.getBytes ^String source "UTF-8")}))

(defn- replace-bundle!
  [user status id source]
  (mt/user-http-request user :put status (str "custom-viz-plugin/" id "/bundle") multipart
                        {:file (.getBytes ^String source "UTF-8")}))

(defn- fetch-bundle
  [user status id & query-params]
  (apply mt/user-http-request-full-response user :get status (str "custom-viz-plugin/" id "/bundle") query-params))

(deftest install-and-list-test
  (mt/with-model-cleanup [:model/CustomVisualization]
    (let [source                             (bundle-source (manifest))
          {:keys [id bundle_hash], :as plugin} (upload! :crowberto 200 source)]
      (testing "POST returns the installed visualization"
        (is (=? {:id            pos-int?
                 :identifier    "heron-ring"
                 :display_name  "Heron ring"
                 :icon          "progress"
                 :status        "active"
                 :error_message nil
                 :enabled       true
                 :bundle_hash   (:bundle_hash (custom-viz.manifest/parse-bundle source))
                 :manifest      (manifest)
                 :dev_only      false
                 :warnings      []}
                plugin))
        (is (not (contains? plugin :bundle))))
      (testing "admins list every visualization"
        (is (=? [{:id id :identifier "heron-ring"}]
                (mt/user-http-request :crowberto :get 200 "custom-viz-plugin")))
        (is (=? {:id id :identifier "heron-ring"}
                (mt/user-http-request :crowberto :get 200 (str "custom-viz-plugin/" id)))))
      (testing "everyone lists the enabled visualizations with the URL of their bundle"
        (is (= [{:id           id
                 :identifier   "heron-ring"
                 :display_name "Heron ring"
                 :icon         "progress"
                 :bundle_url   (str "/api/custom-viz-plugin/" id "/bundle?v=" bundle_hash)
                 :bundle_hash  bundle_hash
                 :manifest     (manifest)
                 :warnings     []}]
               (mt/user-http-request :rasta :get 200 "custom-viz-plugin/list"))))
      (testing "everyone loads the bundle as JavaScript"
        (let [{:keys [body headers]} (fetch-bundle :rasta 200 id :v bundle_hash)]
          (is (= source body))
          (is (str/starts-with? (get headers "Content-Type") "text/javascript"))
          (testing "cached for a year under its hash"
            (is (= "private, max-age=31536000, immutable" (get headers "Cache-Control"))))))
      (testing "not cached without the current hash"
        (is (= "private, no-cache" (get-in (fetch-bundle :rasta 200 id) [:headers "Cache-Control"])))
        (is (= "private, no-cache" (get-in (fetch-bundle :rasta 200 id :v "0000") [:headers "Cache-Control"])))))))

(deftest admin-only-test
  (mt/with-model-cleanup [:model/CustomVisualization]
    (let [{:keys [id]} (upload! :crowberto 200 (bundle-source (manifest)))]
      (is (= "You don't have permissions to do that."
             (upload! :rasta 403 (bundle-source (manifest :identifier "egret")))))
      (is (= "You don't have permissions to do that."
             (mt/user-http-request :rasta :get 403 "custom-viz-plugin")))
      (is (= "You don't have permissions to do that."
             (mt/user-http-request :rasta :get 403 (str "custom-viz-plugin/" id))))
      (is (= "You don't have permissions to do that."
             (replace-bundle! :rasta 403 id (bundle-source (manifest)))))
      (is (= "You don't have permissions to do that."
             (mt/user-http-request :rasta :put 403 (str "custom-viz-plugin/" id) {:enabled false})))
      (is (= "You don't have permissions to do that."
             (mt/user-http-request :rasta :delete 403 (str "custom-viz-plugin/" id))))
      (is (= 1 (t2/count :model/CustomVisualization)))
      (testing "the bundle needs a signed-in user"
        (is (= "Unauthenticated"
               (mt/client :get 401 (str "custom-viz-plugin/" id "/bundle"))))))))

(deftest invalid-bundle-test
  (mt/with-model-cleanup [:model/CustomVisualization]
    (testing "an invalid bundle is rejected with a message that says why"
      (is (= "The bundle was written for custom visualization API version 2, but this Metabase supports version 1."
             (upload! :crowberto 400 (bundle-source (manifest :apiVersion 2)))))
      (is (= "The bundle must open with a \"/* metabase-custom-viz ... */\" comment holding its JSON manifest."
             (upload! :crowberto 400 "window.MetabaseCustomViz.define(\"egret\", {});")))
      (is (str/starts-with? (upload! :crowberto 400 (str (bundle-source (manifest)) "\nvar egret = ;"))
                            "The bundle is not valid JavaScript:")))
    (testing "an identifier can only be installed once"
      (upload! :crowberto 200 (bundle-source (manifest)))
      (is (= "A custom visualization with the identifier \"heron-ring\" is already installed. Replace its bundle instead."
             (upload! :crowberto 400 (bundle-source (manifest :name "Another ring"))))))
    (is (= 1 (t2/count :model/CustomVisualization)))))

(deftest bundle-too-large-test
  (testing "POST rejects a file over the size cap with a 413"
    (is (= "Uploaded content exceeded limits."
           (mt/user-http-request :crowberto :post 413 "custom-viz-plugin" multipart
                                 {:file (byte-array (inc custom-viz.manifest/max-bundle-bytes))})))))

(deftest replace-bundle-test
  (mt/with-model-cleanup [:model/CustomVisualization]
    (let [{:keys [id bundle_hash]} (upload! :crowberto 200 (bundle-source (manifest)))
          new-source               (bundle-source (manifest :name "Heron ring 2" :icon "pie") "heron 2")
          replaced                 (replace-bundle! :crowberto 200 id new-source)]
      (testing "the new bundle, name and icon replace the old ones"
        (is (=? {:id           id
                 :identifier   "heron-ring"
                 :display_name "Heron ring 2"
                 :icon         "pie"
                 :manifest     (manifest :name "Heron ring 2" :icon "pie")}
                replaced))
        (is (not= bundle_hash (:bundle_hash replaced)))
        (is (= new-source (:body (fetch-bundle :rasta 200 id :v (:bundle_hash replaced))))))
      (testing "the identifier can't change, since questions refer to it"
        (is (= (str "The new bundle declares the identifier \"egret\", but this visualization is \"heron-ring\". "
                    "Questions use the identifier, so it can't change.")
               (replace-bundle! :crowberto 400 id (bundle-source (manifest :identifier "egret"))))))
      (testing "an invalid bundle leaves the installed one alone"
        (replace-bundle! :crowberto 400 id (bundle-source (manifest :apiVersion 7)))
        (is (= (:bundle_hash replaced)
               (:bundle_hash (mt/user-http-request :crowberto :get 200 (str "custom-viz-plugin/" id)))))))
    (testing "404 for an unknown visualization"
      (replace-bundle! :crowberto 404 Integer/MAX_VALUE (bundle-source (manifest))))))

(deftest enable-disable-test
  (mt/with-model-cleanup [:model/CustomVisualization]
    (let [{:keys [id]} (upload! :crowberto 200 (bundle-source (manifest)))]
      (is (=? {:id id :enabled false}
              (mt/user-http-request :crowberto :put 200 (str "custom-viz-plugin/" id) {:enabled false})))
      (testing "a disabled visualization is listed for admins only"
        (is (=? [{:id id :enabled false}] (mt/user-http-request :crowberto :get 200 "custom-viz-plugin")))
        (is (= [] (mt/user-http-request :rasta :get 200 "custom-viz-plugin/list"))))
      (testing "and its bundle is served to admins only"
        (fetch-bundle :rasta 404 id)
        (fetch-bundle :crowberto 200 id))
      (is (=? {:id id :enabled true}
              (mt/user-http-request :crowberto :put 200 (str "custom-viz-plugin/" id) {:enabled true})))
      (is (=? [{:id id}] (mt/user-http-request :rasta :get 200 "custom-viz-plugin/list")))
      (fetch-bundle :rasta 200 id))))

(deftest delete-test
  (mt/with-model-cleanup [:model/CustomVisualization]
    (let [{:keys [id]} (upload! :crowberto 200 (bundle-source (manifest)))]
      (is (nil? (mt/user-http-request :crowberto :delete 204 (str "custom-viz-plugin/" id))))
      (is (= [] (mt/user-http-request :crowberto :get 200 "custom-viz-plugin")))
      (mt/user-http-request :crowberto :get 404 (str "custom-viz-plugin/" id))
      (fetch-bundle :crowberto 404 id)
      (mt/user-http-request :crowberto :delete 404 (str "custom-viz-plugin/" id))
      (testing "the identifier can be installed again"
        (upload! :crowberto 200 (bundle-source (manifest)))))))

(deftest turned-off-test
  (mt/with-model-cleanup [:model/CustomVisualization]
    (let [{:keys [id]} (upload! :crowberto 200 (bundle-source (manifest)))]
      (mt/with-temporary-setting-values [custom-visualizations-enabled false]
        (testing "nobody can use custom visualizations while they are turned off"
          (is (= [] (mt/user-http-request :rasta :get 200 "custom-viz-plugin/list")))
          (fetch-bundle :rasta 404 id))
        (testing "admins can still manage them"
          (is (=? [{:id id}] (mt/user-http-request :crowberto :get 200 "custom-viz-plugin")))
          (fetch-bundle :crowberto 200 id))
        (testing "the custom-viz token feature reflects the setting"
          (is (false? (get-in (mt/user-http-request :rasta :get 200 "session/properties")
                              [:token-features :custom-viz])))))
      (testing "custom visualizations are on by default"
        (is (true? (get-in (mt/user-http-request :rasta :get 200 "session/properties")
                           [:token-features :custom-viz])))))))

(deftest unsupported-stored-manifest-test
  (testing "a visualization whose stored manifest this Metabase can't run is reported as an error and not served"
    (mt/with-model-cleanup [:model/CustomVisualization]
      (let [{:keys [id]} (upload! :crowberto 200 (bundle-source (manifest)))]
        (t2/update! :model/CustomVisualization id {:manifest (manifest :apiVersion 99)})
        (is (=? {:id            id
                 :status        "error"
                 :error_message "The bundle was written for custom visualization API version 99, but this Metabase supports version 1."}
                (mt/user-http-request :crowberto :get 200 (str "custom-viz-plugin/" id))))
        (is (= [] (mt/user-http-request :rasta :get 200 "custom-viz-plugin/list")))))))
