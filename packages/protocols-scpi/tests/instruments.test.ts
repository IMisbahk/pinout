import { describe, expect, it } from 'vitest';
import { createScriptedScpi, type ScriptedScpi } from './helpers.js';
import { DigitalMultimeter, FunctionGenerator, Oscilloscope, PowerSupply } from '../src/index.js';
import { ScpiRawDisabledError, ScpiResponseError, ScpiUsageError } from '../src/errors.js';

function openScripted(responses: Record<string, string | string[]>): Promise<ScriptedScpi> {
  const scpi = createScriptedScpi(responses);
  return scpi.open().then(() => scpi);
}

describe('PowerSupply', () => {
  it('sends exactly the standard programming commands per channel', async () => {
    const scpi = await openScripted({});
    const psu = new PowerSupply(scpi.client);
    await psu.setVoltage(1, 5);
    await psu.setCurrent(1, 0.5);
    await psu.setVoltage(2, 12.5);
    await psu.enableOutput(1);
    await psu.disableOutput(1);
    expect(scpi.requests).toEqual([
      ':VOLT1 5',
      ':CURR1 0.5',
      ':VOLT2 12.5',
      ':OUTP1 ON',
      ':OUTP1 OFF',
    ]);
    await scpi.client.close();
  });

  it('reads back measured voltage, current, and power', async () => {
    const scpi = await openScripted({
      ':MEAS:VOLT1?': '+5.012E+00',
      ':MEAS:CURR1?': '+4.98E-01',
      ':MEAS:POW1?': '+2.50E+00',
    });
    const psu = new PowerSupply(scpi.client);
    await expect(psu.readVoltage(1)).resolves.toBe(5.012);
    await expect(psu.readCurrent(1)).resolves.toBeCloseTo(0.498, 6);
    await expect(psu.readPower(1)).resolves.toBe(2.5);
    expect(scpi.requests).toEqual([':MEAS:VOLT1?', ':MEAS:CURR1?', ':MEAS:POW1?']);
    await scpi.client.close();
  });

  it('validates channels and values', async () => {
    const scpi = await openScripted({});
    const psu = new PowerSupply(scpi.client);
    await expect(psu.setVoltage(0, 5)).rejects.toBeInstanceOf(ScpiUsageError);
    await expect(psu.setVoltage(1.5, 5)).rejects.toBeInstanceOf(ScpiUsageError);
    await expect(psu.setVoltage(1, Number.NaN)).rejects.toBeInstanceOf(ScpiUsageError);
    await expect(psu.enableOutput(-1)).rejects.toBeInstanceOf(ScpiUsageError);
    expect(scpi.requests).toEqual([]);
    await scpi.client.close();
  });
});

describe('DigitalMultimeter', () => {
  it('issues the standard MEASure queries', async () => {
    const scpi = await openScripted({
      ':MEAS:VOLT:DC?': '+1.02E+00',
      ':MEAS:VOLT:AC?': '+2.30E+00',
      ':MEAS:CURR:DC?': '+1.5E-03',
      ':MEAS:CURR:AC?': '+2.5E-03',
      ':MEAS:RES?': '+1.0E+04',
    });
    const dmm = new DigitalMultimeter(scpi.client);
    await expect(dmm.measureVoltage()).resolves.toBe(1.02);
    await expect(dmm.measureVoltage('ac')).resolves.toBe(2.3);
    await expect(dmm.measureCurrent()).resolves.toBe(0.0015);
    await expect(dmm.measureCurrent('ac')).resolves.toBe(0.0025);
    await expect(dmm.measureResistance()).resolves.toBe(10000);
    expect(scpi.requests).toEqual([
      ':MEAS:VOLT:DC?',
      ':MEAS:VOLT:AC?',
      ':MEAS:CURR:DC?',
      ':MEAS:CURR:AC?',
      ':MEAS:RES?',
    ]);
    await scpi.client.close();
  });
});

describe('FunctionGenerator', () => {
  it('sends source commands with the defaulted channel 1', async () => {
    const scpi = await openScripted({});
    const fgen = new FunctionGenerator(scpi.client);
    await fgen.setFrequency(1000);
    await fgen.setAmplitude(2.5);
    await fgen.setWaveform('sine');
    await fgen.enableOutput();
    expect(scpi.requests).toEqual([
      ':SOUR1:FREQ 1000',
      ':SOUR1:VOLT 2.5',
      ':SOUR1:FUNC SIN',
      ':OUTP1 ON',
    ]);
    await scpi.client.close();
  });

  it('maps waveforms and honors explicit channels', async () => {
    const scpi = await openScripted({});
    const fgen = new FunctionGenerator(scpi.client);
    await fgen.setWaveform('square', 2);
    await fgen.setWaveform('ramp', 2);
    await fgen.setWaveform('noise', 2);
    await fgen.setFrequency(1.2e6, 2);
    await fgen.setAmplitude(0.5, 2);
    await fgen.disableOutput(2);
    expect(scpi.requests).toEqual([
      ':SOUR2:FUNC SQU',
      ':SOUR2:FUNC RAMP',
      ':SOUR2:FUNC NOIS',
      ':SOUR2:FREQ 1200000',
      ':SOUR2:VOLT 0.5',
      ':OUTP2 OFF',
    ]);
    await scpi.client.close();
  });

  it('rejects unknown waveform names', async () => {
    const scpi = await openScripted({});
    const fgen = new FunctionGenerator(scpi.client);
    const bad = 'triangle' as unknown as Parameters<typeof fgen.setWaveform>[0];
    await expect(fgen.setWaveform(bad)).rejects.toBeInstanceOf(ScpiUsageError);
    expect(scpi.requests).toEqual([]);
    await scpi.client.close();
  });
});

