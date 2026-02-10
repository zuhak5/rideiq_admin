import { cn } from '@/lib/utils';

describe('cn', () => {
  it('merges classes', () => {
    expect(cn('a', false && 'b', 'c')).toBe('a c');
  });
});
