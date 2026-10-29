-- Backfill weekly requests created before HO approval was removed: they are still `open`, so nothing in the UI could approve or withdraw them.
UPDATE "mp_request" SET "status" = 'approved' WHERE "type" = 'weekly' AND "status" = 'open';
