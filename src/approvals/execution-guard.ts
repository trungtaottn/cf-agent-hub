import {productionDecisionDescriptors} from './action-registry';
import {createApprovedIntentGuard} from './execution-guard-source';
/** Fixed empty production registry. No external dispatch or no-effect producer. */
export const {verifyApprovedIntent,assertApprovedIntentCurrent,verifyConsumedIntent,assertConsumedIntentCurrent}=createApprovedIntentGuard(productionDecisionDescriptors);
export type {VerifiedApprovedIntent,VerifiedConsumedIntent,ConsumedRunBinding} from './execution-guard-source';
