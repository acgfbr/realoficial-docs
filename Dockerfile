FROM node:23-alpine

WORKDIR /app

RUN npm install -g mintlify

COPY . .

EXPOSE 3000

CMD ["node", "scripts/serve-docs.mjs"]
