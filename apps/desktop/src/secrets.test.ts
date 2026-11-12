import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, onTestFinished, test } from 'vitest';
import { createSecrets, type KeyStore } from './secrets.ts';

// Stand-in for Electron safeStorage: reversible, but never the plain text.
const fakeSafeStorage = (available = true): KeyStore => ({
    isEncryptionAvailable: () => available,
    encryptString: (text: string) => Buffer.from(Buffer.from(text, "utf8").map(byte => byte ^ 0x5a)),
    decryptString: (buffer: Buffer) => Buffer.from(Buffer.from(buffer).map(byte => byte ^ 0x5a)).toString("utf8"),
});

function directory() {
    const dir = path.join(os.tmpdir(), randomUUID());
    onTestFinished(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}

describe("记住的 API Key", () => {
    test("加密保存、读取并可单独删除", async () => {
        const dir = directory();
        const secrets = createSecrets(dir, fakeSafeStorage());
        await Promise.all([secrets.write("openai", "sk-openai-fixture"), secrets.write("ark", "ark-fixture")]);
        assert.deepStrictEqual(await secrets.read(), { openai: "sk-openai-fixture", ark: "ark-fixture" });
        const raw = fs.readFileSync(path.join(dir, "api-keys.data"), "utf8");
        assert.ok(!raw.includes("sk-openai-fixture"), "磁盘上不能出现明文 Key");
        await secrets.write("openai", null);
        assert.deepStrictEqual(await createSecrets(dir, fakeSafeStorage()).read(), { ark: "ark-fixture" });
    });

    test("钥匙串不可用时不落盘", async () => {
        const dir = directory();
        const secrets = createSecrets(dir, fakeSafeStorage(false));
        assert.throws(() => secrets.write("openai", "sk-openai-fixture"), /钥匙串不可用/);
        assert.deepStrictEqual(await secrets.read(), {});
        assert.strictEqual(fs.existsSync(path.join(dir, "api-keys.data")), false);
    });

    test("拒绝未知供应商和含空白的 Key", () => {
        const secrets = createSecrets(directory(), fakeSafeStorage());
        assert.throws(() => secrets.write("other", "key"), TypeError);
        assert.throws(() => secrets.write("openai", "has space"), TypeError);
    });
});
