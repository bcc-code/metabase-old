# Metabot SQL for business users

Each person chooses whether to see the SQL and database errors of the queries Metabot (the AI assistant) writes:
**Account settings → Profile → "Show me SQL and database errors"**. It is on for admins and off for everyone else
until they change it.

With it off:

- Before Metabot shows a SQL query it wrote, in the chat or as a proposal in the SQL editor, the query runs once,
  for one row, as that person and with their permissions. Only a single read-only SELECT is run this way; anything
  else (and SQL with `{{variables}}`) is shown as before.
- When the database rejects it, nobody sees the error: it goes back to Metabot, which fixes the query within the same
  reply. After 3 failed runs in one reply, Metabot stops and explains in plain words, and a further failure ends the
  reply with "Metabot could not build a query that works for this. Try asking in a different way."
- A chart in the chat that fails later shows "There was a problem displaying this chart." instead of the database's
  message (a missing permission is still explained as such).

People with it on get the query straight away and see its error if it fails, so their queries don't run twice.

Whenever a database error goes back to the model (here, and when Metabot reads query results), values it quotes
from the data are masked first: quoted text that isn't part of the query, email addresses and long numbers.
Table and column names, and expressions from the query, stay so that Metabot can fix it. This is best effort: it
can't recognise a value the database doesn't set apart.

A test run takes at most 30 seconds; a slower query is shown without one. Test runs show up in the query log with
context `metabot`.
