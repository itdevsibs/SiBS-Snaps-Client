# SiBS HRIS-style multi-stage React build with optional Vite build arguments.
FROM node:current-alpine AS deps

WORKDIR /app

COPY package*.json ./
RUN npm ci

FROM node:current-alpine AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG VITE_API_URL
ARG VITE_APP_NAME

ENV VITE_API_URL=$VITE_API_URL
ENV VITE_APP_NAME=$VITE_APP_NAME

# Intentionally no mandatory VITE_API_URL check: SiBS-Snaps production
# uses same-origin /api routed by nginx, not a hardcoded client API port.
RUN npm run build

FROM nginx:alpine AS runner

COPY --from=builder /app/dist /usr/share/nginx/html
# Keep the production /api reverse proxy from the prior fix.
# nginx's official entrypoint substitutes SNAPS_API_UPSTREAM at startup.
COPY nginx.conf /etc/nginx/templates/default.conf.template

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
