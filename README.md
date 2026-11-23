# AI Running Coach · 佳明全自动私人跑步教练（GitHub Actions + Pages 版）

无需 24 小时开机，也无需租用云服务器。每天早上 06:30（北京时间）在 GitHub 云端自动运行 1 分钟：
1. 拉取 **Garmin Connect（支持 `.cn` 中国区与 `.com` 国际区）** 最近 8–12 周运动记录、`.FIT` 原始遥测、昨夜睡眠、HRV、静息心率与身体电量；
2. 免费拉取 **Open-Meteo** 当日及未来 7 天训练时段天气（气温、湿度、露点、风速、海拔与 AQI 空气质量）；
3. 读取既定课表，按训练负荷、体感打卡、晨间恢复和天气规则校验并调整当天安排；
4. 渲染单文件交互式暗色看板 `dist/index.html` 发布到 **GitHub Pages**，并自动推送到 **飞书 / 企业微信 / 钉钉 / 微信 Server酱 / iOS Bark**。

---

## 一、本地快速预览（无需任何 Key）

```bash
npm run demo
```
执行后会在 `dist/index.html` 生成完整看板，用浏览器直接打开即可预览效果。

---

## 二、本地测试你的 `.cn` 账号连通性

1. 复制 `.env.example` 为 `.env`；
2. 如果你已在 https://connect.garmin.cn/app/settings/personalApiToken 生成了 Key，填入 `GARMIN_PERSONAL_API_KEY`；
3. 运行诊断命令：
   ```bash
   npm run check
   ```
   * 若 `.cn` 官方 Personal API 正常返回运动记录，直接用官方 Key 即可；
   * 若 `.cn` 官方 Personal API 仍报 `HTTP 526` 服务端故障，在 `.env` 临时填入 `GARMIN_EMAIL` 和 `GARMIN_PASSWORD` 再跑一次 `npm run check`，脚本会自动登录并打印出一段 `GARMIN_SESSION_JSON`，后续云端即可免密码直接复用。

---

## 三、部署到 GitHub（0 成本全自动每日运行）


1. **编辑个人档案**：修改 `config/runner.config.json` 中的城市、经纬度、目标赛事、日期与心率/阈值基线。
2. **创建 GitHub 私有仓库（Private Repo）并推送代码**：
   ```bash
   git init
   git add .
   git commit -m "init: garmin ai running coach"
   git branch -M main
   git remote add origin https://github.com/你的用户名/garmin-ai-running-coach.git
   git push -u origin main
   ```
3. **开启 GitHub Pages**：
   * 进入仓库 `Settings -> Pages -> Build and deployment`；
   * 将 **Source** 改为 **`GitHub Actions`**。
4. **配置 GitHub Secrets**（`Settings -> Secrets and variables -> Actions -> New repository secret`）：
   * **Garmin 凭证（二选一，或同时配置作自动降级）**：
     * `GARMIN_REGION`：`cn`
     * `GARMIN_PERSONAL_API_KEY`：你在 `connect.garmin.cn` 生成的 Personal API Key
     * （兜底可选）`GARMIN_SESSION_JSON`：本地 `npm run check` 导出的 Token JSON（或 `GARMIN_EMAIL` / `GARMIN_PASSWORD`）
   * **手机推送通知（按需任选其一）**：
     * `FEISHU_WEBHOOK` / `WECOM_WEBHOOK` / `DINGTALK_WEBHOOK` / `SERVERCHAN_KEY` / `BARK_URL`
5. **立即手动验证一次**：
   * 进入仓库 `Actions -> Daily AI Running Coach -> Run workflow`；
   * 约 1 分钟后即可在手机收到推送，并打开 `https://你的用户名.github.io/garmin-ai-running-coach/` 查看专属驾驶舱。

---

## 四、定制周期课表与每日更新

