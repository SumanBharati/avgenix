// Verifies the full round-trip: editing a Labor Rate/Cost in Account
// Settings and clicking "Save Labor Settings" actually persists, and the
// "Add Labor" picker in My Organization's Library reads the *current* value
// afterward rather than a stale/cached one. Written after a report that an
// edited "Installation" rate still showed $0 in the Library picker — this
// checks whether that's a real bug in the save/read path, or the edit just
// never got saved.
//
// Prereqs: node --env-file=.env.local scripts/testing/seed-fixture.mjs
// Usage:   node --env-file=.env.local scripts/testing/verify-labor-rate-propagates.mjs

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

    await page.goto(`${APP_URL}/org/settings`);
    await page.locator("text=Labor Rates and Costs").waitFor({ timeout: 15000 });

    // Find which column is "Installation" from the label row, so the right
    // Rate/Cost inputs (same index, separate grids) get edited.
    const labelInputs = page.locator('div.flex.items-center.gap-1 input[type="text"]');
    const labelCount = await labelInputs.count();
    const allLabels = [];
    for (let i = 0; i < labelCount; i++) allLabels.push(await labelInputs.nth(i).inputValue());
    const idx = allLabels.indexOf("Installation");
    console.log(`"Installation" labor type found at index: ${idx}`);
    if (idx === -1) throw new Error(`Could not find "Installation" among labor types: ${allLabels}`);

    const rateInputs = page.locator('input[type="number"][step="0.01"][min="0"]');
    // Rates grid comes first (N inputs), then Costs grid (N inputs) — same order.
    const n = allLabels.length;
    const rateInput = rateInputs.nth(idx);
    const costInput = rateInputs.nth(n + idx);

    const newRate = "137";
    const newCost = "82";
    await rateInput.fill(newRate);
    await costInput.fill(newCost);

    await page.locator("button", { hasText: "Save Labor Settings" }).click();
    await page.locator("text=Saved").waitFor({ timeout: 5000 });
    console.log("Settings saved — 'Saved' confirmation appeared.");

    await page.goto(`${APP_URL}/inventory?section=org`);
    await page.locator("button", { hasText: "Add Labor" }).waitFor({ timeout: 15000 });
    await page.locator("button", { hasText: "Add Labor" }).click();
    await page.locator("text=Add Labor Item").waitFor({ timeout: 5000 });

    await page.locator("select").selectOption({ label: "Installation" });
    await page.waitForTimeout(300);

    const bodyText = await page.locator(".fixed.inset-0.z-50").last().innerText();
    console.log("--- Add Labor Item modal content ---");
    console.log(bodyText);
    console.log("-------------------------------------");

    const showsNewRate = bodyText.includes(`$${newRate}`);
    const showsNewCost = bodyText.includes(`$${newCost}`);
    console.log(`Modal shows updated Billing Rate ($${newRate}/hr) (expect true): ${showsNewRate}`);
    console.log(`Modal shows updated Your Cost ($${newCost}/hr) (expect true): ${showsNewCost}`);

    await page.screenshot({ path: "scripts/testing/screenshots/labor-rate-propagates.png" });
    console.log(`\nConsole/page errors: ${consoleErrors.length === 0 ? "none" : consoleErrors.join(" | ")}`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
