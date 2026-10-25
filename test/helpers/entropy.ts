import type { Entropy } from '../../src/workspace/context';
/** Repeatable test sequence, with distinct draws. Never used by production. */
export class FixedEntropy implements Entropy {
 private draw=0;
 bytes(length:number) {
  if(length<8)throw Error('FIXTURE_ENTROPY_LENGTH');
  const bytes=new Uint8Array(length).fill(42);new DataView(bytes.buffer).setBigUint64(0,BigInt(++this.draw));return bytes;
 }
}
