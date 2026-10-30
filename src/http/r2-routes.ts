import {HttpError,toHttpError} from './envelopes';
/** Shared fallback until a domain owner installs its reviewed authenticated route.
 * No speculative dispatch table, SQL, scheduler repair, approvals or Waiting records.
 * Generating a DTO/validator does not register a route or grant authority. */
export function r2Routes(_request:Request):Response {
 return toHttpError(new HttpError('NOT_FOUND',404),crypto.randomUUID());
}
