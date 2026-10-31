/** Additive reviewed current witness descriptors; no caller-selected SQL. */
import {NATIVE_SQL_CATALOG} from './native-host-v2-sql-catalog.mjs';
import current from '../../workers/native-fixture/complete-selectors-schema17.json' with {type:'json'};
const s=current.catalog.S;
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
export const NATIVE_SQL_CATALOG_SCHEMA17=freeze({...NATIVE_SQL_CATALOG,S:{...NATIVE_SQL_CATALOG.S,sql:s.sql,sqlSha256:s.sqlSha256,limits:{...NATIVE_SQL_CATALOG.S.limits,acceptedRows:s.acceptedRows,bridgeRows:s.bridgeRows,rawScalarBytes:s.rawScalarBytes,jsonArrayBytes:s.bridgeJsonBytes}}});
