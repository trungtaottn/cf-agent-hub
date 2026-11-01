import {productionDecisionDescriptors} from './action-registry';
import {createDecisionCommands} from './commands-source';
/** Fixed empty production composition; no public registry or receipt injection. */
export const {prepareRequestTaskDecision}=createDecisionCommands(productionDecisionDescriptors);
export type {DecisionPreparationContext,DecisionIds} from './commands-source';
