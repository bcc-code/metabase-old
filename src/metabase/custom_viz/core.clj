(ns metabase.custom-viz.core
  "Installing, changing and serving custom visualizations. Every write goes through here so that each one publishes
  its `:event/custom-viz-plugin-*` event."
  (:require
   [metabase.custom-viz.db :as custom-viz.db]
   [metabase.custom-viz.manifest :as custom-viz.manifest]
   [metabase.custom-viz.schema :as custom-viz.schema]
   [metabase.events.core :as events]
   [metabase.util.i18n :refer [tru]]
   [metabase.util.malli :as mu]
   [metabase.util.malli.schema :as ms]))

(mu/defn- ->plugin :- ::custom-viz.schema/custom-viz-plugin
  [{:keys [manifest], :as row} :- ::custom-viz.schema/custom-visualization]
  (let [problem (custom-viz.manifest/manifest-problem manifest)]
    (merge (select-keys row [:id :identifier :display_name :icon :enabled :bundle_hash :manifest :created_at :updated_at])
           {:status        (if problem "error" "active")
            :error_message problem
            :dev_only      false
            :warnings      []})))

(defn- usable?
  [{:keys [manifest]}]
  (nil? (custom-viz.manifest/manifest-problem manifest)))

(defn- bundle-url
  [{:keys [id bundle_hash]}]
  (str "/api/custom-viz-plugin/" id "/bundle?v=" bundle_hash))

(mu/defn- ->runtime :- ::custom-viz.schema/custom-viz-plugin-runtime
  [row :- ::custom-viz.schema/custom-visualization]
  (merge (select-keys row [:id :identifier :display_name :icon :bundle_hash :manifest])
         {:bundle_url (bundle-url row)
          :warnings   []}))

(defn- publish-event!
  "Publish `topic` for `plugin`, a [[->plugin]] map, on behalf of `user-id`."
  [topic user-id plugin & {:keys [previous]}]
  (events/publish-event! topic (cond-> {:object   plugin
                                        :model    :model/CustomVisualization
                                        :model-id (:id plugin)
                                        :user-id  user-id
                                        :details  (select-keys plugin [:identifier :display_name :enabled :bundle_hash])}
                                 previous (assoc :previous-object previous))))

(mu/defn plugins :- [:sequential ::custom-viz.schema/custom-viz-plugin]
  "Every installed custom visualization, by display name."
  []
  (mapv ->plugin (custom-viz.db/custom-visualizations)))

(mu/defn plugin :- [:maybe ::custom-viz.schema/custom-viz-plugin]
  "The custom visualization with `id`, or nil."
  [id :- ms/PositiveInt]
  (some-> (custom-viz.db/custom-visualization id) ->plugin))

(mu/defn runtime-plugins :- [:sequential ::custom-viz.schema/custom-viz-plugin-runtime]
  "The enabled custom visualizations whose manifests this Metabase can run, with what the browser needs to load them."
  []
  (into []
        (comp (filter usable?) (map ->runtime))
        (custom-viz.db/enabled-custom-visualizations)))

(defn- check-identifier-available!
  [identifier]
  (when (custom-viz.db/custom-visualization-id-with-identifier identifier)
    (throw (ex-info (tru "A custom visualization with the identifier \"{0}\" is already installed. Replace its bundle instead."
                         identifier)
                    {:status-code 400}))))

(defn- manifest-columns
  [{:keys [manifest], :as parsed-bundle}]
  (merge (select-keys parsed-bundle [:manifest :bundle :bundle_hash])
         {:display_name (:name manifest)
          :icon         (:icon manifest)}))

(mu/defn install! :- ::custom-viz.schema/custom-viz-plugin
  "Validate and install the bundle `source` on behalf of `user-id`, enabled. Throws a 400 when the bundle is invalid
  or another visualization already uses its identifier."
  [user-id :- ms/PositiveInt
   source  :- :string]
  (let [{:keys [manifest], :as parsed} (custom-viz.manifest/parse-bundle source)
        _                              (check-identifier-available! (:identifier manifest))
        id                             (custom-viz.db/insert-custom-visualization!
                                        (assoc (manifest-columns parsed) :identifier (:identifier manifest)))
        installed                      (plugin id)]
    (publish-event! :event/custom-viz-plugin-create user-id installed)
    installed))

(mu/defn replace-bundle! :- [:maybe ::custom-viz.schema/custom-viz-plugin]
  "Replace the bundle of the custom visualization with `id` by `source` on behalf of `user-id`. The new bundle must
  declare the same identifier, since saved questions refer to the visualization by it. Returns nil when no
  visualization has `id`; throws a 400 when the bundle is invalid."
  [user-id :- ms/PositiveInt
   id      :- ms/PositiveInt
   source  :- :string]
  (when-let [previous (plugin id)]
    (let [{:keys [manifest], :as parsed} (custom-viz.manifest/parse-bundle source)]
      (when (not= (:identifier manifest) (:identifier previous))
        (throw (ex-info (tru "The new bundle declares the identifier \"{0}\", but this visualization is \"{1}\". Questions use the identifier, so it can''t change."
                             (:identifier manifest)
                             (:identifier previous))
                        {:status-code 400})))
      (custom-viz.db/update-custom-visualization! id (manifest-columns parsed))
      (let [updated (plugin id)]
        (publish-event! :event/custom-viz-plugin-update user-id updated :previous previous)
        updated))))

(mu/defn set-enabled! :- [:maybe ::custom-viz.schema/custom-viz-plugin]
  "Enable or disable the custom visualization with `id` on behalf of `user-id`. Returns nil when no visualization has
  `id`."
  [user-id  :- ms/PositiveInt
   id       :- ms/PositiveInt
   enabled? :- :boolean]
  (when-let [previous (plugin id)]
    (custom-viz.db/update-custom-visualization! id {:enabled enabled?})
    (let [updated (plugin id)]
      (publish-event! :event/custom-viz-plugin-update user-id updated :previous previous)
      updated)))

(mu/defn delete! :- [:maybe ::custom-viz.schema/custom-viz-plugin]
  "Delete the custom visualization with `id` on behalf of `user-id` and return it, or nil when no visualization has
  `id`. Questions that used it fall back to a table."
  [user-id :- ms/PositiveInt
   id      :- ms/PositiveInt]
  (when-let [deleted (plugin id)]
    (custom-viz.db/delete-custom-visualization! id)
    (publish-event! :event/custom-viz-plugin-delete user-id deleted)
    deleted))

(mu/defn bundle :- [:maybe ::custom-viz.schema/bundle]
  "The JavaScript source, hash and enabled flag of the custom visualization with `id`, or nil."
  [id :- ms/PositiveInt]
  (custom-viz.db/bundle id))
