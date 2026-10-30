import type {CursorPayload} from '../http/cursors';
/** Internal domain page. Only HTTP encodes continuation and wraps the public envelope,
 * after the synchronous transaction has completed. Never serialize this shape directly. */
export interface PageData<T> {items:readonly T[];next:CursorPayload|null;hasMore:boolean;}
