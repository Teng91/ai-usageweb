// 一行一筆 JSON；絕不記錄 token、header 或原始回應
export function logJson(obj) {
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), ...obj }) + '\n');
}

export function logInfo(msg, extra = {}) {
  logJson({ level: 'info', msg, ...extra });
}

export function logWarn(msg, extra = {}) {
  logJson({ level: 'warn', msg, ...extra });
}
