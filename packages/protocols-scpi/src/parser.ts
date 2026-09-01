import { ScpiParseError, ScpiResponseError } from './errors.js';

/**
 * A parsed SCPI command.
 *
 * - `path` is the header split on `:` with every mnemonic expanded to its
 *   canonical LONG form (`:volt:lev?` -> ['VOLTAGE', 'LEVEL']) so that short
 *   and long spellings compare equal. Star commands keep their `*` prefix
 *   (`*IDN?` -> ['*IDN']).
 * - `channel` is the numeric suffix of the first header that carries one
 *   (`VOLT1` -> channel 1).
 * - `args` are the comma-separated parameters: numbers stay numbers, `ON`/`OFF`
 *   become booleans, quoted strings are unquoted, and unit-carrying numerics
 *   (`3.3V`) are preserved verbatim as strings.
 */
export interface ScpiCommand {
  path: string[];
  channel?: number;
  query: boolean;
  args: (string | number | boolean)[];
}

/** SCPI numeric parameter keywords that are not plain numbers. */
const KEYWORD_ARGUMENTS = new Set(['MIN', 'MAX', 'DEF', 'UP', 'DOWN']);

const PLAIN_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Number with a unit suffix, e.g. `3.3V`, `1kHz`, `10 %`, `5 V`. */
const NUMBER_WITH_UNIT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\s*[A-Za-zµΩ°%]+$/;

const HEADER_MNEMONIC = /^([A-Za-z]+)(\d+)?$/;

const COMMON_COMMAND = /^\*[A-Za-z]+$/;

/**
 * Common SCPI mnemonics, as `[longForm, shortForm]` pairs. Both spellings
 * expand to the long form so `VOLT` and `VOLTage` normalize identically.
 * Mnemonics outside this table are preserved verbatim (uppercased).
 */
const MNEMONIC_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['ABORt', 'ABOR'],
  ['ACQuire', 'ACQ'],
  ['AMPLitude', 'AMPL'],
  ['APPLy', 'APPL'],
  ['AVERage', 'AVER'],
  ['BWIDth', 'BWID'],
  ['CALibrate', 'CAL'],
  ['CONDition', 'COND'],
  ['CONFigure', 'CONF'],
  ['COUPling', 'COUP'],
  ['COUNt', 'COUN'],
  ['CURRent', 'CURR'],
  ['DATa', 'DATA'],
  ['DELay', 'DEL'],
  ['DISPlay', 'DISP'],
  ['EDGe', 'EDG'],
  ['ENABle', 'ENAB'],
  ['ERRor', 'ERR'],
  ['EVENt', 'EVEN'],
  ['FREQuency', 'FREQ'],
  ['FUNCtion', 'FUNC'],
  ['FORmat', 'FORM'],
  ['HCOPy', 'HCOP'],
  ['IMMediate', 'IMM'],
  ['INPut', 'INP'],
  ['INITiate', 'INIT'],
  ['INSTrument', 'INST'],
  ['LENGth', 'LEN'],
  ['LEVel', 'LEV'],
  ['LIMit', 'LIM'],
  ['MARKer', 'MARK'],
  ['MEASure', 'MEAS'],
  ['MEMOry', 'MEM'],
  ['OFFSet', 'OFFS'],
  ['OPERation', 'OPER'],
  ['OUTPut', 'OUTP'],
  ['PHASe', 'PHAS'],
  ['POINts', 'POIN'],
  ['POWer', 'POW'],
  ['PROGram', 'PROG'],
  ['QUEStionable', 'QUES'],
  ['RANGe', 'RANG'],
  ['RECall', 'REC'],
  ['SENSe', 'SENS'],
  ['SOURce', 'SOUR'],
  ['STATe', 'STAT'],
  ['STATus', 'STAT'],
  ['SWEEp', 'SWEE'],
  ['TRACe', 'TRAC'],
  ['TRANsition', 'TRANS'],
  ['TRIGger', 'TRIG'],
  ['VOLTage', 'VOLT'],
  ['WAVeform', 'WAV'],
  ['WINDow', 'WIND'],
];

