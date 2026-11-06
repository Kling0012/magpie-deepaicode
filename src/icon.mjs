// 原创图标：深蓝底 + 一道“波形/溪流”+ 一颗星点。
// 用 data URI 内联，满足 magpie 的 magpie.icon（≤1MB，SVG 可以）。

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#5B8DEF"/><stop offset="1" stop-color="#2A5FCC"/>
</linearGradient></defs>
<rect x="2" y="2" width="60" height="60" rx="14" fill="url(#g)"/>
<path d="M12 40c6-18 12-18 18-8s12 10 22-14" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round"/>
<circle cx="46" cy="20" r="4" fill="#ffffff" opacity="0.92"/>
</svg>`;

const bytes = Buffer.from(SVG, "utf8");
export const ICON_DATA_URI = `data:image/svg+xml;base64,${bytes.toString("base64")}`;
export { SVG as ICON_SVG };
