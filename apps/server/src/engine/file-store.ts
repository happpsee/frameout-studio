// Tasks on local disk: one JSON file per task, in a directory only the engine writes to.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readTask, TASK_ID, type Task, type TaskStore } from './task.ts';

export function createFileStore(directory: string): TaskStore {
  const fileOf = (id: string) => {
    if (!TASK_ID.test(id)) throw new TypeError('Invalid task id');
    return path.join(directory, `${id}.json`);
  };

  return {
    async load() {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      const tasks: Task[] = [];
      let skipped = 0;
      for (const name of await fs.readdir(directory)) {
        const file = path.join(directory, name);
        // Left by a write that was interrupted.
        if (name.endsWith('.tmp')) await fs.rm(file, { force: true });
        if (!name.endsWith('.json')) continue;
        let task: Task | undefined;
        try {
          task = readTask(JSON.parse(await fs.readFile(file, 'utf8')));
        } catch {
          /* Unreadable or not JSON: counted below. */
        }
        if (task && `${task.id}.json` === name) tasks.push(task);
        else skipped++;
      }
      return { tasks, skipped };
    },

    async put(task) {
      const file = fileOf(task.id);
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      // Write to a temporary file, then rename, so a crash never leaves a half-written task.
      const temporary = path.join(directory, `.${randomUUID()}.tmp`);
      try {
        const handle = await fs.open(temporary, 'wx', 0o600);
        try {
          await handle.writeFile(JSON.stringify(task));
          await handle.sync();
        } finally {
          await handle.close();
        }
        await fs.rename(temporary, file);
      } catch (error) {
        await fs.rm(temporary, { force: true }).catch(() => {});
        throw error;
      }
    },

    async remove(id) {
      await fs.rm(fileOf(id), { force: true });
    },
  };
}