const MNEMONIC_LONG_FORMS: ReadonlyMap<string, string> = buildMnemonicMap();

function buildMnemonicMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const [long, short] of MNEMONIC_PAIRS) {
    map.set(long.toLowerCase(), long.toUpperCase());
    map.set(short.toLowerCase(), long.toUpperCase());
  }
  return map;
}

/**
 * Expand a mnemonic to its canonical long form using the built-in table.
 * Unknown mnemonics are returned uppercased and unchanged.
 */
export function expandMnemonic(mnemonic: string): string {
  return MNEMONIC_LONG_FORMS.get(mnemonic.toLowerCase()) ?? mnemonic.toUpperCase();
}

/** Remove `//` line comments and `/* ... `*`/` block comments (quote-aware). */
function stripComments(input: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < input.length) {
    const ch = input.charAt(i);
    if (quote !== null) {
      if (ch === quote && input.charAt(i + 1) === quote) {
        out += quote + quote;
        i += 2;
        continue;
      }
      if (ch === quote) {
        quote = null;
      }
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '/' && input.charAt(i + 1) === '/') {
      break;
    }
    if (ch === '/' && input.charAt(i + 1) === '*') {
      const end = input.indexOf('*/', i + 2);
      if (end < 0) {
        throw new ScpiParseError('Unterminated block comment.');
      }
      out += ' ';
      i = end + 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  if (quote !== null) {
    throw new ScpiParseError('Unterminated quoted string.');
  }
  return out;
}

/** Split the leading header token off; the remainder is the argument text. */
function splitHeader(text: string): { header: string; rest: string } {
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (ch === ' ' || ch === '\t' || ch === ',') {
      return { header: text.slice(0, i), rest: text.slice(i) };
    }
  }
  return { header: text, rest: '' };
}

