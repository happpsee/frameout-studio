const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { createSecrets } = require("./secrets.cjs");

// Stand-in for Electron safeStorage: reversible, but never the plain text.
const fakeSafeStorage = (available = true) => ({
    isEncryptionAvailable: () => available,
    encryptString: text => Buffer.from(text, "utf8").map(byte => byte ^ 0x5a),
    decryptString: buffer => Buffer.from(buffer).map(byte => byte ^ 0x5a).toString("utf8"),
});

function directory(t) {
    const dir = path.join(os.tmpdir(), randomUUID());
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}

test.describe("记住的 API Key", () => {
    test("加密保存、读取并可单独删除", async (t) => {
        const dir = directory(t);
        const secrets = createSecrets(dir, fakeSafeStorage());
        await Promise.all([secrets.write("openai", "sk-openai-fixture"), secrets.write("ark", "ark-fixture")]);
        assert.deepStrictEqual(await secrets.read(), { openai: "sk-openai-fixture", ark: "ark-fixture" });
        const raw = fs.readFileSync(path.join(dir, "api-keys.data"), "utf8");
        assert.ok(!raw.includes("sk-openai-fixture"), "磁盘上不能出现明文 Key");
        await secrets.write("openai", null);
        assert.deepStrictEqual(await createSecrets(dir, fakeSafeStorage()).read(), { ark: "ark-fixture" });
    });

    test("钥匙串不可用时不落盘", async (t) => {
        const dir = directory(t);
        const secrets = createSecrets(dir, fakeSafeStorage(false));
        assert.throws(() => secrets.write("openai", "sk-openai-fixture"), /钥匙串不可用/);
        assert.deepStrictEqual(await secrets.read(), {});
        assert.strictEqual(fs.existsSync(path.join(dir, "api-keys.data")), false);
    });

    test("拒绝未知供应商和含空白的 Key", (t) => {
        const secrets = createSecrets(directory(t), fakeSafeStorage());
        assert.throws(() => secrets.write("other", "key"), TypeError);
        assert.throws(() => secrets.write("openai", "has space"), TypeError);
    });
});
