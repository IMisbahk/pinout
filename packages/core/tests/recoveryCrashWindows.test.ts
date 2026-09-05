import { describe, expect, it } from 'vitest';
import {
  FileJournalStorage,
  Journal,
  MemoryJournalStorage,
  OperationManager,
} from '../src/index.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Recovery: Crash Windows', () => {
  it('Window A: crash before dispatch marks operation as aborted and blocks silent replay', async () => {
    const journal = new Journal({ storage: new MemoryJournalStorage() });
    const firstManager = new OperationManager({}, undefined, { journal });

    // Accepted and journaled (operation.requested), but testHook simulates crash before dispatch
    const original = firstManager.begin({
      deviceId: 'relay-01',
      capability: 'relay.set',
      owner: 'agent-a',
      idempotencyKey: 'win-a-key',
      testHooks: {
        beforeDispatch: () => {
          throw new Error('simulated process crash before dispatch');
        },
      },
      run: async () => {
        throw new Error('should never reach here in window a');
      },
    });

    await tick(10);
    const firstSnapshot = original.handle.snapshot();
    expect(firstSnapshot.status).toBe('aborted');

    // Simulate daemon restart with the same persistent journal
    const restartedManager = new OperationManager({}, undefined, { journal });
    await restartedManager.hydrate();

    const hydratedOp = restartedManager.get(original.handle.id);
    expect(hydratedOp).toBeDefined();
    expect(hydratedOp?.status).toBe('aborted');
    expect(hydratedOp?.error?.code).toBe('OPERATION_ABORTED_BEFORE_DISPATCH');

    // Client retries with the same idempotency key: returns deduped aborted handle without executing
    let ranSecondTime = false;
    const retry = restartedManager.begin({
      deviceId: 'relay-01',
      capability: 'relay.set',
      owner: 'agent-a',
      idempotencyKey: 'win-a-key',
      run: async () => {
        ranSecondTime = true;
        return { on: true };
      },
    });

    expect(retry.deduped).toBe(true);
    expect(retry.handle.id).toBe(original.handle.id);
    expect(retry.handle.snapshot().status).toBe('aborted');
    expect(ranSecondTime).toBe(false);

    await expect(retry.handle.waitForResult()).rejects.toMatchObject({
      code: 'OPERATION_ABORTED_BEFORE_DISPATCH',
    });
  });

  it('Window B: crash after dispatch before ack transitions to requires_reconciliation and blocks silent replay', async () => {
    const journalDir = await mkdtemp(join(tmpdir(), 'pinout-win-b-'));
    const journalFile = join(journalDir, 'journal.jsonl');

    try {
      const journal = new Journal({ storage: new FileJournalStorage(journalFile) });
      const firstManager = new OperationManager({}, undefined, { journal });

      let physicalActuationHappened = false;
      const original = firstManager.begin({
        deviceId: 'arm-01',
        capability: 'motion.move_to',
        owner: 'agent-b',
        idempotencyKey: 'win-b-key',
        testHooks: {
          afterDispatchBeforeAck: () => {
            // Physical actuation happened, but host process dies before writing ack
            throw new Error('simulated power loss / crash before ack write');
          },
        },
        run: async () => {
          physicalActuationHappened = true;
          return { moved: true, angle: 90 };
        },
      });

      await tick(15);
      expect(physicalActuationHappened).toBe(true);

      // Flush journal before simulating crash
      await journal.close();

      // Restart runtime against the persisted journal
      const recoveryJournal = new Journal({ storage: new FileJournalStorage(journalFile) });
      const restartedManager = new OperationManager({}, undefined, { journal: recoveryJournal });
      await restartedManager.hydrate();

      const listed = restartedManager.list();
      expect(listed.some((op) => op.id === original.handle.id)).toBe(true);

      const recoveredOp = restartedManager.get(original.handle.id);
      expect(recoveredOp).toBeDefined();
      expect(recoveredOp?.status).toBe('requires_reconciliation');
      expect(recoveredOp?.error?.code).toBe('OPERATION_REQUIRES_RECONCILIATION');

      // Client attempting to waitForResult() receives structured error demanding reconciliation
      const handle = restartedManager.getHandle(original.handle.id);
      await expect(handle.waitForResult()).rejects.toMatchObject({
        code: 'OPERATION_REQUIRES_RECONCILIATION',
      });

      // Retrying with the same idempotency key is blocked and returns the uncertain snapshot
      let duplicateActuation = false;
      const retry = restartedManager.begin({
        deviceId: 'arm-01',
        capability: 'motion.move_to',
        owner: 'agent-b',
        idempotencyKey: 'win-b-key',
        run: async () => {
          duplicateActuation = true;
          return { moved: true, angle: 90 };
        },
      });

      expect(retry.deduped).toBe(true);
      expect(retry.handle.snapshot().status).toBe('requires_reconciliation');
      expect(duplicateActuation).toBe(false);
    } finally {
      await rm(journalDir, { recursive: true, force: true });
    }
  });

  it('Window C: crash after completion before client receipt preserves recorded result and allows retrieval without re-execution', async () => {
    const journalDir = await mkdtemp(join(tmpdir(), 'pinout-win-c-'));
    const journalFile = join(journalDir, 'journal.jsonl');

    try {
      const journal = new Journal({ storage: new FileJournalStorage(journalFile) });
      const firstManager = new OperationManager({}, undefined, { journal });

      let executionCount = 0;
      const original = firstManager.begin({
        deviceId: 'chamber-01',
        capability: 'temperature.set',
        owner: 'agent-c',
        idempotencyKey: 'win-c-key',
        run: async () => {
          executionCount += 1;
          return { targetC: 42.5, currentC: 42.4, heater: 'active' };
        },
      });

      const firstResult = await original.handle.waitForResult();
      expect(firstResult).toEqual({ targetC: 42.5, currentC: 42.4, heater: 'active' });
      expect(executionCount).toBe(1);

      // Flush journal before crash
      await journal.close();

      // Restart runtime against same journal
      const recoveryJournal = new Journal({ storage: new FileJournalStorage(journalFile) });
      const restartedManager = new OperationManager({}, undefined, { journal: recoveryJournal });
      await restartedManager.hydrate();

      const recovered = restartedManager.get(original.handle.id);
      expect(recovered).toBeDefined();
      expect(recovered?.status).toBe('completed');
      expect(recovered?.result).toEqual({ targetC: 42.5, currentC: 42.4, heater: 'active' });

      // Client retrieves result by operation ID
      const retrievedResult = await restartedManager.getHandle(original.handle.id).waitForResult();
      expect(retrievedResult).toEqual({ targetC: 42.5, currentC: 42.4, heater: 'active' });

      // Client retries with same idempotency key
      const retry = restartedManager.begin({
        deviceId: 'chamber-01',
        capability: 'temperature.set',
        owner: 'agent-c',
        idempotencyKey: 'win-c-key',
        run: async () => {
          executionCount += 1;
          return { targetC: 999 };
        },
      });

      expect(retry.deduped).toBe(true);
      expect(retry.handle.snapshot().status).toBe('completed');
      expect(await retry.handle.waitForResult()).toEqual({
        targetC: 42.5,
        currentC: 42.4,
        heater: 'active',
      });
      expect(executionCount).toBe(1); // Never executed a second time!
    } finally {
      await rm(journalDir, { recursive: true, force: true });
    }
  });
});
