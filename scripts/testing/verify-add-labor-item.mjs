// Verifies the "Add Labor" flow on My Organization's Library now that the
// labor_library migration (050_labor_library.sql) has been applied: picking
// a Labor Type from the dropdown and saving creates a row without the
// earlier "Could not find the table 'public.labor_library'" schema-cache
// error, and the new row shows up in the Labor table.
//
// Prereqs: node --env-file=.env.local scripts/testing/seed-fixture.mjs
//          supabase/migrations/050_labor_library.sql applied to the DB
// Usage:   node --env-file=.env.local scripts/testing/verify-add-labor-item.mjs

import { chromium } from "playwright";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const EMAIL = process.env.PLAYWRIGHT_TEST_EMAIL;
const PASSWORD = process.env.PLAYWRIGHT_TEST_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error("Missing PLAYWRIGHT_TEST_EMAIL/PASSWORD — run with node --env-file=.env.local");
  process.exit(1);
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  try {
    // Sign-in lives in the header's "Log In" popup; /login only redirects.
    await page.goto(`${APP_URL}/`);
    await page.locator("button", { hasText: /^Log In$/ }).first().click();
    await page.locator('input[type="email"]').fill(EMAIL);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.locator("button", { hasText: /^Log In$/ }).first().waitFor({ state: "detached", timeout: 15000 });

    await page.goto(`${APP_URL}/inventory?section=org`);
    await page.locator("button", { hasText: "Add Labor" }).waitFor({ timeout: 15000 });

    await page.locator("button", { hasText: "Add Labor" }).click();
    await page.locator("text=Add Labor Item").waitFor({ timeout: 5000 });

    const select = page.locator("select");
    await select.waitFor({ timeout: 5000 });
    const selectedLabel = await select.locator("option:checked").textContent();
    console.log(`Labor Type dropdown defaulted to: "${selectedLabel?.trim()}"`);

    await page.locator("button", { hasText: /^Save$/ }).click();
    await page.waitForTimeout(1500);

    const schemaCacheError = await page.locator("text=Could not find the table").count();
    console.log(`Schema-cache error present (expect 0): ${schemaCacheError}`);

    const modalStillOpen = await page.locator("text=Add Labor Item").count();
    console.log(`Modal closed after save (expect true): ${modalStillOpen === 0}`);

    const newRow = page.locator("tbody tr", { hasText: selectedLabel?.trim() || "" }).first();
    const rowVisible = await newRow.count();
    console.log(`New row visible in Labor table (expect true): ${rowVisible > 0}`);
    if (rowVisible > 0) {
      console.log(`Row text: ${(await newRow.textContent())?.replace(/\s+/g, " ").trim()}`);
    }

    await page.screenshot({ path: "scripts/testing/screenshots/add-labor-item.png" });
    console.log(`\nConsole/page errors: ${consoleErrors.length === 0 ? "none" : consoleErrors.join(" | ")}`);
    console.log("Done. Screenshot at scripts/testing/screenshots/add-labor-item.png");
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
