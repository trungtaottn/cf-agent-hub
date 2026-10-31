import {productionDecisionDescriptors} from './action-registry';
import {createProposalInputVerifier} from './input-binding-source';
/** Fixed empty production composition. No descriptor/bucket-key override is public. */
export const {verifyProposalInput,recheckProposalInput}=createProposalInputVerifier(productionDecisionDescriptors);
export type {ProposalInputContext} from './input-binding-source';
