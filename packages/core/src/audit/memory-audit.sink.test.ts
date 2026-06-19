import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryAuditSink } from './memory-audit.sink.js';

describe('MemoryAuditSink', () => {
  let sink: MemoryAuditSink;
  beforeEach(() => {
    sink = new MemoryAuditSink();
  });

  it('appends events in order', async () => {
    await sink.record({
      type: 'verification_started',
      phoneRedacted: '+91***10',
      channel: 'sms',
      ts: new Date(0),
    });
    await sink.record({
      type: 'code_dispatched',
      phoneRedacted: '+91***10',
      channel: 'sms',
      provider: 'mock',
      ts: new Date(1000),
    });
    expect(sink.events).toHaveLength(2);
    expect(sink.events[0]!.type).toBe('verification_started');
    expect(sink.events[1]!.type).toBe('code_dispatched');
  });

  it('clear empties the buffer', async () => {
    await sink.record({
      type: 'verification_started',
      phoneRedacted: '+91***10',
      channel: 'sms',
      ts: new Date(),
    });
    sink.clear();
    expect(sink.events).toHaveLength(0);
  });
});
