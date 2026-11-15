# 素材来源

整理日期：2026-10-21。以下素材用于 FRAMEOUT 交互原型的样例镜头，均已通过实际 HTTP 下载与文件格式检查，未使用 JIEJOE 网站的照片或字体文件。

## 摄影图片

| 本地文件 | 内容 | 来源地址 | 文件大小 |
| --- | --- | --- | --- |
| `still-ocean.webp` | 蓝调近水面浪花，1200 × 800 | https://images.unsplash.com/photo-1518837695005-2083093ee35b?fm=webp&fit=crop&w=1200&q=82 | 74,390 字节 |
| `still-city.webp` | 雨后城市街道，1200 × 1501 | https://images.unsplash.com/photo-1519501025264-65ba15a82390?fm=webp&fit=crop&w=1200&q=82 | 340,632 字节 |

图片来源为 Unsplash 图像 CDN。摄影师身份未从本次直接文件响应中可靠取得，因此没有推测或编造作者署名。平台授权说明：https://unsplash.com/license 。

## 展示字体

- 本地文件：`anton-latin.woff2`，12,004 字节，WOFF2 格式。
- 字体：Anton，正常字形，字重 400，Latin 子集。
- 官方样式入口：https://fonts.googleapis.com/css2?family=Anton&display=swap 。
- 本次下载地址：https://fonts.gstatic.com/s/anton/v27/1Ptgg87LROyAm3Kz-C8CSKlv.woff2 。
- 版权：Copyright 2020 The Anton Project Authors，项目地址：https://github.com/googlefonts/AntonFont.git 。
- 授权：SIL Open Font License 1.1，完整文本已保存为 `ANTON-LICENSE.txt`。
- 授权原文：https://raw.githubusercontent.com/google/fonts/main/ofl/anton/OFL.txt 。

### 中文标题字体

- 本地文件：`huangyou-display.woff2`，68,632 字节，WOFF2 格式。只包含介绍页用到的 294 个字符。
- 字体：站酷庆科黄油体（ZCOOL QingKe HuangYou），字重 400。
- 原文件：`ZCOOLQingKeHuangYou-Regular.ttf`（8,328,684 字节），来自 https://github.com/google/fonts/tree/main/ofl/zcoolqingkehuangyou ，没有放进仓库。
- 生成方式：`node apps/web/scripts/subset-display-font.mjs <原文件路径>`。介绍页的文案改了之后要重新生成，否则新出现的字会落回系统字体。
- 版权：Copyright 2018 The ZCOOL QingKe HuangYou Project Authors，项目地址：https://www.github.com/googlefonts/zcool-qingke-huangyou 。
- 授权：SIL Open Font License 1.1，完整文本已保存为 `HUANGYOU-LICENSE.txt`。

```css
@font-face {
  font-family: "Anton";
  src: url("./anton-latin.woff2") format("woff2");
  font-style: normal;
  font-weight: 400;
  font-display: swap;
}
```
