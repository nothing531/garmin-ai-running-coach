# AI Running Coach · 佳明全自动私人跑步教练（GitHub Actions + Pages 版）

无需 24 小时开机，也无需租用云服务器。每天早上 06:30（北京时间）在 GitHub 云端自动运行 1 分钟：
1. 拉取 **Garmin Connect（支持 `.cn` 中国区与 `.com` 国际区）** 最近 8–12 周运动记录、`.FIT` 原始遥测、昨夜睡眠、HRV、静息心率与身体电量；
2. 免费拉取 **Open-Meteo** 当日及未来 7 天训练时段天气（气温、湿度、露点、风速、海拔与 AQI 空气质量）；
3. 基于 **Banister PMC (CTL/ATL/TSB/ACWR)**、**80/20 极化训练**、**Jack Daniels 体系** 与 **晨间红绿灯自适应规则**，调用大模型生成分化周期计划；
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
   * **大模型 API（不填则自动启用内置科学引擎）**：
     * `LLM_API_KEY`：你的 DeepSeek / OpenAI / 通义千问 / Claude Key
     * `LLM_BASE_URL`：例如 `https://api.deepseek.com/v1`（按需修改）
     * `LLM_MODEL`：例如 `deepseek-chat`
   * **手机推送通知（按需任选其一）**：
     * `FEISHU_WEBHOOK` / `WECOM_WEBHOOK` / `DINGTALK_WEBHOOK` / `SERVERCHAN_KEY` / `BARK_URL`
5. **立即手动验证一次**：
   * 进入仓库 `Actions -> Daily AI Running Coach -> Run workflow`；
   * 约 1 分钟后即可在手机收到推送，并打开 `https://你的用户名.github.io/garmin-ai-running-coach/` 查看专属驾驶舱。

---

## 四、无 LLM API 的协同模式：Antigravity 定制周期 + 手机端每日看数与安全微调

如果你不打算接入 `LLM_API_KEY`，推荐使用以下零成本工作流：
1. **定期打开电脑与 Antigravity 对话**：结合你的主观体感、工作安排与 Garmin 历史数据，直接把定制好的多周/全周期课表与教练备忘写入 `config/custom-plan.json`；
2. **推送即自动更新网站**：将 `config/custom-plan.json` 或 `config/runner.config.json` 推送到 `main` 分支后，GitHub Actions 会立即重跑并刷新 GitHub Pages 看板；
3. **每日 06:30 自动生理/环境微调**：云端每天优先按 `config/custom-plan.json` 中对应日期的定制课表渲染，并自动叠加上 Garmin 晨间红绿灯护栏（HRV/睡眠异常时自动降级/熔断）以及当日气温、露点、海拔配速修正。
