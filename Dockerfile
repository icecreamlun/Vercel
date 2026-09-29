FROM node:22-bookworm-slim AS runner
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY runner ./runner
COPY scripts/catalog.mjs scripts/env.mjs ./scripts/
COPY fixtures ./fixtures
RUN npm run build:runner && node scripts/catalog.mjs && npm prune --omit=dev

FROM golang:1.24-bookworm AS backend
WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download
COPY internal ./internal
COPY cmd ./cmd
RUN CGO_ENABLED=0 go build -trimpath -o /promptship ./cmd/server

FROM node:22-bookworm-slim
WORKDIR /app
ENV APP_ENV=production LISTEN_ADDR=0.0.0.0:8080 NODE_ENV=production
COPY --from=backend /promptship /app/promptship
COPY --from=runner /build/node_modules ./node_modules
COPY --from=runner /build/dist ./dist
COPY --from=runner /build/fixtures ./fixtures
COPY scripts/sandbox.mjs scripts/env.mjs ./scripts/
COPY package.json ./
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 8080
CMD ["/app/promptship"]
