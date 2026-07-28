// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Link, RouterRoot, useLocation } from "./routing.js";

function BrowserProbe() {
  const location = useLocation();
  return <>
    <span>{location.pathname}{location.search}</span>
    <Link to="/tasks?scope=mine">任务</Link>
  </>;
}

describe("browser history routing", () => {
  beforeEach(() => window.history.replaceState(null, "", "/books"));
  afterEach(() => {
    cleanup();
    window.history.replaceState(null, "", "/");
  });

  it("pushes same-origin navigation into browser history", async () => {
    render(<RouterRoot><BrowserProbe /></RouterRoot>);

    await userEvent.click(screen.getByRole("link", { name: "任务" }));

    expect(window.location.pathname).toBe("/tasks");
    expect(window.location.search).toBe("?scope=mine");
    expect(screen.getByText("/tasks?scope=mine")).toBeTruthy();
  });

  it("renders a location restored by popstate", async () => {
    render(<RouterRoot><BrowserProbe /></RouterRoot>);

    window.history.replaceState(null, "", "/admin/members");
    window.dispatchEvent(new PopStateEvent("popstate"));

    expect(await screen.findByText("/admin/members")).toBeTruthy();
  });

  it.each([
    "javascript:alert(1)",
    "https://outside.example/tasks",
  ])("rejects a non-internal navigation target: %s", (target) => {
    expect(() => render(
      <RouterRoot initialEntries={["/books"]}>
        <Link to={target}>不安全目标</Link>
      </RouterRoot>,
    )).toThrow("internal_navigation_required");
  });
});
