FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

# アカウント情報は /app/data に保存される。
# 再デプロイで消えないようボリュームをマウントすること。
VOLUME /app/data

CMD ["node", "server.js"]
