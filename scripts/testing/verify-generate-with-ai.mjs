// Verifies "Generate with AI" in Signal Flow Builder or Room Designer.
//
// scope mode (room has a Scope of Work):
//   - questions come in rounds; the conference bar brand is NOT asked when
//     the scope already names one (Logitech here); every choice question
//     offers the generic option.
// interview mode (room has no Scope of Work):
//   - the modal offers "Write a Scope of Work first" (opens Site Survey on
//     that room's Scope of Work section) or "Let AI ask the questions";
//   - the interview starts with the basics and follows up on the answers
//     (a bar-based Teams Room answer leads to an MTR bar brand question);
//   - generating saves the answers back as the room's Scope of Work + size.
// Both: the review lists library matches vs generic, and generating places
// equipment.
//
// Calls the real AI routes, so it takes a few minutes.
//
// Prereqs: node --env-file=.env.local scripts/testing/create-test-user.mjs
//          node --env-file=.env.local scripts/testing/seed-fixture.mjs
// Usage:   node --env-file=.env.local scripts/testing/verify-generate-with-ai.mjs [signal-flow|room-designer] [scope|interview]

import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const EMAIL = process.env.PLAYWRIGHT_TEST_EMAIL;
const PASSWORD = process.env.PLAYWRIGHT_TEST_PASSWORD;
const fixture = JSON.parse(readFileSync(new URL("./.fixture.json", import.meta.url), "utf8"));
const OUT_DIR = fileURLToPath(new URL("./screenshots/", import.meta.url));
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const TOOL = process.argv[2] === "room-designer" ? "room-designer" : "signal-flow";
const MODE = process.argv[3] === "interview" ? "interview" : "scope";
const TAG = `${TOOL}-${MODE}`;

const SCOPE = `Medium conference room for 10 people, used for Microsoft Teams meetings.
Two 75" displays on the front wall. Logitech Rally Bar video bar below the displays.
Ceiling microphones and four ceiling speakers for voice and program audio.
Table HDMI input and a wireless presentation system; route sources to both displays through a switcher.
Wall-mounted touch panel by the door for room control.`;

const ROOM_FIELDS = ["scope_of_work", "room_length", "room_length_in", "room_width", "room_width_in", "room_height", "room_height_in"];

// Sets the room's survey fields; returns the previous values to restore later.
async function setRoomFields(values) {
  const { data } = await admin.from("site_surveys").select("data").eq("project_id", fixture.projectId).maybeSingle();
  let previous = null;
  const buildings = (data?.data?.buildings || []).map((b) => ({
    ...b,
    rooms: (b.rooms || []).map((r) => {
      if (r.id !== fixture.roomId) return r;
      previous = Object.fromEntries(ROOM_FIELDS.map((k) => [k, r.data?.[k] ?? ""]));
      return { ...r, data: { ...(r.data || {}), ...values } };
    }),
  }));
  await admin.from("site_surveys").update({ data: { ...(data?.data || {}), buildings } }).eq("project_id", fixture.projectId);
  return previous;
}

async function readRoomFields() {
  const { data } = await admin.from("site_surveys").select("data").eq("project_id", fixture.projectId).maybeSingle();
  for (const b of data?.data?.buildings || []) for (const r of b.rooms || []) if (r.id === fixture.roomId) return r.data || {};
  return {};
}

// Answers the visible round: prefers options that steer toward a bar-based
// Teams Room (to exercise the follow-ups), else the first option; types
// plain answers into text questions.
async function answerRound(page) {
  const blocks = page.locator("[data-question]");
  const n = await blocks.count();
  const asked = [];
  for (let i = 0; i < n; i++) {
    const block = blocks.nth(i);
    const q = (await block.locator(".font-semibold").first().textContent()) || "";
    const input = block.locator("input");
    const buttons = block.locator("button");
    if ((await buttons.count()) === 0 && (await input.count())) {
      const answer = /dimension|size|how (big|large)|length|width|seat|capacity|people/i.test(q) ? "24 x 16 x 9 ft, seats 10" : "Standard";
      await input.first().fill(answer);
      asked.push({ q, answer, options: [] });
      continue;
    }
    const labels = (await buttons.allTextContents()).map((t) => t.trim());
    const prefer = [/bar[- ]based/i, /teams/i, /video ?conferenc/i, /conference room/i];
    let idx = 0;
    for (const re of prefer) { const k = labels.findIndex((l) => re.test(l)); if (k >= 0) { idx = k; break; } }
    await buttons.nth(idx).click();
    asked.push({ q, answer: labels[idx], options: labels });
  }
  return asked;
}

