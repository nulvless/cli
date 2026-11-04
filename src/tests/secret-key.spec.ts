import { parseAssignment } from '../secret-key';

describe('parseAssignment', () => {
  it('splits on the first equals sign', () => {
    expect(parseAssignment('DATABASE_URL=postgres://u:p@h/db?x=1')).toEqual({
      key: 'DATABASE_URL',
      value: 'postgres://u:p@h/db?x=1',
    });
  });

  it('leaves the value empty when only a key is given', () => {
    expect(parseAssignment('STRIPE_KEY')).toEqual({ key: 'STRIPE_KEY', value: null });
  });

  it('keeps an explicit empty value', () => {
    expect(parseAssignment('FLAG=')).toEqual({ key: 'FLAG', value: '' });
  });
});
