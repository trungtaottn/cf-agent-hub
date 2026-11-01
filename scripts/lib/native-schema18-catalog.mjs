/** Trusted source-only additive18 delta. Full generated18 remains the canonical
 * hash artifact; sharing frozen17 data keeps the existing executable byte cap. */
import prior from '../../workers/native-fixture/complete-selectors-schema17.json' with {type:'json'};
import delta from '../../workers/native-fixture/schema18-runtime-delta.json' with {type:'json'};
export const nativeSchema18Catalog={...prior,witness_profile:delta.witness_profile,schema_version:delta.schema_version,catalog:{...prior.catalog,S:delta.S},phaseVectors:prior.phaseVectors.map((v,i)=>({...v,bridgeJsonAdmissionBytes:delta.phase_bridge_bytes[i]})),externalVectors:prior.externalVectors.map((v,i)=>({...v,bridgeJsonAdmissionBytes:delta.external_bridge_bytes[i]})),totals:{...prior.totals,bridgeJsonAdmissionBytes:delta.bridge_total}};
