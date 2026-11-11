const test = require("node:test");
const { queue } = require("./queue");
const assert = require("node:assert");

test.describe("queue测试", async () => {
    const order = [];
    const p1 = queue("test", async () => {
        await new Promise(resolve => setTimeout(resolve, 80))
        order.push("A");
    });
    const p2 = queue("test", () => {
        order.push("B");
    });
    await Promise.all([p1, p2]);
    console.log(order);
    assert.deepEqual(order, ["A", "B"], "queue串行链条实现错误!!!");
});