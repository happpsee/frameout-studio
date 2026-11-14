import type { ProviderId } from './providers.ts';

/** What a provider client is created from: where to call, with which key, and the generation settings. */
export interface AIConfig {
  provider: ProviderId;
  baseUrl: string;
  key: string;
  imageModel: string;
  videoModel: string;
  imageSize: string;
  duration: number;
  videoRatio: string;
  resolution: string;
  transport: 'proxy' | 'direct';
}
