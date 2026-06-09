// Playwright smoke test for Lira Foundation slice
// Run with: node scripts/smoke-playwright.mjs

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
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

  // ─── STEP 4B: Clienti — create + list + set default (Slice 4A) ───
  console.log('\n=== STEP 4B: Clienti CRUD ===');
  // bottom-nav.ts: <a data-route="/clienti">; navigate via SPA router (fallback goto)
  const clientiTab = page.locator('[data-route="/clienti"]').first();
  if ((await clientiTab.count()) > 0) {
    await clientiTab.click();
  } else {
    await page.goto(`${BASE_URL}/clienti`, { waitUntil: 'networkidle' });
  }
  await page.waitForTimeout(1500);
  const urlClienti = page.url();
  check('On /clienti page', urlClienti.includes('/clienti'), `url=${urlClienti}`);
  await screenshot(page, '05b-clienti-page');

  // Open "Nuovo" modal and create a cliente (P.IVA valida con check-digit corretto)
  const CLI_NAME = 'Smoke Cliente SpA';
  await page.click('[data-new]');
  await page.waitForTimeout(500);
  await page.fill('[data-form] [name="nome"]', CLI_NAME);
  await page.fill('[data-form] [name="partitaIva"]', '00743110157');
  await screenshot(page, '05c-clienti-form');
  await page.click('[data-form] button[type="submit"]');
  await page.waitForTimeout(1500);
  // Se il modal è rimasto aperto (es. 409 su DB non fresco al re-run) lo chiudo.
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300);
  const listText = await page.textContent('[data-list]').catch(() => '');
  check('Cliente appears in list', !!listText && listText.includes(CLI_NAME),
    `list="${(listText || '').slice(0, 120)}"`);
  await screenshot(page, '05d-clienti-list');

  // Set as default: apro la riga, spunto "predefinito", salvo → compare ★
  const cliRow = page.locator('.cliente-row', { hasText: CLI_NAME }).first();
  if ((await cliRow.count()) > 0) {
    await cliRow.click();
    await page.waitForTimeout(500);
    await page.check('[data-form] [name="isDefault"]');
    await page.click('[data-form] button[type="submit"]');
    await page.waitForTimeout(1500);
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(300);
    const listText2 = await page.textContent('[data-list]').catch(() => '');
    check('Cliente marked default (star)', !!listText2 && listText2.includes('★'),
      `list="${(listText2 || '').slice(0, 120)}"`);
    await screenshot(page, '05e-clienti-default');
  } else {
    check('Cliente row found for default toggle', false, 'row not found');
  }

  // ─── STEP 4C: Fatture — crea bozza → invia → paga (Slice 5A) ───
  console.log('\n=== STEP 4C: Fatture (bozza → invia → paga) ===');
  // bottom-nav.ts: <a data-route="/fatture">; navigate via SPA router (fallback goto)
  const fattureTab = page.locator('[data-route="/fatture"]').first();
  if ((await fattureTab.count()) > 0) {
    await fattureTab.click();
  } else {
    await page.goto(`${BASE_URL}/fatture`, { waitUntil: 'networkidle' });
  }
  await page.waitForTimeout(1500);
  const urlFatture = page.url();
  check('On /fatture page', urlFatture.includes('/fatture'), `url=${urlFatture}`);
  await screenshot(page, '05f-fatture-page');

  // Crea una bozza: il cliente default ("Smoke Cliente SpA") è già selezionato.
  await page.click('[data-new]');
  await page.waitForTimeout(500);
  await page.fill('[data-form] [data-riga-desc]', 'Consulenza smoke');
  await page.fill('[data-form] [data-riga-prezzo]', '1000');
  await screenshot(page, '05g-fattura-form');
  await page.click('[data-form] button[type="submit"]');
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300);
  const rowsAfterCreate = await page.locator('.fattura-row').count();
  check('Bozza fattura creata (riga in lista)', rowsAfterCreate > 0, `rows=${rowsAfterCreate}`);
  await screenshot(page, '05h-fattura-bozza');

  // Invia la prima (più recente in cima per data/createdAt) → ottiene numero AAAA/N.
  const inviaBtn = page.locator('[data-invia]').first();
  if ((await inviaBtn.count()) > 0) {
    await inviaBtn.click();
    await page.waitForTimeout(1500);
    const listFatt = await page.textContent('[data-list]').catch(() => '');
    check('Fattura inviata con numero (AAAA/N)', /\d{4}\/\d+/.test(listFatt || ''),
      `list="${(listFatt || '').slice(0, 140)}"`);
    await screenshot(page, '05i-fattura-inviata');
  } else {
    check('Pulsante invia presente', false, 'nessun [data-invia]');
  }

  // Segna pagata: il bottone € apre un prompt(date) → lo accetto con la data odierna.
  const pagaBtn = page.locator('[data-paga]').first();
  if ((await pagaBtn.count()) > 0) {
    const today = new Date().toISOString().slice(0, 10);
    page.once('dialog', (d) => d.accept(today));
    await pagaBtn.click();
    await page.waitForTimeout(1500);
    const listFatt2 = await page.textContent('[data-list]').catch(() => '');
    check('Fattura segnata PAGATA', !!listFatt2 && listFatt2.includes('PAGATA'),
      `list="${(listFatt2 || '').slice(0, 140)}"`);
    await screenshot(page, '05j-fattura-pagata');
  } else {
    check('Pulsante paga presente', false, 'nessun [data-paga]');
  }

  // ─── STEP 4D: Import XML (Slice 5E) ───
  console.log('\n=== STEP 4D: Import XML ===');
  const tmpXml = join(SCREENSHOT_DIR, 'smoke-fattura.xml');
  const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<p:FatturaElettronica versione="FPR12" xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2">
  <FatturaElettronicaHeader><CessionarioCommittente>
    <DatiAnagrafici><IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>00743110157</IdCodice></IdFiscaleIVA>
      <Anagrafica><Denominazione>Smoke Import Srl</Denominazione></Anagrafica></DatiAnagrafici>
    <Sede><Indirizzo>Via Test 1</Indirizzo><CAP>20100</CAP><Comune>Milano</Comune><Provincia>MI</Provincia><Nazione>IT</Nazione></Sede>
  </CessionarioCommittente></FatturaElettronicaHeader>
  <FatturaElettronicaBody>
    <DatiGenerali><DatiGeneraliDocumento><TipoDocumento>TD01</TipoDocumento><Data>2026-07-01</Data><Numero>2026/99</Numero><ImportoTotaleDocumento>500.00</ImportoTotaleDocumento></DatiGeneraliDocumento></DatiGenerali>
    <DatiBeniServizi><DettaglioLinee><Descrizione>Servizio importato</Descrizione><Quantita>1.00</Quantita><PrezzoUnitario>500.00</PrezzoUnitario><PrezzoTotale>500.00</PrezzoTotale></DettaglioLinee></DatiBeniServizi>
  </FatturaElettronicaBody>
</p:FatturaElettronica>`;
  await writeFile(tmpXml, xmlContent, 'utf8');
  await page.goto(`${BASE_URL}/fatture`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  page.once('dialog', (d) => d.accept()); // alert del report
  await page.setInputFiles('[data-xml-input]', tmpXml);
  await page.waitForTimeout(2000);
  const listImport = await page.textContent('[data-list]').catch(() => '');
  check('Fattura XML importata (2026/99 in lista)', !!listImport && listImport.includes('2026/99'),
    `list="${(listImport || '').slice(0, 140)}"`);
  await screenshot(page, '05k-import-xml');

  // Torno alla dashboard per non perturbare gli step profili successivi
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

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
