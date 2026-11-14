import { useState } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import APISettings from './APISettings';
import {
  defaults,
  initialConfig,
  loadProfiles,
  PREFERENCES_KEY,
  startingProfile,
} from '../lib/preferences';
import { loadRememberedKeys } from '../lib/secrets';
import type { AIConfig } from '../types';

const mocked = vi.hoisted(() => ({ createClient: vi.fn(), connect: vi.fn() }));
vi.mock('@frameout/shared', async importOriginal => ({
  ...(await importOriginal<typeof import('@frameout/shared')>()),
  createClient: mocked.createClient,
}));

const showModalDescriptor = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  'showModal',
);
const closeDescriptor = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
beforeAll(() => {
  // jsdom has no modal API; model its open/close contract without mocking React.
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.open = true;
      },
    },
    close: {
      configurable: true,
      value(this: HTMLDialogElement) {
        if (!this.open) return;
        this.open = false;
        this.dispatchEvent(new Event('close'));
      },
    },
  });
});
afterAll(() => {
  if (showModalDescriptor)
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', showModalDescriptor);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  if (closeDescriptor) Object.defineProperty(HTMLDialogElement.prototype, 'close', closeDescriptor);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});
beforeEach(() => {
  localStorage.clear();
  mocked.connect.mockReset().mockResolvedValue({ ok: true });
  mocked.createClient.mockReset().mockImplementation(() => ({ testConnection: mocked.connect }));
});
afterEach(cleanup);

function Harness({
  initial = { ...defaults('openai'), key: 'openai-memory-secret' },
  onConfig = () => {},
}: {
  initial?: AIConfig;
  onConfig?: (config: AIConfig) => void;
}) {
  const [open, setOpen] = useState(true);
  const [config, setConfig] = useState(initial);
  return (
    <>
      <button onClick={() => setOpen(true)}>重新打开设置</button>
      <APISettings
        open={open}
        onClose={() => setOpen(false)}
        config={config}
        onChange={value => {
          setConfig(value);
          onConfig(value);
        }}
      />
    </>
  );
}
const keyInput = () => screen.getByLabelText<HTMLInputElement>('API Key', { exact: true });
async function provider(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole('combobox', { name: '供应商' }));
  await user.click(screen.getByRole('option', { name: label }));
}

describe('API settings provider profiles and cancellation', () => {
  it('retains provider keys during this mount while saved/refreshed profiles contain no keys', async () => {
    const user = userEvent.setup();
    const onConfig = vi.fn();
    const { unmount } = render(<Harness onConfig={onConfig} />);
    expect(keyInput().value).toBe('openai-memory-secret');
    await user.click(screen.getByRole('combobox', { name: '图片模型' }));
    await user.click(screen.getByRole('option', { name: /GPT Image 2/ }));
    await provider(user, '火山方舟');
    expect(keyInput().value).toBe('');
    await user.type(keyInput(), 'ark-memory-secret');
    await provider(user, 'OpenAI');
    expect(keyInput().value).toBe('openai-memory-secret');
    expect(screen.getByRole('combobox', { name: '图片模型' }).textContent).toContain('GPT Image 2');
    await provider(user, '火山方舟');
    expect(keyInput().value).toBe('ark-memory-secret');
    await user.click(screen.getByRole('button', { name: /保存配置/ }));
    expect(onConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({ provider: 'ark', key: 'ark-memory-secret' }),
    );
    const saved = localStorage.getItem(PREFERENCES_KEY)!;
    expect(saved).not.toContain('openai-memory-secret');
    expect(saved).not.toContain('ark-memory-secret');
    expect(JSON.parse(saved).profiles.openai.imageModel).toBe('gpt-image-2');
    expect(loadProfiles().profiles.ark?.key).toBe('');
    expect(initialConfig()).toMatchObject({ provider: 'ark', key: '' });
    await user.click(screen.getByRole('button', { name: '重新打开设置' }));
    expect(keyInput().value).toBe('ark-memory-secret');
    await provider(user, 'OpenAI');
    expect(keyInput().value).toBe('openai-memory-secret');
    unmount();
    render(<Harness initial={initialConfig()} />);
    expect(keyInput().value).toBe('');
    await provider(user, 'OpenAI');
    expect(keyInput().value).toBe('');
  });

  it('redacts connection error messages instead of displaying the API key', async () => {
    mocked.connect.mockRejectedValue(
      new Error('upstream echoed openai-memory-secret in Bearer openai-memory-secret'),
    );
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: '测试连接' }));
    const status = screen.getByRole('status').textContent;
    expect(status).not.toContain('openai-memory-secret');
    expect(status).toContain('[已隐藏]');
  });

  it('clears the memory key for every provider', async () => {
    const user = userEvent.setup();
    const onConfig = vi.fn();
    render(<Harness onConfig={onConfig} />);
    await provider(user, '火山方舟');
    await user.type(keyInput(), 'ark-memory-secret');
    await provider(user, 'OpenAI');
    await user.click(screen.getByRole('button', { name: '清除本页所有密钥' }));
    expect(keyInput().value).toBe('');
    expect(onConfig).toHaveBeenLastCalledWith(expect.objectContaining({ key: '' }));
    await provider(user, '火山方舟');
    expect(keyInput().value).toBe('');
  });
  it('remembers a key in the desktop keychain only when asked', async () => {
    const write = vi.fn(async () => {});
    window.frameoutDesktop = {
      platform: 'darwin',
      storage: { read: vi.fn(async () => null), write: vi.fn(async () => {}) },
      onBeforeClose: () => () => true,
      openTemporaryDownload: vi.fn(),
      openProviderConsole: vi.fn(async () => {}),
      secrets: {
        available: async () => true,
        read: async () => ({ ark: 'ark-remembered' }),
        write,
      },
    };
    try {
      await loadRememberedKeys();
      expect(startingProfile('ark').key).toBe('ark-remembered');
      const user = userEvent.setup();
      const onConfig = vi.fn();
      render(<Harness initial={{ ...defaults('openai'), key: '' }} onConfig={onConfig} />);
      const remember = () =>
        screen.getByRole<HTMLInputElement>('checkbox', { name: '在本机钥匙串中记住此 Key' });
      expect(remember().checked).toBe(false);
      await user.type(keyInput(), 'sk-openai-new');
      await user.click(remember());
      await user.click(screen.getByRole('button', { name: /保存配置/ }));
      expect(write).toHaveBeenCalledWith('openai', 'sk-openai-new');
      expect(onConfig).toHaveBeenLastCalledWith(
        expect.objectContaining({ provider: 'openai', key: 'sk-openai-new' }),
      );
      await user.click(screen.getByRole('button', { name: '重新打开设置' }));
      await provider(user, '火山方舟');
      expect(keyInput().value).toBe('ark-remembered');
      expect(remember().checked).toBe(true);
      await user.click(remember());
      await user.click(screen.getByRole('button', { name: /保存配置/ }));
      expect(write).toHaveBeenLastCalledWith('ark', null);
    } finally {
      delete window.frameoutDesktop;
      await loadRememberedKeys();
    }
  });
});
