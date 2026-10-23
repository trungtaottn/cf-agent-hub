import type { Clock } from '../../src/workspace/context';
export class FixedClock implements Clock { constructor(public value = Date.parse('2026-10-23T00:00:00Z')) {} nowMs() { return this.value; } }
