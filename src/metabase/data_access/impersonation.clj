(ns metabase.data-access.impersonation
  "Connection impersonation: queries a user runs against a Database use a database role taken from one of their
  attributes, so the database's own grants decide what they see.

  ### When it applies

  A user is impersonated on a Database when one of their groups has an impersonation policy on it, unless:

  * they are an admin;
  * another of their groups, without a policy on the Database, has unrestricted view-data access to the whole Database.

  The role is the value of the policy's user attribute. A missing attribute, policies of several groups resolving to
  different roles, or a sandbox on the same Database are errors: queries fail rather than run with the wrong access.

  ### How the role reaches the connection

  [[apply-impersonation]] records the role on the query (so cached results are keyed by it), and
  [[apply-impersonation-postprocessing]] binds it while the query runs. Every checkout of a pooled warehouse connection
  calls [[set-role-if-supported!]], which sets the bound role, or resets a connection that ran under a role (or that
  belongs to a Database with impersonation policies) to the default role, so a pooled connection never carries a
  previous user's role."
  (:require
   [clojure.core.memoize :as memoize]
   [metabase.api.common :as api]
   [metabase.data-access.attributes :as data-access.attributes]
   [metabase.data-access.db :as data-access.db]
   [metabase.data-access.sandbox :as data-access.sandbox]
   [metabase.driver :as driver]
   [metabase.driver.sql :as driver.sql]
   [metabase.driver.util :as driver.u]
   [metabase.permissions.core :as perms]
   [metabase.query-processor.interface :as qp.i]
   [metabase.util :as u]
   [metabase.util.i18n :refer [tru]]
   [metabase.util.log :as log])
  (:import
   (java.util Collections Map WeakHashMap)))

(set! *warn-on-reflection* true)

;;; ------------------------------------------------ Enforced policies -----------------------------------------------

