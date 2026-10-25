import {approvedHttpsUrl} from '../config/deployment';
import type {DeliveryResult} from './repository';
/** Installed operator host/path allowlist is the R1 boundary; no DNS rebinding guarantee is implied. */
export function egressAllowed(url:string,approvedUrls:readonly string[]):boolean{
 return approvedHttpsUrl(url)&&approvedUrls.includes(url);
}
function retryAfter(value:string|null,nowMs:number):number|undefined{
 if(value===null)return undefined;
 if(/^(0|[1-9][0-9]*)$/.test(value)){const seconds=Number(value);return Number.isSafeInteger(seconds)?seconds:undefined;}
 // Accept an HTTP-date, not numeric/date-parser coercions such as "-1".
 if(!/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), [0-9]{2} [A-Z][a-z]{2} [0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2} GMT$/.test(value))return undefined;
 const date=Date.parse(value);return Number.isFinite(date)?Math.max(0,(date-nowMs)/1000):undefined;
}
export function classifyResponse(response:Response,nowMs:number):DeliveryResult{
 const status=response.status;
 if(status>=200&&status<300)return {kind:'delivered',status};
 if(status===408||status===429||status>=500&&status<=599){
  const hint=retryAfter(response.headers.get('retry-after'),nowMs);
  return {kind:'transient',status,category:'http_transient',...(hint===undefined?{}:{retryAfterSeconds:hint})};
 }
 return {kind:'permanent',status,category:status>=300&&status<400?'redirect_denied':'http_permanent'};
}
