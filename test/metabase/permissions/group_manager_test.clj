(ns metabase.permissions.group-manager-test
  "Tests for group managers: non-admins who manage the membership of their own groups."
  (:require
   [clojure.test :refer :all]
   [metabase.permissions.advanced-test-util :as advanced-test-util]
   [metabase.permissions.core :as perms]
   [metabase.test :as mt]
   [metabase.test.fixtures :as fixtures]
   [metabase.util :as u]
   [toucan2.core :as t2]))

(use-fixtures :once (fixtures/initialize :db :test-users))

(defn- do-with-group-manager
  "Call `f` with a map of a group manager `:manager`, the group they manage `:managed-group`, a group they don't manage
  `:other-group`, and a user who belongs to neither `:member`."
  [f]
  (mt/with-temp [:model/User                       manager       {:first_name "Mallard"}
                 :model/User                       member        {:first_name "Teal"}
                 :model/PermissionsGroup           managed-group {:name "Ducks"}
                 :model/PermissionsGroup           other-group   {:name "Geese"}
                 :model/PermissionsGroupMembership _             {:user_id          (u/the-id manager)
                                                                  :group_id         (u/the-id managed-group)
                                                                  :is_group_manager true}]
    (f {:manager       manager
        :member        member
        :managed-group managed-group
        :other-group   other-group})))

(defn- membership-id [user group]
  (t2/select-one-pk :model/PermissionsGroupMembership :user_id (u/the-id user) :group_id (u/the-id group)))

(defn- group-ids [user]
  (t2/select-fn-set :group_id :model/PermissionsGroupMembership :user_id (u/the-id user)))

