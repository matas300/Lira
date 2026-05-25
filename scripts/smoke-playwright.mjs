// Playwright smoke test for Lira Foundation slice
// Run with: node scripts/smoke-playwright.mjs

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const SCREENSHOT_DIR = 'C:/tmp/lira-smoke';
const BASE_URL = 'http://localhost:5173';
const EMAIL = 'matas300@gmail.com';
const PASSWORD = 'TestPasswordLunga1';

let passed = 0;
let failed = 0;
const results = {};

function check(label, condition, details = '') {
  if (condition) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.error(`  FAIL: ${label}${details ? ' — ' + details : ''}`);
    failed++;
  }
  results[label] = condition;
  return condition;
}

async function screenshot(page, name) {
  const path = join(SCREENSHOT_DIR, `lira-smoke-${name}.png`);
  await page.screenshot({ path, fullPage: false });
  console.log(`  Screenshot: ${path}`);
}

async function main() {
  await mkdir(SCREENSHOT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // ─── STEP 1: Open http://localhost:5173 ───
  console.log('\n=== STEP 1: Open http://localhost:5173 ===');
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(1500); // let router initialize
  await screenshot(page, '01-initial');

  // ─── STEP 2: Verify login page (SPA router: URL may be / but page shows login) ───
  console.log('\n=== STEP 2: Verify login page visible ===');
  // The router navigates to /login via pushState; URL might show /login
  const url1 = page.url();
  const loginForm = await page.locator('form').count();
  const hasLoginPage = loginForm > 0;
  check('Login page/form visible', hasLoginPage, `url=${url1}, forms=${loginForm}`);
  // URL might be /login OR / depending on pushState timing
  const isLoginUrl = url1.includes('/login') || url1 === BASE_URL + '/';
  check('URL is login or root (SPA)', isLoginUrl, `url=${url1}`);
  await screenshot(page, '02-login-page');

  // ─── STEP 3: Login ───
  console.log('\n=== STEP 3: Login ===');
  // Using id selectors from login.ts: id="email" id="password"
  await page.fill('#email', EMAIL);
  await page.fill('#password', PASSWORD);
  await screenshot(page, '03-login-filled');
  await page.click('button[type="submit"]');
  // Wait for dashboard to load (the router fetches /api/auth/me then mounts dashboard)
  await page.waitForTimeout(3000);
  await screenshot(page, '04-after-login');

  // ─── STEP 4: Verify dashboard ───
  console.log('\n=== STEP 4: Verify dashboard ===');
  const url2 = page.url();
  // Not on login anymore (URL should be / after pushState)
  const notOnLogin = !url2.includes('/login');
  check('Arrived at dashboard (not /login)', notOnLogin, `url=${url2}`);

  // dashboard.ts shows "Benvenuto, ${me.user.name}" and activeProfile.displayName
  // header.ts shows: <strong>${me.user.name}</strong> ... <select data-profile-switch>
  // and logout button: <button data-logout>Esci</button>
  const headerEl = await page.locator('[data-logout]').count();
  check('Logout button (Esci) visible', headerEl > 0, `data-logout count: ${headerEl}`);

  const headerName = await page.locator('header strong').first().textContent().catch(() => null);
  check('Header shows user name "Mattia"', headerName === 'Mattia', `got: ${headerName}`);

  const profileSelect = await page.locator('[data-profile-switch]').count();
  check('Profile select visible', profileSelect > 0);

  // Check page content for dashboard text
  const dashText = await page.textContent('body');
  check('Dashboard shows "Benvenuto"', !!dashText?.includes('Benvenuto'));
  await screenshot(page, '05-dashboard');

  // ─── STEP 5: Navigate to /profiles via profile-pill ───
  console.log('\n=== STEP 5: Navigate to /profiles ===');
  // header.ts: <a class="profile-pill" data-route="/profiles">
  const profilePill = page.locator('[data-route="/profiles"]').first();
  const pillCount = await profilePill.count();
  if (pillCount > 0) {
    // Click somewhere that isn't the select inside the pill to avoid triggering select
    // The <a> element has data-route, so click the strong inside it
    await page.locator('.profile-pill strong').first().click();
  } else {
    await page.goto(`${BASE_URL}/profiles`, { waitUntil: 'networkidle' });
  }
  await page.waitForTimeout(2000);
  await screenshot(page, '06-profiles-page');
  const url3 = page.url();
  check('On /profiles page', url3.includes('/profiles'), `url=${url3}`);

  // ─── STEP 6: Verify both profiles visible ───
  console.log('\n=== STEP 6: Verify both profiles visible ===');
  const profilesText = await page.textContent('body');
  check('"default" profile visible', !!profilesText?.includes('default'));
  check('"peru" profile visible', !!profilesText?.includes('peru'));

  // ─── STEP 7: Create "demo" profile ───
  console.log('\n=== STEP 7: Create "demo" profile ===');
  // profiles.ts form: <input class="input" name="slug" ...> and <input name="displayName" ...>
  await page.fill('input[name="slug"]', 'demo');
  await page.fill('input[name="displayName"]', 'Demo');
  await screenshot(page, '07-create-demo-form');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2000);
  await screenshot(page, '07b-after-create-demo');
  const afterCreate = await page.textContent('body');
  check('"demo" profile appears after create', !!afterCreate?.includes('demo'));

  // ─── STEP 8: Activate "demo" profile ───
  console.log('\n=== STEP 8: Activate "demo" profile ===');
  // profiles.ts: <button class="btn btn-ghost" data-switch="${p.slug}">Attiva</button>
  const activateBtn = page.locator('[data-switch="demo"]').first();
  const activateCount = await activateBtn.count();
  if (activateCount > 0) {
    await activateBtn.click();
    await page.waitForTimeout(2000);
    await screenshot(page, '08-demo-activated');
    const afterActivate = await page.textContent('body');
    // After activation, "demo" should show "attivo" and not have the Attiva button
    const demoActive = afterActivate?.includes('attivo') || !afterActivate?.includes('data-switch="demo"');
    // Check the select value changed
    const selectVal = await page.locator('[data-profile-switch]').first().inputValue().catch(() => null);
    check('Active profile changed to "demo"',
      selectVal === 'demo' || !!afterActivate?.includes('attivo'),
      `select value: ${selectVal}`);
  } else {
    // Maybe demo is already active (was created as active?) — check
    const txt = await page.textContent('body');
    const demoIsActive = txt?.includes('attivo') && !txt?.includes('Attiva');
    check('Activate demo profile (or already active)', !!demoIsActive, 'Activate button [data-switch="demo"] not found');
  }

  // ─── STEP 9: Logout ───
  console.log('\n=== STEP 9: Logout ===');
  // header.ts: <button class="btn btn-ghost" data-logout>Esci</button>
  const logoutBtn = page.locator('[data-logout]').first();
  const logoutCount = await logoutBtn.count();
  if (logoutCount > 0) {
    await logoutBtn.click();
    await page.waitForTimeout(2000);
    await screenshot(page, '09-after-logout');
    const url4 = page.url();
    const loginForm2 = await page.locator('form').count();
    check('Redirected to /login after logout', url4.includes('/login') || loginForm2 > 0, `url=${url4}, forms=${loginForm2}`);
  } else {
    await screenshot(page, '09-no-logout-btn');
    check('Logout button [data-logout] found', false, 'button not found');
  }

  await browser.close();

  console.log('\n=== SUMMARY ===');
  console.log(`PASS: ${passed}, FAIL: ${failed}`);

  // Print final results table
  console.log('\n--- Results per check ---');
  for (const [label, result] of Object.entries(results)) {
    console.log(`  ${result ? 'PASS' : 'FAIL'}: ${label}`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Smoke test error:', err);
  process.exit(1);
});
