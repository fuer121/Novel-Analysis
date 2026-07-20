import type { IndexCoverage, ScopePreview as ScopePreviewValue } from "./types.js";

const coverageItems: Array<[keyof IndexCoverage, string]> = [["total", "请求"], ["fresh", "已新鲜"], ["missing", "缺失"], ["failed", "失败"], ["stale", "过期"]];

export function CoverageStrip({ value }: { value: IndexCoverage }) {
  return <dl className="scope-strip">{coverageItems.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{value[key]}</dd></div>)}</dl>;
}

export function PreviewStrip({ value }: { value: ScopePreviewValue }) {
  return <dl className="scope-strip preview-strip"><div><dt>请求</dt><dd>{value.total}</dd></div><div><dt>将执行</dt><dd>{value.executable}</dd></div><div><dt>将跳过</dt><dd>{value.skipped}</dd></div><div><dt>已新鲜</dt><dd>{value.fresh}</dd></div><div><dt>缺失</dt><dd>{value.missing}</dd></div><div><dt>失败</dt><dd>{value.failed}</dd></div><div><dt>过期</dt><dd>{value.stale}</dd></div></dl>;
}
