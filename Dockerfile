FROM node:20-bookworm-slim
ENV TZ=America/Sao_Paulo NODE_ENV=production
WORKDIR /app
COPY package.json ./
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && npm install --omit=dev && apt-get purge -y python3 make g++ && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
COPY . .
# O banco fica em /app/data: crie um VOLUME apontando para essa pasta no EasyPanel para nao perder os dados
RUN mkdir -p /app/data
EXPOSE 3000
CMD ["node", "server.js"]
