import {productionDecisionDescriptors} from '../approvals/action-registry';
import {createTaskClaimCommands} from './claim-source';
/** Fixed production composition. Synchronous R2 APIs never accept approval evidence. */
export const {claimTask,claimTaskCommand,prepareClaimTaskCommand}=createTaskClaimCommands(productionDecisionDescriptors);
