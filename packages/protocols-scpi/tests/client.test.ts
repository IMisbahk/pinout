import { describe, expect, it } from 'vitest';
import { createScriptedScpi } from './helpers.js';
import {
  ScpiClosedError,
  ScpiResponseError,
  ScpiTimeoutError,
  ScpiUsageError,
  ScpiClient,
} from '../src/index.js';
import { loopbackTransport } from '@pinout/core';

describe('ScpiClient', () => {
  it('parses *IDN? into its four IEEE 488.2 fields', async () => {
    const scpi = createScriptedScpi({
      '*IDN?': 'KEYSIGHT, DSOX1102A, CN5741234, 00.08.0000',
    });
    await scpi.open();
    const identity = await scpi.client.identify();
    expect(identity.manufacturer).toBe('KEYSIGHT');
    expect(identity.model).toBe('DSOX1102A');
    expect(identity.serialNumber).toBe('CN5741234');
    expect(identity.firmwareVersion).toBe('00.08.0000');
    expect(scpi.requests).toEqual(['*IDN?']);
    await scpi.client.close();
  });

  it('rejects malformed *IDN? responses', async () => {
    const scpi = createScriptedScpi({ '*IDN?': 'ONLY,THREE' });
    await scpi.open();
    await expect(scpi.client.identify()).rejects.toBeInstanceOf(ScpiResponseError);
    await scpi.client.close();
  });

  it('sends *RST, *CLS and evaluates *OPC?', async () => {
    const scpi = createScriptedScpi({ '*OPC?': '1' });
    await scpi.open();
    await scpi.client.reset();
    await scpi.client.clearStatus();
    await expect(scpi.client.operationComplete()).resolves.toBe(true);
    expect(scpi.requests).toEqual(['*RST', '*CLS', '*OPC?']);
    await scpi.client.close();
  });

  it('appends the terminator to every command', async () => {
    const scpi = createScriptedScpi({ ':VOLT1 5': [] });
    await scpi.open();
    await scpi.client.command(':VOLT1 5');
    expect(scpi.rawWrites).toEqual([':VOLT1 5\n']);
    await scpi.client.close();
  });

  it('supports a configurable terminator', async () => {
    const scpi = createScriptedScpi({ ':VOLT1 5': [] }, { terminator: '\r\n' });
    await scpi.open();
    await scpi.client.command(':VOLT1 5');
    expect(scpi.rawWrites).toEqual([':VOLT1 5\r\n']);
    expect(scpi.requests).toEqual([':VOLT1 5']);
    await scpi.client.close();
  });

  it('refuses queries via command() and non-queries via query()', async () => {
    const scpi = createScriptedScpi({});
    await scpi.open();
    await expect(scpi.client.command('*IDN?')).rejects.toBeInstanceOf(ScpiUsageError);
    await expect(scpi.client.query(':VOLT1 5')).rejects.toBeInstanceOf(ScpiUsageError);
    expect(scpi.requests).toEqual([]);
    await scpi.client.close();
  });

  it('times out a query that never gets a response', async () => {
    const scpi = createScriptedScpi({}); // no scripted response at all
    await scpi.open();
    const start = Date.now();
    await expect(scpi.client.query(':VOLT1?', { timeoutMs: 25 })).rejects.toBeInstanceOf(
      ScpiTimeoutError,
    );
    expect(Date.now() - start).toBeLessThan(1000);
    // The client stays usable after a timeout.
    await expect(scpi.client.query('*OPC?', { timeoutMs: 30 })).rejects.toBeInstanceOf(
      ScpiTimeoutError,
    );
    expect(scpi.requests).toEqual([':VOLT1?', '*OPC?']);
    await scpi.client.close();
  });

  it('queues concurrent queries strictly sequentially and pairs responses', async () => {
    const scpi = createScriptedScpi({
      ':MEAS:VOLT1?': '5.000',
      ':MEAS:CURR1?': '0.250',
      ':MEAS:VOLT2?': '3.300',
    });
    await scpi.open();
    const first = scpi.client.query(':MEAS:VOLT1?');
    const second = scpi.client.query(':MEAS:CURR1?');
    const third = scpi.client.query(':MEAS:VOLT2?');
    await expect(first).resolves.toBe('5.000');
    await expect(second).resolves.toBe('0.250');
    await expect(third).resolves.toBe('3.300');
    expect(scpi.requests).toEqual([':MEAS:VOLT1?', ':MEAS:CURR1?', ':MEAS:VOLT2?']);
    await scpi.client.close();
  });

  it('keeps writes and queries ordered across the queue', async () => {
    const scpi = createScriptedScpi({ ':VOLT1?': '5.000' });
    await scpi.open();
    const program = scpi.client.command(':VOLT1 5');
    const ask = scpi.client.query(':VOLT1?');
    await program;
    await expect(ask).resolves.toBe('5.000');
    expect(scpi.requests).toEqual([':VOLT1 5', ':VOLT1?']);
    await scpi.client.close();
  });

  it('routes unsolicited lines to onUnsolicited', async () => {
    const unsolicited: string[] = [];
    const transport = loopbackTransport();
    const client = new ScpiClient(transport, {
      timeoutMs: 100,
      onUnsolicited: (line) => unsolicited.push(line),
    });
    await client.open();
    transport.inject('SRQ EVENT');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(unsolicited).toEqual(['SRQ EVENT']);
    // A line injected while a query is pending pairs with the query instead
    // of being reported as unsolicited.
    const identity = client.identify({ timeoutMs: 100 });
    transport.inject('*IDN?');
    await expect(identity).rejects.toBeInstanceOf(ScpiResponseError);
    expect(unsolicited).toEqual(['SRQ EVENT']);
    await client.close();
  });

  it('parses SYST:ERR? entries and the terminating code 0', async () => {
    const scpi = createScriptedScpi({
      ':SYST:ERR?': ['-113,"Undefined header"', '0,"No error"'],
    });
    await scpi.open();
    await expect(scpi.client.readError()).resolves.toEqual({
      code: -113,
      message: 'Undefined header',
    });
    await expect(scpi.client.readError()).resolves.toBeNull();
    expect(scpi.requests).toEqual([':SYST:ERR?', ':SYST:ERR?']);
    await scpi.client.close();
  });

  it('drains the error queue until the code-0 entry', async () => {
    const scpi = createScriptedScpi({
      ':SYST:ERR?': ['-222,"Data out of range"', '-113,"Undefined header"', '0,"No error"'],
    });
    await scpi.open();
    const errors = await scpi.client.drainErrors();
    expect(errors).toEqual([
      { code: -222, message: 'Data out of range' },
      { code: -113, message: 'Undefined header' },
    ]);
    await scpi.client.close();
  });

  it('parses numeric and boolean query helpers', async () => {
    const scpi = createScriptedScpi({
      ':MEAS:VOLT1?': '+3.25E+00',
      ':OUTP1?': 'ON',
      ':OUTP2?': '0',
      ':VOLT1?': 'maybe',
    });
    await scpi.open();
    await expect(scpi.client.queryNumber(':MEAS:VOLT1?')).resolves.toBe(3.25);
    await expect(scpi.client.queryBoolean(':OUTP1?')).resolves.toBe(true);
    await expect(scpi.client.queryBoolean(':OUTP2?')).resolves.toBe(false);
    await expect(scpi.client.queryBoolean(':VOLT1?')).rejects.toBeInstanceOf(ScpiResponseError);
    await scpi.client.close();
  });

  it('rejects requests still waiting when the transport closes', async () => {
    const scpi = createScriptedScpi({});
    await scpi.open();
    const pending = scpi.client.query(':VOLT1?', { timeoutMs: 5000 });
    await scpi.client.close();
    await expect(pending).rejects.toBeInstanceOf(ScpiClosedError);
    expect(scpi.client.isOpen).toBe(false);
  });

  it('is idempotent for open() and close()', async () => {
    const transport = loopbackTransport();
    const client = new ScpiClient(transport);
    await client.open();
    await client.open();
    expect(client.isOpen).toBe(true);
    await client.close();
    await client.close();
    expect(client.isOpen).toBe(false);
  });

  it('rejects pending requests when the transport fails underneath', async () => {
    const transport = loopbackTransport();
    const client = new ScpiClient(transport, { timeoutMs: 2000 });
    await client.open();
    // Break the inbound stream without a close() from our side.
    await transport.close();
    await expect(client.query(':VOLT1?')).rejects.toBeInstanceOf(ScpiClosedError);
  });
});
