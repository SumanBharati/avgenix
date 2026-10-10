// Verifies that labor_library items (added via My Organization's Library →
// Labor tab) are now searchable from the Proposal page's "Add Equipment"
// modal and insert as a labor-priced line item (Labor Hrs * Labor Rate),
// not an equipment-priced one — the gap reported after the Add Labor feature
// first shipped (the picker only searched equipment_library).
//
// Prereqs: node --env-file=.env.local scripts/testing/seed-fixture.mjs
//          at least one labor_library row for the fixture org (the earlier
//          verify-add-labor-item.mjs run already added "Engineering")
// Usage:   node --env-file=.env.local scripts/testing/verify-labor-in-proposal.mjs

import { chromium } from "playwright";
import { readFileSync } from "fs";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const EMAIL = process.env.PLAYWRIGHT_TEST_EMAIL;
const PASSWORD = process.env.PLAYWRIGHT_TEST_PASSWORD;
const fixture = JSON.parse(readFileSync(new URL("./.fixture.json", import.meta.url), "utf8"));

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
    await page.goto(`${APP_URL}/`);
    await page.locator("button", { hasText: /^Log In$/ }).first().click();
    await page.locator('input[type="email"]').fill(EMAIL);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.locator("button", { hasText: /^Log In$/ }).first().waitFor({ state: "detached", timeout: 15000 });

    await page.goto(`${APP_URL}/projects/${fixture.projectId}/proposal`);
    await page.locator("text=Add Line Item").first().waitFor({ timeout: 20000 });

    await page.locator("text=Add Line Item").first().click();
    await page.locator("text=Add Equipment").waitFor({ timeout: 5000 });

    await page.locator('input[placeholder*="Search by manufacturer"]').fill("Engineering");
    await page.waitForTimeout(500);

    const laborResult = page.locator("button", { hasText: "Labor" }).filter({ hasText: "Engineering" }).first();
    const laborResultVisible = await laborResult.count();
    console.log(`"Engineering" labor item found in Search Library (expect true): ${laborResultVisible > 0}`);
    if (laborResultVisible === 0) {
      await page.screenshot({ path: "scripts/testing/screenshots/labor-in-proposal-not-found.png" });
      throw new Error("Labor item not found in search results — see screenshot");
    }

    await laborResult.click();
    await page.waitForTimeout(800);

    const modalClosed = (await page.locator("text=Add Equipment").count()) === 0;
    console.log(`Modal closed after adding labor item (expect true): ${modalClosed}`);

    // addItemFromLabor appends to the end of the section's items — rendered
    // text lives inside <input> values, which Playwright's hasText text-match
    // doesn't see, so the newly added row is just "whichever is last".
    const row = page.locator("tbody tr").last();
    await row.waitFor({ timeout: 5000 });
    const modelValue = await row.locator('input[placeholder="Model #"]').inputValue();
    console.log(`New row's Model field (expect "Engineering"): ${modelValue}`);

    const laborHoursInput = row.locator('input[step="0.25"]');
    const laborRateInput = row.locator('input[step="0.01"]').last();
    console.log(`Labor Hrs defaulted to 1 (expect true): ${(await laborHoursInput.inputValue()) === "1"}`);
    const rateVal = await laborRateInput.inputValue();
    console.log(`Labor Rate carried from catalog item: ${rateVal}`);

    const lineTotalCell = row.locator("td").nth(-2);
    console.log(`Line Total cell text: ${(await lineTotalCell.textContent())?.trim()}`);

    await page.screenshot({ path: "scripts/testing/screenshots/labor-in-proposal.png" });
    console.log(`\nConsole/page errors: ${consoleErrors.length === 0 ? "none" : consoleErrors.join(" | ")}`);
    console.log("Done. Screenshot at scripts/testing/screenshots/labor-in-proposal.png");
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
