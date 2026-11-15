#!/usr/bin/env node
/**
 * End-to-end check of the built static dashboard (run `npm run build` first).
 *
 *   npm run build && npm run e2e
 *
 * - Serves ./out locally and drives it with Chromium (Playwright).
 * - Airtable is faked by intercepting https://api.airtable.com, so no real token is needed.
 * - Checks the dashboard on Samsung-sized phones AND on desktop:
 *   no sideways scrolling, touch targets, layout (1 vs 2 columns), connect flow,
 *   and the "remember token" behaviour. Screenshots go to ./e2e-screenshots/ (git-ignored).
 *
 * Requires Playwright + a Chromium browser (`npm i -D playwright && npx playwright install chromium`
 * on your own machine). Samsung Internet is Chromium-based, so Chromium is a good stand-in.
 */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium, devices } = require("playwright");

const OUT = path.join(__dirname, "..", "out");
const SHOTS = path.join(__dirname, "..", "e2e-screenshots");
const GOOD = "patGOODTOKEN1234567890";
const BASE = "appAnHmtOjUfgQAcA";
const TABLE = "tblyQ1DaQW5A7wJbA";

const VIEWPORTS = [
  { name: "galaxy-s9plus-320", options: devices["Galaxy S9+"], columns: 1, mobile: true },
  {
    name: "galaxy-s23-360",
    options: { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    columns: 1,
    mobile: true,
  },
  {
    name: "galaxy-ultra-412",
    options: { viewport: { width: 412, height: 915 }, deviceScaleFactor: 3.5, isMobile: true, hasTouch: true },
    columns: 1,
    mobile: true,
  },
  { name: "desktop-1280", options: { viewport: { width: 1280, height: 800 } }, columns: 2, mobile: false },
];

const LONG_URL = "https://example.com/" + "a".repeat(220);
const records = () => [
  { id: "recAAAAAAAAAAAAAA", fields: { Title: "Senior Product Manager", Company: "JFrog", "Favorite Company": true, Location: "Herzliya", "Office Requirement": "Hybrid", "Match %": 0.91, Status: "New", Source: "LinkedIn", Domain: "Other", "Recommended CV": "Base", "Apply URL": "https://example.com/apply", "Match Rationale": "Strong platform experience.", "CV Suggestions": "Add 'developer platform' to the summary.", Description: `Long description with a very long link ${LONG_URL}` } },
  { id: "recBBBBBBBBBBBBBB", fields: { Title: "Solution Architect", Company: "Navina", Location: "Tel Aviv", "Office Requirement": "Fully remote", "Match %": 0.62, Status: "Saved", Source: "Drushim", Domain: "Medtech" } },
  { id: "recCCCCCCCCCCCCCC", fields: { Title: "מנהל/ת מוצר בכיר/ה", Company: "חברה לדוגמה", Location: "רמת גן", "Match %": 0.74, Status: "New", Source: "Drushim" } },
];

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".txt": "text/plain", ".json": "application/json", ".ico": "image/x-icon", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

function serveOut() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (p.endsWith("/")) p += "index.html";
      let file = path.join(OUT, p);
      if (!file.startsWith(OUT)) { res.statusCode = 403; return res.end(); }
      if (!fs.existsSync(file) && fs.existsSync(file + ".html")) file += ".html";
      if (!fs.existsSync(file)) { res.statusCode = 404; return res.end("not found"); }
      res.setHeader("Content-Type", MIME[path.extname(file)] ?? "application/octet-stream");
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, () => resolve(server));
  });
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization,content-type",
  "access-control-allow-methods": "GET,PATCH,OPTIONS",
};

async function installFakeAirtable(context, log) {
  await context.route("https://api.airtable.com/**", async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const auth = req.headers()["authorization"];
    log.push({ method: req.method(), url: req.url(), auth, body: req.postData() });
    const json = (status, body) => route.fulfill({ status, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify(body) });
    if (auth !== `Bearer ${GOOD}`) return json(401, { error: { type: "AUTHENTICATION_REQUIRED" } });
    if (!req.url().includes(`/${BASE}/${TABLE}`)) return json(404, { error: { type: "NOT_FOUND" } });
    if (req.method() === "PATCH") {
      const id = req.url().split("/").pop();
      const rec = records().find((r) => r.id === id);
      Object.assign(rec.fields, JSON.parse(req.postData()).fields);
      return json(200, rec);
    }
    return json(200, { records: records() });
  });
}

let failures = 0;
const check = (cond, label) => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
};

const storedToken = (page) => page.evaluate(() => {
  const raw = localStorage.getItem("mnj.connection.v1");
  return raw ? JSON.parse(raw).token : null;
});
const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

async function connect(page, token, remember) {
  await page.locator('input[type="password"]').fill(token);
  const box = page.getByLabel("לזכור את המפתח בדפדפן הזה");
  if ((await box.isChecked()) !== remember) await box.click();
  await page.getByRole("button", { name: "התחבר", exact: true }).click();
}