describe('Oscilloscope', () => {
  it('configures only the provided channel settings', async () => {
    const scpi = await openScripted({});
    const scope = new Oscilloscope(scpi.client);
    await scope.configureChannel(1, { enabled: true, coupling: 'dc', voltsPerDivision: 0.5 });
    await scope.configureChannel(2, { enabled: false });
    expect(scpi.requests).toEqual([
      ':CHAN1:DISP ON',
      ':CHAN1:COUP DC',
      ':CHAN1:SCAL 0.5',
      ':CHAN2:DISP OFF',
    ]);
    await scpi.client.close();
  });

  it('rejects invalid couplings and channels', async () => {
    const scpi = await openScripted({});
    const scope = new Oscilloscope(scpi.client);
    const badCoupling = 'weird' as unknown as Parameters<
      typeof scope.configureChannel
    >[1]['coupling'];
    await expect(
      scope.configureChannel(1, badCoupling === undefined ? {} : { coupling: badCoupling }),
    ).rejects.toBeInstanceOf(ScpiUsageError);
    await expect(scope.captureWaveform({ channel: 0 })).rejects.toBeInstanceOf(ScpiUsageError);
    expect(scpi.requests).toEqual([]);
    await scpi.client.close();
  });

  it('captures an ASCII waveform and reports metadata', async () => {
    const scpi = await openScripted({ ':WAV:DATA?': '0.1,0.2,-0.3,4.0E-2' });
    const scope = new Oscilloscope(scpi.client);
    const waveform = await scope.captureWaveform({ channel: 1 });
    expect(waveform.data).toEqual([0.1, 0.2, -0.3, 0.04]);
    expect(waveform.metadata).toEqual({ channel: 1, format: 'ascii', points: 4 });
    expect(scpi.requests).toEqual([':WAV:SOUR CHAN1', ':WAV:FORM ASC', ':WAV:DATA?']);
    await scpi.client.close();
  });

  it('unwraps a 488.2 definite-length block around ASCII data', async () => {
    const scpi = await openScripted({ ':WAV:DATA?': '#8000000051,2,3' });
    const scope = new Oscilloscope(scpi.client);
    const waveform = await scope.captureWaveform();
    expect(waveform.data).toEqual([1, 2, 3]);
    expect(waveform.metadata.points).toBe(3);
    await scpi.client.close();
  });

  it('returns raw bytes for byte format', async () => {
    const scpi = await openScripted({ ':WAV:DATA?': '#202\x01\x02' });
    const scope = new Oscilloscope(scpi.client);
    const waveform = await scope.captureWaveform({ channel: 2, format: 'byte' });
    expect(waveform.data).toBeInstanceOf(Uint8Array);
    expect(Array.from(waveform.data as Uint8Array)).toEqual([1, 2]);
    expect(waveform.metadata).toEqual({ channel: 2, format: 'byte', points: 2 });
    expect(scpi.requests).toEqual([':WAV:SOUR CHAN2', ':WAV:FORM BYTE', ':WAV:DATA?']);
    await scpi.client.close();
  });

  it('rejects non-numeric ASCII waveform data', async () => {
    const scpi = await openScripted({ ':WAV:DATA?': '1,x,3' });
    const scope = new Oscilloscope(scpi.client);
    await expect(scope.captureWaveform()).rejects.toBeInstanceOf(ScpiResponseError);
    await scpi.client.close();
  });
});

describe('raw() escape hatch', () => {
  it('is disabled by default', async () => {
    const scpi = await openScripted({});
    const psu = new PowerSupply(scpi.client);
    await expect(psu.raw(':VENDOR:SECRET?')).rejects.toBeInstanceOf(ScpiRawDisabledError);
    expect(scpi.requests).toEqual([]);
    await scpi.client.close();
  });

  it('sends vendor commands only with explicit allowRaw opt-in', async () => {
    const scpi = await openScripted({ ':VENDOR:SECRET?': '42', ':VENDOR:DO': [] });
    const psu = new PowerSupply(scpi.client, { allowRaw: true });
    await expect(psu.raw(':VENDOR:SECRET?')).resolves.toBe('42');
    await expect(psu.raw(':VENDOR:DO')).resolves.toBeUndefined();
    expect(scpi.requests).toEqual([':VENDOR:SECRET?', ':VENDOR:DO']);
    await scpi.client.close();
  });
});
