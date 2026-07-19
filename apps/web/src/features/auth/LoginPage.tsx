import { Link, useSearchParams } from "react-router-dom";

function safeDestination(value: string | null): string {
  if (value === "/admin/members" || value === "/tasks" || /^\/tasks\/[^/?#]+$/.test(value ?? "")) {
    return value!;
  }
  return "/tasks";
}

export function LoginPage() {
  const [search] = useSearchParams();
  const destination = safeDestination(search.get("returnTo"));
  const completePath = `/auth/complete?returnTo=${encodeURIComponent(destination)}`;
  const loginUrl = `/api/auth/login?returnTo=${encodeURIComponent(completePath)}`;

  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="login-title">
        <p className="product-mark">小说分析工作台</p>
        <h1 id="login-title">登录团队工作区</h1>
        <p>使用已加入成员名单的飞书账号继续</p>
        <a className="primary-button login-button" href={loginUrl}>使用飞书登录</a>
        <Link className="text-link" to="/tasks">返回任务中心</Link>
      </section>
    </main>
  );
}
