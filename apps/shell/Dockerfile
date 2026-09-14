# Build from the repository root: docker build -f apps/shell/Dockerfile -t platform-shell .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @platform/shell build

FROM nginx:1.27-alpine
COPY --from=build /repo/apps/shell/dist /usr/share/nginx/html
COPY apps/shell/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/shell/docker/entrypoint.sh /entrypoint.sh
EXPOSE 8080
ENTRYPOINT ["/entrypoint.sh"]
