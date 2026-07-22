import { Download } from "lucide-react";

import { buildAnalysisExport, downloadAnalysisExport, tableViewsFromJson } from "./analysis-export.js";

function renderCell(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
export function AnalysisResultView({ title, result }: { title: string; result: unknown }) {
  if (result === null || result === undefined) return <p className="analysis-empty">任务完成后，结果会显示在这里</p>;
  const tables = tableViewsFromJson(result);
  const downloadable = buildAnalysisExport(title, result);
  return <section className="analysis-result" aria-label="分析结果">
    <div className="analysis-section-heading"><h3>分析结果</h3><button className="secondary-button icon-command" type="button" onClick={() => downloadAnalysisExport(downloadable)}><Download size={16} />导出 {downloadable.filename.split(".").at(-1)?.toUpperCase()}</button></div>
    {tables.length ? tables.map((table) => <div className="analysis-result-table" key={table.key}>
      <h4>{table.title}</h4><div className="data-table-wrap"><table className="data-table analysis-table"><thead><tr>{table.columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{table.rows.map((row, index) => <tr key={index}>{table.columns.map((column) => <td key={column.key}>{renderCell(row[column.key])}</td>)}</tr>)}</tbody></table></div>
    </div>) : typeof result === "string" ? <article className="analysis-markdown">{result}</article> : <pre className="analysis-json">{JSON.stringify(result, null, 2)}</pre>}
  </section>;
}