async function main() {
  const previous = await setRoomFields(MODE === "scope"
    ? { scope_of_work: SCOPE }
    : { scope_of_work: "", room_length: "", room_length_in: "", room_width: "", room_width_in: "", room_height: "", room_height_in: "" });
  const browser = await chromium.launch();
  let fails = 0;
  const check = (label, ok, detail = "") => { console.log(`${label}: ${ok ? "YES" : `NO (FAIL${detail ? ` — ${detail}` : ""})`}`); if (!ok) fails++; };
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${APP_URL}/login`);
    await page.locator('input[type="email"]').fill(EMAIL);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15000 });
    await page.waitForTimeout(4000);
    await page.goto(`${APP_URL}/designEngineering/${TOOL}?project=${fixture.projectId}&room=${fixture.roomId}`);
    const aiButton = page.locator("button:not([disabled])", { hasText: "with AI" }).first();
    await aiButton.waitFor({ timeout: 120000 });
    await page.waitForTimeout(1500);
    await aiButton.click();

    if (MODE === "interview") {
      await page.locator("text=Let AI ask the questions").waitFor({ timeout: 60000 });
      check("No-scope choice offered", (await page.locator("text=Write a Scope of Work first").count()) > 0);
      await page.screenshot({ path: `${OUT_DIR}generate-with-ai-${TAG}-choose.png` });

      const [popup] = await Promise.all([
        context.waitForEvent("page"),
        page.locator("button", { hasText: "Open Scope of Work" }).click(),
      ]);
      await popup.waitForLoadState();
      const scopeBox = popup.locator('textarea[placeholder="Describe the scope of work for this room..."]');
      const opened = await scopeBox.waitFor({ timeout: 90000 }).then(() => true).catch(() => false);
      check("'Open Scope of Work' opens this room's Scope of Work in Site Survey", opened, popup.url());
      await popup.close();

      await page.locator("button", { hasText: "Let AI ask instead" }).click();
    }

    const transcript = [];
    const nextBtn = page.locator("button", { hasText: /^Next$/ });
    const genBtn = page.locator("button", { hasText: /^(Generate|Replace & generate)$/ });
    for (let round = 1; round <= 9; round++) {
      const which = await Promise.race([
        nextBtn.waitFor({ timeout: 240000 }).then(() => "questions"),
        genBtn.waitFor({ timeout: 240000 }).then(() => "review"),
      ]);
      if (which === "review") break;
      await page.waitForTimeout(300);
      const asked = await answerRound(page);
      console.log(`Round ${round}:`);
      asked.forEach((a) => console.log(`  Q: ${a.q}\n     options: ${a.options.join(" | ") || "(text)"}\n     answered: ${a.answer}`));
      transcript.push(...asked);
      if (round === 1) await page.screenshot({ path: `${OUT_DIR}generate-with-ai-${TAG}-round1.png` });
      await nextBtn.click();
    }

    const choiceQs = transcript.filter((t) => t.options.length);
    check("Every choice question offers the generic option", choiceQs.every((t) => t.options.some((o) => /Generic/.test(o))));
    if (MODE === "scope") {
      check("Did not ask for the conference bar brand (scope names Logitech)",
        !transcript.some((t) => /(conference|video) bar/i.test(t.q) && /brand|manufacturer/i.test(t.q)));
    } else {
      const firstRound = transcript.slice(0, 4).map((t) => t.q).join(" ");
      check("Interview starts with room basics", /room|space|size|dimension|outcome|use/i.test(firstRound), firstRound);
      const choseBar = transcript.findIndex((t) => /bar[- ]based|video bar/i.test(t.answer));
      const followedUp = choseBar >= 0 && transcript.slice(choseBar + 1).some((t) => /bar/i.test(t.q) && /brand|manufacturer|which/i.test(t.q));
      check("A bar-based answer leads to a bar brand follow-up", followedUp, choseBar < 0 ? "bar-based option never offered" : "");
    }

    await genBtn.waitFor({ timeout: 240000 });
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.innerText.replace(/\s+/g, " ").trim())));
    console.log("Designed equipment (qty | device | location | product):");
    rows.forEach((r) => console.log("  " + r.join(" | ")));
    check("Review lists designed equipment", rows.length > 0);
    if (MODE === "interview") check("Offers to save the answers as the Scope of Work", (await page.locator("text=Save the answers as this room").count()) > 0);
    const wiringWarnings = await page.locator("[data-wiring-warnings] li").allTextContents();
    if (wiringWarnings.length) console.log("Wiring-guide warnings:\n" + wiringWarnings.map((w) => "  - " + w).join("\n"));
    const usesLogitech = rows.some((r) => /Logitech/.test(r[3]));
    await page.screenshot({ path: `${OUT_DIR}generate-with-ai-${TAG}-review.png` });

    await genBtn.click();
    const doneText = TOOL === "signal-flow" ? "text=with AI across" : "text=with AI (";
    await page.locator(doneText).first().waitFor({ timeout: 180000 });
    const notice = await page.locator(doneText).first().textContent();
    console.log("Notice:", notice);
    if (TOOL === "signal-flow") {
      await page.waitForTimeout(800);
      const flagTexts = await page.evaluate(() => [...document.querySelectorAll("#sf-canvas-export svg text")].map((t) => t.textContent).filter((t) => /client lan/i.test(t || "")));
      console.log(`Client LAN flags on canvas: ${flagTexts.length} (${flagTexts.join(", ")})`);
      check("Devices that need internet are flagged to Client LAN", flagTexts.length > 0 && /flagged to Client LAN/.test(notice || ""), notice || "");
    }
    if (TOOL === "signal-flow" && usesLogitech) {
      check("Logitech units wired per the Logitech wiring guide", /follow the Logitech wiring guide/.test(notice || ""), notice || "");
      const asksMode = transcript.some((t) => /android|pc mode|byod|mode/i.test(t.q + " " + t.options.join(" ")));
      console.log(`Asked the Logitech operating mode: ${asksMode ? "yes" : "no (scope/answers may have settled it)"}`);
    }
    await page.screenshot({ path: `${OUT_DIR}generate-with-ai-${TAG}-placed.png` });

    if (MODE === "interview") {
      const saved = await readRoomFields();
      console.log("Saved scope:\n" + String(saved.scope_of_work || "").split("\n").map((l) => "  " + l).join("\n"));
      console.log("Saved size:", saved.room_length, "x", saved.room_width, "x", saved.room_height, "ft");
      check("Scope of Work saved to Site Survey", String(saved.scope_of_work || "").trim().length > 40);
      check("Room size saved to Site Survey", !!saved.room_length && !!saved.room_width);
    }

    await page.waitForTimeout(1500); // the history write is fire-and-forget
    const { error: histErr, data: hist } = await admin.from("ai_design_history").select("id, mode, selections").eq("org_id", fixture.orgId).order("created_at", { ascending: false }).limit(1);
    if (histErr) console.log(`ai_design_history: not available (${histErr.message}) — apply migration 052`);
    else check("Design recorded for future sessions", hist.length > 0 && hist[0].mode === MODE);
  } finally {
    await browser.close();
    if (previous) await setRoomFields(previous);
  }
  console.log(fails ? `\n${fails} check(s) FAILED` : "\nAll checks passed");
  if (fails) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
