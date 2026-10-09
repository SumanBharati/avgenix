-- ============================================================
-- AVGenix: archive sandbox Stripe IDs before the live-mode cutover.
-- ============================================================
-- organizations.stripe_customer_id / stripe_subscription_id are a single,
-- mode-agnostic pair of columns (021_org_subscription.sql) — nothing in
-- the schema or in app/api/stripe/* distinguishes a Stripe test-mode ID
-- from a live-mode one. Now that STRIPE_SECRET_KEY has been switched to a
-- live restricted key, the test-mode cus_.../sub_... values already
-- stored on these rows are being sent to the Stripe Live API, which
-- correctly rejects them ("No such customer") — test and live are
-- separate object spaces in Stripe even though the ID format is
-- identical.
--
-- Before clearing stripe_customer_id/stripe_subscription_id so checkout
-- creates fresh live customers, copy the current (sandbox) values into a
-- dedicated archive pair. These archive columns are never read or
-- written by any app code — they exist purely so the sandbox
-- customer/subscription IDs used during test-mode development stay
-- looked-up-able from the DB instead of only living in the Stripe Test
-- Dashboard.
--
-- This migration is additive and non-destructive: it adds two nullable
-- columns and copies existing values into them. It does NOT clear or
-- modify stripe_customer_id / stripe_subscription_id — that happens in a
-- separate, explicitly-approved step once this archive is confirmed.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS stripe_test_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_test_subscription_id text;

COMMENT ON COLUMN public.organizations.stripe_test_customer_id IS
  'Archived Stripe test-mode customer ID, copied from stripe_customer_id before the live-mode cutover (049). Not read or written by app code.';
COMMENT ON COLUMN public.organizations.stripe_test_subscription_id IS
  'Archived Stripe test-mode subscription ID, copied from stripe_subscription_id before the live-mode cutover (049). Not read or written by app code.';

-- Copy only — never overwrites an archive value that's already set, so
-- this stays safe to re-run.
UPDATE public.organizations
SET
  stripe_test_customer_id     = COALESCE(stripe_test_customer_id, stripe_customer_id),
  stripe_test_subscription_id = COALESCE(stripe_test_subscription_id, stripe_subscription_id)
WHERE stripe_customer_id IS NOT NULL OR stripe_subscription_id IS NOT NULL;
