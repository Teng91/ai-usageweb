// 產生 Web Push 用的 VAPID 金鑰，以及 PUSH_KEY／PUSH_TICK_TOKEN 兩個隨機密碼；印出 fly secrets 指令
// 用法：npm run gen-vapid
import crypto from 'node:crypto';
import { generateVapidKeys } from '../src/webpush.js';

const { publicKey, privateKey } = generateVapidKeys();
const rand = () => crypto.randomBytes(24).toString('base64url');
const pushKey = rand();
const tickToken = rand();

console.log(`VAPID_PUBLIC_KEY=${publicKey}
VAPID_PRIVATE_KEY=${privateKey}
PUSH_KEY=${pushKey}
PUSH_TICK_TOKEN=${tickToken}

# 設到 fly.io：
fly secrets set VAPID_PUBLIC_KEY=${publicKey} VAPID_PRIVATE_KEY=${privateKey} PUSH_KEY=${pushKey} PUSH_TICK_TOKEN=${tickToken}

# GitHub repo 的 Settings → Secrets → Actions 新增 PUSH_TICK_TOKEN（同上面的值）
# PUSH_KEY 是手機訂閱時要輸入的密碼，記下來
# 換 VAPID 金鑰後，所有裝置都要重新開啟通知`);
