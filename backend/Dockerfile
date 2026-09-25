FROM node:20-alpine AS builder

WORKDIR /app

COPY backend/package*.json ./

COPY backend/prisma/ ./prisma/

RUN npm install

COPY backend/tsconfig.json ./

COPY backend/src/ ./src/

RUN npx prisma generate --schema prisma/schema.prisma && npm run build

FROM node:20-alpine AS runner

WORKDIR /app

COPY backend/package*.json ./

COPY backend/prisma/ ./prisma/

RUN npm install --omit=dev

# Generated Prisma client (the prisma CLI is a dev dependency, so generate once in the builder)
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

COPY --from=builder /app/dist ./dist

COPY db/ ./db/

EXPOSE 3001

CMD ["node", "dist/server.js"]
