const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');

async function main() {
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, 'docs', 'verification-20260910');
  const data = path.join(output, 'app-data');
  const home = path.join(output, 'test-home');
  fs.mkdirSync(data, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  const app = spawn(process.argv[2], [], { env: { ...process.env,
    TEMP: 'D:\\AI\\智能体工作目录\\temp', TMP: 'D:\\AI\\智能体工作目录\\temp',
    HERMES_PROVIDER_SWITCHER_DATA_DIR: data, HERMES_PROVIDER_SWITCHER_TEST_HOME: home,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=19224 --remote-debugging-address=127.0.0.1',
  }, stdio: 'ignore' });
  let browser;
  try {
    for (let i = 0; i < 45; i++) {
      try { browser = await chromium.connectOverCDP('http://127.0.0.1:19224'); break; }
      catch { await new Promise(resolve => setTimeout(resolve, 1000)); }
    }
    assert(browser, 'WebView debugging endpoint did not start');
    const context = browser.contexts()[0];
    let page;
    for (let i = 0; i < 20; i++) {
      page = context.pages().find(p => /tauri|localhost/.test(p.url()));
      if (page) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert(page, 'No application page');
    await page.getByRole('navigation', { name: '工作区导航', exact: true }).waitFor({ timeout: 30000 });
    const dialog = page.getByRole('dialog');
    if (await dialog.count()) {
      const button = dialog.getByRole('button').last();
      await button.click();
      await dialog.waitFor({ state: 'hidden', timeout: 15000 });
    }
    await page.getByRole('button', { name: '路由中枢', exact: true }).click();
    await page.getByRole('button', { name: '添加供应商', exact: true }).waitFor();
    for (const size of [{width: 1180, height: 760}, {width: 900, height: 600}, {width: 390, height: 720}]) {
      await page.setViewportSize(size);
      await page.screenshot({ path: path.join(output, `workbench-${size.width}.png`) });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Horizontal page overflow');
      assert(await page.locator('.hermes-brand img').evaluate(img => img.complete && img.naturalWidth > 0), 'Brand image missing');
    }
    await page.setViewportSize({width: 1000, height: 650});
    await page.getByRole('button', { name: '资源库', exact: true }).click();
    await page.getByRole('button', { name: 'MCP 服务器', exact: true }).waitFor();
    await page.screenshot({path: path.join(output, 'resources.png')});
    await page.getByRole('button', { name: 'Skills', exact: true }).click();
    await page.screenshot({path: path.join(output, 'skills.png')});
    await page.getByRole('button', { name: '应用设置', exact: true }).click();
    await page.getByRole('tablist').waitFor();
    await page.screenshot({path: path.join(output, 'settings.png')});
    console.log('PASS: native EXE, sidebar, resources, settings, 1180/900/390 widths, brand image');
  } finally {
    if (browser) await browser.close();
    if (app.pid) { const killer = spawn('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' }); await new Promise(resolve => killer.on('close', resolve)); }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
