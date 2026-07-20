import { useParams } from "react-router-dom";
import { WritePanel } from "./WritePanel.js";

export function ImportPanel() {
  const { bookId } = useParams();
  return <div className="workspace-section"><WritePanel title="导入章节" description="先核对本次数据源范围，再提交后台导入任务" previewPath={`/books/${bookId}/import-preview`} submitPath={`/books/${bookId}/import-jobs`} previewBody={{}} submitBody={{ autoStartL1: true }} previewKind="import"><p className="inline-setting">导入完成后自动开始 L1 索引</p></WritePanel></div>;
}
