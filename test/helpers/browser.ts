import { test as base, chromium, type Browser } from '@playwright/test';
export const appOrigin='https://hub.fixture.example.invalid';
export const issuerOrigin='https://issuer.fixture.example.invalid';
export function captures() {
 const port=(key:string)=>{const value=process.env[key];if(!value||!/^\d+$/.test(value)||Number(value)<1||Number(value)>65535)throw Error('Missing fixture readiness capture '+key);return Number(value);};
 const pin=(key:string)=>{const value=process.env[key];if(!value||!(/^[A-Za-z0-9+/]{43}=$/).test(value))throw Error('Missing fixture leaf SPKI capture '+key);return value;};
 return {proxy:port('CFHUB_PROXY_PORT'),negativeProxy:port('CFHUB_NEGATIVE_PROXY_PORT'),appPort:port('CFHUB_APP_PORT'),pins:[pin('CFHUB_APP_PIN'),pin('CFHUB_ISSUER_PIN')]};
}
export async function launchFixtureBrowser(proxy?:number):Promise<Browser> {
 const values=captures();
 return chromium.launch({
  headless:true,
  proxy:{server:'http://127.0.0.1:'+(proxy??values.proxy),bypass:'<-loopback>'},
  args:['--ignore-certificate-errors-spki-list='+values.pins.join(','),'--proxy-bypass-list=<-loopback>']
 });
}
export const test=base.extend({
 browser:async({},use)=>{const browser=await launchFixtureBrowser();try{await use(browser);}finally{await browser.close();}}
});
export { expect } from '@playwright/test';
