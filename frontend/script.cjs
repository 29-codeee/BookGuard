const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  await page.goto('http://127.0.0.1:3000');
  await page.waitForSelector('button', { timeout: 10000 });
  const buttons = await page.$$('button');
  for (let btn of buttons) {
    const text = await page.evaluate(el => el.textContent, btn);
    if (text && text.includes('Book Direct')) {
      console.log('Clicking button...');
      await btn.click();
      break;
    }
  }
  await new Promise(r => setTimeout(r, 2000));
  await browser.close();
})();
