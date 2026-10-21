import { describe, expect, it } from 'vitest';
import { OPEN_STAGES, STAGES, isBackwards, nextStage, stageIndex } from './constants';
import { friendlyError } from './errors';

describe('stage workflow', () => {
  it('has exactly the 11 agreed stages in order', () => {
    expect(STAGES).toEqual([
      'Inquiry',
      'Payment received',
      'Import permit',
      'CDEC form signed',
      'CDEC approved',
      'Order placed',
      'Shipped',
      'In customs',
      'Cleared',
      'Delivered',
      'POD received',
    ]);
  });
  it('treats delivered and POD as closed', () => {
    expect(OPEN_STAGES).not.toContain('Delivered');
    expect(OPEN_STAGES).not.toContain('POD received');
    expect(OPEN_STAGES).toHaveLength(9);
  });
  it('detects backwards moves (which need a correction reason)', () => {
    expect(isBackwards('Shipped', 'Inquiry')).toBe(true);
    expect(isBackwards('Inquiry', 'Shipped')).toBe(false);
  });
  it('computes the next stage', () => {
    expect(nextStage('Inquiry')).toBe('Payment received');
    expect(nextStage('POD received')).toBeNull();
    expect(stageIndex('In customs')).toBe(7);
  });
});

describe('error messages', () => {
  it('never leaks raw database errors', () => {
    expect(friendlyError({ code: '42P01', message: 'relation "x" does not exist' })).toBe('Unable to save changes. Please retry.');
    expect(friendlyError({ code: '42501', message: 'new row violates row-level security policy' })).toBe('You do not have permission to perform this action.');
  });
  it('shows deliberate business-rule messages', () => {
    expect(friendlyError({ code: '22023', message: 'A reason is required.' })).toBe('A reason is required.');
  });
});
