# Open-Meteo 天气接入

Jotkeep 通过独立的原生 macOS 辅助应用读取当前位置和中文地名，再请求 Open-Meteo。Electron
主进程负责缓存，Renderer 只消费结构化天气状态，不持有 API Key 或定位权限。

## 本地开发

```bash
npm run build:weather
npm run dev
```

辅助应用产物位于 `native/build/WeatherBridge.app`。它使用 ad hoc 签名即可运行，不要求 Apple
Developer Program、WeatherKit entitlement 或 Provisioning Profile。

首次打开 Today 时，系统会以“Jotkeep Weather”申请定位权限。定位用途说明位于
`native/WeatherBridge/Info.plist`。拒绝授权时，日历继续可用，天气区域展示明确的不可用状态。

## 数据与缓存

- 数据源为 `https://api.open-meteo.com/v1/forecast`。
- 请求当前温度、体感温度、湿度、降水、WMO 天气代码、云量、风速和当日最高/最低温。
- WMO 天气代码在原生辅助进程中映射为 Jotkeep 的天气场景。
- Electron 主进程缓存文件为 `userData/weather-cache.v1.json`，有效期 20 分钟。
- 网络或定位失败时优先展示最后一次缓存，并标记为“缓存”。

## 使用边界

Open-Meteo 免费接口仅适用于非商业用途，并要求 CC BY 4.0 署名。Today 卡片会展示可点击的
“Open-Meteo”数据来源。请求会向 Open-Meteo 发送经纬度；其服务条款说明服务器日志可能包含坐标，
并在 90 天后删除。

- [Open-Meteo API](https://open-meteo.com/en/docs)
- [免费接口条款](https://open-meteo.com/en/terms)
- [署名要求](https://open-meteo.com/en/license)

## 动画边界

Open-Meteo 只提供天气数据，不提供天气动画。Jotkeep 使用自己的 WebGL2 程序化渲染：体积噪声
云层、多景深降水、昼夜光照、湿地反射、雪、雾和雷暴闪光。
