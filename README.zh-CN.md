# Aniflow

[English](./README.md)

Aniflow 是面向 OpenList 下载流程的本地蜜柑（Mikan）RSS 动画订阅与整理工具。

它会轮询 Mikan RSS，解析字幕组、分辨率、字幕语言、来源、编码等元数据，按订阅规则筛选，并将匹配的种子 / 磁力链接提交到 OpenList 的 115 离线下载。完成后通过 OpenList 文件系统 API 扫描与整理，并重命名为 Plex / Jellyfin 风格的媒体库路径。

## 技术栈

- Next.js App Router、TypeScript、Tailwind CSS
- 本地 shadcn/ui 风格组件
- SQLite（`better-sqlite3` + Drizzle ORM，`src/lib/db/schema.ts`）
- RSS XML 解析（`fast-xml-parser`）
- OpenList 115 离线下载：`/api/fs/add_offline_download`
- 整理相关：OpenList `/api/fs/list`、`/api/fs/rename`、`/api/fs/move`

## 快速开始

```bash
cp .env.example .env
npm install
npm run dev
```

浏览器打开 <http://localhost:3000>。

后台 Worker：

```bash
npm run worker
```

### 访问控制（可选）

在 `.env` 中设置 `AUTH_PASSWORD` 后，Web UI 与 API 需要登录。为空时仅允许本机回环地址（如 `localhost`、`127.0.0.1`）。局域网、反向代理或公网访问必须设置密码。

```bash
AUTH_PASSWORD=your-strong-password
# 可选：自定义 session 签名密钥
AUTH_SECRET=
```

- 浏览器：`/login` 密码表单，session cookie 有效期 7 天
- API：`Authorization: Bearer <AUTH_PASSWORD>` 或 HTTP Basic（`任意用户名:AUTH_PASSWORD`）
- 独立 worker 进程不走该密码；若对外暴露，请用主机网络或反向代理保护

## OpenList 相关设置

在应用的 **后台设置** 中配置 OpenList API、115 访问方式、代理、命名模板、TMDB 与 worker 轮询间隔。运行时集成配置保存在 SQLite 中，不写在 `.env`。

下载目录是**全局 incoming 根路径**，例如 `/115/Anime/_incoming`。新建订阅默认会在其下使用**按订阅分子目录**（`/115/Anime/_incoming/{订阅名}`），避免不同番剧的离线任务挤在同一文件夹。该路径是挂载了 115 存储的 OpenList 远程路径，不是本机路径，也不是 WebDAV。应用会将 RSS 中的种子 / 磁力提交到 `/api/fs/add_offline_download`（使用对应订阅路径），再用 OpenList fs API 扫描、重命名、创建目标目录并移动完成文件。

`115 Cloud` 与 `115 Open` 是不同的 OpenList 离线后端，请选择与挂载在 `/115` 的驱动一致的一项。点击 115 检查按钮会先把下载目录同步到 OpenList 对应后端配置，再读取可用工具列表。

RSS 抓取仅在 **后台设置** 中开启代理开关后才会使用配置的代理。代理默认值为 `http://127.0.0.1:7890`，未开启时不会使用。

## 订阅流程

在 **订阅** 页先解析 HTTPS 的 `mikanani.me/RSS/` 链接。其它 RSS 源与种子下载站会被服务端拒绝。解析后从下拉框选择识别到的标题、字幕组、分辨率、字幕语言并创建订阅；选中的组 / 分辨率 / 语言会作为该订阅的允许规则保存。

## Docker

```bash
cp .env.example .env
docker compose up --build
```

Compose 会启动共享 `./data/aniflow.sqlite` 的 `web` 与 `worker` 服务。Web 端口默认绑定 `127.0.0.1`。未设置 `AUTH_PASSWORD` 时请保持该绑定；需要远程访问时请使用带鉴权的反向代理，或显式修改端口绑定。

## 命名规则

最终媒体文件名不含发布标签；标签保留在 SQLite 中，并在集数管理界面展示。

推荐路径形态：

```text
下载目录:     /115/Anime/_incoming
媒体库根目录: /115/Anime
季度路径模板: {title}/Season {season_pad}
文件名模板:   {title} - S{season_pad}E{episode_pad}.{ext}
```

默认最终路径：

```text
/115/Anime/Show Name/Season 01/Show Name - S01E01.mkv
```

默认模板：

```text
季度路径: {title}/Season {season_pad}
文件名:   {title} - S{season_pad}E{episode_pad}.{ext}
```

可用变量：`{title}`、`{season}`、`{season_pad}`、`{episode}`、`{episode_pad}`、`{ext}`。

## 说明

- TMDB 为可选，仅用于展示增强。
- 无法解析集数的条目会暂存，供手动处理。
- 规则可允许 / 拦截字幕组、分辨率、字幕语言，以及包含 / 排除关键词。
