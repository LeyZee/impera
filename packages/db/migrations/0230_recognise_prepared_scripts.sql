-- The recognition of a script copied into Reveal (ADR 0112 § 23): the import, as the service role, passes the order
-- and conditions the agency wrote on the script in preparation to the native script it became. It inserts only, and
-- only on a native script on which nothing was set: never an update nor a delete of what the agency set.
GRANT INSERT ON "platform_script_branches" TO impera_service;
