import {
  publicStatusCodeFor,
  toFamilyRequest,
  type BrokerRequest,
  type HealthCheck,
  type MediaRequest,
} from '@media-concierge/shared';
import type { PublicRequestBroker } from './contracts.js';

export interface SupabaseBrokerOptions {
  supabaseUrl: string;
  bridgeToken: string;
  timeoutMs?: number;
  retries?: number;
}

export class SupabasePublicRequestBroker implements PublicRequestBroker {
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly retries: number;

  constructor(private readonly options: SupabaseBrokerOptions) {
    this.endpoint = `${options.supabaseUrl.replace(/\/$/, '')}/functions/v1/bridge-sync`;
    this.timeoutMs = options.timeoutMs ?? 6_000;
    this.retries = options.retries ?? 2;
  }

  async health(): Promise<HealthCheck> {
    try {
      await this.call({ action: 'health' });
      return { name: 'Buzón público', status: 'healthy', message: 'Supabase bridge disponible' };
    } catch {
      return { name: 'Buzón público', status: 'degraded', message: 'Supabase bridge no respondió' };
    }
  }

  async pullPending(): Promise<BrokerRequest[]> {
    return this.call<BrokerRequest[]>({ action: 'pull' });
  }

  async publishStatus(request: MediaRequest): Promise<void> {
    if (!request.publicRequestId) return;
    const family = toFamilyRequest(request);
    await this.call({
      action: 'update',
      publicRequestId: request.publicRequestId,
      status: publicStatusCodeFor(request.state),
      publicEpisodes: family.publicEpisodes,
      note: family.history.at(-1)?.note ?? 'Estado actualizado.',
    });
  }

  private async call<T = unknown>(body: unknown): Promise<T> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      try {
        const response = await fetch(this.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-bridge-token': this.options.bridgeToken,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!response.ok) throw new Error(`Public broker returned ${response.status}`);
        return (await response.json()) as T;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Public broker request failed');
        if (attempt < this.retries) {
          await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
        }
      }
    }
    throw lastError ?? new Error('Public broker request failed');
  }
}
