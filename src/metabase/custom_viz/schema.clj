(ns metabase.custom-viz.schema
  "Malli schemas for custom visualizations: the manifest a bundle declares, the app-DB rows, and the shapes the REST
  API returns."
  (:require
   [metabase.util.malli.registry :as mr]
   [metabase.util.malli.schema :as ms]))

(def supported-api-versions
  "Versions of the custom visualization host API this Metabase can run."
  #{1})

(mr/def ::text
  "A non-blank string of at most 254 characters."
  [:and
   [:string {:min 1, :max 254}]
   [:re {:error/message "must not be blank"} #"\S"]])

(mr/def ::identifier
  "Identifies a visualization; questions that use it store the display type `custom:<identifier>`."
  [:re {:error/message "must be 1 to 64 lowercase letters, digits or hyphens, starting with a letter"}
   #"^[a-z][a-z0-9-]{0,63}$"])

(mr/def ::icon
  "Name of a Metabase icon."
  [:re {:error/message "must be the name of a Metabase icon, e.g. \"bar\""}
   #"^[a-zA-Z0-9_-]{1,64}$"])

(mr/def ::column-type
  "The kind of column a column setting accepts."
  [:enum "any" "number" "string" "date" "boolean"])

(mr/def ::setting-id
  [:re {:error/message "must be 1 to 64 letters, digits, underscores or hyphens, starting with a letter"}
   #"^[A-Za-z][A-Za-z0-9_-]{0,63}$"])

(mr/def ::select-value
  [:or :string number? :boolean])

(mr/def ::select-option
  [:map {:closed true}
   [:name  ::text]
   [:value ::select-value]])

(defn- setting-schema
  "A closed map schema for a setting of `setting-type` with the entries every setting has plus `entries`."
  [setting-type & entries]
  (into [:map {:closed true}
         [:id      ::setting-id]
         [:type    [:= setting-type]]
         [:title   ::text]
         [:section {:optional true} ::text]]
        entries))

(defn- default-is-an-option?
  [{:keys [options], :as setting}]
  (or (not (contains? setting :default))
      (boolean (some #(= (:default setting) (:value %)) options))))

(mr/def ::setting
  "A setting the visualization shows in the visualization settings sidebar."
  [:multi {:dispatch      :type
           :error/message "type must be one of text, number, select, toggle, color, column or columns"}
   ["text"    (setting-schema "text"
                              [:default     {:optional true} :string]
                              [:placeholder {:optional true} :string])]
   ["number"  (setting-schema "number"
                              [:default     {:optional true} number?]
                              [:placeholder {:optional true} :string])]
   ["select"  [:and
               (setting-schema "select"
                               [:options [:sequential {:min 1, :max 100} ::select-option]]
                               [:default {:optional true} ::select-value])
               [:fn {:error/message "default must be the value of one of the options"} default-is-an-option?]]]
   ["toggle"  (setting-schema "toggle"
                              [:default {:optional true} :boolean])]
   ["color"   (setting-schema "color"
                              [:default {:optional true} [:string {:min 1, :max 64}]])]
   ["column"  (setting-schema "column"
                              [:columnType {:optional true} ::column-type])]
   ["columns" (setting-schema "columns"
                              [:columnType {:optional true} ::column-type])]])

(defn- ordered-bounds?
  [lower-key upper-key]
  (fn [m]
    (let [lower (get m lower-key)
          upper (get m upper-key)]
      (or (nil? lower) (nil? upper) (<= lower upper)))))

(mr/def ::data-requirements
  "The shape of query results the visualization can render."
  [:and
   [:map {:closed true}
    [:minRows             {:optional true} nat-int?]
    [:maxRows             {:optional true} pos-int?]
    [:minColumns          {:optional true} nat-int?]
    [:maxColumns          {:optional true} pos-int?]
    [:requiredColumnTypes {:optional true} [:map-of [:enum :number :string :date :boolean] pos-int?]]]
   [:fn {:error/message "minRows must not be greater than maxRows"} (ordered-bounds? :minRows :maxRows)]
   [:fn {:error/message "minColumns must not be greater than maxColumns"} (ordered-bounds? :minColumns :maxColumns)]])

(defn- distinct-setting-ids?
  [settings]
  (apply distinct? nil (map :id settings)))

(mr/def ::manifest
  "The manifest a bundle declares in its leading `metabase-custom-viz` comment, with keywordized keys."
  [:map {:closed true}
   [:apiVersion  (into [:enum] (sort supported-api-versions))]
   [:identifier  ::identifier]
   [:name        ::text]
   [:icon        {:optional true} ::icon]
   [:description {:optional true} [:string {:max 1000}]]
   [:data        {:optional true} ::data-requirements]
   [:settings    {:optional true} [:and
                                   [:sequential {:max 50} ::setting]
                                   [:fn {:error/message "setting ids must be unique"} distinct-setting-ids?]]]])

(mr/def ::parsed-bundle
  "A bundle that passed validation, ready to be stored."
  [:map {:closed true}
   [:manifest    ::manifest]
   [:bundle      :string]
   [:bundle_hash [:re #"^[0-9a-f]{64}$"]]])

(mr/def ::stored-manifest
  "A manifest as stored, which may not be one this Metabase can run, e.g. after an upgrade dropped its API version."
  [:any {::mr/deliberately-open true
         :description           "the manifest JSON as stored"}])

(mr/def ::custom-visualization
  "A custom visualization row as the module selects it: every column except the bundle source."
  [:map {:closed true}
   [:id           ms/PositiveInt]
   [:identifier   :string]
   [:display_name :string]
   [:icon         [:maybe :string]]
   [:manifest     ::stored-manifest]
   [:bundle_hash  :string]
   [:enabled      :boolean]
   [:created_at   ms/TemporalInstant]
   [:updated_at   ms/TemporalInstant]])

(mr/def ::custom-visualization.insert
  "The columns of a new custom visualization row."
  [:map {:closed true}
   [:identifier   ::identifier]
   [:display_name :string]
   [:icon         [:maybe :string]]
   [:manifest     ::manifest]
   [:bundle       :string]
   [:bundle_hash  :string]])

(mr/def ::custom-visualization.update
  "Changes to a custom visualization row."
  [:map {:closed true}
   [:display_name {:optional true} :string]
   [:icon         {:optional true} [:maybe :string]]
   [:manifest     {:optional true} ::manifest]
   [:bundle       {:optional true} :string]
   [:bundle_hash  {:optional true} :string]
   [:enabled      {:optional true} :boolean]])

(mr/def ::bundle
  "The bundle source of a custom visualization, with what decides who may load it."
  [:map {:closed true}
   [:bundle      :string]
   [:bundle_hash :string]
   [:enabled     :boolean]])

(mr/def ::custom-viz-plugin
  "A custom visualization as the admin API returns it. `status` is `error` when the stored manifest is not one this
  Metabase can run; `dev_only` and `warnings` exist for compatibility with the frontend's plugin type."
  [:map {:closed true}
   [:id            ms/PositiveInt]
   [:identifier    :string]
   [:display_name  :string]
   [:icon          [:maybe :string]]
   [:status        [:enum "active" "error"]]
   [:error_message [:maybe :string]]
   [:enabled       :boolean]
   [:bundle_hash   :string]
   [:manifest      ::stored-manifest]
   [:dev_only      :boolean]
   [:warnings      [:sequential :any]]
   [:created_at    ms/TemporalInstant]
   [:updated_at    ms/TemporalInstant]])

(mr/def ::custom-viz-plugin-runtime
  "What any signed-in user needs to load and register an enabled custom visualization."
  [:map {:closed true}
   [:id           ms/PositiveInt]
   [:identifier   :string]
   [:display_name :string]
   [:icon         [:maybe :string]]
   [:bundle_url   :string]
   [:bundle_hash  :string]
   [:manifest     ::manifest]
   [:warnings     [:sequential :any]]])
