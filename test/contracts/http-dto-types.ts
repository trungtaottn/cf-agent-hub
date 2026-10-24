import type {AuthLogoutRequest} from '../../src/http/dto';
const empty:AuthLogoutRequest={};
// @ts-expect-error closed empty JSON object rejects primitive
const number:AuthLogoutRequest=1;
// @ts-expect-error closed empty JSON object rejects string
const string:AuthLogoutRequest='token';
// @ts-expect-error closed empty JSON object rejects array
const array:AuthLogoutRequest=[];
// @ts-expect-error closed empty JSON object rejects nonempty object
const object:AuthLogoutRequest={unexpected:true};
void [empty,number,string,array,object];
