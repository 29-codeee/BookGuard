import { randomUUID } from 'node:crypto';
import type { ResourceType } from '../transactions/types.js';

export interface ProviderItem { id: string; resourceId: string; type: ResourceType; quantity: number }
export interface ProviderContext { provider: string; unitPrice: number; currency: string }
export interface ProviderResult { ok: true; provider: string; reference: string; status: 'RESERVED' | 'CONFIRMED' | 'CANCELLED' }
export interface DatasetProviderAdapter {
  readonly type: ResourceType;
  reserve(item: ProviderItem, context: ProviderContext): Promise<ProviderResult>;
  confirm(item: ProviderItem, context: ProviderContext, reference: string): Promise<ProviderResult>;
  cancel(item: ProviderItem, context: ProviderContext, reference: string): Promise<ProviderResult>;
}

export type FailureRule = string | Error | boolean;

export interface InjectedFailures {
  reserve?: Partial<Record<ResourceType, FailureRule>>;
  confirm?: Partial<Record<ResourceType, FailureRule>>;
  cancel?: Partial<Record<ResourceType, FailureRule>>;
}

export type ProviderRegistry = Record<ResourceType, DatasetProviderAdapter>;

/**
 * Deterministic local provider adapter with configurable failure injection
 * for testing forward reservations and reverse compensation flows.
 */
export class MockDatasetProviderAdapter implements DatasetProviderAdapter {
  constructor(
    readonly type: ResourceType,
    private failureRules: {
      reserve?: FailureRule;
      confirm?: FailureRule;
      cancel?: FailureRule;
    } = {},
    private onCall?: (action: string) => void
  ) {}

  setFailureRule(op: 'reserve' | 'confirm' | 'cancel', rule?: FailureRule): void {
    this.failureRules[op] = rule;
  }

  async reserve(_item: ProviderItem, context: ProviderContext): Promise<ProviderResult> {
    this.onCall?.(`reserve:${this.type}`);
    if (this.failureRules.reserve) {
      const err = this.failureRules.reserve;
      throw typeof err === 'string' ? new Error(err) : err instanceof Error ? err : new Error(`injected ${this.type} reserve failure`);
    }
    return { ok: true, provider: context.provider, reference: `bg-${this.type}-${randomUUID()}`, status: 'RESERVED' };
  }

  async confirm(_item: ProviderItem, context: ProviderContext, reference: string): Promise<ProviderResult> {
    this.onCall?.(`confirm:${this.type}`);
    if (this.failureRules.confirm) {
      const err = this.failureRules.confirm;
      throw typeof err === 'string' ? new Error(err) : err instanceof Error ? err : new Error(`injected ${this.type} confirm failure`);
    }
    return { ok: true, provider: context.provider, reference, status: 'CONFIRMED' };
  }

  async cancel(_item: ProviderItem, context: ProviderContext, reference: string): Promise<ProviderResult> {
    this.onCall?.(`cancel:${this.type}`);
    if (this.failureRules.cancel) {
      const err = this.failureRules.cancel;
      throw typeof err === 'string' ? new Error(err) : err instanceof Error ? err : new Error(`injected ${this.type} cancellation failure`);
    }
    return { ok: true, provider: context.provider, reference, status: 'CANCELLED' };
  }
}

/**
 * Creates a complete provider registry for all 4 resource types,
 * optionally injecting deterministic failures and recording call actions.
 */
export function createMockProviderRegistry(options: {
  calls?: string[];
  failures?: InjectedFailures;
} = {}): ProviderRegistry {
  const types: ResourceType[] = ['hotel', 'flight', 'transport', 'activity'];
  const registry = {} as ProviderRegistry;
  for (const t of types) {
    registry[t] = new MockDatasetProviderAdapter(
      t,
      {
        reserve: options.failures?.reserve?.[t],
        confirm: options.failures?.confirm?.[t],
        cancel: options.failures?.cancel?.[t]
      },
      action => options.calls?.push(action)
    );
  }
  return registry;
}

/**
 * Failure-injection configs behind the deterministic Phase 4 scenarios.
 * Shared so the operations dashboard's demo scenarios run exactly the same
 * failure patterns as the automated saga tests.
 */
export const FailureScenarioSimulations = {
  /** A. Hotel succeeds, flight succeeds, transport fails. */
  scenarioA: { reserve: { transport: 'injected transport reserve failure' } },
  /** B. Hotel succeeds, flight fails immediately. */
  scenarioB: { reserve: { flight: 'injected flight reserve failure' } },
  /** C. All providers succeed. */
  scenarioC: {},
  /** D. Forward operation fails and compensation succeeds. */
  scenarioD: { reserve: { transport: 'injected transport reserve failure' } },
  /** E. Forward operation fails and one compensation fails. */
  scenarioE: {
    reserve: { transport: 'injected transport reserve failure' },
    cancel: { flight: 'injected flight cancellation failure' }
  }
} satisfies Record<string, InjectedFailures>;

/**
 * Predefined deterministic failure simulation scenarios for BookGuard Phase 4 tests.
 */
export const FailureScenarios = {
  /** A. Hotel succeeds, flight succeeds, transport fails. */
  scenarioA(calls?: string[]): ProviderRegistry {
    return createMockProviderRegistry({ calls, failures: FailureScenarioSimulations.scenarioA });
  },
  /** B. Hotel succeeds, flight fails immediately. */
  scenarioB(calls?: string[]): ProviderRegistry {
    return createMockProviderRegistry({ calls, failures: FailureScenarioSimulations.scenarioB });
  },
  /** C. All providers succeed. */
  scenarioC(calls?: string[]): ProviderRegistry {
    return createMockProviderRegistry({ calls, failures: FailureScenarioSimulations.scenarioC });
  },
  /** D. Forward operation fails and compensation succeeds. */
  scenarioD(calls?: string[]): ProviderRegistry {
    return createMockProviderRegistry({ calls, failures: FailureScenarioSimulations.scenarioD });
  },
  /** E. Forward operation fails and one compensation fails. */
  scenarioE(calls?: string[]): ProviderRegistry {
    return createMockProviderRegistry({ calls, failures: FailureScenarioSimulations.scenarioE });
  }
};

const adapters: Record<ResourceType, DatasetProviderAdapter> = {
  hotel: new MockDatasetProviderAdapter('hotel'),
  flight: new MockDatasetProviderAdapter('flight'),
  transport: new MockDatasetProviderAdapter('transport'),
  activity: new MockDatasetProviderAdapter('activity')
};

export function getDatasetProviderAdapter(type: ResourceType): DatasetProviderAdapter {
  return adapters[type];
}
