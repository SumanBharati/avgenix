// Verifies: "when I do ctrl V, It should ask me to pick a point where I want
// it placed instead of randomly placing it anywhere."
//
// In Signal Flow Builder:
//   1. Ctrl+C then Ctrl+V must NOT paste immediately — it arms a placement
//      step (prompt notice + ghost preview following the cursor).
//   2. Clicking then pastes, with the copied group's top-left at the click.
//   3. Ctrl+V then Escape cancels — nothing is added.
//
// Prereqs: node --env-file=.env.local scripts/testing/create-test-user.mjs
//          node --env-file=.env.local scripts/testing/seed-fixture.mjs
// Usage:   node --env-file=.env.local scripts/testing/verify-signal-flow-paste-placement.mjs

import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const EMAIL = process.env.PLAYWRIGHT_TEST_EMAIL;
const PASSWORD = process.env.PLAYWRIGHT_TEST_PASSWORD;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const fixture = JSON.parse(readFileSync(new URL("./.fixture.json", import.meta.url), "utf8"));
const OUT_DIR = fileURLToPath(new URL("./screenshots/", import.meta.url));
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const DEVICE_NAME = "Paste Placement Test Display";

async function seed() {
  const designData = {
    devices: [
      { uid: 9081, id: "display-55", name: DEVICE_NAME, icon: "monitor", w: 4.0, h: 2.26, wall: "front", type: "display", color: "#8b5cf6", x: 8, y: 0.1, z: 5, mountWall: "north" },
    ],
    config: {
      roomType: "medium", roomW: 16, roomL: 20, roomH: 9,
      tableShape: "rectangular", tableSeats: 8, tableWidth: 4, tableWallDist: 4,
      showTable: true, selectedWall: "north", placedDoors: [], annotations: [],
    },
  };
  const { data: existing } = await admin.from("room_designs").select("id").eq("project_id", fixture.projectId).eq("room_id", fixture.roomId).maybeSingle();
  if (existing) await admin.from("room_designs").update({ data: designData, updated_at: new Date().toISOString() }).eq("id", existing.id);
  else await admin.from("room_designs").insert({ project_id: fixture.projectId, room_id: fixture.roomId, user_id: fixture.userId, data: designData });
}

async function login(page) {
  await page.goto(`${APP_URL}/login`);
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15000 });
}

const deviceBoxes = (page) => page.evaluate((name) =>
  [...document.querySelectorAll("#sf-canvas-export svg text")]
    .filter((t) => t.textContent && t.textContent.includes(name))
    .map((t) => { const r = t.closest("g").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }),
  DEVICE_NAME);

async function main() {
  await seed();
  const browser = await chromium.launch();
  const sfUrl = `${APP_URL}/designEngineering/signal-flow?project=${fixture.projectId}&room=${fixture.roomId}`;
  let fails = 0;
  const check = (label, ok, detail = "") => { console.log(`${label}: ${ok ? "YES" : `NO (FAIL${detail ? ` — ${detail}` : ""})`}`); if (!ok) fails++; };

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await login(page);
    // Let the post-login page finish storing the session before navigating
    // away, or the target page comes up signed out.
    await page.waitForTimeout(4000);
    await page.goto(sfUrl);
    // Generous timeout — the first hit on a dev server compiles the page.
    await page.locator("#sf-canvas-export").waitFor({ timeout: 90000 }).catch(async (e) => {
      await page.screenshot({ path: `${OUT_DIR}signal-flow-paste-load-fail.png` });
      throw e;
    });
    await page.locator("svg text", { hasText: DEVICE_NAME }).first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(500);

    const before = await deviceBoxes(page);
    console.log("Devices before:", before.length, before);
    const src = before[0];

    // Select + copy
    await page.mouse.click(src.x + src.w / 2, src.y + src.h / 2);
    await page.waitForTimeout(200);
    await page.keyboard.press("Control+c");
    await page.waitForTimeout(200);

    // Paste arms placement — nothing added yet
    await page.keyboard.press("Control+v");
    await page.waitForTimeout(300);
    check("Ctrl+V did not paste immediately", (await deviceBoxes(page)).length === before.length);
    check("Placement prompt shown", (await page.locator("text=Click to place").count()) > 0);

    // Ghost follows cursor
    const canvas = await page.evaluate(() => { const r = document.getElementById("sf-canvas-export").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    const target = { x: Math.round(canvas.x + canvas.w * 0.6), y: Math.round(canvas.y + canvas.h * 0.6) };
    await page.mouse.move(target.x - 40, target.y - 40);
    await page.mouse.move(target.x, target.y, { steps: 5 });
    await page.waitForTimeout(200);
    const ghost = await page.evaluate(() => {
      const r = [...document.querySelectorAll('#sf-canvas-export svg g[pointer-events="none"] > rect[stroke="#8b5cf6"]')][0];
      if (!r) return null; const b = r.getBoundingClientRect(); return { x: b.x, y: b.y };
    });
    check("Ghost preview rendered at cursor", !!ghost && Math.abs(ghost.x - target.x) < 3 && Math.abs(ghost.y - target.y) < 3, JSON.stringify(ghost));
    await page.screenshot({ path: `${OUT_DIR}signal-flow-paste-ghost.png` });

    // Click places it
    await page.mouse.click(target.x, target.y);
    await page.waitForTimeout(400);
    const after = await deviceBoxes(page);
    check("Click pasted one copy", after.length === before.length + 1, `count=${after.length}`);
    const pasted = after.find((b) => Math.abs(b.x - src.x) > 5 || Math.abs(b.y - src.y) > 5);
    console.log("Pasted device box:", pasted, "target:", target);
    check("Copy landed at clicked point (not next to original)", !!pasted && Math.abs(pasted.x - target.x) < 30 && Math.abs(pasted.y - target.y) < 30);
    await page.screenshot({ path: `${OUT_DIR}signal-flow-paste-placed.png` });

    // Ctrl+V then Escape cancels
    await page.keyboard.press("Control+v");
    await page.waitForTimeout(200);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    await page.mouse.click(canvas.x + 80, canvas.y + canvas.h - 80);
    await page.waitForTimeout(300);
    check("Escape cancelled the paste", (await deviceBoxes(page)).length === after.length);

    await page.close();
  } finally {
    await browser.close();
  }
  console.log(fails ? `\n${fails} check(s) FAILED` : "\nAll checks passed");
  if (fails) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
