
const queuesMap = new Map();

const queue = (key, operation) => {
    const lastResult = (queuesMap.get(key) || Promise.resolve(key));

    const nowResult = lastResult
    .catch(() => {})
    .then(() => operation(key));

    queuesMap.set(key, nowResult);
    
    const clear = () => {
        if (queuesMap.get(key) === nowResult) queuesMap.delete(key);
    };

    nowResult.then(clear, clear);
    return nowResult;
};


module.exports = {
    queue
}
/**
 * queue, key, operation
 * 
 * 对一个key的操作一定在后面的key的前面
 * 所以，只要保证前面的顺序一定在后面的前面就可以了
 * 
 * 
 */