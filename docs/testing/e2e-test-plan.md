# AVGenix — End-to-End Manual Test Plan

Written from the perspective of a real AV integration company using AVGenix for the first
time, walking a project from first login through to completion. Use this as a checklist
during manual QA passes; check items off and note the actual result (not just pass/fail)
next to anything surprising.

Each section lists: **Steps** (what the user does) → **Expect** (what should happen).
Flag anything that deviates, is slow, or requires a page refresh to reflect reality.

---

## 0. Before you start

- [ ] Use a fresh test identity per pass (e.g. `claude-e2e-test+<date>@avgenix.local`) so org
      creation / invite flows aren't polluted by leftover state from prior runs.
- [ ] Test in both a desktop browser width and a narrow/mobile width — several flows below
      (project dashboard cards, calculators, room designer) are layout-heavy.
- [ ] Have two browser profiles/incognito windows ready for invite-flow testing (inviter +
      invitee).

---

## 1. First impression: landing → sign up

**Steps**

- [ ] Visit the site logged out. Confirm header shows `Home`, `Dashboard`, `Sign Up`, `Log In`. VM Note: The Home and Dashboard does not appear while signed out, and it is the correct behaviour.
- [ ] Click **Sign Up**, register with a new email/password.
- [ ] Check email for confirmation link (`/auth/confirm`); click it.
- [ ] Log in with the new account.

VM Question: Should we also ask for a contact number, so user has to enter the number, so that there are no two accounts with the same number. This will avoid abuse of the 3 day trial. 

**Expect**

- [ ] Unconfirmed accounts can't reach the dashboard (or are clearly told to confirm).
- [ ] After confirming + logging in, user lands on `/welcome` (not dumped into a broken
      dashboard with no org).

---

## 2. Onboarding: org or invite?  
VM Note: This behaviour has changed. Now, on sign up, an account is created, without enforcing the users to create an organization. The user will have capability to create an rganization later on, and manage the team, also if someone invites this user to their team, an invitation email and button shows up. Accepting it would join you to the organization.

**Steps**

- [ ] On `/welcome`, read both options ("part of an organization" vs "starting fresh").
- [ ] Choose **Create Organization** → fill out `/org/new`.

**Expect**

