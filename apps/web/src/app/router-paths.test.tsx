// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { AppRouter } from "./router.js";

it("renders the safe unknown route for malformed encoded parameters", () => {
  render(<AppRouter initialEntries={["/tasks/%"]} />);

  expect(screen.getByRole("heading", { name: "页面不存在" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "返回任务中心" }).getAttribute("href")).toBe("/tasks");
});