(deftest group-manager-groups-test
  (advanced-test-util/with-advanced-permissions
    (do-with-group-manager
     (fn [{:keys [manager managed-group other-group]}]
       (testing "a group manager lists only the groups they manage"
         (is (= #{(u/the-id managed-group)}
                (into #{} (map :id) (mt/user-http-request manager :get 200 "permissions/group")))))
       (testing "a group manager can fetch the groups they manage, but no other"
         (mt/user-http-request manager :get 200 (str "permissions/group/" (u/the-id managed-group)))
         (mt/user-http-request manager :get 403 (str "permissions/group/" (u/the-id other-group))))
       (testing "a group manager can rename the groups they manage, but no other"
         (mt/user-http-request manager :put 200 (str "permissions/group/" (u/the-id managed-group)) {:name "Dabbling ducks"})
         (mt/user-http-request manager :put 403 (str "permissions/group/" (u/the-id other-group)) {:name "Swans"})
         (is (= "Geese" (t2/select-one-fn :name :model/PermissionsGroup :id (u/the-id other-group)))))
       (testing "people who manage no group can't list groups"
         (mt/user-http-request :rasta :get 403 "permissions/group"))
       (testing "GET /api/user/current says the user is a group manager"
         (is (true? (get-in (mt/user-http-request manager :get 200 "user/current") [:permissions :is_group_manager])))
         (is (false? (get-in (mt/user-http-request :rasta :get 200 "user/current") [:permissions :is_group_manager]))))
       (testing "while the feature is disabled a group manager has no special access"
         (advanced-test-util/without-advanced-permissions
           (mt/user-http-request manager :get 403 "permissions/group")
           (mt/user-http-request manager :get 403 (str "permissions/group/" (u/the-id managed-group)))))))))

(deftest group-manager-membership-api-test
  (advanced-test-util/with-advanced-permissions
    (do-with-group-manager
     (fn [{:keys [manager member managed-group other-group]}]
       (testing "a group manager can add people to the groups they manage"
         (mt/user-http-request manager :post 200 "permissions/membership" {:group_id (u/the-id managed-group)
                                                                          :user_id  (u/the-id member)})
         (is (contains? (group-ids member) (u/the-id managed-group))))
       (testing "but not to other groups"
         (mt/user-http-request manager :post 403 "permissions/membership" {:group_id (u/the-id other-group)
                                                                          :user_id  (u/the-id member)})
         (mt/user-http-request manager :post 403 "permissions/membership" {:group_id (u/the-id (perms/admin-group))
                                                                          :user_id  (u/the-id member)})
         (is (not (contains? (group-ids member) (u/the-id other-group))))
         (is (not (contains? (group-ids member) (u/the-id (perms/admin-group))))))
       (testing "a group manager can promote members of the groups they manage"
         (mt/user-http-request manager :put 200 (str "permissions/membership/" (membership-id member managed-group))
                               {:is_group_manager true})
         (is (true? (t2/select-one-fn :is_group_manager :model/PermissionsGroupMembership
                                      :id (membership-id member managed-group)))))
       (perms/add-user-to-group! member other-group)
       (testing "but not of other groups"
         (mt/user-http-request manager :put 403 (str "permissions/membership/" (membership-id member other-group))
                               {:is_group_manager true}))
       (testing "a group manager can remove people from the groups they manage, but no other"
         (mt/user-http-request manager :delete 403 (str "permissions/membership/" (membership-id member other-group)))
         (is (contains? (group-ids member) (u/the-id other-group)))
         (mt/user-http-request manager :delete 204 (str "permissions/membership/" (membership-id member managed-group)))
         (is (not (contains? (group-ids member) (u/the-id managed-group)))))
       (testing "admins can't be group managers"
         (mt/user-http-request :crowberto :post 400 "permissions/membership" {:group_id         (u/the-id managed-group)
                                                                             :user_id          (mt/user->id :crowberto)
                                                                             :is_group_manager true}))))))

(deftest group-manager-update-user-memberships-test
  (advanced-test-util/with-advanced-permissions
    (do-with-group-manager
     (fn [{:keys [manager member managed-group other-group]}]
       (let [all-users  {:id (u/the-id (perms/all-users-group))}
             update!    (fn [expected-status memberships]
                          (mt/user-http-request manager :put expected-status (str "user/" (u/the-id member))
                                                {:user_group_memberships memberships}))]
         (testing "a group manager can see the people in Metabase"
           (is (seq (:data (mt/user-http-request manager :get 200 "user")))))
         (testing "a group manager can add a user to the groups they manage, as a manager or not"
           (update! 200 [all-users {:id (u/the-id managed-group) :is_group_manager true}])
           (is (= {(u/the-id managed-group) true}
                  (t2/select-fn->fn :group_id :is_group_manager :model/PermissionsGroupMembership
                                    :user_id (u/the-id member) :group_id (u/the-id managed-group)))))
         (testing "but not to other groups"
           (update! 403 [all-users {:id (u/the-id managed-group)} {:id (u/the-id other-group)}])
           (update! 403 [all-users {:id (u/the-id managed-group)} {:id (u/the-id (perms/admin-group))}])
           (is (= #{(u/the-id (perms/all-users-group)) (u/the-id managed-group)} (group-ids member))))
         (perms/add-user-to-group! member other-group)
         (testing "nor remove them from other groups"
           (update! 403 [all-users {:id (u/the-id managed-group)}])
           (is (contains? (group-ids member) (u/the-id other-group))))
         (testing "a group manager can remove a user from the groups they manage"
           (update! 200 [all-users {:id (u/the-id other-group)}])
           (is (= #{(u/the-id (perms/all-users-group)) (u/the-id other-group)} (group-ids member))))
         (testing "a group manager can't change a user's other details"
           (mt/user-http-request manager :put 200 (str "user/" (u/the-id member)) {:first_name "Pintail"})
           (is (= "Teal" (t2/select-one-fn :first_name :model/User :id (u/the-id member))))))))))

(deftest admin-update-user-memberships-test
  (advanced-test-util/with-advanced-permissions
    (do-with-group-manager
     (fn [{:keys [member managed-group other-group]}]
       (let [all-users {:id (u/the-id (perms/all-users-group))}]
         (testing "admins set every membership, and who manages each group"
           (mt/user-http-request :crowberto :put 200 (str "user/" (u/the-id member))
                                 {:user_group_memberships [all-users
                                                           {:id (u/the-id managed-group) :is_group_manager true}
                                                           {:id (u/the-id other-group) :is_group_manager false}]})
           (is (= {(u/the-id (perms/all-users-group)) false
                   (u/the-id managed-group)           true
                   (u/the-id other-group)             false}
                  (t2/select-fn->fn :group_id :is_group_manager :model/PermissionsGroupMembership
                                    :user_id (u/the-id member)))))
         (testing "an admin can't be made a group manager"
           (mt/user-http-request :crowberto :put 400 (str "user/" (u/the-id member))
                                 {:user_group_memberships [all-users
                                                           {:id (u/the-id (perms/admin-group))}
                                                           {:id (u/the-id managed-group) :is_group_manager true}]})
           (is (false? (t2/select-one-fn :is_superuser :model/User :id (u/the-id member))))))))))
