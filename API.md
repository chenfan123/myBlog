# MyBlog 接口文档

本文档对应当前项目代码，包含 FastAPI 业务接口和 Next.js CDN 上传代理接口。

## 1. 基本信息

### 1.1 服务地址

| 环境 | FastAPI | Next.js |
| --- | --- | --- |
| 本地 | `http://localhost:8000` | `http://localhost:3000` |
| 线上 | `https://ainew.gz.cn` | `https://ainew.gz.cn` |

FastAPI v1 接口统一前缀：

```text
/api/v1
```

线上 Nginx 只把 `/api/v1/` 转发给 FastAPI；`/` 和其他页面路径由 Next.js 处理。因此下面的 FastAPI 根路径、Swagger、ReDoc 和 OpenAPI 地址默认只在本地端口 `8000` 直接访问。线上业务接口统一使用 `https://ainew.gz.cn/api/v1/...`。

交互式文档：

- Swagger UI：`GET /docs`
- ReDoc：`GET /redoc`
- OpenAPI JSON：`GET /openapi.json`

### 1.2 数据格式

- 普通请求与响应使用 `application/json`。
- 图片上传使用 `multipart/form-data`。
- 时间使用 ISO 8601 格式，例如 `2026-08-27T10:30:00+08:00`。
- 用户和博客节点 ID 使用 UUID。

### 1.3 登录认证

登录或注册成功后，后端通过响应头 `Set-Cookie` 写入 JWT：

```text
myblog_access_token=<JWT>; HttpOnly; SameSite=Lax; Path=/
```

前端 JavaScript 不读取 JWT。浏览器请求时需要携带 Cookie：

```ts
fetch(url, {
  credentials: "include",
});
```

权限分为：

| 身份 | 能力 |
| --- | --- |
| 未登录用户 | 查看公开简历、博客目录和已发布文章 |
| 普通用户 | 具备登录状态，但不能进入管理后台 |
| 管理员 | 修改简历、管理博客树、上传图片 |

### 1.4 通用错误格式

FastAPI 业务错误：

```json
{
  "detail": "错误描述"
}
```

参数校验失败：

```json
{
  "detail": [
    {
      "type": "string_too_short",
      "loc": ["body", "name"],
      "msg": "String should have at least 1 character",
      "input": ""
    }
  ]
}
```

常见状态码：

| 状态码 | 含义 |
| --- | --- |
| `200` | 请求成功 |
| `201` | 创建成功 |
| `204` | 成功，无响应体 |
| `400` | 业务参数不正确 |
| `401` | 未登录、Cookie 失效或密码错误 |
| `403` | 已登录但不是管理员 |
| `404` | 数据不存在 |
| `409` | 邮箱、slug 等唯一数据冲突 |
| `422` | FastAPI/Pydantic 参数校验失败 |
| `429` | 请求过于频繁 |
| `502` | CDN 等上游服务异常 |
| `503` | Redis、邮件或验证码服务不可用 |

## 2. 接口总览

### 2.1 基础接口

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/` | 公开 | API 基本信息 |
| `GET` | `/api/v1/health` | 公开 | 健康检查 |

### 2.2 认证接口

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| `POST` | `/api/v1/auth/email-code` | 公开 | 验证人机验证并发送邮箱验证码 |
| `POST` | `/api/v1/auth/register` | 公开 | 注册普通用户并自动登录 |
| `POST` | `/api/v1/auth/login` | 公开 | 人机验证、账号密码登录 |
| `GET` | `/api/v1/auth/me` | 登录用户 | 获取当前用户 |
| `POST` | `/api/v1/auth/logout` | 公开 | 删除登录 Cookie |

### 2.3 简历接口

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/v1/resume` | 公开 | 获取简历内容 |
| `GET` | `/api/v1/admin/verify` | 管理员 | 校验管理员身份 |
| `PUT` | `/api/v1/admin/resume` | 管理员 | 覆盖保存简历内容 |