async function runViewport(browser, base, vp) {
  console.log(`\n[${vp.name}]`);
  const context = await browser.newContext({ ...vp.options, locale: "he-IL" });
  const log = [];
  await installFakeAirtable(context, log);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(base);
  await page.waitForSelector("text=חיבור ל-Airtable");
  check(await page.locator('input[type="password"]').isVisible(), "token form is visible before connecting");
  check((await overflowX(page)) <= 1, "no horizontal scroll (before connecting)");
  await page.screenshot({ path: path.join(SHOTS, `${vp.name}-1-connect.png`) });

  // Wrong token → clear error, still not connected
  await connect(page, "patWRONGTOKEN1234567890", false);
  await page.waitForSelector(".msg.error");
  check(/דחה את המפתח/.test(await page.locator(".msg.error").innerText()), "wrong token shows a Hebrew error");

  // Good token, "remember" OFF → connects, nothing saved
  await connect(page, GOOD, false);
  await page.waitForSelector(".card");
  check((await page.locator(".card").count()) === 3, "3 job cards rendered");
  check((await storedToken(page)) === null, "token NOT in localStorage when 'remember' is off");
  check((await page.locator('input[type="password"]').inputValue()) === "", "token field is cleared after connecting");
  const html = await page.content();
  check(!html.includes(GOOD), "full token never appears in the page DOM");
  check((await page.locator("summary", { hasText: "מחובר" }).innerText()).includes("pat••••7890"), "only a masked token is displayed");

  // Sorted by match %, favorites marked
  const titles = await page.locator(".card h3").allInnerTexts();
  check(titles[0] === "Senior Product Manager" && titles[1] === "מנהל/ת מוצר בכיר/ה", "cards sorted by match % (91, 74, 62)");

  // Layout: 1 column on phones, 2 on desktop
  const boxes = await page.locator(".card").evaluateAll((els) => els.slice(0, 2).map((e) => e.getBoundingClientRect().toJSON()));
  const sameRow = Math.abs(boxes[0].top - boxes[1].top) < 2;
  check(vp.columns === 2 ? sameRow : !sameRow, `${vp.columns} column layout`);
  check((await overflowX(page)) <= 1, "no horizontal scroll (dashboard)");

  // Details with a very long unbroken link must not overflow
  await page.locator(".card").first().locator("summary").click();
  check((await overflowX(page)) <= 1, "no horizontal scroll with long text expanded");
  await page.screenshot({ path: path.join(SHOTS, `${vp.name}-2-dashboard.png`), fullPage: true });

  // Touch targets
  if (vp.mobile) {
    const small = await page.evaluate(() =>
      [...document.querySelectorAll('button:not(.link), select, input:not([type=checkbox]):not([type=range]), a.btn, summary')]
        .filter((e) => e.getBoundingClientRect().width > 0)
        .map((e) => ({ tag: e.tagName, text: (e.textContent || e.getAttribute("aria-label") || "").slice(0, 20), h: e.getBoundingClientRect().height }))
        .filter((x) => x.h < 43.5));
    check(small.length === 0, `all controls are at least 44px tall${small.length ? " — too small: " + JSON.stringify(small) : ""}`);
  }

  // Status change writes back exactly Status (+ Applied Date)
  await page.locator(".card").first().getByLabel("סטטוס המשרה").selectOption("Applied");
  await page.waitForFunction(() => document.querySelector(".card select")?.value === "Applied");
  const patch = log.find((l) => l.method === "PATCH");
  const fields = patch ? JSON.parse(patch.body).fields : {};
  check(fields.Status === "Applied" && /^\d{4}-\d{2}-\d{2}$/.test(fields["Applied Date"]) && Object.keys(fields).length === 2, "status change PATCHes only Status + Applied Date");

  // Reload with 'remember' off → not connected, panel open
  await page.reload();
  await page.waitForSelector('input[type="password"]');
  check((await page.locator(".card").count()) === 0, "after reload (not remembered) the user must reconnect");

  // 'Remember' ON → survives reload, auto-connects
  await connect(page, GOOD, true);
  await page.waitForSelector(".card");
  check((await storedToken(page)) === GOOD, "token saved in localStorage only when 'remember' is on");
  await page.reload();
  await page.waitForSelector(".card");
  check(true, "after reload (remembered) the dashboard loads without re-entering the token");

  // Delete saved key
  await page.locator("summary", { hasText: "חיבור ל-Airtable" }).click();
  await page.getByRole("button", { name: "מחק מפתח שמור" }).click();
  check((await storedToken(page)) === null, "'delete saved key' removes the token from localStorage");
  await page.waitForSelector("text=כדי לראות משרות");
  check((await page.locator(".card").count()) === 0, "dashboard is empty again after deleting the key");

  check(errors.length === 0, `no JavaScript errors${errors.length ? ": " + errors[0] : ""}`);
  await context.close();
}

(async () => {
  if (!fs.existsSync(path.join(OUT, "index.html"))) {
    console.error("out/index.html not found. Run `npm run build` first.");
    process.exit(2);
  }
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = await serveOut();
  const base = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();
  try {
    for (const vp of VIEWPORTS) await runViewport(browser, base, vp);
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll responsive/e2e checks passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
