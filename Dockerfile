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


RUN npm run build


FROM nginx:alpine AS runner


COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf


EXPOSE 80


CMD ["nginx", "-g", "daemon off;"]
