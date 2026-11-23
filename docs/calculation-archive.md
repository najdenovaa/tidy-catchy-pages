# Calculation archive

Every explicit cementing, plug, CT and foam calculation records a detached snapshot in `calculation_logs`. Applied cementing optimizer programs are included. RIR, workover, stimulation and the standalone WOC simulator calculate live: input edits are archived after a 1.5-second pause rather than per keystroke. Initial default screens and opening an existing calculation do not create a second log entry.

The existing JSON columns and INSERT/SELECT RLS policies are reused; no database migration or Edge Function deployment is required. `calc_params.__calculationArchive` contains schemaVersion, build commit SHA, stable anonymous browser ID, account ID when available, title and results. IDs are descriptive client metadata, never authorization. Server read authorization continues to be enforced by admin-only RLS. New snapshots insert directly into the database; IP geolocation remains on the existing visit logging path.

A browser outbox persists one item per calculation before transmission, retries failed inserts after 15 seconds or connectivity restoration, and resumes at the next app launch. UUID primary keys make retry after a lost HTTP response idempotent. A storage/quota failure is shown to the user; an in-memory retry remains possible while the page is open. Different tabs do not overwrite each other's pending keys.

Admin Details opens the module in a separate tab using `?archive=<log-id>`. The module reads the protected original and restores the working inputs without updating the journal or the user's cabinet. Saving that working copy uses the normal cabinet flow to create a new calculation in the admin's account. Historical results and build version stay visible in Details; recalculation uses the current application code.

Legacy cementing entries with complete fluid arrays can be restored using the normalizer. Incomplete historical plug/CT entries have no restore action. Unsupported modules or archive formats are not opened as a different module. The admin list omits `calc_params`, avoiding download of every archived result just to display the log list.

Validation: `npm test`, `npx tsc --noEmit -p tsconfig.app.json`, `npm run build`. Unit tests cover guest/account identity, immutable capture, durable retry, duplicate IDs, RLS-denied reads, incomplete legacy records, and live input debounce/hydration. A real admin session is needed for an end-to-end check against the production database.