### 2.4 博客接口

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/v1/blog/tree` | 公开 | 获取已发布博客目录树的扁平节点 |
| `GET` | `/api/v1/blog/posts/{slug}` | 公开 | 按 slug 获取已发布文章 |
| `GET` | `/api/v1/admin/blog/tree` | 管理员 | 获取包含草稿的完整博客树 |
| `GET` | `/api/v1/admin/blog/nodes/{node_id}` | 管理员 | 获取节点详情和 Markdown 正文 |
| `POST` | `/api/v1/admin/blog/nodes` | 管理员 | 创建文件夹或文章 |
| `PATCH` | `/api/v1/admin/blog/nodes/{node_id}` | 管理员 | 修改、移动或发布节点 |
| `DELETE` | `/api/v1/admin/blog/nodes/{node_id}` | 管理员 | 删除节点及全部子节点 |

### 2.5 Next.js 图片接口

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| `POST` | `/api/cdn/presign` | 管理员 | 获取 CDN 预签名上传地址 |
| `POST` | `/api/cdn/upload` | 管理员 | 上传图片并返回公开地址 |

## 3. 基础接口

### 3.1 API 根路径

```http
GET /
```

响应 `200`：

```json
{
  "message": "MyBlog API",
  "docs": "/docs",
  "health": "/api/v1/health"
}
```

### 3.2 健康检查

```http
GET /api/v1/health
```

响应 `200`：

```json
{
  "status": "ok"
}
```

## 4. 认证接口

### 4.1 发送注册邮箱验证码

```http
POST /api/v1/auth/email-code
Content-Type: application/json
```

请求体：

```json
{
  "email": "user@example.com",
  "captcha_verify_param": "阿里云验证码成功回调返回的完整字符串"
}
```

字段说明：

| 字段 | 类型 | 必填 | 限制 | 说明 |
| --- | --- | --- | --- | --- |
| `email` | string | 是 | 5～320 字符 | 未注册邮箱，会转换为小写 |
| `captcha_verify_param` | string | 是 | 1～8192 字符 | 必须原样传递，不可解析或修改 |

响应 `200`：

```json
{
  "message": "验证码已发送，请检查邮箱",
  "retry_after_seconds": 60,
  "expires_in_seconds": 600
}
```

可能错误：

- `400`：阿里云验证码校验失败。
- `409`：邮箱已经注册。
- `429`：同一邮箱请求过于频繁，响应头包含 `Retry-After`。
- `503`：Redis、邮件或验证码服务不可用。

### 4.2 注册账户

```http
POST /api/v1/auth/register
Content-Type: application/json
```

请求体：

```json
{
  "display_name": "张三",
  "email": "user@example.com",
  "password": "Password123",
  "email_code": "123456"
}
```

| 字段 | 类型 | 必填 | 限制 |
| --- | --- | --- | --- |
| `display_name` | string | 是 | 2～80 字符 |
| `email` | string | 是 | 5～320 字符 |
| `password` | string | 是 | 8～128 字符，至少包含一个字母和一个数字 |
| `email_code` | string | 是 | 6 位数字 |

注册用户默认：

```json
{
  "is_admin": false
}
```

响应 `201`，同时写入登录 Cookie：

```json
{
  "user": {
    "id": "a93df89d-342a-4df4-8fac-a0b98bd66b75",
    "email": "user@example.com",
    "display_name": "张三",
    "is_admin": false,
    "created_at": "2026-08-27T10:30:00+08:00"
  }
}
```

可能错误：

- `400`：邮箱验证码错误或过期。
- `409`：邮箱已经注册。
- `503`：Redis 服务不可用。

### 4.3 登录

```http
POST /api/v1/auth/login
Content-Type: application/json
```

请求体：

```json
{
  "email": "user@example.com",
  "password": "Password123",
  "captcha_verify_param": "阿里云验证码成功回调返回的完整字符串"
}
```

后端处理顺序：

1. 调用阿里云完成验证码二次验签。
2. 校验邮箱和 Argon2 密码哈希。
3. 更新最后登录时间。
4. 写入 HttpOnly 登录 Cookie。

响应 `200`：

```json
{
  "user": {
    "id": "a93df89d-342a-4df4-8fac-a0b98bd66b75",
    "email": "user@example.com",
    "display_name": "张三",
    "is_admin": false,
    "created_at": "2026-08-27T10:30:00+08:00"
  }
}
```

可能错误：

- `400`：验证码校验失败。
- `401`：邮箱或密码错误。

### 4.4 获取当前用户

```http
GET /api/v1/auth/me
Cookie: myblog_access_token=<JWT>
```

响应 `200`：

```json
{
  "id": "a93df89d-342a-4df4-8fac-a0b98bd66b75",
  "email": "user@example.com",
  "display_name": "张三",
  "is_admin": false,
  "created_at": "2026-08-27T10:30:00+08:00"
}
```

未登录或 JWT 失效返回 `401`。

### 4.5 退出登录

```http
POST /api/v1/auth/logout
```

响应 `204`，无响应体。后端会删除登录 Cookie。

## 5. 简历接口

### 5.1 获取简历

```http
GET /api/v1/resume
```

响应 `200`：

```json
{
  "profile": {
    "name": "陈建华",
    "role": "前端开发工程师 / Agent 开发工程师",
    "age": "28",
    "experience": "5年",
    "education": "大学/本科",
    "phone": "电话号码",
    "email": "邮箱地址",
    "introduction": "个人简介",
    "avatar_url": "https://cdn.example.com/avatar.png",
    "location": "杭州",
    "availability": "开放机会"
  },
  "strengths": ["个人优势一"],
  "skill_groups": [
    {
      "title": "前端开发",
      "skills": ["TypeScript", "React", "Next.js"]
    }
  ],
  "expectation": {
    "roles": ["前端开发工程师"],
    "location": "杭州",
    "salary": "面议",
    "availability": "一个月内"
  },
  "experiences": [
    {
      "company": "公司名称",
      "role": "前端开发工程师",
      "time": "2021.01 — 至今",
      "content": ["工作内容"],
      "achievements": ["工作业绩"]
    }
  ],
  "projects": [
    {
      "index": "01",
      "name": "项目名称",
      "role": "项目角色",
      "time": "项目时间",
      "summary": "项目简介",
      "contribution": ["个人贡献"],
      "stack": ["Next.js", "FastAPI"]
    }
  ],
  "agent_demos": [
    {
      "title": "Agent Demo",
      "description": "Demo 描述",
      "tags": ["LangGraph", "RAG"],
      "status": "开发中",
      "demo_url": "https://example.com"
    }
  ],
  "updated_at": "2026-08-27T10:30:00+08:00"
}
```

没有简历记录时返回 `404`。

### 5.2 验证管理员

```http
GET /api/v1/admin/verify
Cookie: myblog_access_token=<JWT>
```

- 管理员：`204`。
- 未登录：`401`。
- 普通用户：`403`。

### 5.3 保存简历

```http
PUT /api/v1/admin/resume
Content-Type: application/json
Cookie: myblog_access_token=<JWT>
```

请求体使用 5.1 响应中的完整简历结构，但不需要 `updated_at`。

响应 `200`：返回保存后的完整简历，并包含新的 `updated_at`。

## 6. 博客接口

### 6.1 博客节点结构

博客使用扁平节点加 `parent_id` 表示树形关系。

节点摘要：

```json
{
  "id": "20cdb879-b259-416f-97ef-ab753b525071",
  "parent_id": null,
  "kind": "folder",
  "name": "前端开发",
  "slug": null,
  "is_published": false,
  "sort_order": 0,
  "updated_at": "2026-08-27T10:30:00+08:00"
}
```

`kind` 取值：

- `folder`：文件夹，没有 slug、正文和发布状态。
- `document`：Markdown 文章，可以设置 slug、正文和发布状态。

节点详情比摘要多出：

```json
{
  "content": "# Markdown 正文",
  "created_at": "2026-08-27T10:00:00+08:00",
  "published_at": "2026-08-27T10:30:00+08:00"
}
```

### 6.2 获取公开博客树

```http
GET /api/v1/blog/tree
```

响应 `200`：节点摘要数组。

```json
[
  {
    "id": "20cdb879-b259-416f-97ef-ab753b525071",
    "parent_id": null,
    "kind": "folder",
    "name": "前端开发",
    "slug": null,
    "is_published": false,
    "sort_order": 0,
    "updated_at": "2026-08-27T10:30:00+08:00"
  },
  {
    "id": "1e2e5bb6-f0df-464a-a50d-c4197616a3b4",
    "parent_id": "20cdb879-b259-416f-97ef-ab753b525071",
    "kind": "document",
    "name": "理解 React 状态管理",
    "slug": "understanding-react-state",
    "is_published": true,
    "sort_order": 0,
    "updated_at": "2026-08-27T10:30:00+08:00"
  }
]
```

只返回已发布文章及这些文章的祖先文件夹，不返回草稿正文。

### 6.3 获取已发布文章

```http
GET /api/v1/blog/posts/{slug}
```

路径参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `slug` | string | 文章地址，例如 `understanding-react-state` |

响应 `200`：博客节点详情。

文章不存在或未发布返回 `404`。

### 6.4 获取管理员博客树

```http
GET /api/v1/admin/blog/tree
Cookie: myblog_access_token=<JWT>
```

响应 `200`：包含文件夹、已发布文章和草稿的节点摘要数组。为了避免一次加载大量正文，本接口不返回 `content`。

### 6.5 获取管理员节点详情

```http
GET /api/v1/admin/blog/nodes/{node_id}
Cookie: myblog_access_token=<JWT>
```

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `node_id` | UUID | 博客节点 ID |

响应 `200`：节点详情，文档节点包含完整 Markdown 正文。

节点不存在返回 `404`。

### 6.6 创建文件夹或文章

```http
POST /api/v1/admin/blog/nodes
Content-Type: application/json
Cookie: myblog_access_token=<JWT>
```

创建根文件夹：

```json
{
  "parent_id": null,
  "kind": "folder",
  "name": "Agent 开发"
}
```

在文件夹中创建文章：

```json
{
  "parent_id": "20cdb879-b259-416f-97ef-ab753b525071",
  "kind": "document",
  "name": "LangGraph 入门"
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `parent_id` | UUID/null | 否 | 父文件夹；null 表示根节点 |
| `kind` | `folder`/`document` | 是 | 节点类型 |
| `name` | string | 是 | 1～160 字符 |

响应 `201`：创建后的节点详情。

文章创建时自动生成类似 `post-a1b2c3d4e5` 的唯一 slug。

可能错误：

- `400`：父节点不是文件夹。
- `404`：父节点不存在。

### 6.7 修改、移动或发布节点

```http
PATCH /api/v1/admin/blog/nodes/{node_id}
Content-Type: application/json
Cookie: myblog_access_token=<JWT>
```

所有字段均可选，只提交需要修改的字段：

```json
{
  "parent_id": "20cdb879-b259-416f-97ef-ab753b525071",
  "name": "LangGraph 实践指南",
  "slug": "langgraph-practical-guide",
  "content": "# LangGraph 实践指南\n\n正文内容",
  "is_published": true,
  "sort_order": 10
}
```

| 字段 | 类型 | 限制与说明 |
| --- | --- | --- |
| `parent_id` | UUID/null | 移动到指定文件夹；null 移动到根目录 |
| `name` | string | 1～160 字符 |
| `slug` | string | 仅文档可用，只能包含小写字母、数字和中划线 |
| `content` | string | 仅文档可用，最大 2,000,000 字符 |
| `is_published` | boolean | 仅文档可用；true 发布，false 转为草稿 |
| `sort_order` | integer | 数值越小越靠前 |

响应 `200`：修改后的节点详情。

可能错误：

- `400`：slug 格式错误、文件夹写入正文、移动到文档中或形成循环树。
- `404`：节点或父节点不存在。
- `409`：slug 已被其他文章使用。

### 6.8 删除节点

```http
DELETE /api/v1/admin/blog/nodes/{node_id}
Cookie: myblog_access_token=<JWT>
```

响应 `204`，无响应体。

删除文件夹会通过数据库外键级联删除其中的全部子文件夹和文章，此操作不可恢复。

## 7. 图片上传接口

图片接口由 Next.js 提供，接收到浏览器 Cookie 后，会向 FastAPI `/api/v1/admin/verify` 验证管理员身份。

支持格式：

```text
PNG、JPEG、WebP、GIF、BMP、TIFF
```

最大文件大小：`10MB`。

### 7.1 获取预签名地址

```http
POST /api/cdn/presign
Content-Type: application/json
Cookie: myblog_access_token=<JWT>
```

请求体：

```json
{
  "suffix": "png",
  "width": 1200,
  "height": 800,
  "biz": "blog",
  "scene": "content"
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `suffix` | string | 是 | `png`、`jpeg`、`webp`、`gif`、`bmp`、`tif` 或 `tiff` |
| `width` | integer | 是 | 正整数 |
| `height` | integer | 是 | 正整数 |
| `biz` | string | 否 | 默认 `appraiser` |
| `scene` | string | 否 | 默认 `coin` |

响应 `200`：

```json
{
  "preUrl": "https://cdn-upload.example.com/presigned-url",
  "visitUrl": "https://cdn.example.com/image.png"
}
```

客户端随后使用 `PUT preUrl` 上传原始文件。

### 7.2 直接上传图片

```http
POST /api/cdn/upload
Content-Type: multipart/form-data
Cookie: myblog_access_token=<JWT>
```

FormData 参数：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `file` | File | 是 | 图片文件，最大 10MB |
| `width` | number/string | 是 | 图片像素宽度 |
| `height` | number/string | 是 | 图片像素高度 |
| `biz` | string | 否 | 博客使用 `blog` |
| `scene` | string | 否 | 博客使用 `content` |

JavaScript 示例：

```ts
const formData = new FormData();
formData.set("file", file);
formData.set("width", String(width));
formData.set("height", String(height));
formData.set("biz", "blog");
formData.set("scene", "content");

const response = await fetch("/api/cdn/upload", {
  method: "POST",
  credentials: "include",
  body: formData,
});
```

响应 `200`：

```json
{
  "url": "https://cdn.example.com/image.png",
  "width": 1200,
  "height": 800
}
```

粘贴图片到博客编辑器后，前端会把响应地址转换为 Markdown：

```md
![image.png](https://cdn.example.com/image.png)
```

可能错误：

- `400`：未选择文件、格式不支持、尺寸无效或超过 10MB。
- `401`：未登录。
- `403`：不是管理员。
- `502`：无法连接 CDN、获取预签名地址失败或上传失败。

## 8. 调用示例

### 8.1 curl 登录并保存 Cookie

`captcha_verify_param` 必须来自浏览器中的阿里云验证码回调，以下只展示请求形式：

```bash
curl -i \
  -c cookies.txt \
  -X POST http://localhost:8000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "user@example.com",
    "password": "Password123",
    "captcha_verify_param": "CAPTCHA_VERIFY_PARAM"
  }'
```

### 8.2 使用 Cookie 获取当前用户

```bash
curl -b cookies.txt http://localhost:8000/api/v1/auth/me
```

### 8.3 管理员创建文章

```bash
curl -b cookies.txt \
  -X POST http://localhost:8000/api/v1/admin/blog/nodes \
  -H 'Content-Type: application/json' \
  -d '{
    "parent_id": null,
    "kind": "document",
    "name": "我的第一篇文章"
  }'
```

## 9. 安全注意事项

- 不要在前端、接口文档或 Git 中保存 JWT、AccessKey Secret、邮件密码和 CDN 凭据。
- 管理员接口必须由后端检查 `users.is_admin`，隐藏前端按钮不能代替权限校验。
- `captcha_verify_param` 是一次性的，必须从前端原样提交到后端。
- Markdown 渲染默认不执行文章中的原始 HTML。
- 删除博客文件夹会级联删除全部子节点，调用前应再次确认。
- 线上 Cookie 使用 `Secure`，接口必须通过 HTTPS 调用。

## 10. 文档维护

接口代码位置：

```text
apps/api/src/app/api/v1/
apps/api/src/app/schemas/
apps/web/src/app/api/
```

FastAPI 接口发生变化后，可以通过以下地址核对实时 OpenAPI 定义：

```text
http://localhost:8000/openapi.json
http://localhost:8000/docs
```