1. 结合体感、工作安排和 Garmin 历史数据定期复盘，将更新后的课表与教练备忘写入 `config/custom-plan.json`。
2. 本机看板可由本地 AI / 定时任务刷新。使用 GitHub Pages 部署时，可由 GitHub Actions 定期执行，或在提交课表变更后触发更新。
3. 每次刷新优先采用当日定制课表，并按晨间恢复、主观打卡与当日天气规则校验和调整。缺少定制课表的日期使用项目内置训练规则。
4. **Windows / Mac、线上网站与 Garmin Connect 多端同步规则（必做，详见 `AGENTS.md`）**：
   * **单一事实来源 & 开聊先拉取**：将独立部署服务器 `huawei-sg:/opt/garmin-coach` 视为 Windows、Mac 与手机网页端的单一事实来源。在任意电脑开启新会话分析训练或修改计划前，务必先拉取/核对服务器最新的 `data/private/checkins.json`、`config/custom-plan.json`、`config/runner.config.json` 与 `data/private/telemetry-cache.json`，切勿基于旧设备本地缓存做决策。
   * **每日反馈持久化追踪**：所有每日主观打卡、伤病状态、鞋具/补给备注、力量重量/RIR、分段体感与日记均按日期结构化保存在 `data/private/checkins.json`（保留最近 180 天，引擎每次运行都会自动读取以追踪 48–72h 疲劳、持续伤病解除状态、14 天完成度与同一力量动作的连续 RIR 进展）。
   * **线上网站同步（独立服务器部署）**：每次在本地写入/更新主观打卡（`data/private/checkins.json`）、拉取新 Garmin 遥测（`data/private/telemetry-cache.json`）或调整计划/配置（`config/runner.config.json`、`config/custom-plan.json`）后，**必须同步写入线上网站服务器**（默认路径 `/opt/garmin-coach`，切勿只刷新本地 `dist/`）。同步 `checkins.json` 前应先检查远端是否有手机端新提交的打卡记录，按日期合并后再上传，避免覆盖网页端刚提交的记录；上传后在服务器 `/opt/garmin-coach` 执行 `node src/index.js --render-only`（或 `node scripts/refresh-from-codex.mjs`）刷新服务端 `data/private/dashboard-payload.json` 与 Nginx 目录 `PUBLISH_DIR`（如 `/var/www/garmin-coach`）。
   * **Garmin Connect 日历课表同步（推荐在服务器执行）**：每次出新计划或调整既有计划（修改 `config/custom-plan.json`、心率/配速目标或触发减量/调休）后，**必须同步更新 Garmin Connect 官网日历课表**，自动推送新版结构化课表并替换同日旧 `[AI] MM-DD` 排期（改为休息日时会自动清理当天旧跑步课）。
     * **为什么建议由服务器推送**：本机直连 `@likenttt/garmin-connect` 依赖的 `thegarth.s3.amazonaws.com` 在国内网络环境下容易解析失败或报 `ECONNREFUSED 127.0.0.1:443`；而部署服务器（SSH 别名 `huawei-sg`）可同时连通该域名与 `garmin.cn`。
     * **必加 IPv4 参数（避坑）**：服务器跨境访问 `connectapi.garmin.cn` / `sso.garmin.cn` 时，Node 默认的 Happy Eyeballs（IPv4/IPv6 双栈自动探测）在无 IPv6 路由且 IPv4 握手超过 250ms 时会报 `ETIMEDOUT` + `ENETUNREACH`。**执行同步务必加上 `--no-network-family-autoselection --dns-result-order=ipv4first`**。

### 标准三端同步命令速查（修改课表 / 打卡后按序执行）

```bash
# 1. 先检查远端 checkins.json，确认无手机端新增打卡（若有请先按日期合并）
ssh huawei-sg 'cat /opt/garmin-coach/data/private/checkins.json'

# 2. 本地校验渲染、跑单测并 dry-run 预览即将推送的手表课表
node src/index.js --render-only
npm test
node scripts/sync-workouts.js --days 5 --dry-run

# 3. 上传更新后的配置/课表/打卡到服务器（按实际改动文件上传，私密文件保持 600 权限）
scp config/custom-plan.json huawei-sg:/opt/garmin-coach/config/custom-plan.json
scp data/private/checkins.json huawei-sg:/opt/garmin-coach/data/private/checkins.json
# 如修改了 runner.config.json，一并上传：
# scp config/runner.config.json huawei-sg:/opt/garmin-coach/config/runner.config.json

# 4. 在服务器重渲染线上看板，并以 IPv4 优先模式推送未来 5 天课表到 Garmin Connect
ssh huawei-sg 'chmod 600 /opt/garmin-coach/data/private/checkins.json \
  && cd /opt/garmin-coach \
  && node src/index.js --render-only \
  && node --no-network-family-autoselection --dns-result-order=ipv4first scripts/sync-workouts.js --days 5'
```

> 仅需推送单日课表时，将 `--days 5` 替换为 `--date YYYY-MM-DD`。推送完成后，在手机端 **Garmin Connect App** 同步一次手表即可生效。
