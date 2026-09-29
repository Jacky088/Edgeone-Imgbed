# CNB 图床

轻量级、无服务器的图片托管服务。基于腾讯云 **EdgeOne Pages** 与 **CNB 对象存储**构建，
零成本部署、全球 CDN 加速，支持多存储桶（S3 兼容）与在线设置同步。

> ⚠️ **CNB 仓库单张图片最大支持 5MB**；其他 S3 存储桶按各自平台的实际限制。

## 页面预览

![CNB 图床上传页预览（日间 / 夜间）](./screenshot-preview-pc-imgbed.png)

------------------------------------------------------------------------

## 🚀 功能特性

-   **上传**：拖拽 / 点击 / Ctrl+V 粘贴 / 整个文件夹递归上传，批量多选；兼容 PicGo 客户端
-   **压缩**：浏览器端 WebP 压缩（质量、长边可调）；可选「原始」模式；GIF 自动跳过以保留动画
-   **多存储桶**：默认 CNB，可添加任意 S3 兼容桶（R2 / OSS / COS / MinIO），保存前自动连接检测；
    顶栏下拉切换本机上传目标，设置页可设站点默认；每桶可设空间配额（GB，可选），
    累计用量超 80% 橙色、超 90% 红色，超出配额拒绝上传
-   **缩略图**：自动生成缩略图链接（可关闭）
-   **命名**：时间戳（默认，防同名覆盖）/ 保留原名 / 随机 ID；中文文件名完整支持
-   **链接**：一键复制直链 / Markdown / HTML / BBCode（单张与批量），结果卡自带二维码
-   **图片列表**：搜索、排序、筛选、多选批量操作、JSON 备份导入导出、键盘快捷键、大图预览
-   **两级删除**：删除进回收站（30 天可恢复）；彻底删除 / 到期清理联动删除源文件，
    失败由孤儿扫描兜底
-   **孤儿清理**：独立页面，对比平台资产清单与上传记录，卡片式预览并一键清理（仅 CNB）
-   **存储实测**：侧栏存储卡显示各桶累计用量与配额，CNB 接官方接口实测
-   **设置云端同步**：上传偏好与主题保存在服务端，任何设备登录即得到一致体验
-   **安全**：访问密码保护（可选）、HMAC 签名令牌、「记住我 7 天」、接口限流

------------------------------------------------------------------------

## 🧰 技术栈

- **前端**: Vue 3 + TypeScript + Vite + TailwindCSS
- **后端**: EdgeOne Pages Node Functions（Express）+ Pages Functions（KV 记录）
- **存储**: CNB 对象存储（内置默认）+ 任意 S3 兼容桶（SigV4 签名，零依赖实现）
- **记录**: EdgeOne KV（全量索引 + 超限自动分片 + 服务端分页）

------------------------------------------------------------------------

## 📦 快速开始

``` bash
pnpm install          # 安装依赖
pnpm dev              # 前端开发服务器（http://localhost:5173）
pnpm dev:api          # 本地 API + 边缘函数模拟器 + S3 Mock（配合 pnpm dev 联调）
```

### 🧪 质量检查

``` bash
pnpm lint            # ESLint
pnpm type-check      # 前端 vue-tsc
pnpm type-check:node # 后端 Node Functions tsc
pnpm test            # Vitest 单元测试（含 SigV4 官方向量、KV 集成逻辑）
```

------------------------------------------------------------------------

### 一键部署

[![使用国内版EdgeOne Pages 部署](https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg)](https://console.cloud.tencent.com/edgeone/pages/new?repository-url=https%3A%2F%2Fgithub.com%2FJacky088%2FEdgeone-Imgbed%2F)（国内版）

[![使用国际版EdgeOne Pages 部署](https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg)](https://edgeone.ai/pages/new?repository-url=https%3A%2F%2Fgithub.com%2FJacky088%2FEdgeone-Imgbed%2F)（国际版）

### 🔧 环境变量配置

在 EdgeOne 控制台中为项目添加以下变量：

    BASE_IMG_URL=你的图床域名（需以 / 结尾，例如 https://img.example.com/）
    SLUG_IMG=CNB 对象存储仓库名（格式：用户名/仓库名）
    TOKEN_IMG=CNB 仓库访问令牌（权限见「获取 CNB TOKEN」一节）
    SITE_PASSWORD=访问密码（可选）
    AUTH_SECRET=令牌与内部接口签名密钥（使用多存储桶功能时必填，建议随机长字符串；
        修改后所有登录令牌立即失效，口令泄露时可用此方式强制全端下线）
    PICGO_TOKEN=PicGo 上传接口令牌（可选，设置后启用 /api/upload/picgo）
    MAX_UPLOAD_MB=单文件大小上限（可选，默认 25，最大 100；CNB 仓库单图上限 5MB）
    UPLOAD_RATE_LIMIT=上传限流（可选，次/分钟/IP，默认 120）

### KV 上传记录配置

1.  在 EdgeOne 控制台进入"存储 - KV"并开通。
2.  创建命名空间（例如 `cnb-imgbed-records`）。
3.  绑定到项目，变量名必须为 `IMG_RECORDS_KV`，重新部署。

删除语义：列表删除仅移入回收站（30 天），不删源文件；彻底删除与到期清理由服务端
联动删除源文件（尽力而为），个别失败仅留孤儿文件，可在「孤儿清理」页对账清理。

### 📷 PicGo 客户端配置（可选）

设置环境变量 `PICGO_TOKEN` 并重新部署后，在 PicGo 使用"自定义 Web 图床"插件：

    API 地址：https://你的域名/api/upload/picgo
    请求方式：POST
    自定义请求头：Authorization: Basic base64("api:你的PICGO_TOKEN")
    JSON 路径：result[0]

------------------------------------------------------------------------

## 🔑 获取 CNB TOKEN

1.  登录 [CNB官网](https://cnb.cool/)，右上角头像进入个人设置
2.  选择 **访问令牌**
3.  找到你的图床仓库（需先创建且设置为公开）
4.  按下表勾选权限后生成并复制 Token，用于环境变量 `TOKEN_IMG` 配置

### 访问令牌权限清单

| 权限 | 说明 | 依赖的功能 |
| --- | --- | --- |
| `repo-code:rw` | 仓库代码读写 | 上传图片（基础必需） |
| `repo-manage:rw` | 仓库管理读写（**包含只读能力**） | 孤儿扫描与总量统计（最低 `:r`）；删除源文件（需 `:rw`） |
| `group-resource:r` | 组织资源只读 | 侧栏存储用量与配额实测（组织级接口，服务端自动调用） |

> ⚠️ 「资源范围」必须选 **全部** 或 **指定组织**：选「指定仓库」时 `group-resource:r`
> 无法勾选，存储卡将显示 403。仅配置上传时 `repo-code:rw` 即可，其余权限缺失时
> 对应功能显示明确提示，不影响上传。

------------------------------------------------------------------------

## 🤝 致谢

感谢项目 [**WhY15w 的 hw‑img‑host**](https://github.com/WhY15w/hw-img-host) 提供灵感与基础实现。

------------------------------------------------------------------------

## 📄 License

本项目遵循 MIT License。

---

如果这个项目对你有帮助，欢迎在 GitHub 上点一个 ⭐ 支持作者！
