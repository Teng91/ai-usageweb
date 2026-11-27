import fs from 'node:fs/promises';
import path from 'node:path';

// 先寫 .tmp 再 rename，避免停機時把檔案寫壞
export async function writeFileAtomic(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, file);
}

export async function readFileOrNull(file) {
  try {
    return await fs.readFile(file);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * 同一個檔案的寫入排隊依序做（同時寫會共用同一個 .tmp）。
 * write() 回傳這一次的結果（失敗會丟錯，由呼叫端決定要不要吞掉）；失敗不會卡住下一次。
 * flush() 等排在前面的都寫完（關機用）。
 */
export class SerialWriter {
  constructor(file) {
    this.file = file;
    this.chain = Promise.resolve();
  }

  write(data) {
    const job = this.chain.then(() => writeFileAtomic(this.file, data));
    this.chain = job.catch(() => {});
    return job;
  }

  flush() {
    return this.chain;
  }
}
