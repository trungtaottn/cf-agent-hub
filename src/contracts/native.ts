import type {HttpDTOMap} from '../http/dto';
/** Exact canonical generated aliases, not a parallel native wire model.
 * ImportEnvelope intentionally retains unvalidated unknown rows until row validation. */
export type NativeDTO<K extends keyof HttpDTOMap> = HttpDTOMap[K];
