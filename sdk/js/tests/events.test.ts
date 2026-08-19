import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PactumClient } from '../src/client';
import { decodeSorobanEvent, RawSorobanEvent } from '../src/events';

describe('Pactum JS SDK - Typed Event Listeners', () => {
  let client: PactumClient;

  beforeEach(() => {
    client = new PactumClient({
      contractId: 'CBADTVTJ6IN332HIKZ7LWUYMYTLPZYCEBV3X2HS47VHR5UDBHQ3GAA7E',
    });
  });

  describe('Event Listener Subscription and Dispatch', () => {
    it('handles created event with strongly typed payload', () => {
      const callback = vi.fn();
      client.on('created', callback);

      client.emit('created', {
        id: 42n,
        issuer: 'GABC123',
        counterparty: 'GXYZ456',
      });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(
        {
          id: 42n,
          issuer: 'GABC123',
          counterparty: 'GXYZ456',
        },
        undefined,
      );
    });

    it('handles attested event with strongly typed payload', () => {
      const callback = vi.fn();
      client.on('attested', callback);

      client.emit('attested', {
        id: 100n,
        status: 'Fulfilled',
      });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith({ id: 100n, status: 'Fulfilled' }, undefined);
    });

    it('supports unsubscribing via unsubscribe return function', () => {
      const callback = vi.fn();
      const unsubscribe = client.on('disputed', callback);

      client.emit('disputed', { id: 5n });
      expect(callback).toHaveBeenCalledTimes(1);

      unsubscribe();
      client.emit('disputed', { id: 5n });
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('Soroban Event Decoding and Dispatching', () => {
    it('decodes raw created event from Soroban topics and value', () => {
      const rawEvent: RawSorobanEvent = {
        topic: ['created', 'GABC_ISSUER', 'GXYZ_COUNTERPARTY'],
        value: '123',
      };

      const callback = vi.fn();
      client.on('created', callback);

      const handled = client.handleRawEvent(rawEvent);
      expect(handled).toBe(true);
      expect(callback).toHaveBeenCalledWith(
        {
          id: 123n,
          issuer: 'GABC_ISSUER',
          counterparty: 'GXYZ_COUNTERPARTY',
        },
        rawEvent,
      );
    });

    it('decodes raw attested event from Soroban topics and value', () => {
      const rawEvent: RawSorobanEvent = {
        topic: ['attested', '999'],
        value: 'late',
      };

      const callback = vi.fn();
      client.on('attested', callback);

      const handled = client.handleRawEvent(rawEvent);
      expect(handled).toBe(true);
      expect(callback).toHaveBeenCalledWith({ id: 999n, status: 'Late' }, rawEvent);
    });

    it('decodes raw resolved event from Soroban topics and value', () => {
      const rawEvent: RawSorobanEvent = {
        topic: ['resolved', '77'],
        value: 'Breached',
      };

      const callback = vi.fn();
      client.on('resolved', callback);

      const handled = client.handleRawEvent(rawEvent);
      expect(handled).toBe(true);
      expect(callback).toHaveBeenCalledWith({ id: 77n, finalOutcome: 'Breached' }, rawEvent);
    });
  });
});
