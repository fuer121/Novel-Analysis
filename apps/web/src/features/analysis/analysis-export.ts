export type AnalysisTable = {
  key: string;
  title: string;
  rows: Array<Record<string, unknown>>;
  columns: Array<{ key: string; label: string }>;
};

export type AnalysisExport = { filename: string; content: string; type: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function rowsFromArray(key: string, value: unknown[]): AnalysisTable | null {
  const rows = value.map((entry) => asRecord(entry) ?? { value: entry });
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return { key, title: key === "items" ? "分析条目" : key, rows, columns: keys.map((column) => ({ key: column, label: column })) };
}

export function tableViewsFromJson(value: unknown): AnalysisTable[] {
  if (Array.isArray(value)) {
    const table = rowsFromArray("结果", value);
    return table ? [table] : [];
  }
  const record = asRecord(value);
  if (!record) return [];
  const entries = Object.entries(record);
  const tables = entries.flatMap(([key, entry]) => {
    if (Array.isArray(entry)) {
      const table = rowsFromArray(key, entry);
      return table ? [table] : [];
    }
    const nested = asRecord(entry);
    if (!nested) return [];
    return [{ key, title: key, rows: [nested], columns: Object.keys(nested).map((column) => ({ key: column, label: column })) }];
  });
  const scalarRows = entries.filter(([, entry]) => entry === null || typeof entry !== "object").map(([field, entry]) => ({ field, value: entry }));
  if (scalarRows.length) tables.push({ key: "summary_fields", title: "结果字段", rows: scalarRows, columns: [{ key: "field", label: "字段" }, { key: "value", label: "值" }] });
  return tables.sort((left, right) => left.key === "items" ? -1 : right.key === "items" ? 1 : 0);
}

const escapeXml = (value: unknown) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const safeName = (value: string) => value.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 80) || "analysis-result";

function excelWorkbookXml(value: unknown, title: string): string {
  const tables = tableViewsFromJson(value);
  if (!tables.length) return "";
  const usedNames = new Set<string>();
  const sheets = tables.map((table) => {
    const base = String(table.title || table.key || "结果").replace(/[:\\/?*[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "结果";
    let name = base; let index = 2;
    while (usedNames.has(name.toLowerCase())) { const suffix = ` ${index}`; name = `${base.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`; index += 1; }
    usedNames.add(name.toLowerCase());
    const header = table.columns.length ? `<Row>${table.columns.map((column) => `<Cell><Data ss:Type="String">${escapeXml(column.label)}</Data></Cell>`).join("")}</Row>` : "";
    const rows = table.rows.map((row) => `<Row>${table.columns.map((column) => {
      const value = row[column.key];
      const rendered = typeof value === "object" && value !== null ? JSON.stringify(value) : value;
      const type = typeof value === "number" && Number.isFinite(value) ? "Number" : "String";
      return `<Cell><Data ss:Type="${type}">${escapeXml(rendered)}</Data></Cell>`;
    }).join("")}</Row>`).join("\n");
    return `<Worksheet ss:Name="${escapeXml(name)}"><Table>${header}${rows}</Table></Worksheet>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<?mso-application progid="Excel.Sheet"?>\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><DocumentProperties xmlns="urn:schemas-microsoft-com:office:office"><Title>${escapeXml(title)}</Title></DocumentProperties>${sheets}</Workbook>`;
}

export function buildAnalysisExport(title: string, value: unknown): AnalysisExport {
  const filename = safeName(title);
  if (typeof value === "string") return { filename: `${filename}.md`, content: value, type: "text/markdown;charset=utf-8" };
  const workbook = excelWorkbookXml(value, title);
  if (workbook) return { filename: `${filename}.xls`, content: workbook, type: "application/vnd.ms-excel;charset=utf-8" };
  return { filename: `${filename}.json`, content: JSON.stringify(value, null, 2) ?? "null", type: "application/json;charset=utf-8" };
}

export function downloadAnalysisExport(value: AnalysisExport): void {
  const url = URL.createObjectURL(new Blob([value.content], { type: value.type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = value.filename;
  link.click();
  URL.revokeObjectURL(url);
}
