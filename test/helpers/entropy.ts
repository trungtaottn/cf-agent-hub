import type { Entropy } from '../../src/workspace/context';
export class FixedEntropy implements Entropy { bytes(length: number) { return new Uint8Array(length).fill(42); } }
