/** Version1 recovery uses the same fence algorithm with an explicit frozen schema policy. */
import * as current from './maintenance';
import type {WorkspaceTransaction} from '../storage/transaction';
export * from './maintenance';
export const readAdmissionFence=(tx:WorkspaceTransaction)=>current.readAdmissionFence(tx,7);
export const assertFence=(tx:WorkspaceTransaction,expected:current.AdmissionFence)=>current.assertFence(tx,expected,7);
export const assertAdmissionOpen=(tx:WorkspaceTransaction,expected?:current.AdmissionFence)=>current.assertAdmissionOpen(tx,expected,7);
export const admissionOpen=(tx:WorkspaceTransaction,expected?:current.AdmissionFence)=>current.admissionOpen(tx,expected,7);
