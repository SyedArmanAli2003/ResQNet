FROM node:20-alpine AS builder
WORKDIR /app
COPY server/package.json server/package-lock.json* ./server/
RUN npm install --prefix server

FROM node:20-alpine
WORKDIR /app
COPY . .
COPY --from=builder /app/server/node_modules ./server/node_modules
EXPOSE 3000
CMD ["node", "server/index.js"]
