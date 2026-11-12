/** Every provider the app can be configured for. */
export const PROVIDER_IDS = ['openai', 'ark', 'compatible'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const isProviderId = (value: unknown): value is ProviderId =>
  typeof value === 'string' && (PROVIDER_IDS as readonly string[]).includes(value);

/** Official base URLs the server-side relay may forward to. */
export const OFFICIAL_BASE_URLS = {
  openai: 'https://api.openai.com/v1',
  ark: 'https://ark.cn-beijing.volces.com/api/v3',
} as const;

export type OfficialProvider = keyof typeof OFFICIAL_BASE_URLS;

/** What each provider can do in this app. */
export const PROVIDER_CAPABILITIES: Readonly<
  Record<ProviderId, { readonly video: boolean; readonly references: boolean }>
> = {
  openai: { video: false, references: true },
  ark: { video: true, references: true },
  compatible: { video: true, references: false },
};

/** Pages where a user creates an API key. The desktop app opens only these hosts. */
export const PROVIDER_KEY_PAGES = {
  openai: 'https://platform.openai.com/api-keys',
  ark: 'https://console.volcengine.com/ark',
} as const;
