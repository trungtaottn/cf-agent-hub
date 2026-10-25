import { test,expect,appOrigin,issuerOrigin,captures,launchFixtureBrowser } from '../helpers/browser';
test('approved fresh fixture keys reach both HTTPS authorities',async({page})=>{
 const response=await page.goto(appOrigin+'/health/live');expect(response?.status()).toBe(200);expect(response?.headers()['content-type']).toMatch(/^application\/json\b/);expect(await response?.json()).toEqual({status:'alive'});
 const discovery=await page.goto(issuerOrigin+'/.well-known/openid-configuration');expect(discovery?.status()).toBe(200);
 expect(JSON.parse(await page.textContent('body')??'').issuer).toBe(issuerOrigin);
});
test('invalid unpinned key fails even for an allowed authority',async()=>{
 const browser=await launchFixtureBrowser(captures().negativeProxy);
 try {const page=await browser.newPage({ignoreHTTPSErrors:false});await expect(page.goto(appOrigin+'/health/live')).rejects.toThrow(/ERR_CERT_AUTHORITY_INVALID/);}
 finally {await browser.close();}
});
test('unknown hosts, alternate ports and loopback cannot bypass the proxy',async({page,context})=>{
 for(const url of ['https://unknown.example.invalid/','https://hub.fixture.example.invalid:444/','https://127.0.0.1:'+captures().appPort+'/health/live']) {
  // Chromium may finish its error-page navigation after goto rejects. Isolate each attempt.
  const rejectedPage=await context.newPage();
  try {await expect(rejectedPage.goto(url)).rejects.toThrow(/ERR_TUNNEL_CONNECTION_FAILED/);}
  finally {await rejectedPage.close();}
 }
 const denied=await page.goto('http://127.0.0.1:'+captures().appPort+'/health/live');expect(denied?.status()).toBe(403);
});
test('fixture listeners do not turn public installation into authority',async({page})=>{
 await page.goto(appOrigin+'/health/live');
 const status=await page.evaluate(async()=> (await fetch('/internal/install',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operation:'install',principalId:'synthetic_operator'})})).status);
 expect(status).toBe(404);
});
