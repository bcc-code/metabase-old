(ns metabase.metabot.tools.sql.masking
  "Masking the values a database error quotes from the data, before the error reaches the model.

  A database usually rejects a query over something the query says: a column or table it names, a function, the
  syntax. Those parts of its error are what the model needs to fix the query, and the model wrote them itself. Now and
  then the error also quotes a value from the data, such as the text that wouldn't convert to a number, which may be
  personal. So a quoted part of the error stays only when it is text of the query itself, and email addresses and long
  numbers that aren't in the query are masked too. This is best effort: it can't recognise a value the error doesn't
  set apart."
  (:require
   [clojure.string :as str]
   [metabase.util :as u]))

(set! *warn-on-reflection* true)

(def ^:private quoted-part
  "Text in double quotes, single quotes or backticks: the ways databases quote identifiers and values in errors."
  #"\"([^\"]*)\"|'([^']*)'|`([^`]*)`")

(def ^:private key-detail
  "A key and its values in a constraint error, such as Postgres's `Key (email)=(someone@example.com)`."
  #"\)=\(([^)]*)\)")

(def ^:private email-address
  #"[\w.%+-]+@[\w-]+(?:\.[\w-]+)+")

(def ^:private long-number
  "Six digits or more: an id, a phone number or an account number rather than a position in the query."
  #"\d{6,}")

(def ^:private parts-of-a-query
  "What databases quote in an error to say where in the query it went wrong, such as MySQL's `in 'where clause'`."
  #{"where clause" "field list" "order clause" "group statement" "having clause" "on clause" "from clause"
    "select clause" "group clause" "order by clause" "group by clause"})

(def ^:private sql-expression
  "An expression as a database writes it back in an error, such as H2's `CAST(10 AS BIGINT)`: upper-case words, digits
  and operators, with a call in parentheses."
  #"[A-Z0-9_ .,*+/<>=-]*\([A-Z0-9_ .,*+/<>=()'-]*\)[A-Z0-9_ .,*+/<>=()-]*")

(defn- in-query?
  [lower-case-sql text]
  (or (contains? parts-of-a-query (u/lower-case-en text))
      (str/includes? lower-case-sql (u/lower-case-en text))
      (boolean (re-matches sql-expression text))))

(defn- mask-unless-in-query
  [lower-case-sql replacement]
  (fn [match]
    (let [text (if (string? match) match (first match))]
      (if (in-query? lower-case-sql text)
        text
        replacement))))

(defn mask-data-values
  "`error-message`, a database's error for the query `sql`, with the quoted text, email addresses and long numbers that
  aren't part of `sql` masked. With no `sql`, all of them are masked. Nil for a nil `error-message`."
  [error-message sql]
  (when error-message
    (let [lower-case-sql (u/lower-case-en (or sql ""))]
      (-> error-message
          (str/replace quoted-part
                       (fn [[whole & groups]]
                         (let [inner (some identity groups)
                               quote (subs whole 0 1)]
                           (if (or (str/blank? inner) (in-query? lower-case-sql (str/trim inner)))
                             whole
                             (str quote "<value>" quote)))))
          (str/replace key-detail ")=(<value>)")
          (str/replace email-address (mask-unless-in-query lower-case-sql "<email>"))
          (str/replace long-number (mask-unless-in-query lower-case-sql "<number>"))))))
