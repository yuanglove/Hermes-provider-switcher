const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
async function main() {
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, 'docs/verification-20260910');
  fs.mkdirSync(output, {recursive:true});
  const server = http.createServer((req,res) => {
    const file = path.join(root,'dist',decodeURIComponent(new URL(req.url,'http://localhost').pathname === '/' ? 'index.html' : new URL(req.url,'http://localhost').pathname));
    if (!file.startsWith(path.join(root,'dist')) || !fs.existsSync(file)) {res.writeHead(404).end(); return;}
    res.setHeader('Content-Type', ({'.js':'application/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.svg':'image/svg+xml'})[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const browser = await chromium.launch({channel:'msedge',headless:true});
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      localStorage.setItem('hermes-provider-switcher-last-app','claude');
      localStorage.setItem('hermes-provider-switcher-last-view','providers');
      localStorage.setItem('hermes-provider-switcher-theme','light');
      const values = {
        get_migration_result:false, get_skills_migration_result:null, check_all_env_conflicts:{}, check_env_conflicts:[],
        get_init_error:null, get_settings:{language:'zh',firstRunNoticeConfirmed:true,showProfileSwitcher:false},
        get_providers:{
          'local-fixture':{id:'local-fixture',name:'DeepSeek / 示例配置',category:'custom',settingsConfig:{env:{ANTHROPIC_BASE_URL:'https://api.example.com',ANTHROPIC_AUTH_TOKEN:'TEST_ONLY'}}},
          'backup-fixture':{id:'backup-fixture',name:'备用供应商 / 示例配置',category:'custom',settingsConfig:{env:{ANTHROPIC_BASE_URL:'https://backup.example.com',ANTHROPIC_AUTH_TOKEN:'TEST_ONLY'}}},
        }, get_current_provider:'local-fixture', get_proxy_status:{running:false,active_targets:[]},
        get_proxy_takeover_status:{}, get_universal_providers:{}, get_unified_mcp_servers:{},
        get_installed_skills:[], scan_unmanaged_skills:[], get_app_config_dir:'D:/Hermes',
      };
      window.__TAURI_INTERNALS__ = {metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},
        transformCallback:()=>1, unregisterCallback:()=>{}, convertFileSrc:x=>x,
        invoke:async command => command in values ? values[command] : command.includes('version') ? '0.3.0' : command.includes('path') || command.includes('dir') ? 'D:/Hermes' : command.includes('list') || command.includes('skills') ? [] : {},
      };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole('button',{name:'路由中枢',exact:true}).waitFor();
    for (const width of [1180,900,390]) {
      await page.setViewportSize({width,height:720});
      await page.screenshot({path:path.join(output,`renderer-${width}.png`)});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth));
      assert(await page.locator('.hermes-brand img').evaluate(img=>img.complete && img.naturalWidth>0));
    }
    await page.setViewportSize({width:1000,height:650});
    await page.getByRole('button',{name:'资源库',exact:true}).click();
    await page.getByRole('button',{name:'MCP 服务器',exact:true}).waitFor();
    await page.getByRole('button',{name:'导入已有',exact:true}).waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({path:path.join(output,'renderer-resources.png')});
    console.log('PASS: production renderer, mock IPC only; sidebar, resource tabs, image and widths 1180/900/390');
  } finally {await browser.close(); server.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