(defn- enforced-policies
  "The impersonation policies of the User with `user-id`'s groups on the Database with `db-id`, or nil when none applies
  to them."
  [user-id db-id]
  (let [policies (data-access.db/user-impersonations user-id db-id)]
    (when (seq policies)
      (let [impersonated-groups (into #{} (map :group_id) policies)
            other-groups        (into #{} (remove impersonated-groups) (data-access.db/user-group-ids user-id))]
        (when-not (and (seq other-groups)
                       (= :unrestricted
                          (perms/table-permission-for-groups other-groups :perms/view-data db-id nil)))
          policies)))))

(defn- role-value [attribute value]
  (if (or (string? value) (number? value))
    (str value)
    (throw (ex-info (tru "The user attribute \"{0}\" used for connection impersonation must hold a single value." attribute)
                    {:status-code 403, :type :missing-required-permissions, :attribute attribute}))))

(defn impersonation-for-db
  "`{:role role}` when the current user is impersonated on the Database with `db-id`, else nil. Throws a 403 when the
  policy can't be resolved (missing attribute, conflicting roles, a sandbox on the same Database)."
  [db-id]
  (when (and api/*current-user-id* (not api/*is-superuser?*) (pos-int? db-id))
    (when-let [policies (enforced-policies api/*current-user-id* db-id)]
      (when (data-access.sandbox/sandboxed-user-for-db? db-id)
        (throw (ex-info (tru "Conflicting row and column security and connection impersonation policies apply to you on this database. Ask an administrator to keep only one of them.")
                        {:status-code 403, :type :missing-required-permissions, :database-id db-id})))
      (let [attributes (data-access.attributes/user-attributes api/*current-user-id*)
            roles      (into (sorted-set)
                             (map (fn [{:keys [attribute]}]
                                    (role-value attribute
                                                (data-access.attributes/required-attribute-value
                                                 attributes attribute :impersonation))))
                             policies)]
        (when (> (count roles) 1)
          (throw (ex-info (tru "Your groups have connection impersonation policies with different database roles for this database. Ask an administrator to keep only one of them.")
                          {:status-code 403, :type :missing-required-permissions, :database-id db-id})))
        {:role (first roles)}))))

(defn impersonation-enforced-for-db?
  "Whether connection impersonation applies to the current user on the Database `db-or-id`. True also when it applies
  but can't be resolved, since their queries there must not run unimpersonated."
  [db-or-id]
  (try
    (some? (impersonation-for-db (u/the-id db-or-id)))
    (catch clojure.lang.ExceptionInfo _
      true)))

(defn impersonated-user?
  "Whether connection impersonation applies to the current user on any Database."
  []
  (boolean
   (when (and api/*current-user-id* (not api/*is-superuser?*))
     (some impersonation-enforced-for-db?
           (into #{} (map :db_id) (data-access.db/user-impersonations api/*current-user-id* nil))))))

;;; ------------------------------------------------- Cache tokens ---------------------------------------------------

(defn impersonation-token-for-db
  "`{:role role}` when the current user is impersonated on the Database with `db-id`, else nil. May throw, see
  [[impersonation-for-db]]."
  [db-id]
  (impersonation-for-db db-id))

(defn- field-database-id [field]
  (or (get-in field [:table :db_id])
      (:db_id field)
      (some-> ((some-fn :table_id :table-id) field) data-access.db/table :db_id)))

(defn hash-input-for-impersonation
  "The part of the FieldValues cache key that depends on the current user's impersonation on `field`'s Database: nil
  when they aren't impersonated there, `{:impersonation-role nil}` (no cached values may be used) when it can't be
  resolved."
  [field]
  (try
    (when-let [{:keys [role]} (some-> (field-database-id field) impersonation-for-db)]
      {:impersonation-role role})
    (catch Throwable e
      (log/warnf e "Could not resolve connection impersonation for FieldValues of field %s" (:id field))
      {:impersonation-role nil})))

;;; ------------------------------------------------ Query processor -------------------------------------------------

(defn apply-impersonation
  "Pre-processing middleware. Records the current user's impersonation role on the query, so results cached for it
  are only served to users with the same role and so [[apply-impersonation-postprocessing]] can bind it."
  [query]
  (if qp.i/*skip-middleware-because-app-db-access*
    query
    (if-let [{:keys [role]} (impersonation-for-db (:database query))]
      (assoc query :impersonation/role role)
      query)))

;; The connection pool's checkout hook can't take arguments: the role reaches it bound on the query's thread.
#_{:clj-kondo/ignore [:metabase/discourage-dynamic-vars]}
(def ^:dynamic *impersonation*
  "`{:db-id :role}` of the query running on this thread under connection impersonation, or nil."
  nil)

(defn apply-impersonation-postprocessing
  "Execution middleware. Binds the role recorded on the query while it runs, so connections checked out for it use
  the role."
  [qp]
  (fn [query rff]
    (binding [*impersonation* (when-let [role (:impersonation/role query)]
                                {:db-id (:database query), :role role})]
      (qp query rff))))

(defn currently-impersonated?
  "Whether a connection impersonation role is bound for the query running on this thread."
  []
  (some? *impersonation*))

;;; ------------------------------------------------ Connections -----------------------------------------------------

(defonce ^:private ^Map connections-with-role
  ;; physical connections that last ran under an impersonation role; weak, so closed connections drop out
  (Collections/synchronizedMap (WeakHashMap.)))

(def ^:private database-has-impersonations?
  (memoize/ttl (fn [db-id] (data-access.db/database-has-impersonations? db-id))
               :ttl/threshold (* 60 1000)))

(defn impersonations-in-database?
  "Whether any group has an impersonation policy on the Database with `db-id`. Unlike the check done on every
  connection checkout, this always reads the app DB."
  [db-id]
  (data-access.db/database-has-impersonations? db-id))

(defn forget-database-policies!
  "Drop what this instance remembers about which Databases have impersonation policies; call after changing them."
  []
  (memoize/memo-clear! database-has-impersonations?))

(defn set-role-if-supported!
  "Called on every checkout of a pooled connection `conn` to `database`. Sets the current query's impersonation role,
  or puts back the default role on a connection that may carry another role."
  [driver conn database]
  (when (and database
             (driver.u/supports? driver :connection-impersonation database))
    (let [{bound-db-id :db-id, role :role} *impersonation*]
      (if (and role (= bound-db-id (:id database)))
        (do
          (driver/set-role! driver conn role)
          (.put connections-with-role conn true))
        (when (or (.containsKey connections-with-role conn)
                  (database-has-impersonations? (:id database)))
          (if-let [default-role (driver.sql/default-database-role driver database)]
            (do
              (driver/set-role! driver conn default-role)
              (.remove connections-with-role conn))
            (when (.containsKey connections-with-role conn)
              ;; nothing to reset it to: refuse the connection, so the pool replaces it with a fresh one
              (throw (ex-info (tru "Connection impersonation needs a default role for this database. Set the role in the database connection settings.")
                              {:database-id (:id database)})))))))))
