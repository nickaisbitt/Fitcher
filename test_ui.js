const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Log page errors and console messages
  page.on('pageerror', error => console.log(`Page Error: ${error}`));
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log(`Console Error: ${msg.text()}`);
    }
  });

  const filePath = `file://${path.resolve('public/index.html')}`;
  console.log(`Navigating to ${filePath}`);
  await page.goto(filePath);

  // Wait for React to load
  await page.waitForTimeout(2000);

  // Click "Continue without account (Demo Mode)" to bypass auth
  const bypassBtn = page.getByText('Continue without account (Demo Mode)');
  if (await bypassBtn.isVisible()) {
      console.log("Clicking Demo Mode button...");
      await bypassBtn.click();
      await page.waitForTimeout(1000);
  }

  // Click Trades tab
  console.log("Clicking Trades tab...");
  await page.getByRole('button', { name: 'Trades' }).click();
  await page.waitForTimeout(1000);

  // Capture screenshot
  await page.screenshot({ path: 'trades_tab.png' });
  console.log('Screenshot saved as trades_tab.png');

  // Verify empty state text exists
  const hasText = await page.getByText('No trades executed yet').isVisible();
  console.log(`Empty state visible: ${hasText}`);

  await browser.close();
})();
