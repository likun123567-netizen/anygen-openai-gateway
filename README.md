# AnyGen → OpenAI 兼容转换网关（最小可用版）

这个网关的目标是：

- **对下游平台**：伪装成 OpenAI 兼容 API（提供 `/v1/models`、`/v1/chat/completions`）
- **对上游 AnyGen**：把一次 chat 请求转换为一次 AnyGen `task.create`（`POST /v1/openapi/tasks`）

网关返回的“assistant 回复”里包含：`task_id` + `task_url`，方便你在 AnyGen 里查看任务进度/编辑。

> 说明：这是“先跑通链路”的最小版本；不做轮询，不等待任务完成。

---

## 0) 安全提醒（强烈建议看）

- **不要**把 `ANYGEN_API_KEY` 发到聊天/群里
- 如果你曾经泄露过 key：建议立刻在 AnyGen 控制台 **作废并重新生成**
- `GATEWAY_KEY` 建议必设，否则别人知道你的网关地址就能白嫖调用

---

## 方案 1（推荐给没服务器的人）：Render 免费云一键部署（公网 HTTPS）

本项目已包含 `render.yaml`，可以用 Render 的 Blueprint 一键部署。

### 1.1 准备
- 一个 GitHub 账号
- 一个 Render 账号（可用 GitHub 登录）

### 1.2 把项目放到你自己的 GitHub
1) 在你本机解压本项目
2) 新建一个 GitHub 仓库（例如 `anygen-openai-gateway`）
3) 把目录内容 push 到你的仓库根目录

### 1.3 Render 一键部署
1) 打开 Render： https://render.com/
2) 选择 **New +** → **Blueprint**
3) 选择你刚刚的 GitHub 仓库
4) Render 会识别 `render.yaml` 并创建一个 Web Service

### 1.4 在 Render 填环境变量（必须）
在 Render 的 Service → **Environment** 里添加：

- `ANYGEN_API_KEY`：你的 AnyGen key（`sk-...`）
- `GATEWAY_KEY`：你自定义的网关 key（例如 `gw-xxxx`）

然后点 **Deploy** 或等待自动部署完成。

### 1.5 拿到你的 Base URL
部署完成后 Render 会给你一个公网 HTTPS 地址，例如：

- `https://anygen-openai-gateway-xxxx.onrender.com`

这就是你平台要填的 **Base URL**（不要再拼 `/v1`）。

---

## Render 自检（复制就能用）

把下面命令里的域名换成你的 Render 域名。

### 健康检查

```bash
curl -s https://<你的域名>/healthz
```

### 拉模型列表

```bash
curl -s https://<你的域名>/v1/models \
  -H 'Authorization: Bearer <GATEWAY_KEY>'
```

### 发一次 chat（创建 AnyGen 任务）

```bash
curl -s https://<你的域名>/v1/chat/completions \
  -H 'Authorization: Bearer <GATEWAY_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "anygen-slide",
    "messages": [{"role":"user","content":"帮我做一个关于XXX的10页PPT"}]
  }'
```

返回的 `assistant.content`（JSON 字符串）里会有：

- `task_id`
- `task_url`

打开 `task_url` 就能在 AnyGen 页面看进度/编辑。

---

## 方案 2（有服务器的人）：Docker 部署

### 2.1 创建 .env（不要提交到 git）

```bash
cat > .env <<'EOF'
ANYGEN_API_KEY=sk-xxxx
GATEWAY_KEY=gw-xxxx
EOF
```

### 2.2 启动

```bash
docker compose up -d --build
```

---

## 平台侧怎么填（OpenAI 直连）

- 协议：选 **OpenAI 直连**
- 请求地址（Base URL）：
  - Render：`https://<你的域名>`
  - Docker：`http://<你的服务器IP>:8080`
- API Key：填 **GATEWAY_KEY**（不是 AnyGen Key）
- 点“拉取模型”：应该能看到 `anygen-slide / anygen-doc ...`

---

## 常见问题

### Q1：平台提示 404 / 返回 HTML
通常是 **Base URL 填错** 或平台没有按 OpenAI 协议请求 `/v1/models`。

Base URL 必须是根：

- `https://<域名>`

不要带 `/v1/...` 子路径。

### Q2：网关返回 401 Unauthorized
说明你设置了 `GATEWAY_KEY`，但平台没带：

- `Authorization: Bearer <GATEWAY_KEY>`

把平台里的“API Key”填成 `GATEWAY_KEY` 即可。

### Q3：AnyGen 鉴权错误
说明 `ANYGEN_API_KEY` 不对/过期/被删。

---

## 下一步增强（可选）

如果你希望平台里**直接拿到下载链接**（而不是只拿 `task_url`），可以加：

- 在 `/v1/chat/completions` 内部轮询 `GET /v1/openapi/tasks/:task_id`
- 等 `status=completed` 后把 `output.files[].url` 拼到 assistant 回复

你只要告诉我：你希望最长等待多少秒（例如 300 秒）。
