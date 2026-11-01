import {CHUNK_COUNT,encodeCurrentChunk,type SqlCell} from '../recovery/encoding';
import {tableDefinition} from '../recovery/table-registry';
import {HttpError} from '../http/envelopes';
import type {ProposalRow} from './repository';
/** Recovery format is a capacity constraint only, never a source of authority.
 * isSlug permits 128 characters; CHUNK_COUNT bounds indices to 0..255.
 * Independently legal JSON/association maxima need not fit together in one row. */
export function assertDecisionProposalCapacity(row:ProposalRow):void {
 const table=tableDefinition('decision_proposals',19);
 try{encodeCurrentChunk({format_version:2,schema_version:19,capture_id:'c'.repeat(128),index:CHUNK_COUNT-1,table:'decision_proposals',columns:table.columns.map(c=>c.name),rows:[table.columns.map(c=>(row as unknown as Record<string,SqlCell>)[c.name])]});}
 catch{throw new HttpError('LIMIT_EXCEEDED',413);}
}
