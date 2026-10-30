# Granular caching

- **Admin → Performance → Database caching**: a default policy plus a policy per database; "Clear cache for this
  database", "Clear all cached results", "Reset all to default".
- **Admin → Performance → Dashboard and question caching**: every dashboard and question with its own policy, with
  edit and reset.
- **Dashboard settings, question settings, metric caching**: "When to get new results" and "Clear cache".

Policies: **Adaptive** (cache for a multiple of the average run time), **Duration** (fixed hours/minutes),
**Schedule** (results go stale when a cron schedule fires, in the report timezone) and **Don't cache**. The most
specific policy wins: question → dashboard (when the question runs on that dashboard) → database → default. A
background job records schedule runs every minute; nothing needs configuring.

Models use model persistence instead of a caching policy.

## Refresh cache automatically

A question's or dashboard's **Duration** or **Schedule** policy has a **Refresh cache automatically** switch. With
it on, Metabase runs the queries again as soon as their cached results go stale, so people are served from the cache
instead of waiting:

- **Schedule**: right after the schedule fires.
- **Duration**: shortly before the results expire: 2 minutes plus the last 10% of the duration
  (`MB_QUERY_CACHING_EARLY_REFRESH_RATIO`, default 0.1) before.
- Either: right after someone clears the cache of the question, dashboard or database.

What runs again is what people ran: per question, the (up to) 10 combinations of filter values applied most often
during the last caching period, or the last one applied when nobody ran it during that period. A question nobody has
ever run is left alone. On a dashboard, the policy covers the cards without a policy of their own, with the filter
values applied on that dashboard.

Questions on a database with row- and column-level security or connection impersonation are **not** refreshed:
their results differ from person to person, so there is no single result to keep warm. Their caching still works
for queries people run.

The refresh runs show up in the query log (`query_execution`) with context `cache-refresh`. A background job checks
every minute what is due. With several Metabase instances on one application database, each policy is refreshed by
one instance only.
