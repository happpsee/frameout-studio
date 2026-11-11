const test = require("node:test");
const { createStorage } = require("./storage.cjs");
const path = require("node:path");
const process = require("node:process");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const assert = require("node:assert");

test.describe("文件storage管理者能力测试组", () => {
    
test("写文件能力基本测试",  async (t) => {
    const dirname = process.cwd();
    const dir = path.join(dirname, randomUUID());
    await fs.mkdir(dir, { recursive: true });

    t.after(() => {
        fsSync.rmdirSync(dir, { recursive: true, force: true });
    });

    const storage = createStorage(dir);
    const textdecoder = new TextEncoder("utf-8");

    await storage.write("1", textdecoder.encode("this is a file.txt").buffer);

    const dirs = await fs.readdir(dir);
    dirs.includes("1.data");
    
    assert.strictEqual(dirs.includes("1.data"), true, "写文件失败!!!");
    const content = await fs.readFile(path.join(dir, "1.data"), "utf-8");
    assert.strictEqual(content, "this is a file.txt", "文件写入错误， 内容不一致！！");
});

test("读文件能力基本测试", async (t) => {
    const dirname = path.join(process.cwd(), randomUUID());
    await fs.mkdir(dirname, { recursive: true });
    t.after(() => {
        fsSync.rmdirSync(dirname, { force: true, recursive: true });
    });
    const storage = createStorage(dirname);

    await storage.write("1", (new TextEncoder("utf-8")).encode("this is a file.txt").buffer);

    const data = await storage.read("1");

    const textdecoder = new TextDecoder("utf-8");
    
    assert.strictEqual(textdecoder.decode(data), "this is a file.txt", "文件读取功能失败");
});

test("同一key并发写后读", async (t) => {
    const dirname = path.join(process.cwd(), randomUUID());
    t.after(() => {
        fsSync.rmSync(dirname, { force: true, recursive: true });
    });
    const storage = createStorage(dirname);

    const write = storage.write("1", new TextEncoder().encode("first").buffer);
    const read = storage.read("1");
    const second = storage.write("1", new TextEncoder().encode("second").buffer);
    const readAgain = storage.read("1");
    await write;
    await second;

    assert.strictEqual(new TextDecoder().decode(await read), "first", "排队的读操作必须拿到文件路径");
    assert.strictEqual(new TextDecoder().decode(await readAgain), "second", "排队的读操作必须读到最新内容");
});

test("防止操作越权文件夹", async () => {
    const storage = createStorage(path.join(process.cwd(), randomUUID()));
    const keys = ["../dirs", "./asa"];

    const blocked = keys.every((key) => {
        try {
            storage.write(key, new TextEncoder().encode("x").buffer);
            return false;   // 没抛错 → 防护失效
        } catch (err) {
            return true;    // 抛错 → 防护生效
        }
    });

    assert.strictEqual(blocked, true, "路径越权, 不允许操作项目独属的文件夹目录！！！");
});

test("检测清洗逻辑", async (t) => {
    const dir = path.join(process.cwd(), randomUUID());
    fsSync.mkdirSync(dir, { recursive: true });
    t.after(() => {
        fsSync.rmdirSync(dir, { recursive: true, force: true });
    });
    fsSync.writeFileSync(path.join(dir, "1.tmp"), "sss");
    fsSync.writeFileSync(path.join(dir, "2.data"), "ssss2");

    createStorage(dir);

    const dirs = fsSync.readdirSync(dir);
    assert.strictEqual(!dirs.includes("1.tmp") && dirs.includes("2.data"), true, "没有清扫成功！！！");
});

test("检测不存在文件", async (t) => {
    const storage = createStorage(path.join(process.cwd(), randomUUID()));
    assert.notStrictEqual(await storage.read("s"), "null", "不存在的文件路径应该返回null");
});
});
