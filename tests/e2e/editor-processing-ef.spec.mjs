import {test,expect} from '@playwright/test';
import {writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {disableOnboarding,makeTempDir,startBlankServer,findFreePort,openMenubarMenu} from './helpers.mjs';

let server,root,paths;
function backend(method,payload={}) {
  const code = `import json,sys
from pathlib import Path
from maw import launcher_projects as p
method, args = sys.argv[1], json.loads(sys.argv[2])
if method == 'get_recent_projects': result = p.recent_projects_payload()
elif method == 'get_all_projects': result = p.all_projects_payload()
elif method == 'set_recent_project_pinned': result = p.set_recent_project_pinned(Path(args['path']), args['pinned'])
elif method == 'remove_recent_project': result = p.remove_recent_project(Path(args['path']))
elif method == 'relocate_recent_project': result = p.relocate_recent_project(Path(args['path']), Path(args['newPath']))
elif method == 'note_project_opened': result = p.note_project_opened(Path(args['path']))
else: result = {'ok': False}
print(json.dumps(result))`;
  return JSON.parse(execFileSync(process.env.MSW_E2E_PYTHON||process.env.MAW_E2E_PYTHON,
    ['-c',code,method,JSON.stringify(payload)],{encoding:'utf8',windowsHide:true}));
}
test.beforeEach(async({page})=>{
  root=makeTempDir('processing-ef');
  process.env.MAW_ENV_FILE=join(root,'isolated.env');process.env.MSW_APP_DATA_ROOT=join(root,'local');
  paths=['one','two','moved'].map(folder=>{
    mkdirSync(join(root,folder));const path=join(root,folder,'same.mosp');
    writeFileSync(path,JSON.stringify({segments:[],media:''}));return path;
  });
  backend('note_project_opened',{path:paths[0]});
  await disableOnboarding(page);
  server=await startBlankServer(await findFreePort(),join(root,'settings'));
  await page.goto(server.url);await expect(page.locator('#editor-loading')).toBeHidden();
});
test.afterEach(async({context})=>{for(const page of context.pages())await page.close({runBeforeUnload:false});await server?.stop();});

test('live editor and launcher share pins, removal, relocation and successful opens',async({page,context})=>{
  const launcher=await context.newPage();
  await launcher.goto(pathToFileURL(resolve('web/launcher/index.html')).href);
  await launcher.waitForFunction(()=>window.MSWLauncher?.backend && window.MSWLauncher.backend!=='pending');
  await launcher.exposeFunction('testRecentBackend',backend);
  await launcher.evaluate(()=>{
    const previous=window.MSWLauncher.callBackend;
    window.MSWLauncher.callBackend=(method,payload)=>[
      'get_recent_projects','get_all_projects','set_recent_project_pinned','remove_recent_project','relocate_recent_project',
    ].includes(method)?window.testRecentBackend(method,payload):previous(method,payload);
    window.MSWNavigation.show('home');
  });
  const displayed=()=>page.locator('#recent-projects-list [data-project-path]').evaluateAll(nodes=>nodes.map(n=>n.dataset.projectPath));
  const parity=async()=>{
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await launcher.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await expect.poll(async()=>JSON.stringify(await displayed())).toBe(JSON.stringify(backend('get_recent_projects').projects.map(p=>p.path)));
    await expect.poll(()=>launcher.evaluate(()=>MSWProjectHome.state.projects.map(p=>p.path))).toEqual(await displayed());
  };
  await parity();
  backend('note_project_opened',{path:paths[1]});
  await launcher.evaluate(path=>MSWLauncher.callBackend('set_recent_project_pinned',{path,pinned:true}),paths[1]);
  await parity();
  await openMenubarMenu(page,'文件');
  await expect(page.locator('#recent-projects-list .recent-project-badge').first()).toHaveText('已固定');
  await expect(page.locator('#recent-projects-list .recent-project-name').first()).toContainText('two');
  await launcher.evaluate(([path,newPath])=>MSWLauncher.callBackend('relocate_recent_project',{path,newPath}),[paths[1],paths[2]]);
  await parity();
  // Real trusted open endpoint reloads the editor into the relocated project.
  await Promise.all([
    page.waitForEvent('load'),
    page.evaluate(path=>{void openRecentProject({path});},paths[2]),
  ]);
  await expect.poll(()=>page.evaluate(()=>SERVER_CONFIG.canSave)).toBe(true);
  await expect(page.locator('#editor-loading')).toBeHidden();
  await launcher.evaluate(path=>MSWLauncher.callBackend('remove_recent_project',{path}),paths[2]);
  await parity();
  expect(await displayed()).not.toContain(paths[2]);
  expect(await displayed()).not.toContain(paths[1]);
  await launcher.close();
});

test('menu refresh recovers from server errors and failed reads never show stale paths',async({page})=>{
  await page.route('**/api/recent-projects',route=>route.fulfill({status:503,json:{ok:false}}));
  await openMenubarMenu(page,'文件');
  await expect(page.locator('#recent-projects-list')).toHaveText('最近工程暂不可用');
  await expect(page.locator('#recent-projects-list [data-project-path]')).toHaveCount(0);
  await page.unroute('**/api/recent-projects');
  await page.keyboard.press('Escape');await openMenubarMenu(page,'文件');
  await expect(page.locator('#recent-projects-list [data-project-path]')).toHaveCount(1);
});
