// Legacy public-only smoke replaced by private synthetic aiTailor.test.ts in Turn 2.
import { describe, expect, it } from 'vitest';
import { scanFactGuardWarnings } from './aiTailor';
describe('numeric baseline',()=>{it('does not trust a different unit',()=>{expect(scanFactGuardWarnings('30%','30课时')).toHaveLength(1);});});
