(ns metabase.custom-viz.api
  "`/api/custom-viz-plugin` endpoints. Admins install, replace, enable, disable and delete custom visualizations;
  everyone who is signed in can list the enabled ones and load their bundles.

  An installed bundle runs as trusted code in the Metabase origin of everyone who views it, which is why only
  admins can install one."
  (:require
   [clojure.java.io :as io]
   [metabase.api.common :as api]
   [metabase.api.macros :as api.macros]
   [metabase.custom-viz.core :as custom-viz]
   [metabase.custom-viz.manifest :as custom-viz.manifest]
   [metabase.custom-viz.schema :as custom-viz.schema]
   [metabase.premium-features.core :as premium-features]
   [metabase.util.malli.schema :as ms]))

(set! *warn-on-reflection* true)

(def ^:private BundleUpload
  "The multipart body of an upload: the bundle as the `file` part."
  [:map {:closed true}
   [:file [:map {:closed true}
           [:filename :string]
           [:tempfile (ms/InstanceOfClass java.io.File)]]]])

(defn- bundle-source!
  "The text of the uploaded bundle `file`. Deletes the uploaded file."
  [{:keys [^java.io.File tempfile]}]
  (try
    (slurp tempfile :encoding "UTF-8")
    (finally
      (io/delete-file tempfile :silently))))

(api.macros/defendpoint :get "/" :- [:sequential ::custom-viz.schema/custom-viz-plugin]
  "Every installed custom visualization, enabled or not. Admins only."
  []
  (api/check-superuser)
  (custom-viz/plugins))

(api.macros/defendpoint :get "/list" :- [:sequential ::custom-viz.schema/custom-viz-plugin-runtime]
  "The enabled custom visualizations, with the URL of each one's bundle. Empty when custom visualizations are turned
  off."
  []
  (if (premium-features/enable-custom-viz?)
    (custom-viz/runtime-plugins)
    []))

(api.macros/defendpoint :get "/:id" :- ::custom-viz.schema/custom-viz-plugin
  "The custom visualization with `id`. Admins only."
  [{:keys [id]} :- [:map {:closed true}
                    [:id ms/PositiveInt]]]
  (api/check-superuser)
  (api/check-404 (custom-viz/plugin id)))

(api.macros/defendpoint :post "/" :- ::custom-viz.schema/custom-viz-plugin
  "Install a custom visualization from an uploaded JavaScript bundle, the `file` part. The bundle must open with a
  `metabase-custom-viz` manifest comment and be at most 5 MB. Admins only."
  {:multipart {:max-file-size  custom-viz.manifest/max-bundle-bytes
               :max-file-count 1}}
  [_route-params
   _query-params
   {:keys [file]} :- BundleUpload]
  (api/check-superuser)
  (custom-viz/install! api/*current-user-id* (bundle-source! file)))

(api.macros/defendpoint :put "/:id/bundle" :- ::custom-viz.schema/custom-viz-plugin
  "Replace the bundle of the custom visualization with `id` by an uploaded one, the `file` part. The new bundle must
  declare the same identifier. Admins only."
  {:multipart {:max-file-size  custom-viz.manifest/max-bundle-bytes
               :max-file-count 1}}
  [{:keys [id]} :- [:map {:closed true}
                    [:id ms/PositiveInt]]
   _query-params
   {:keys [file]} :- BundleUpload]
  (api/check-superuser)
  (api/check-404 (custom-viz/replace-bundle! api/*current-user-id* id (bundle-source! file))))

(api.macros/defendpoint :put "/:id" :- ::custom-viz.schema/custom-viz-plugin
  "Enable or disable the custom visualization with `id`. Admins only."
  [{:keys [id]} :- [:map {:closed true}
                    [:id ms/PositiveInt]]
   _query-params
   {:keys [enabled]} :- [:map {:closed true}
                         [:enabled :boolean]]]
  (api/check-superuser)
  (api/check-404 (custom-viz/set-enabled! api/*current-user-id* id enabled)))

(api.macros/defendpoint :delete "/:id" :- :nil
  "Delete the custom visualization with `id`. Questions that used it show a table instead. Admins only."
  [{:keys [id]} :- [:map {:closed true}
                    [:id ms/PositiveInt]]]
  (api/check-superuser)
  (api/check-404 (custom-viz/delete! api/*current-user-id* id))
  nil)

(api.macros/defendpoint :get "/:id/bundle" :- :any
  "The JavaScript bundle of the custom visualization with `id`. Cacheable for a year when `v` is the bundle's hash, as
  in the `bundle_url` that `GET /api/custom-viz-plugin/list` returns. Disabled visualizations, and every
  visualization while custom visualizations are turned off, are only served to admins."
  [{:keys [id]} :- [:map {:closed true}
                    [:id ms/PositiveInt]]
   {:keys [v]} :- [:map {:closed true}
                   [:v {:optional true} :string]]]
  (let [{:keys [bundle bundle_hash enabled]} (api/check-404 (custom-viz/bundle id))]
    (api/check-404 (or api/*is-superuser?*
                       (and enabled (premium-features/enable-custom-viz?))))
    {:status  200
     :headers {"Content-Type"  "text/javascript; charset=utf-8"
               ;; `private` because middleware adds cookies to the response.
               "Cache-Control" (if (= v bundle_hash)
                                 "private, max-age=31536000, immutable"
                                 "private, no-cache")
               "ETag"          (str "\"" bundle_hash "\"")}
     :body    bundle}))
