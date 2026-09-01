import { describe, expect, it } from 'vitest';
import {
  expandMnemonic,
  formatScpiNumber,
  parseScpiCommand,
  parseScpiErrorQueueLine,
  parseScpiNumber,
  scpiCommandKey,
} from '../src/parser.js';
import { ScpiParseError, ScpiResponseError } from '../src/errors.js';

describe('parseScpiCommand', () => {
  it('normalizes short and long mnemonic spellings to the same path', () => {
    const short = parseScpiCommand(':VOLT:LEV:IMM:AMPL');
    const long = parseScpiCommand(':VOLTage:LEVel:IMMediate:AMPLitude');
    expect(short.path).toEqual(['VOLTAGE', 'LEVEL', 'IMMEDIATE', 'AMPLITUDE']);
    expect(long.path).toEqual(short.path);
    expect(scpiCommandKey(short)).toBe(scpiCommandKey(long));
  });

  it('expands a curated dictionary of common SCPI mnemonics', () => {
    expect(expandMnemonic('VOLT')).toBe('VOLTAGE');
    expect(expandMnemonic('volt')).toBe('VOLTAGE');
    expect(expandMnemonic('MEAS')).toBe('MEASURE');
    expect(expandMnemonic('Measure')).toBe('MEASURE');
    expect(expandMnemonic('SOUR')).toBe('SOURCE');
    expect(expandMnemonic('FUNC')).toBe('FUNCTION');
  });

  it('preserves unknown mnemonics verbatim (uppercased)', () => {
    expect(parseScpiCommand(':xyz:Abc').path).toEqual(['XYZ', 'ABC']);
  });

  it('extracts numeric suffix channel syntax', () => {
    const command = parseScpiCommand('VOLT1');
    expect(command.path).toEqual(['VOLTAGE']);
    expect(command.channel).toBe(1);
    expect(command.query).toBe(false);

    const suffixedQuery = parseScpiCommand(':MEAS:VOLT2?');
    expect(suffixedQuery.path).toEqual(['MEASURE', 'VOLTAGE']);
    expect(suffixedQuery.channel).toBe(2);
    expect(suffixedQuery.query).toBe(true);
  });

  it('keeps commands without a suffix channel-free', () => {
    const command = parseScpiCommand(':SYST:ERR?');
    expect('channel' in command).toBe(false);
  });

  it('detects queries attached to or separated from the header', () => {
    expect(parseScpiCommand('*IDN?').query).toBe(true);
    expect(parseScpiCommand('*IDN ?').query).toBe(true);
    expect(parseScpiCommand('MEAS:VOLT:DC?').query).toBe(true);
    expect(parseScpiCommand('MEAS:VOLT:DC').query).toBe(false);
  });

  it('classifies numeric, boolean, string, unit, and keyword arguments', () => {
    expect(parseScpiCommand(':VOLT 5').args).toEqual([5]);
    expect(parseScpiCommand(':VOLT -3.25E+01').args).toEqual([-32.5]);
    expect(parseScpiCommand(':OUTP ON').args).toEqual([true]);
    expect(parseScpiCommand(':OUTP off').args).toEqual([false]);
    expect(parseScpiCommand(':DISP:TEXT "HELLO WORLD"').args).toEqual(['HELLO WORLD']);
    expect(parseScpiCommand(':VOLT 3.3V').args).toEqual(['3.3V']);
    expect(parseScpiCommand(':VOLT 5 V').args).toEqual(['5 V']);
    expect(parseScpiCommand(':TRIG:SOUR BUS, IMM').args).toEqual(['BUS', 'IMM']);
    expect(parseScpiCommand(':VOLT MIN, MAX, DEF').args).toEqual(['MIN', 'MAX', 'DEF']);
    expect(parseScpiCommand(':FREQ 1e3').args).toEqual([1000]);
    expect(parseScpiCommand(':LIM INF, NINF').args).toEqual([Infinity, -Infinity]);
  });

  it('unquotes strings with doubled quote escapes', () => {
    expect(parseScpiCommand(`:DISP:TEXT "say ""hi"""`).args).toEqual(['say "hi"']);
    expect(parseScpiCommand(`:DISP:TEXT 'it''s'`).args).toEqual(["it's"]);
  });

  it('supports line and block comments outside quoted strings', () => {
    expect(parseScpiCommand(':VOLT 5 // set volts').args).toEqual([5]);
    expect(parseScpiCommand(':VOLT /* set volts */ 5').args).toEqual([5]);
    expect(parseScpiCommand(':VOLT 5 /* set */ // done').query).toBe(false);
    expect(parseScpiCommand(':DISP:TEXT "a // not a comment"').args).toEqual([
      'a // not a comment',
    ]);
  });

  it('parses IEEE 488.2 common commands', () => {
    expect(parseScpiCommand('*RST')).toEqual({ path: ['*RST'], query: false, args: [] });
    expect(parseScpiCommand('*CLS')).toEqual({ path: ['*CLS'], query: false, args: [] });
    expect(parseScpiCommand('*OPC?')).toEqual({ path: ['*OPC'], query: true, args: [] });
    expect(parseScpiCommand('*ESE 1').args).toEqual([1]);
  });

  it('rejects malformed commands', () => {
    expect(() => parseScpiCommand('')).toThrow(ScpiParseError);
    expect(() => parseScpiCommand('   ')).toThrow(ScpiParseError);
    expect(() => parseScpiCommand(':VOLT;:CURR')).toThrow(ScpiParseError);
    expect(() => parseScpiCommand(':A::B')).toThrow(ScpiParseError);
    expect(() => parseScpiCommand(':VOLT "unterminated')).toThrow(ScpiParseError);
    expect(() => parseScpiCommand(':VOLT 1,,2')).toThrow(ScpiParseError);
    expect(() => parseScpiCommand(':VOLT /* dangling')).toThrow(ScpiParseError);
    expect(() => parseScpiCommand('*B4D?')).toThrow(ScpiParseError);
  });
});

