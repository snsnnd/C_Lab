FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8000

COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server

EXPOSE 8000
CMD ["node", "server/serve.mjs"]
