FROM node:22-alpine AS build
WORKDIR /app
ARG NPM_REGISTRY=https://registry.npmmirror.com
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --prefer-offline --no-audit --registry=$NPM_REGISTRY
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -qO- http://127.0.0.1/health || exit 1
