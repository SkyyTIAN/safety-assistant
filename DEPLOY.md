# 飞书导出功能 - 部署说明

## 概述

本功能需要部署一个 Cloudflare Worker 作为后端代理，将网页内容安全地发送到飞书 API 创建文档。

## 部署步骤

### 1. 准备飞书应用

1. 前往 [飞书开放平台](https://open.feishu.cn/app) 
2. 创建企业自建应用（或使用现有应用）
3. 获取以下信息：
   - App ID: `cli_xxx`
   - App Secret: 在应用凭证中获取

4. 配置应用权限（需要开通以下权限）：
   - `docx:document:create` - 创建云文档
   - `docx:document:read` - 读取文档内容

5. 发布应用并添加到你所在的飞书工作区

### 2. 部署 Cloudflare Worker

1. 注册 [Cloudflare](https://dash.cloudflare.com/) 账号
2. 创建新的 Worker

3. 将 `worker.js` 的内容粘贴到 Worker 编辑器中

4. 在 Worker 设置中，添加环境变量：
   - `FEISHU_APP_ID` = 你的飞书 App ID
   - `FEISHU_APP_SECRET` = 你的飞书 App Secret

5. 部署 Worker，获取 Worker URL，例如：
   `https://feishu-export.your-subdomain.workers.dev`

### 3. 配置网页

编辑 `index.html`，在文件顶部的配置区域填入 Worker URL：

```javascript
var FEISHU_WORKER_URL = 'https://feishu-export.your-subdomain.workers.dev';
```

### 4. 更新 GitHub Pages

将修改后的 `index.html` 推送到 GitHub 仓库即可。

## 工作原理

```
用户点击"导出到飞书"
    ↓
网页 POST {title, content} 到 Cloudflare Worker
    ↓
Worker 使用 App Credentials 获取 tenant_access_token
    ↓
Worker 调用飞书 API 创建文档
    ↓
返回 document_id，网页显示链接
```

## 注意事项

1. **安全**：App Secret 只应存在于 Cloudflare Worker 环境变量中，绝不要暴露在前端代码
2. **跨域**：Worker 已配置 CORS，允许来自任何源的请求
3. **限制**：飞书 API 有调用频率限制，高频使用请申请更高配额

## 故障排除

### "导出失败: 未配置飞书应用凭证"
- 检查 Worker 是否正确设置了 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET`

### "导出失败: 获取 token 失败"
- 确认飞书应用的 App ID 和 App Secret 正确
- 确认应用已发布并添加到工作区

### "导出失败: 创建文档失败"
- 确认应用已开通 `docx:document:create` 权限
- 确认应用已发布新版本
