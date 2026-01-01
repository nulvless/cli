import { assertSecretKey, parseAssignment } from '../secret-key';

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

describe('assertSecretKey', () => {
  it.each(['NULVLESS_URL', 'nulvless_token', 'NVL_REGION', 'EDGE_REGION'])('rejects the reserved name %s', (key) => {
    expect(() => assertSecretKey(key)).toThrow('is reserved');
  });

  it.each(['1KEY', 'MY-KEY', ''])('rejects the malformed name "%s"', (key) => {
    expect(() => assertSecretKey(key)).toThrow('is not a valid secret name');
  });

  it('accepts a regular name', () => {
    expect(() => assertSecretKey('PROJECT_SECRET_KEY')).not.toThrow();
  });
});
