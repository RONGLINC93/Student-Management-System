# 学生管理系统 - 生产镜像
# 零依赖纯 Node.js 项目，无需 npm install
#
# 基础镜像默认走国内加速源，避免直连 Docker Hub 超时。
# 如需切换其它源或官方源，可在构建时覆盖：
#   docker compose build --build-arg NODE_IMAGE=node:20-alpine
#   docker compose build --build-arg NODE_IMAGE=docker.1ms.run/library/node:20-alpine
ARG NODE_IMAGE=docker.m.daocloud.io/library/node:20-alpine
FROM ${NODE_IMAGE}

# 设置工作目录
WORKDIR /app

# 时区（如需其它时区可自行调整）
ENV TZ=Asia/Shanghai

# 仅复制运行所需文件（data 目录不打包进镜像，运行时通过卷挂载持久化）
COPY server.js package.json ./
COPY public ./public

# 数据目录（会被 docker-compose 的卷覆盖以持久化）
RUN mkdir -p /app/data

# 以非 root 用户运行，提升安全性
RUN chown -R node:node /app
USER node

# 服务监听端口
ENV PORT=3000
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

# 启动服务
CMD ["node", "server.js"]