- [ ] A brand-new user with no org is never silently routed to `/dashboard`; `/welcome`
      only auto-skips once `activeOrg` is actually loaded (watch for a flash of the welcome
      screen immediately followed by a redirect — confirm it isn't janky).
- [ ] New org gets created, user becomes its first member/admin, and lands on `/dashboard`.

**Separately test the invite side:**

- [ ] From org A (already created above), go to `/org/members` → `/org/invite`, invite the
      second test identity.
- [ ] In the second browser profile, accept the invite link.
- [ ] Confirm the invitee joins org A directly (skips `/org/new`) and shows up in
      `/org/members` with the expected role.
- [ ] As the admin, remove that member (`remove-member`) and confirm their seat count drops.

---

## 3. Org settings & billing (Stripe test mode)

**Steps**

- [ ] Go to **Account Settings** (`/org/settings`). Review org name/address, member role
      list (default roles vs custom), and labor rate table (Engineering, Installation,
      Project Mgmt, Project Coord, Programming, Field Engineering).
- [ ] Add a custom role, add/edit a labor rate, save, reload the page — confirm it persisted. VM Question: How does the Labor rate etc. get used in the app?
- [ ] Open billing/checkout (`/api/stripe/checkout`) and go through a **test-mode** card
      checkout for a seat.
- [ ] Confirm seat count reflected in the org matches `sync-seats` after adding the second
      member from §2 (billing memory: $20/seat, each workspace billed separately — verify a
      second org does NOT share or double-count this workspace's seats).
- [ ] Open the Stripe customer portal (`/api/stripe/portal`) from the app and confirm it
      opens the right customer (not a different workspace's).

**Expect**

- [ ] No live-mode charge occurs (test mode only, per current project status).
- [ ] Seat count updates reasonably promptly after invite/removal, not just on hard refresh.

---

## 4. My Settings (personal profile)

**Steps**

- [ ] Go to **My Settings** (`/profile/settings`). Update name/phone/avatar if available.
- [ ] Switch orgs (if you belong to more than one) and confirm the dashboard, projects list,
      and library all re-scope to the new org — not a mix of both.
- [ ] Try account deletion (`/api/account/delete`) on a disposable test account only — do
      **not** run this against a real org's admin account. Confirm it actually removes
      access rather than leaving a zombie session.

---

## 5. Create the first project

**Steps**

- [ ] Go to `/projects` → **New Project**. Fill in name, job number, client name, address,
      city/state/zip, client email/phone, sales rep, engineer.
- [ ] Save, confirm it appears in the project list.

**Expect**

- [ ] New project's phase badge reads **Opportunity** by default (confirmed in code —
      `phase: "opportunity"` is set on creation). This should hold true even if you leave
      phase unset in the form.
- [ ] Filtering the project list by stage/client/sales/engineer/PM/programmer all narrow
      results correctly, including the new project under "Opportunity".
- [ ] Duplicate the project (if that action is exposed) and confirm the dupe is a clean copy,
      not a reference that mutates the original.

---

## 6. Walk the project lifecycle stages

Open the new project (`/projects/[id]`). It shows a dashboard of modules grouped by
recommended phase. Walk them **in the order a real PM would**, advancing the phase as you go.

### 6a. Site Survey _(recommended at: Proposal)_

- [ ] Open **Site Survey**. Add a room, record measurements/existing infrastructure.
- [ ] Confirm rooms created here are visible later from the Proposal page (equipment
      list references survey rooms, per `surveyRooms` state on the project page).

### 6b. Design Engineering _(recommended at: Proposal)_

- [ ] Open **Design Engineering** hub → try Room Designer (and Room Designer v2 if both are
      reachable — confirm which one is actually linked from the project and whether the
      other is dead/legacy).
- [ ] Try Rack Planner: add a rack, drop in equipment, confirm elevation/unit math updates
      live as you add/remove items (don't hand-verify U-count once and trust it forever —
      add a tall item and recheck the total).
- [ ] Try Signal Flow builder: place a couple of devices, connect them, save, reload — confirm
      the topology persists.
- [ ] Try Cable Pull sheet generation from the signal flow — confirm cable list matches the
      connections you actually made, not a stale sample.
- [ ] Try EDID/HDCP tool and RFI management — create one RFI, confirm it's visible from
      Project Engineering → RFI list later too (same project, same list, not two silos).

### 6c. Proposal _(recommended at: Proposal)_

- [ ] Open **Proposal**. Generate/author scope of work (there's an AI scope generator —
      `generate-scope` / `generate-proposal-scope` — try it and sanity-check the output
      against the site survey notes you entered).
- [ ] Add equipment line items — pull from the shared AVGenix Library and/or your org's
      equipment library; confirm pricing, margin %, and totals.
- [ ] **Per CLAUDE.md rule**: verify every derived number in the proposal (margin %, tax line,
      grand total, cost-vs-price) is computed live from the line items — change a unit price
      or quantity and confirm the totals recompute, rather than being frozen at generation
      time.
- [ ] Generate a Change Order from an existing accepted proposal; confirm it deltas correctly
      against the original rather than duplicating all line items as "new."
- [ ] Advance the project's phase to **Proposal**, then simulate winning it → **Contract**.
      Also test the losing path: mark the opportunity "Lost" and confirm the reason capture
      ("The opportunity did not convert") and that it's excluded from active-pipeline filters
      afterward.

### 6d. Procurement / Project Coordination _(recommended at: Contract)_

- [ ] Open **Project Coordination** (`/projects/[id]/procurement`). Release a purchase order
      from the accepted proposal's equipment list.
- [ ] Confirm the released order's pricing snapshot matches the Proposal totals at time of
      release (not a live re-pull that could drift if library prices change later).
- [ ] Go to `/procurement/receiving`, receive the order (partial receipt, then full receipt),
      confirm inventory/status updates reflect partial vs complete accurately.

### 6e. Project Engineering _(recommended at: Execution)_

- [ ] Open **Project Engineering**. Confirm it surfaces the same Room Designer / Rack Planner
      / Signal Flow work from §6b scoped to this project (not a second disconnected copy).
- [ ] Review/attach engineering drawings/documentation.

### 6f. Project Management _(recommended at: Execution)_

- [ ] Assign project roles (sales, engineer, PM, field engineer, programmer) from the org
      member list; confirm each assignment is reflected in the Projects list filters from §5.
- [ ] Check scheduling/coordination views for the project.
- [ ] Cross-check against the standalone **Project Management** module (`/project-management`,
      with People / Reports / Time Off / Time Tracking) — confirm hours logged against this
      project by a team member show up in the project's own reporting, not just in the
      standalone timesheet.

### 6g. Programming _(recommended at: Execution)_

- [ ] Open **Programming**. Log commissioning/integration-testing notes or checklist items
      against the project.

### 6h. Completion

- [ ] Mark the project **Completed**. Confirm it moves out of active pipeline views but
      remains fully viewable/read-accessible (survey, proposal, procurement history, etc. all
      still load — nothing gets archived into a broken state).

---

## 7. Reference tools a real estimator would lean on mid-project

These are typically used _while_ building the Proposal/Site Survey, not as a standalone
flow — test them in that context, not in isolation.

- [ ] Pick 3–4 calculators relevant to a real room (e.g. **Projector Lumens**, **Throw Ratio**,
      **Display Sizing**, **Speaker Coverage**, **Dante Bandwidth**, **PoE Budget**). Enter the
      same room dimensions you logged in Site Survey and sanity-check outputs against real
      AVIXA guidance.
  - [ ] **Explicitly re-check the CLAUDE.md rule here**: change one base input (e.g. screen
        width) and confirm every derived figure on that calculator (aspect ratio, Mpx,
        resolution, bandwidth, etc.) updates — none of them should be a value that was
        computed once and left as static text.
- [ ] Open **Resolution Reference**, **PoE Database**, **Standards**, and the general
      `/reference` pages (`/reference/platforms`, `/reference/poe-database`,
      `/reference/standards`) — confirm these match the versions under `/calculators/standards`
      and `/calculators/poe-database` rather than silently forking into stale duplicates.
- [ ] Check **Unit Converter** and **Connectors** reference for copy/paste-ability (a real
      estimator will copy a number straight into a proposal — make sure formatting doesn't
      mangle it, e.g. truncated decimals or missing units).

---

## 8. Equipment Library vs. org inventory

- [ ] As a non-admin org user, confirm you can **browse/search** the shared AVGenix Library
      (`/admin/products` is admin-only — a regular user shouldn't reach it) but can only
      **write** to your own org's equipment library (`/inventory`).
- [ ] As a `library_admins` member, add/edit a product in the shared library and confirm it's
      now visible to _other_ orgs' users (not just yours) — this is the one place changes are
      meant to be global.
- [ ] Add a custom item to your org's own `/inventory` that does **not** exist in the shared
      library; confirm it's usable in a Proposal and does not leak into other orgs.

---

## 9. Cross-cutting checks

- [ ] **Session persistence**: refresh mid-flow (e.g. mid-proposal) and confirm no data loss
      and no bounce back to login.
- [ ] **Logout**: use the header dropdown → Logout. Confirm protected routes (`/dashboard`,
      `/projects/...`) redirect to login afterward rather than rendering stale cached data.
- [ ] **Org switch mid-session**: with two orgs, switch active org while sitting on a project
      detail page that belongs to the _other_ org — confirm it doesn't keep showing that
      project's data under the new org context.
- [ ] **AI features error handling**: temporarily test what the scope/proposal AI generators
      (`generate-scope`, `generate-devices-from-scope`, `generate-signal-flow-topology`,
      `summarize-survey`) show on a slow/failed response — spinner vs. silent failure vs.
      stuck button.
- [ ] **Mobile width**: redo §5–6 project dashboard navigation at a phone-width viewport;
      confirm the module cards and tables don't overflow or become untappable.

---

## Known context to keep in mind while testing

- New projects must default to `phase = "opportunity"` — this was a deliberate fix, not an
  accident; flag it immediately if a new project ever lands in a different default stage.
- Derived figures (aspect ratios, Mpx, bandwidth, proposal totals) must always be computed
  from base values live, never hand-typed or frozen — see `docs/competitive/av-buddy/
video-teardown.md` §4 for why AVGenix treats this as a hard rule, not a style preference.
- Billing is $20/seat with each workspace billed separately in Stripe **test mode only** —
  don't be alarmed by test-mode banners/test card numbers; do be alarmed if a real card charge
  goes through or if two workspaces' seat counts bleed into each other.
