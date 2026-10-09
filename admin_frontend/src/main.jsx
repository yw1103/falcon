import React, { useEffect, useState, useId } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  Bird,
  Blocks,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Cpu,
  Database,
  Eye,
  ExternalLink,
  FileText,
  Globe2,
  LayoutDashboard,
  ListFilter,
  Loader2,
  MessageSquare,
  Network,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  SquarePen,
  Trash2,
  Users,
  Wallet,
  Workflow,
  Zap,
} from "lucide-react";
import { Badge, Button, Dialog, Switch } from "./components/ui";
import "./styles.css";

const pages = {
  overview: {
    title: "工作台",
    subtitle: "让采集、账号与工作流，井然有序。",
    icon: LayoutDashboard,
  },
  tasks: {
    title: "采集任务",
    subtitle: "配置搜索计划，将有价值的内容送往下一站。",
    icon: Workflow,
    singular: "搜索任务",
  },
  accounts: {
    title: "账号池",
    subtitle: "集中管理账号凭据，按需检查连接状态。",
    icon: Users,
    singular: "账号",
  },
  proxies: {
    title: "代理管理",
    subtitle: "添加代理地址，在账号或任务中按需启用。",
    icon: Network,
    singular: "代理",
  },
  dify: {
    title: "Dify 预设",
    subtitle: "保存常用工作流，接收整理后的采集内容。",
    icon: Blocks,
    singular: "Dify 预设",
  },
  providers: {
    title: "AI 提供商",
    subtitle: "统一配置模型服务，为后续智能处理做好准备。",
    icon: Sparkles,
    singular: "AI 提供商",
  },
  runs: {
    title: "运行记录",
    subtitle: "每一次采集，都有迹可循。",
    icon: FileText,
  },
  billing: {
    title: "费用中心",
    subtitle: "集中查看外部服务的费用与余额。",
    icon: Wallet,
  },
};
const defaults = {
  proxies: { name: "", url: "", enabled: true },
  accounts: {
    name: "",
    site: "rednote",
    phone: "",
    zone: "1",
    cookie: "",
    sms_key: "",
    use_proxy: false,
    proxy_id: null,
    enabled: true,
  },
  dify: {
    name: "",
    base_url: "https://api.dify.ai/v1",
    api_key: "",
    mode: "workflow",
    input_variable: "content",
    enabled: true,
  },
  providers: {
    name: "",
    base_url: "https://api.openai.com/v1",
    api_key: "",
    protocol: "openai-compatible",
    model: "",
    enabled: true,
  },
  tasks: {
    name: "",
    keyword: "",
    interval_seconds: 300,
    request_interval_seconds: 5,
    max_items: 20,
    fetch_content: false,
    sort_type_choice: 0,
    note_type: 0,
    note_time: 0,
    note_range: 0,
    pos_distance: 0,
    geo: null,
    account_id: "",
    use_proxy: false,
    proxy_id: null,
    dify_preset_id: null,
    ai_provider_id: null,
    status: "draft",
    enabled: true,
  },
};
const statusText = {
  draft: "草稿",
  running: "运行中",
  paused: "已暂停",
  healthy: "连接正常",
  check_failed: "检查失败",
  unknown: "未检查",
  success: "已完成",
  failed: "执行失败",
  delivery_failed: "投递失败",
};
function Status({ value = "unknown" }) {
  return (
    <Badge
      tone={
        ["healthy", "success", "running"].includes(value)
          ? "green"
          : value.includes("failed")
            ? "red"
            : ""
      }
    >
      <span className="dot" />
      {statusText[value] || value}
    </Badge>
  );
}
function formatDate(value) {
  return value
    ? new Date(value).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
}
async function api(path, method = "GET", body) {
  const result = await fetch("/api/" + path, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (result.status === 204) return null;
  const data = await result.json();
  if (!result.ok)
    throw new Error(
      typeof data.detail === "string" ? data.detail : "请求失败，请检查配置",
    );
  return data;
}
function Field({ label, hint, children, wide = false }) {
  const id = useId();
  return (
    <div className={`field ${wide ? "wide" : ""}`}>
      <label htmlFor={id}>{label}</label>
      {React.Children.map(children, (child) =>
        React.isValidElement(child) &&
        ["input", "select", "textarea"].includes(child.type)
          ? React.cloneElement(child, {
              id,
              "aria-describedby": hint ? id + "-hint" : undefined,
            })
          : child,
      )}
      {hint && <small id={id + "-hint"}>{hint}</small>}
    </div>
  );
}
function App() {
  const [page, setPage] = useState("overview");
  const [data, setData] = useState({
    tasks: [],
    accounts: [],
    proxies: [],
    dify: [],
    providers: [],
    runs: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [tokenLoaded, setTokenLoaded] = useState(false);
  const [tokenExists, setTokenExists] = useState(false);
  const [busy, setBusy] = useState("");
  const [sample, setSample] = useState(null);
  const [inspect, setInspect] = useState(null);
  const [smsAccount, setSmsAccount] = useState(null);
  const [smsResult, setSmsResult] = useState(null);
  const [smsAttempt, setSmsAttempt] = useState(0);
  const [aiPrompt, setAiPrompt] = useState("请用一句话介绍你能提供的能力。");
  const [aiOutput, setAiOutput] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [apiReady, setApiReady] = useState(false);
  async function reload() {
    try {
      const values = await Promise.all(Object.keys(data).map((k) => api(k)));
      setData(
        Object.fromEntries(Object.keys(data).map((k, i) => [k, values[i]])),
      );
      setApiReady(true);
      setError("");
    } catch (e) {
      setError(e.message);
      setApiReady(false);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    reload();
  }, []);
  useEffect(() => {
    if (!smsAccount) return;
    let cancelled = false;
    let timer;
    let attempt = 0;
    setSmsResult({ status: "waiting", message: "正在查询短信…" });
    setSmsAttempt(0);
    async function poll() {
      attempt += 1;
      setSmsAttempt(attempt);
      try {
        const result = await api(`accounts/${smsAccount.id}/sms`, "POST");
        if (cancelled) return;
        if (result.status === "waiting" && attempt === 60) {
          setSmsResult({ status: "timeout", message: "查询结束，仍未收到短信，请稍后重新获取。" });
        } else {
          setSmsResult(result);
          if (result.status === "waiting") timer = setTimeout(poll, 5000);
        }
      } catch (e) {
        if (!cancelled) setSmsResult({ status: "error", message: e.message });
      }
    }
    poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [smsAccount]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(t);
  }, [notice]);
  function navigate(key) {
    setPage(key);
    setQuery("");
    setFilter("all");
  }
  function edit(kind, item = null) {
    setTokenLoaded(false);
    setTokenExists(kind === "accounts" && !!item?.has_cookie);
    setForm(
      item
        ? Object.fromEntries(
            Object.keys(defaults[kind]).map((k) => [
              k,
              item[k] ?? defaults[kind][k],
            ]),
          )
        : structuredClone(defaults[kind]),
    );
    setSample(null);
    setModal({ kind, id: item?.id });
    setError("");
  }
  function update(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }
  async function perform(key, action, message = "操作完成") {
    setBusy(key);
    setError("");
    try {
      const result = await action();
      if (message) setNotice(message);
      await reload();
      return result;
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }
  async function save(e) {
    e.preventDefault();
    await perform(
      "save",
      async () => {
        await api(
          modal.kind + (modal.id ? "/" + modal.id : ""),
          modal.id ? "PUT" : "POST",
          form,
        );
        setModal(null);
      },
      "配置已保存",
    );
  }
  async function action(kind, item, name) {
    const result = await perform(
      item.id,
      () => api(`${kind}/${item.id}/${name}`, "POST"),
      name === "sample" ? "试采集完成" : "操作完成",
    );
    if (name === "sample" && result) setInspect(result);
    if (kind === "accounts" && name === "check" && result?.last_error) {
      setError(`账号检查失败：${result.last_error}`);
    }
    if (kind === "proxies" && name === "check" && result?.last_error) {
      setError(`代理检查失败：${result.last_error}`);
    }
    if (name === "test" && result)
      setNotice(
        `连接成功 · 发现 ${result.models.length} 个模型${result.model_available ? " · 所选模型可用" : " · 模型列表未包含所选模型"}`,
      );
  }
  async function toggleTask(item) {
    const payload = Object.fromEntries(
      Object.keys(defaults.tasks).map((k) => [k, item[k]]),
    );
    payload.status = item.status === "running" ? "paused" : "running";
    await perform(
      item.id,
      () => api("tasks/" + item.id, "PUT", payload),
      "任务状态已更新",
    );
  }
  async function formSample() {
    if (!modal.id) {
      setError("请先保存任务，再进行试采集。");
      return;
    }
    const result = await perform(
      "sample",
      async () => {
        await api("tasks/" + modal.id, "PUT", form);
        return api("tasks/" + modal.id + "/sample", "POST");
      },
      "试采集完成",
    );
    if (result) setSample(result);
  }
  const running = data.tasks.filter(
    (t) => t.status === "running" && t.enabled,
  ).length;
  const totalNotes = data.runs
    .filter((r) => !r.sample)
    .reduce((sum, r) => sum + (r.count || 0), 0);
  const rows = (data[page] || []).filter(
    (item) =>
      JSON.stringify([
        item.name,
        item.keyword,
        item.phone,
        item.base_url,
        item.model,
        item.task_name,
      ])
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter === "all" ||
        (filter === "enabled" ? item.enabled : item.status === filter)),
  );
  const enabledOptions = (kind) => data[kind].filter((x) => x.enabled);
  const text = (key, placeholder = "", type = "text") => (
    <input
      type={type}
      value={form[key] ?? ""}
      placeholder={placeholder}
      onChange={(e) => update(key, e.target.value)}
    />
  );
  const select = (key, options, placeholder = "请选择", nullable = true) => (
    <select
      value={form[key] ?? ""}
      onChange={(e) => update(key, e.target.value || (nullable ? null : ""))}
    >
      <option value="">{placeholder}</option>
      {options.map((x) => (
        <option key={x.id} value={x.id}>
          {x.name}
        </option>
      ))}
    </select>
  );
  const proxyFields = (
    <div className="proxy-setting wide">
      <div className="switch-row">
        <div>
          <strong>使用代理</strong>
          <small>关闭时直接连接，开启后选择已添加的代理。</small>
        </div>
        <Switch
          checked={!!form.use_proxy}
          label="使用代理"
          onCheckedChange={(v) =>
            setForm((f) => ({
              ...f,
              use_proxy: v,
              proxy_id: v ? f.proxy_id : null,
            }))
          }
        />
      </div>
      {form.use_proxy && (
        <Field label="选择代理">
          {select(
            "proxy_id",
            enabledOptions("proxies"),
            "选择一个已启用的代理",
          )}
          {!enabledOptions("proxies").length && (
            <small>暂无可用代理，请先前往代理管理添加。</small>
          )}
        </Field>
      )}
    </div>
  );
  return (
    <div className="shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("overview");
          }}
        >
          <span className="brand-icon">
            <Bird size={25} />
          </span>
          <span>
            猎隼 <small>FALCON</small>
          </span>
        </a>
        <div className="workspace">
          <span className="workspace-icon">猎</span>
          <div>
            我的工作空间<small>小红书采集中间层</small>
          </div>
          <ChevronRight size={15} />
        </div>
        <p className="nav-label">工作空间</p>
        <nav>
          {["overview", "tasks", "accounts", "proxies"].map((key) => {
            const Icon = pages[key].icon;
            return (
              <button
                key={key}
                className={page === key ? "active" : ""}
                onClick={() => navigate(key)}
              >
                <Icon size={18} />
                {pages[key].title}
                {key === "tasks" && data.tasks.length > 0 && (
                  <span className="nav-count">{data.tasks.length}</span>
                )}
              </button>
            );
          })}
        </nav>
        <p className="nav-label second">服务集成</p>
        <nav>
          {["dify", "providers", "runs", "billing"].map((key) => {
            const Icon = pages[key].icon;
            return (
              <button
                key={key}
                className={page === key ? "active" : ""}
                onClick={() => navigate(key)}
              >
                <Icon size={18} />
                {pages[key].title}
                {key === "providers" && <span className="new-label">NEW</span>}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="connection">
            <span className={`dot ${apiReady ? "live" : ""}`} />
            {apiReady ? "管理服务已连接" : "管理服务未连接"}
            <Badge>LOCAL</Badge>
          </div>
          <div className="profile">
            <span className="avatar">管</span>
            <div>
              管理员<small>本地工作空间</small>
            </div>
            <Settings2 size={16} />
          </div>
        </div>
      </aside>
      <div className="main-wrap">
        <header className="topbar">
          <div className="breadcrumb">
            工作空间
            <ChevronRight size={13} />
            <span>{pages[page].title}</span>
          </div>
          <div className="top-actions">
            <Badge>
              <Database size={12} />
              SQLite
            </Badge>
            <a
              href="https://www.shadcn.com.cn/docs"
              target="_blank"
              rel="noreferrer"
              aria-label="组件文档"
            >
              <CircleHelp size={18} />
            </a>
            <span className="avatar small">管</span>
          </div>
        </header>
        <main>
          <div className="page-header">
            <div>
              <div className="eyebrow">WORKSPACE / {page.toUpperCase()}</div>
              <h1>{pages[page].title}</h1>
              <p>{pages[page].subtitle}</p>
            </div>
            <div className="header-actions">
              <Button variant="outline" onClick={reload} disabled={!!busy}>
                <RefreshCw size={15} />
                刷新
              </Button>
              {defaults[page] && (
                <Button onClick={() => edit(page)}>
                  <Plus size={16} />
                  添加{pages[page].singular}
                </Button>
              )}
              {page === "overview" && (
                <Button onClick={() => edit("tasks")}>
                  <Plus size={16} />
                  创建任务
                </Button>
              )}
            </div>
          </div>
          {error && (
            <div className="alert" role="alert">
              {error}
              <button onClick={() => setError("")}>关闭</button>
            </div>
          )}
          {loading ? (
            <div className="empty">
              <Loader2 className="spin" />
              <h3>正在连接管理服务</h3>
            </div>
          ) : page === "overview" ? (
            <>
              <div className="stats">
                {[
                  {
                    title: "采集任务",
                    value: data.tasks.length,
                    icon: Workflow,
                    foot: `${running} 个任务运行中`,
                  },
                  {
                    title: "账号池",
                    value: data.accounts.length,
                    icon: Users,
                    foot: `${data.accounts.filter((x) => x.status === "healthy").length} 个账号检查通过`,
                  },
                  {
                    title: "已采集内容",
                    value: totalNotes,
                    icon: ArrowDownToLine,
                    foot: "不含试采集数据",
                  },
                  {
                    title: "服务集成",
                    value: data.dify.length + data.providers.length,
                    icon: Blocks,
                    foot: `${data.dify.length} 个 Dify · ${data.providers.length} 个 AI 服务`,
                  },
                ].map((s) => (
                  <div className="stat-card" key={s.title}>
                    <div>
                      <span>{s.title}</span>
                      <s.icon size={18} />
                    </div>
                    <strong>
                      {s.value.toLocaleString()}
                      <small>{s.title === "已采集内容" ? "条" : "个"}</small>
                    </strong>
                    <p>
                      <span className="dot" />
                      {s.foot}
                    </p>
                  </div>
                ))}
              </div>
              <div className="overview-grid">
                <section className="card task-panel">
                  <div className="card-heading">
                    <div>
                      <h2>采集任务</h2>
                      <p>从关键词出发，连接你的内容工作流。</p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => navigate("tasks")}
                    >
                      查看全部
                      <ArrowRight size={14} />
                    </button>
                  </div>
                  {data.tasks.length ? (
                    <TaskTable
                      rows={data.tasks.slice(0, 5)}
                      busy={busy}
                      data={data}
                      edit={edit}
                      action={action}
                      toggle={toggleTask}
                      remove={setDeleteTarget}
                    />
                  ) : (
                    <div className="empty">
                      <span className="empty-icon">
                        <Workflow size={27} />
                      </span>
                      <h3>创建你的第一个采集任务</h3>
                      <p>选择账号、设置关键词和频率，即可开始采集。</p>
                      <Button onClick={() => edit("tasks")}>
                        <Plus size={15} />
                        创建搜索任务
                      </Button>
                    </div>
                  )}
                  <div className="panel-footer">
                    <ShieldCheck size={14} />
                    代理按需启用 · 字段自由编排 · Dify 工作流投递
                  </div>
                </section>
                <section className="card setup-panel">
                  <div className="card-heading">
                    <div>
                      <h2>开始之前</h2>
                      <p>三步完成采集准备</p>
                    </div>
                    <Badge>
                      {
                        [
                          data.accounts.length,
                          data.tasks.length,
                          data.dify.length,
                        ].filter(Boolean).length
                      }{" "}
                      / 3
                    </Badge>
                  </div>
                  {[
                    {
                      step: "01",
                      title: "添加一个账号",
                      desc: "绑定手机号，手动粘贴小红书 Token",
                      page: "accounts",
                      done: data.accounts.length,
                    },
                    {
                      step: "02",
                      title: "连接 Dify 工作流",
                      desc: "保存 API 地址与输入变量",
                      page: "dify",
                      done: data.dify.length,
                    },
                    {
                      step: "03",
                      title: "创建搜索任务",
                      desc: "关键词、频率与字段映射",
                      page: "tasks",
                      done: data.tasks.length,
                    },
                  ].map((s) => (
                    <button
                      className="setup-step"
                      key={s.step}
                      onClick={() => navigate(s.page)}
                    >
                      <span
                        className={s.done ? "step-number done" : "step-number"}
                      >
                        {s.done ? <Check size={16} /> : s.step}
                      </span>
                      <div>
                        <strong>{s.title}</strong>
                        <p>{s.desc}</p>
                      </div>
                      <ChevronRight size={16} />
                    </button>
                  ))}
                  <div className="setup-note">
                    <Zap size={17} />
                    <p>
                      需要额外的智能处理？
                      <button onClick={() => navigate("providers")}>
                        配置 AI 提供商
                        <ArrowRight size={13} />
                      </button>
                    </p>
                  </div>
                </section>
              </div>
              <section className="card recent">
                <div className="card-heading">
                  <div>
                    <h2>最近运行</h2>
                    <p>查看采集结果和投递状态。</p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => navigate("runs")}
                  >
                    全部记录
                    <ArrowRight size={14} />
                  </button>
                </div>
                <RunTable rows={data.runs.slice(0, 4)} inspect={setInspect} />
              </section>
            </>
          ) : page === "billing" ? (
            <section className="card">
              <div className="empty">
                <span className="empty-icon">
                  <Wallet size={28} />
                </span>
                <h3>尚未接入费用查询接口</h3>
                <p>
                  提供服务商的余额查询 cURL 后，可在这里接入真实余额。
                  <br />
                  当前不展示估算费用或模拟数据。
                </p>
              </div>
            </section>
          ) : (
            <section className="card">
              <div className="list-toolbar">
                <div className="search-input">
                  <Search size={16} />
                  <input
                    placeholder={`搜索${pages[page].title}…`}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <div>
                  <span className="muted">共 {rows.length} 条</span>
                  {page === "tasks" && (
                    <select
                      aria-label="任务状态筛选"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    >
                      <option value="all">全部状态</option>
                      <option value="running">运行中</option>
                      <option value="draft">草稿</option>
                      <option value="paused">已暂停</option>
                    </select>
                  )}
                </div>
              </div>
              {page === "tasks" ? (
                <TaskTable
                  rows={rows}
                  busy={busy}
                  data={data}
                  edit={edit}
                  action={action}
                  toggle={toggleTask}
                  remove={setDeleteTarget}
                />
              ) : page === "runs" ? (
                <RunTable rows={rows} inspect={setInspect} />
              ) : rows.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>名称</th>
                        <th>
                          {page === "accounts"
                            ? "手机号 / 区号"
                            : page === "proxies"
                              ? "代理地址"
                              : "API 地址"}
                        </th>
                        <th>
                          {page === "providers"
                            ? "模型"
                            : page === "dify"
                              ? "类型 / 输入变量"
                              : "连接状态"}
                        </th>
                        <th>启用状态</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((item) => (
                        <tr key={item.id}>
                          <td>
                            <strong>{item.name}</strong>
                            <small>{formatDate(item.created_at)} 创建</small>
                          </td>
                          <td className="mono">
                            {page === "accounts"
                              ? `+${item.zone} ${item.phone || "手机号未填写"}`
                              : page === "proxies"
                                ? item.url
                                : item.base_url}
                          </td>
                          <td>
                            {page === "providers" ? (
                              <Badge>{item.model}</Badge>
                            ) : page === "dify" ? (
                              <span>
                                {item.mode === "workflow" ? "工作流" : "聊天"}
                                <small>{item.input_variable}</small>
                              </span>
                            ) : (
                              <span>
                                <Status value={item.status} />
                                {page === "accounts" && (
                                  <small>
                                    {item.site === "rednote"
                                      ? "RedNote 海外站"
                                      : "小红书中国大陆站"}
                                  </small>
                                )}
                              </span>
                            )}
                          </td>
                          <td>
                            <Badge tone={item.enabled ? "green" : ""}>
                              {item.enabled ? "已启用" : "已停用"}
                            </Badge>
                          </td>
                          <td>
                            <div className="row-actions">
                              {page !== "dify" && (
                                <Button
                                  variant="ghost"
                                  disabled={!!busy}
                                  onClick={() =>
                                    action(
                                      page,
                                      item,
                                      page === "providers" ? "test" : "check",
                                    )
                                  }
                                >
                                  {page === "dify" ? null : busy === item.id ? (
                                    <Loader2 className="spin" size={14} />
                                  ) : (
                                    <Activity size={14} />
                                  )}
                                  <span>
                                    {page === "dify"
                                      ? ""
                                      : page === "providers"
                                        ? "连接测试"
                                        : "检查"}
                                  </span>
                                </Button>
                              )}
                              {page === "providers" && (
                                <Button
                                  variant="ghost"
                                  onClick={() => {
                                    setAiOutput("");
                                    setModal({ kind: "ai-test", id: item.id });
                                  }}
                                >
                                  试用
                                </Button>
                              )}
                              {page === "accounts" && (
                                <Button variant="ghost" onClick={() => setSmsAccount({ id: item.id, name: item.name, phone: item.phone })}>
                                  <MessageSquare size={14} />
                                  获取验证码
                                </Button>
                              )}
                              <button
                                className="icon-button"
                                aria-label={`编辑${item.name}`}
                                onClick={() => edit(page, item)}
                              >
                                <SquarePen size={16} />
                              </button>
                              <button
                                className="icon-button"
                                aria-label={`删除${item.name}`}
                                onClick={() =>
                                  setDeleteTarget({ kind: page, item })
                                }
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty">
                  <span className="empty-icon">
                    {React.createElement(pages[page].icon, { size: 28 })}
                  </span>
                  <h3>还没有{pages[page].title}</h3>
                  <p>{pages[page].subtitle}</p>
                  {defaults[page] && (
                    <Button onClick={() => edit(page)}>
                      <Plus size={15} />
                      添加{pages[page].singular}
                    </Button>
                  )}
                </div>
              )}
            </section>
          )}
          <footer className="page-footer">
            <span>猎隼 · 内容采集工作空间</span>
            <span>
              Spider_XHS 驱动 <span className="separator">/</span>{" "}
              数据本地持久化
            </span>
          </footer>
        </main>
      </div>
      {notice && (
        <div className="toast" role="status">
          <Check size={17} />
          {notice}
        </div>
      )}
      <Dialog
        open={!!smsAccount}
        onOpenChange={(open) => { if (!open) setSmsAccount(null); }}
        title="获取验证码"
        description={`${smsAccount?.name || ""} · ${smsAccount?.phone || ""}`}
      >
        <div className="form">
          {smsResult?.status === "waiting" && <div><Loader2 className="spin" size={16} /> 查询中 · {smsAttempt}/60</div>}
          <pre className="preview" role="status">{smsResult?.message || "正在查询短信…"}</pre>
          <div className="dialog-footer">
            {smsResult && smsResult.status !== "waiting" && <Button variant="outline" onClick={() => setSmsAccount({ ...smsAccount })}><RefreshCw size={14} />重新获取</Button>}
            <Button variant="outline" onClick={() => setSmsAccount(null)}>{smsResult?.status === "waiting" ? "停止查询" : "关闭"}</Button>
          </div>
        </div>
      </Dialog>
      <Dialog
        open={!!modal}
        onOpenChange={(v) => {
          if (!v && !busy) setModal(null);
        }}
        title={
          modal?.kind === "ai-test"
            ? "模型试用"
            : `${modal?.id ? "编辑" : "添加"}${pages[modal?.kind]?.singular || ""}`
        }
        description={
          modal?.kind === "tasks"
            ? "保存为草稿，试采集确认后再启动任务。"
            : "配置保存在本机；账号 Token 默认隐藏，需要时可显式查看。"
        }
      >
        {modal?.kind === "ai-test" ? (
          <div className="form">
            <Field label="提示词">
              <textarea
                rows={4}
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
              />
            </Field>
            <Button
              disabled={!!busy}
              onClick={async () => {
                const res = await perform(
                  "generate",
                  () =>
                    api("providers/" + modal.id + "/generate", "POST", {
                      prompt: aiPrompt,
                    }),
                  "",
                );
                if (res) setAiOutput(res.text);
              }}
            >
              {busy ? (
                <Loader2 className="spin" size={15} />
              ) : (
                <Sparkles size={15} />
              )}
              调用模型
            </Button>
            {aiOutput && <pre className="preview">{aiOutput}</pre>}
          </div>
        ) : (
          modal && (
            <form onSubmit={save} className="form">
              <div className="form-grid">
                <Field label="名称" wide>
                  {text("name", "为配置起一个容易识别的名字")}
                </Field>
                {modal.kind === "proxies" && (
                  <Field
                    label="代理地址"
                    hint="支持 IP:端口或 http / https / socks5 地址，也可填写认证信息。"
                    wide
                  >
                    {text("url", "http://127.0.0.1:7890")}
                  </Field>
                )}
                {modal.kind === "accounts" && (
                  <>
                    <Field label="账号站点">
                      <select
                        value={form.site}
                        onChange={(e) => update("site", e.target.value)}
                      >
                        <option value="rednote">RedNote 海外站</option>
                        <option value="xiaohongshu">小红书中国大陆站</option>
                      </select>
                    </Field>
                    <Field label="手机号">
                      {text("phone", "加拿大本地号码，不含区号")}
                    </Field>
                    <Field label="国家区号" hint="加拿大默认 +1">
                      {text("zone", "1")}
                    </Field>
                    <Field label="接码 Key" wide hint={modal.id ? "留空保留已保存的 Key。" : "填写号码提供商提供的 Key。"}>
                      {text("sms_key", "填写接码 Key", "password")}
                    </Field>
                    <Field
                      label="小红书 Token（Cookie）"
                      hint="粘贴小红书已登录请求中的完整 Cookie，至少包含 a1 和 web_session。系统不会自动登录；留空保存会保留现有 Token。"
                      wide
                    >
                      {modal.id && form.cookie === "" && !tokenLoaded && (
                        <div className="secret-saved">
                          <ShieldCheck size={15} />
                          {tokenExists
                            ? "已有 Token 已加密保存"
                            : "尚未添加 Token"}
                          {tokenExists && (
                            <Button
                              type="button"
                              variant="outline"
                              disabled={!!busy}
                              onClick={async () => {
                                try {
                                  const secret = await api(
                                    `accounts/${modal.id}/secret`,
                                  );
                                  update("cookie", secret.cookie);
                                  setTokenLoaded(true);
                                } catch (e) {
                                  setError(e.message);
                                }
                              }}
                            >
                              <Eye size={14} />
                              查看已保存 Token
                            </Button>
                          )}
                        </div>
                      )}
                      <textarea
                        rows={4}
                        value={form.cookie}
                        onChange={(e) => update("cookie", e.target.value)}
                        placeholder="粘贴完整 Cookie（含 a1、web_session）"
                      />
                    </Field>
                    {proxyFields}
                  </>
                )}
                {["dify", "providers"].includes(modal.kind) && (
                  <>
                    <Field
                      label="API 基础地址"
                      hint="包含 /v1，不包含具体调用端点。"
                      wide
                    >
                      {text("base_url", "https://example.com/v1", "url")}
                    </Field>
                    <Field
                      label="API Key"
                      hint={
                        modal.id
                          ? "留空保留已保存的密钥。"
                          : "密钥加密保存在本地数据库。"
                      }
                      wide
                    >
                      {text("api_key", "输入 API Key", "password")}
                    </Field>
                    {modal.kind === "providers" ? (
                      <>
                        <Field label="接口协议">
                          <select
                            value={form.protocol}
                            onChange={(e) => update("protocol", e.target.value)}
                          >
                            <option value="openai-compatible">
                              OpenAI 兼容接口
                            </option>
                          </select>
                        </Field>
                        <Field label="模型名称">
                          {text("model", "例如 gpt-4.1-mini")}
                        </Field>
                      </>
                    ) : (
                      <>
                        <Field label="应用类型">
                          <select
                            value={form.mode}
                            onChange={(e) => update("mode", e.target.value)}
                          >
                            <option value="workflow">Workflow 工作流</option>
                            <option value="chat">Chat 聊天应用</option>
                          </select>
                        </Field>
                        <Field label="输入变量">
                          {text("input_variable", "content")}
                        </Field>
                      </>
                    )}
                  </>
                )}
                {modal.kind === "tasks" && (
                  <>
                    <Field label="搜索关键词">
                      {text("keyword", "例如：加拿大生活")}
                    </Field>
                    <Field label="采集账号">
                      {select(
                        "account_id",
                        enabledOptions("accounts"),
                        "选择账号",
                        false,
                      )}
                    </Field>
                    <Field
                      label="任务间隔（秒）"
                      hint="两次采集之间的等待时长，至少 10 秒。"
                    >
                      <input
                        type="number"
                        min="10"
                        value={form.interval_seconds}
                        onChange={(e) =>
                          update("interval_seconds", Number(e.target.value))
                        }
                      />
                    </Field>
                    <Field label="每次采集条数">
                      <input
                        type="number"
                        min="1"
                        max="1000"
                        value={form.max_items}
                        onChange={(e) =>
                          update("max_items", Number(e.target.value))
                        }
                      />
                    </Field>
                    <Field
                      label="翻页间隔（秒）"
                      hint="控制搜索分页请求的频率。"
                    >
                      <input
                        type="number"
                        min="1"
                        value={form.request_interval_seconds}
                        onChange={(e) =>
                          update(
                            "request_interval_seconds",
                            Number(e.target.value),
                          )
                        }
                      />
                    </Field>
                    <Field label="Dify 投递预设">
                      {select(
                        "dify_preset_id",
                        enabledOptions("dify"),
                        "仅采集，暂不投递",
                      )}
                    </Field>
                    {proxyFields}
                    <Field label="排序方式">
                      <select value={form.sort_type_choice} onChange={(e) => update("sort_type_choice", Number(e.target.value))}>
                        <option value={0}>综合排序</option><option value={1}>最新</option><option value={2}>最多点赞</option><option value={3}>最多评论</option><option value={4}>最多收藏</option>
                      </select>
                    </Field>
                    <Field label="笔记类型">
                      <select value={form.note_type} onChange={(e) => update("note_type", Number(e.target.value))}>
                        <option value={0}>不限</option><option value={1}>视频笔记</option><option value={2}>普通笔记</option>
                      </select>
                    </Field>
                    <Field label="发布时间">
                      <select value={form.note_time} onChange={(e) => update("note_time", Number(e.target.value))}>
                        <option value={0}>不限</option><option value={1}>一天内</option><option value={2}>一周内</option><option value={3}>半年内</option>
                      </select>
                    </Field>
                    <Field label="笔记范围">
                      <select value={form.note_range} onChange={(e) => update("note_range", Number(e.target.value))}>
                        <option value={0}>不限</option><option value={1}>已看过</option><option value={2}>未看过</option><option value={3}>已关注</option>
                      </select>
                    </Field>
                    <Field label="位置距离">
                      <select value={form.pos_distance} onChange={(e) => {
                        const value = Number(e.target.value);
                        update("pos_distance", value);
                        if (!value) update("geo", null);
                      }}>
                        <option value={0}>不限</option><option value={1}>同城</option><option value={2}>附近</option>
                      </select>
                    </Field>
                    {!!form.pos_distance && <>
                      <Field label="纬度" hint="必填，范围 -90 到 90。">
                        <input type="number" step="any" value={form.geo?.latitude ?? ""} onChange={(e) => update("geo", { ...form.geo, latitude: e.target.value === "" ? "" : Number(e.target.value) })} />
                      </Field>
                      <Field label="经度" hint="必填，范围 -180 到 180。">
                        <input type="number" step="any" value={form.geo?.longitude ?? ""} onChange={(e) => update("geo", { ...form.geo, longitude: e.target.value === "" ? "" : Number(e.target.value) })} />
                      </Field>
                    </>}
                    <div className="switch-row wide">
                      <div>
                        <strong>获取帖子正文</strong>
                      </div>
                      <Switch
                        checked={!!form.fetch_content}
                        label="获取帖子正文"
                        onCheckedChange={(value) => update("fetch_content", value)}
                      />
                    </div>
                    <div className="mapping wide">
                      <div className="mapping-heading">
                        <div>
                          <strong>原始采集数据</strong>
                          <small>完整保留 Spider_XHS 返回字段，后续由 Dify 工作流决定如何使用。</small>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={!!busy}
                          onClick={formSample}
                        >
                          {busy === "sample" ? (
                            <Loader2 className="spin" size={14} />
                          ) : (
                            <Play size={14} />
                          )}
                          试采集
                        </Button>
                      </div>
                      {sample && (
                        <Field label={`试采集原始数据 · ${sample.count} 条`}>
                          <pre className="preview">
                            {JSON.stringify(sample.notes || [], null, 2)}
                          </pre>
                        </Field>
                      )}
                    </div>
                  </>
                )}
                <div className="switch-row wide">
                  <div>
                    <strong>启用此配置</strong>
                    <small>停用后无法被新任务选用。</small>
                  </div>
                  <Switch
                    checked={!!form.enabled}
                    label="启用此配置"
                    onCheckedChange={(v) => update("enabled", v)}
                  />
                </div>
              </div>
              {error && <div className="alert">{error}</div>}
              <div className="dialog-footer">
                <Button
                  type="button"
                  variant="outline"
                  disabled={!!busy}
                  onClick={() => setModal(null)}
                >
                  取消
                </Button>
                <Button type="submit" disabled={!!busy}>
                  {busy === "save" && <Loader2 className="spin" size={15} />}
                  保存{modal.id ? "修改" : "配置"}
                </Button>
              </div>
            </form>
          )
        )}
      </Dialog>
      <Dialog
        open={!!inspect}
        onOpenChange={(v) => !v && setInspect(null)}
        title="采集结果"
        description={`${inspect?.task_name || ""} · ${inspect?.count || 0} 条数据`}
      >
        <div className="form">
          <Status value={inspect?.status || "unknown"} />
          {inspect?.error && <div className="alert">{inspect.error}</div>}
          {inspect?.search && <pre className="preview">{JSON.stringify(inspect.search, null, 2)}</pre>}
          <details>
            <summary>查看原始返回数据</summary>
            <pre className="preview">
              {JSON.stringify(inspect?.notes || [], null, 2)}
            </pre>
          </details>
        </div>
      </Dialog>
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        title="删除配置"
        description={`确认删除“${deleteTarget?.item.name}”？引用中的配置需要先解除关联。`}
      >
        <div className="dialog-footer">
          <Button variant="outline" onClick={() => setDeleteTarget(null)}>
            取消
          </Button>
          <Button
            variant="destructive"
            disabled={!!busy}
            onClick={() =>
              perform(
                "delete",
                async () => {
                  await api(
                    `${deleteTarget.kind}/${deleteTarget.item.id}`,
                    "DELETE",
                  );
                  setDeleteTarget(null);
                },
                "已删除",
              )
            }
          >
            确认删除
          </Button>
        </div>
        {error && <div className="alert">{error}</div>}
      </Dialog>
    </div>
  );
}
function TaskTable({ rows, busy, data, edit, action, toggle, remove }) {
  return rows.length ? (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>任务 / 关键词</th>
            <th>执行频率</th>
            <th>代理</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr key={item.id}>
              <td>
                <strong>{item.name}</strong>
                <small>
                  <Search size={11} />
                  {item.keyword}
                </small>
              </td>
              <td>
                每 {item.interval_seconds} 秒
                <small>{item.max_items} 条 / 次</small>
              </td>
              <td>
                {item.use_proxy ? (
                  <Badge>
                    {data.proxies.find((p) => p.id === item.proxy_id)?.name ||
                      "代理"}
                  </Badge>
                ) : (
                  <span className="muted">直连</span>
                )}
              </td>
              <td>
                <Status value={item.status} />
              </td>
              <td>
                <div className="row-actions">
                  <Button
                    variant="ghost"
                    disabled={!!busy || !item.enabled}
                    onClick={() => toggle(item)}
                  >
                    {busy === item.id ? (
                      <Loader2 className="spin" size={14} />
                    ) : (
                      <Play size={14} />
                    )}
                    <span>{item.status === "running" ? "暂停" : "启动"}</span>
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={!!busy}
                    onClick={() => action("tasks", item, "sample")}
                  >
                    试采集
                  </Button>
                  <button
                    className="icon-button"
                    aria-label={`编辑${item.name}`}
                    onClick={() => edit("tasks", item)}
                  >
                    <SquarePen size={16} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`删除${item.name}`}
                    onClick={() => remove({ kind: "tasks", item })}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <div className="empty">
      <Workflow size={25} />
      <h3>没有匹配的任务</h3>
      <p>调整搜索条件或创建一个新任务。</p>
    </div>
  );
}
function RunTable({ rows, inspect }) {
  return rows.length ? (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>任务名称</th>
            <th>类型</th>
            <th>采集数量</th>
            <th>状态</th>
            <th>运行时间</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <strong>{r.task_name}</strong>
              </td>
              <td>{r.sample ? "试采集" : "正式采集"}</td>
              <td>{r.count || 0} 条</td>
              <td>
                <Status value={r.status} />
              </td>
              <td className="muted">{formatDate(r.created_at)}</td>
              <td>
                <button className="text-button" onClick={() => inspect(r)}>
                  查看结果
                  <ArrowRight size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <div className="empty compact">
      <Clock3 size={25} />
      <h3>等待第一次运行</h3>
      <p>任务执行后，采集和投递结果会显示在这里。</p>
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
