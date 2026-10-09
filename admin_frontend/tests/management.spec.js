import { test, expect } from "@playwright/test";

test("管理台 CRUD、代理开关、密钥编辑与页面布局", async ({ page, request }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Keep only this isolated test database clean, never touch the user's data.
  for (const kind of ["tasks", "accounts", "providers", "dify", "proxies"]) {
    const records = await (await request.get("/api/" + kind)).json();
    for (const row of records)
      await request.delete("/api/" + kind + "/" + row.id);
  }
  await page.goto("/");
  await expect(page.getByText("管理服务已连接")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "工作台", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/overview.png", fullPage: true });
  await page.getByRole("button", { name: "代理管理", exact: true }).click();
  await page
    .getByRole("button", { name: "添加代理", exact: true })
    .first()
    .click();
  await page.getByLabel("名称", { exact: true }).fill("本地代理");
  await page.getByLabel("代理地址", { exact: true }).fill("127.0.0.1:7890");
  await page.getByRole("button", { name: "保存配置" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByText("http://127.0.0.1:7890", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "账号池", exact: true }).click();
  await page
    .getByRole("button", { name: "添加账号", exact: true })
    .first()
    .click();
  await page.getByLabel("名称", { exact: true }).fill("测试账号");
  await expect(page.getByLabel("账号站点", { exact: true })).toHaveValue(
    "rednote",
  );
  await page.getByLabel("手机号", { exact: true }).fill("4165550123");
  await expect(page.getByLabel("国家区号")).toHaveValue("1");
  await page
    .getByLabel("小红书 Token（Cookie）", { exact: true })
    .fill("a1=test-a1; web_session=test-session");
  await page.getByRole("button", { name: "保存配置" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await (await request.get("/api/accounts")).json())[0].site).toBe(
    "rednote",
  );
  await page.getByRole("button", { name: "编辑测试账号" }).click();
  await expect(page.getByText("已有 Token 已加密保存")).toBeVisible();
  await expect(page.getByRole("button", { name: "接码登录" })).toHaveCount(0);
  await page.getByRole("button", { name: "查看已保存 Token" }).click();
  await expect(page.getByLabel("小红书 Token（Cookie）")).toHaveValue(
    "a1=test-a1; web_session=test-session",
  );
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "AI 提供商", exact: false })
    .first()
    .click();
  await page
    .getByRole("button", { name: "添加AI 提供商", exact: true })
    .first()
    .click();
  await page.getByLabel("名称", { exact: true }).fill("模型服务");
  await page.getByLabel("API Key", { exact: true }).fill("private-test-key");
  await page.getByLabel("模型名称", { exact: true }).fill("test-model");
  await page.getByRole("button", { name: "保存配置" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "编辑模型服务" }).click();
  await expect(page.getByLabel("API Key", { exact: true })).toHaveValue("");
  await page.getByLabel("模型名称", { exact: true }).fill("updated-model");
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("updated-model", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^采集任务/ }).click();
  await page
    .getByRole("button", { name: "添加搜索任务", exact: true })
    .first()
    .click();
  await page.getByLabel("名称", { exact: true }).fill("关键词采集");
  await page.getByLabel("搜索关键词", { exact: true }).fill("加拿大生活");
  await page
    .getByLabel("采集账号", { exact: true })
    .selectOption({ label: "测试账号" });
  await expect(page.getByLabel("选择代理", { exact: true })).toHaveCount(0);
  await page.getByRole("switch", { name: "使用代理" }).click();
  await expect(page.getByLabel("选择代理", { exact: true })).toBeVisible();
  await page
    .getByLabel("选择代理", { exact: true })
    .selectOption({ label: "本地代理" });
  await page.screenshot({ path: "test-results/task-form.png", fullPage: true });
  await page.getByRole("switch", { name: "使用代理" }).click();
  await expect(page.getByLabel("选择代理", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "保存配置" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const tasks = await (await request.get("/api/tasks")).json();
  expect(tasks[0].use_proxy).toBe(false);
  expect(tasks[0].proxy_id).toBeNull();
  await page.reload();
  await page.getByRole("button", { name: /^采集任务/ }).click();
  await expect(page.getByText("关键词采集", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "删除关键词采集" }).click();
  await page.getByRole("button", { name: "确认删除" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("关键词采集", { exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "工作台", exact: true }).click();
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  for (const kind of ["accounts", "providers", "proxies"]) {
    const records = await (await request.get("/api/" + kind)).json();
    for (const row of records)
      await request.delete("/api/" + kind + "/" + row.id);
  }
});
