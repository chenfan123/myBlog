FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json yarn.lock ./
# Yarn v1 默认网络超时较短，云服务器首次下载依赖时放宽到 5 分钟。
RUN yarn install --frozen-lockfile --network-timeout 300000

FROM node:22-alpine AS builder
WORKDIR /app
ARG NEXT_PUBLIC_API_BASE_URL=https://ainew.gz.cn
ARG NEXT_PUBLIC_ALIYUN_CAPTCHA_PREFIX=
ARG NEXT_PUBLIC_ALIYUN_CAPTCHA_SCENE_ID=
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_ALIYUN_CAPTCHA_PREFIX=$NEXT_PUBLIC_ALIYUN_CAPTCHA_PREFIX
ENV NEXT_PUBLIC_ALIYUN_CAPTCHA_SCENE_ID=$NEXT_PUBLIC_ALIYUN_CAPTCHA_SCENE_ID
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN yarn build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
