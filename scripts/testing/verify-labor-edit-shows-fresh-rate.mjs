// Verifies the fix for: editing a Labor Rate in Account Settings, then
// opening "Edit Labor Item" on an existing My Organization's Library entry
// of that same type, showed the OLD ($0) rate instead of the one just saved.
// Root cause: the Library page fetched organizations.labor_line_items once
// on mount (useEffect keyed on activeOrg.id) and never refetched — Settings
// is a different route/component entirely, and Next.js's client router cache
// can also keep the Library component instance alive (and its stale state)
// across a visit to Settings and back. Fix: openNewLabor/openEditLabor now
// fetch labor_line_items fresh every time, right before showing the modal.
//
// Prereqs: node --env-file=.env.local scripts/testing/seed-fixture.mjs
// Usage:   node --env-file=.env.local scripts/testing/verify-labor-edit-shows-fresh-rate.mjs

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
    await page.goto(`${APP_URL}/`);
    await page.locator("button", { hasText: /^Log In$/ }).first().click();
    await page.locator('input[type="email"]').fill(EMAIL);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.locator("button", { hasText: /^Log In$/ }).first().waitFor({ state: "detached", timeout: 15000 });

    // 1) Land on the Library page FIRST (mounts the component, fires the
    //    mount-time fetch) — mirrors the real report's sequence.
    await page.goto(`${APP_URL}/inventory?section=org`);
    await page.locator("button", { hasText: "Add Labor" }).waitFor({ timeout: 15000 });
    await page.locator("button", { hasText: /^Labor ·/ }).click();

    // Ensure there's an "Installation" row to edit — add one if missing.
    const hasInstallationRow = await page.locator("tbody tr", { hasText: "Installation" }).count();
    if (hasInstallationRow === 0) {
      await page.locator("button", { hasText: "Add Labor" }).click();
      await page.locator("text=Add Labor Item").waitFor({ timeout: 5000 });
      await page.locator("select").selectOption({ label: "Installation" });
      await page.locator("button", { hasText: /^Save$/ }).click();
      await page.waitForTimeout(1000);
    }

    // 2) Now go edit the rate in Settings, without reloading the Library tab
    //    first — this is the exact "already-mounted Library page" scenario.
    await page.goto(`${APP_URL}/org/settings`);
    await page.locator("text=Labor Rates and Costs").waitFor({ timeout: 15000 });
    const labelInputs = page.locator('div.flex.items-center.gap-1 input[type="text"]');
    const labelCount = await labelInputs.count();
    const allLabels = [];
    for (let i = 0; i < labelCount; i++) allLabels.push(await labelInputs.nth(i).inputValue());
    const idx = allLabels.indexOf("Installation");
    const rateInputs = page.locator('input[type="number"][step="0.01"][min="0"]');
    const newRate = String(Math.floor(50 + Math.random() * 100)); // distinct each run
    const newCost = String(Math.floor(20 + Math.random() * 40));
    await rateInputs.nth(idx).fill(newRate);
    await rateInputs.nth(labelCount + idx).fill(newCost);
    await page.locator("button", { hasText: "Save Labor Settings" }).click();
    await page.locator("text=Saved").waitFor({ timeout: 5000 });
    console.log(`Saved Installation rate=$${newRate}/hr, cost=$${newCost}/hr in Settings.`);

    // 3) Back to Library (fresh navigation, not reload) and open Edit on the
    //    existing Installation row.
    await page.goto(`${APP_URL}/inventory?section=org`);
    await page.locator("button", { hasText: "Add Labor" }).waitFor({ timeout: 15000 });
    await page.locator("button", { hasText: /^Labor ·/ }).click();
    const row = page.locator("tbody tr", { hasText: "Installation" }).first();
    await row.waitFor({ timeout: 10000 });
    await row.locator("button").first().click(); // edit icon
    await page.locator("text=Edit Labor Item").waitFor({ timeout: 5000 });
    await page.waitForTimeout(400);

    const modalText = await page.locator(".fixed.inset-0.z-50").last().innerText();
    console.log("--- Edit Labor Item modal content ---");
    console.log(modalText);
    console.log("--------------------------------------");

    const showsNewRate = modalText.includes(`$${newRate}`);
    const showsNewCost = modalText.includes(`$${newCost}`);
    console.log(`Modal shows freshly-saved Billing Rate ($${newRate}/hr) (expect true): ${showsNewRate}`);
    console.log(`Modal shows freshly-saved Your Cost ($${newCost}/hr) (expect true): ${showsNewCost}`);

    await page.screenshot({ path: "scripts/testing/screenshots/labor-edit-shows-fresh-rate.png" });
    console.log(`\nConsole/page errors: ${consoleErrors.length === 0 ? "none" : consoleErrors.join(" | ")}`);

    if (!showsNewRate || !showsNewCost) process.exit(1);
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