/** Split the argument section on commas, respecting quoted strings. */
function splitArguments(text: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (quote !== null) {
      current += ch;
      if (ch === quote) {
        if (text.charAt(i + 1) === quote) {
          current += quote;
          i += 1;
          continue;
        }
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === ',') {
      args.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (quote !== null) {
    throw new ScpiParseError('Unterminated quoted string in arguments.');
  }
  args.push(current.trim());
  return args;
}

/** Unquote a SCPI string argument; doubled quote characters are literal quotes. */
function unquote(token: string): string {
  const quote = token.charAt(0);
  const body = token.slice(1, -1);
  return body.split(quote + quote).join(quote);
}

function classifyArgument(token: string): string | number | boolean {
  const first = token.charAt(0);
  if (first === "'" || first === '"') {
    if (token.length < 2 || token.charAt(token.length - 1) !== first) {
      throw new ScpiParseError(`Unterminated quoted string in argument '${token}'.`);
    }
    return unquote(token);
  }
  const upper = token.toUpperCase();
  if (upper === 'ON') {
    return true;
  }
  if (upper === 'OFF') {
    return false;
  }
  if (upper === 'INF') {
    return Infinity;
  }
  if (upper === 'NINF') {
    return -Infinity;
  }
  if (upper === 'NAN') {
    return NaN;
  }
  if (KEYWORD_ARGUMENTS.has(upper)) {
    return upper;
  }
  if (PLAIN_NUMBER.test(token)) {
    return Number(token);
  }
  // Unit-carrying numerics (`3.3V`, `1kHz`, `5 V`) are preserved verbatim so
  // re-serialization stays lossless without a unit-conversion registry.
  if (NUMBER_WITH_UNIT.test(token)) {
    return token;
  }
  return token;
}

/**
 * Parse one SCPI program message into a structured {@link ScpiCommand}.
 *
 * Supported: mnemonic long/short forms, numeric channel suffixes (`VOLT1`),
 * trailing `?` queries (attached or separated by whitespace), quoted string /
 * number / boolean / unit / keyword arguments, and `//` + `/* *\/` comments.
 * The `;` program-message separator (command chaining) is not supported.
 */
export function parseScpiCommand(input: string): ScpiCommand {
  const text = stripComments(input).trim();
  if (text.length === 0) {
    throw new ScpiParseError('Empty SCPI command.');
  }

  const { header, rest } = splitHeader(text);
  if (header.length === 0) {
    throw new ScpiParseError(`SCPI command has no header: '${input.trim()}'`);
  }

  let headerText = header;
  let argText = rest;
  let query = false;
  if (headerText.endsWith('?')) {
    query = true;
    headerText = headerText.slice(0, -1);
  } else if (argText.trimStart().startsWith('?')) {
    // Tolerate a whitespace-separated query marker: `VOLT ?`.
    query = true;
    argText = argText.trimStart().slice(1);
  }
  headerText = headerText.trimEnd();

  let path: string[];
  let channel: number | undefined;

  if (headerText.startsWith('*')) {
    if (!COMMON_COMMAND.test(headerText)) {
      throw new ScpiParseError(`Invalid IEEE 488.2 common command header '${headerText}'.`);
    }
    path = [headerText.toUpperCase()];
  } else {
    const segments = headerText.replace(/^:/, '').split(':');
    path = [];
    for (const segment of segments) {
      if (segment.length === 0) {
        throw new ScpiParseError(`Malformed header path '${headerText}'.`);
      }
      const match = HEADER_MNEMONIC.exec(segment);
      if (!match || !match[1]) {
        throw new ScpiParseError(`Invalid header mnemonic '${segment}'.`);
      }
      if (channel === undefined && match[2] !== undefined) {
        channel = Number.parseInt(match[2], 10);
      }
      path.push(expandMnemonic(match[1]));
    }
  }

  const trimmedArgs = argText.trim();
  const args: (string | number | boolean)[] = [];
  if (trimmedArgs.length > 0) {
    for (const token of splitArguments(trimmedArgs)) {
      if (token.length === 0) {
        throw new ScpiParseError(`Empty argument in '${input.trim()}'.`);
      }
      args.push(classifyArgument(token));
    }
  }

  const command: ScpiCommand = { path, query, args };
  if (channel !== undefined) {
    command.channel = channel;
  }
  return command;
}

/** Stable identity for a parsed command (short/long spellings collapse). */
export function scpiCommandKey(command: ScpiCommand): string {
  const channel = command.channel === undefined ? '' : String(command.channel);
  return `${command.path.join(':')}${channel}${command.query ? '?' : ''}`;
}

/**
 * Parse a numeric response (`+3.25E+00`, `1`, `-.5`). Throws
 * {@link ScpiResponseError} for anything else.
 */
export function parseScpiNumber(text: string): number {
  const trimmed = text.trim();
  if (!PLAIN_NUMBER.test(trimmed)) {
    throw new ScpiResponseError(`'${text.trim()}' is not a SCPI numeric response.`);
  }
  return Number(trimmed);
}

/** A single `SYST:ERR?` queue entry. */
export interface ScpiErrorQueueEntry {
  code: number;
  message: string;
}

const ERROR_QUEUE_LINE = /^\s*([+-]?\d+)\s*,\s*(?:"((?:[^"]|"")*)"|(.*))\s*$/;

/**
 * Parse a `SYST:ERR?` response of the standard form `-113,"Undefined header"`
 * (message may be unquoted; doubled quotes inside quoted messages are literal).
 */
export function parseScpiErrorQueueLine(text: string): ScpiErrorQueueEntry | undefined {
  const match = ERROR_QUEUE_LINE.exec(text);
  if (!match || match[1] === undefined) {
    return undefined;
  }
  const code = Number.parseInt(match[1], 10);
  const quoted = match[2];
  const bare = match[3];
  const message = (quoted !== undefined ? quoted.replace(/""/g, '"') : (bare ?? '')).trim();
  return { code, message };
}

/** Format a finite number as a SCPI numeric argument (no locale, `E` exponents). */
export function formatScpiNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new ScpiParseError(
      `Cannot format non-finite number ${String(value)} as a SCPI argument.`,
    );
  }
  return String(value);
}
