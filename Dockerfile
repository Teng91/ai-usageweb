FROM node:22-slim

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data

WORKDIR /app

COPY package*.json ./
# 目前沒有相依套件；之後加套件時這行會生效
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; fi

COPY server.js docker-entrypoint.sh ./
COPY src ./src
COPY public ./public
RUN chmod +x docker-entrypoint.sh && mkdir -p /data && chown node:node /data

EXPOSE 8080
# fly volume 掛上來是 root 擁有：entrypoint 先 chown，再用 setpriv 降成 node 使用者執行，
# exec 讓 node 直接收到 SIGTERM，關機前寫入快照
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