describe('scpiCommandKey', () => {
  it('encodes path, channel, and query', () => {
    expect(scpiCommandKey(parseScpiCommand(':MEAS:VOLT1?'))).toBe('MEASURE:VOLTAGE1?');
    expect(scpiCommandKey(parseScpiCommand('*RST'))).toBe('*RST');
    expect(scpiCommandKey(parseScpiCommand(':OUTP1 ON'))).toBe('OUTPUT1');
  });
});

describe('parseScpiNumber', () => {
  it('parses standard numeric responses', () => {
    expect(parseScpiNumber('+3.25E+00')).toBe(3.25);
    expect(parseScpiNumber('-1')).toBe(-1);
    expect(parseScpiNumber(' 42 ')).toBe(42);
    expect(parseScpiNumber('.5')).toBe(0.5);
  });

  it('rejects non-numeric responses', () => {
    expect(() => parseScpiNumber('OK')).toThrow(ScpiResponseError);
    expect(() => parseScpiNumber('1,2')).toThrow(ScpiResponseError);
  });
});

describe('parseScpiErrorQueueLine', () => {
  it('parses quoted standard entries', () => {
    expect(parseScpiErrorQueueLine('-113,"Undefined header"')).toEqual({
      code: -113,
      message: 'Undefined header',
    });
    expect(parseScpiErrorQueueLine('0,"No error"')).toEqual({ code: 0, message: 'No error' });
    expect(parseScpiErrorQueueLine('+0,"No events pending"')).toEqual({
      code: 0,
      message: 'No events pending',
    });
  });

  it('handles unquoted messages and doubled quote escapes', () => {
    expect(parseScpiErrorQueueLine('-222,Data out of range')).toEqual({
      code: -222,
      message: 'Data out of range',
    });
    expect(parseScpiErrorQueueLine('-101,"say ""hi"""')).toEqual({
      code: -101,
      message: 'say "hi"',
    });
  });

  it('returns undefined for garbage', () => {
    expect(parseScpiErrorQueueLine('nonsense')).toBeUndefined();
  });
});

describe('formatScpiNumber', () => {
  it('formats finite numbers without locale surprises', () => {
    expect(formatScpiNumber(5)).toBe('5');
    expect(formatScpiNumber(0.5)).toBe('0.5');
    expect(formatScpiNumber(-32.5)).toBe('-32.5');
  });

  it('rejects non-finite numbers', () => {
    expect(() => formatScpiNumber(Number.NaN)).toThrow(ScpiParseError);
    expect(() => formatScpiNumber(Infinity)).toThrow(ScpiParseError);
  });
});
