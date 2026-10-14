import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { applyNodeChanges } from "@xyflow/react";
import {
  Building2,
  UsersRound,
  BookOpen,
  Download,
  ClipboardList,
  File,
  Clock3,
  PanelLeft,
  Search,
  Plus,
  Link,
  Table2,
  ChevronDown,
  ChevronRight,
  Square,
  CalendarDays,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Field,
  FieldLabel,
  FieldGroup,
  FieldDescription,
} from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { OrganizationGraph } from "./OrganizationGraph";
import {
  initialNodes,
  unitNodes,
  baseRelations,
  unitRelations,
  type EntityNode,
  type EntityData,
  type EntityKind,
  type RelationEdge,
} from "./data";

type Category = "entities" | "campuses" | "units";
const allTabs: { id: Category; label: string }[] = [
  { id: "entities", label: "主体" },
  { id: "campuses", label: "院区" },
  { id: "units", label: "部门与服务单元" },
];
const navigation = [
  { label: "组织与院区", icon: Building2 },
  { label: "人员", icon: UsersRound },
  { label: "字典与标准", icon: BookOpen },
  { label: "导入任务", icon: Download, count: 2 },
  { label: "变更与审核", icon: ClipboardList, count: 3 },
];

export function App() {
  const [nodes, setNodes] = useState<EntityNode[]>(() => [
    ...initialNodes(),
    ...structuredClone(unitNodes),
  ]);
  const [category, setCategory] = useState<Category>("entities");
  const [view, setView] = useState("graph");
  const [date, setDate] = useState("2026-10-11");
  const [campus, setCampus] = useState("all");
  const [expanded, setExpanded] = useState(false);
  const [graphReset, setGraphReset] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRelation, setSelectedRelation] = useState<RelationEdge | null>(
    null,
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [createKind, setCreateKind] = useState<EntityKind | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [role, setRole] = useState("林晓 · 数据维护员");

  const showingUnits = expanded || category === "units";
  const visibleNodes = useMemo(
    () =>
      nodes.filter((node) => {
        if (!showingUnits && ["部门", "服务单元"].includes(node.data.kind))
          return false;
        return (
          campus === "all" || !node.data.campus || node.data.campus === campus
        );
      }),
    [nodes, campus, showingUnits],
  );
  const visibleRelations = useMemo(() => {
    const ids = new Set(visibleNodes.map((node) => node.id));
    return [...baseRelations, ...(showingUnits ? unitRelations : [])].filter(
      (edge) =>
        ids.has(edge.source) &&
        ids.has(edge.target) &&
        !!date &&
        edge.data!.from <= date &&
        (!edge.data!.to || date < edge.data!.to),
    );
  }, [visibleNodes, showingUnits, date]);
  const tableNodes = visibleNodes.filter((node) =>
    category === "entities"
      ? node.data.kind === "机构主体"
      : category === "campuses"
        ? node.data.kind === "院区"
        : ["部门", "服务单元"].includes(node.data.kind),
  );
  const selectedNode = nodes.find((node) => node.id === selectedId);
  const onNodesChange = useCallback<
    React.ComponentProps<typeof OrganizationGraph>["onNodesChange"]
  >(
    (changes) => setNodes((previous) => applyNodeChanges(changes, previous)),
    [],
  );

  useEffect(() => {
    const openSearch = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.matches("input, textarea, [contenteditable=true]")) return;
      if (
        event.key === "/" ||
        ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k")
      ) {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", openSearch);
    return () => window.removeEventListener("keydown", openSearch);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const positions = showingUnits
      ? {
          "org-1": { x: 100, y: 250 },
          north: { x: 440, y: 250 },
          south: { x: 440, y: 407 },
        }
      : Object.fromEntries(
          initialNodes().map((node) => [node.id, node.position]),
        );
    setNodes((previous) =>
      previous.map((node) => ({
        ...node,
        position: positions[node.id as keyof typeof positions] ?? node.position,
      })),
    );
  }, [showingUnits]);

  function reset() {
    setNodes([...initialNodes(), ...structuredClone(unitNodes)]);
    setCategory("entities");
    setView("graph");
    setCampus("all");
    setDate("2026-10-11");
    setExpanded(false);
    setSelectedId(null);
    setSelectedRelation(null);
    setGraphReset((previous) => previous + 1);
    setNotice("已恢复附件中的虚构示例");
  }

  function saveEntity(data: EntityData, id?: string) {
    if (id)
      setNodes((previous) =>
        previous.map((node) => (node.id === id ? { ...node, data } : node)),
      );
    else {
      const newId = `draft-${crypto.randomUUID()}`;
      setNodes((previous) => [
        ...previous,
        {
          id: newId,
          type: "entity",
          position: {
            x: 1030,
            y:
              110 +
              previous.filter((node) => node.id.startsWith("draft-")).length *
                120,
          },
          data: {
            ...data,
            draft: true,
            status: "新建草稿",
            ...(data.kind === "院区" ? { campus: newId } : {}),
          },
        },
      ]);
      setGraphReset((previous) => previous + 1);
      setCampus("all");
      setView("graph");
      if (["部门", "服务单元"].includes(data.kind)) setExpanded(true);
    }
    setCreateKind(null);
    setSelectedId(null);
    setNotice("已保存当前页面草稿，刷新后重置");
  }

  const addLabel =
    category === "campuses"
      ? "院区"
      : category === "units"
        ? "服务单元"
        : "主体";
  return (
    <div className="workspace">
      <aside className="sidebar" aria-label="工作空间导航">
        <div className="workspace-brand">
          <Avatar className="brand-avatar">
            <AvatarFallback>H</AvatarFallback>
          </Avatar>
          <div>
            <strong>HDIP 工作空间</strong>
            <span>澄川医院 · 演示机构</span>
          </div>
        </div>
        <Button
          variant="ghost"
          className="quick-search"
          onClick={() => setSearchOpen(true)}
        >
          <Search data-icon="inline-start" />
          快速查找<kbd>/</kbd>
        </Button>
        <div className="nav-section-label">数据维护</div>
        <nav className="primary-nav">
          {navigation.map(({ label, icon: Icon, count }) => (
            <Button
              key={label}
              variant="ghost"
              className={cn(
                "nav-item",
                label === "组织与院区" && "nav-item-active",
              )}
              aria-label={label}
              aria-current={label === "组织与院区" ? "page" : undefined}
              onClick={() =>
                label === "组织与院区"
                  ? setCategory("entities")
                  : setInfo(label)
              }
            >
              <Icon data-icon="inline-start" />
              <span>{label}</span>
              {count && <span className="nav-count">{count}</span>}
            </Button>
          ))}
        </nav>
        <div className="nav-section-label common-label">常用视图</div>
        <Button
          variant="ghost"
          className="nav-item"
          onClick={() => {
            setCategory("units");
            setView("graph");
          }}
        >
          <File data-icon="inline-start" />
          呼吸内科
        </Button>
        <Button
          variant="ghost"
          className="nav-item"
          onClick={() => setInfo("历史与有效期")}
        >
          <Clock3 data-icon="inline-start" />
          历史与有效期
        </Button>
        <div className="sidebar-footer">
          <Button
            variant="ghost"
            className="nav-item scenario-index"
            onClick={() => setInfo("原型场景索引")}
          >
            <PanelLeft data-icon="inline-start" />
            <span>原型场景索引</span>
            <span className="nav-count">25</span>
          </Button>
          <Separator />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="actor-button"
                aria-label={role}
              >
                <Avatar className="actor-avatar">
                  <AvatarFallback>
                    {role.startsWith("林") ? "林" : "陈"}
                  </AvatarFallback>
                </Avatar>
                <span>
                  <strong>{role}</strong>
                  <small>虚构角色 / 可切换审核场景</small>
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>虚构演示角色</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => setRole("林晓 · 数据维护员")}>
                林晓 · 数据维护员
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setRole("陈宁 · 审核维护员")}>
                陈宁 · 审核维护员
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      <div className="workspace-body">
        <header className="topbar">
          <div className="breadcrumb">
            <span>数据工作空间</span>
            <ChevronRight />
            <span>组织与院区</span>
          </div>
          <div className="topbar-actions">
            <time dateTime="2026-10-11">2026 年 10 月 11 日</time>
            <Badge variant="outline" className="prototype-badge">
              交互原型 · 虚构数据
            </Badge>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="scene-button">
                  场景
                  <ChevronDown data-icon="inline-end" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>组织与院区</DropdownMenuLabel>
                <DropdownMenuItem onSelect={reset}>
                  附件默认场景
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    setDate("2024-06-01");
                    setView("graph");
                  }}
                >
                  2024 年关系时点
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    setCategory("units");
                    setView("graph");
                  }}
                >
                  部门与服务单元
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={reset}>
                  重置页面草稿
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="page-content">
          <div className="page-heading">
            <div>
              <h1>组织与院区</h1>
              <p>先看主体与院区之间的关系，再进入各对象维护字段</p>
            </div>
            <div className="heading-action">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="maintenance-category">
                    维护类别
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>选择维护类别</DropdownMenuLabel>
                  {allTabs.map((tab) => (
                    <DropdownMenuItem
                      key={tab.id}
                      onSelect={() => setCategory(tab.id)}
                    >
                      {tab.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                size="sm"
                className="create-button"
                onClick={() =>
                  setCreateKind(
                    category === "campuses"
                      ? "院区"
                      : category === "units"
                        ? "服务单元"
                        : "机构主体",
                  )
                }
              >
                <Plus data-icon="inline-start" />
                新增{addLabel}
              </Button>
            </div>
          </div>
          <Tabs
            value={category}
            onValueChange={(value) => setCategory(value as Category)}
            className="category-tabs"
          >
            <TabsList className="category-list">
              {allTabs.map((tab) => (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  className="category-trigger"
                >
                  {tab.label}
                  {tab.id !== "units" && (
                    <span className="tab-count">
                      {
                        nodes.filter(
                          (node) =>
                            node.data.kind ===
                            (tab.id === "entities" ? "机构主体" : "院区"),
                        ).length
                      }
                    </span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <section
            className="view-panel"
            aria-label={allTabs.find((tab) => tab.id === category)!.label}
          >
            <div className="view-toolbar">
              <ToggleGroup
                type="single"
                value={view}
                onValueChange={(value) => value && setView(value)}
                className="view-toggle"
              >
                <ToggleGroupItem value="graph" aria-label="关系图">
                  <Link data-icon="inline-start" />
                  关系图
                </ToggleGroupItem>
                <ToggleGroupItem value="table" aria-label="表格">
                  <Table2 data-icon="inline-start" />
                  表格
                </ToggleGroupItem>
              </ToggleGroup>
              <Separator orientation="vertical" className="toolbar-separator" />
              <label className="date-label" htmlFor="business-date">
                业务时点
              </label>
              <div className="date-input-wrap">
                <Input
                  id="business-date"
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                  className="date-input"
                  max="9999-12-31"
                />
                <CalendarDays className="date-decoration" aria-hidden="true" />
              </div>
              <Select value={campus} onValueChange={setCampus}>
                <SelectTrigger className="campus-select" aria-label="院区筛选">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">全部院区</SelectItem>
                    {nodes
                      .filter((node) => node.data.kind === "院区")
                      .map((node) => (
                        <SelectItem key={node.id} value={node.id}>
                          {node.data.name}
                        </SelectItem>
                      ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                className="expand-button"
                aria-pressed={showingUnits}
                onClick={() => {
                  if (category === "units") setCategory("entities");
                  setExpanded(!showingUnits);
                }}
              >
                <Link data-icon="inline-start" />
                {showingUnits ? "收起" : "展开"}部门 / 单元
              </Button>
            </div>
            <div className="graph-heading">
              <span>{showingUnits ? "部门—服务单元" : "主体—院区"}</span>
              <span>点击对象维护字段 · 点击连线查看关系 · 可平移与缩放</span>
            </div>
            {view === "graph" ? (
              <OrganizationGraph
                key={graphReset}
                nodes={visibleNodes}
                edges={visibleRelations}
                layoutMode={showingUnits ? "units" : "base"}
                onNodesChange={onNodesChange}
                onNodeSelect={(node) => setSelectedId(node.id)}
                onEdgeSelect={setSelectedRelation}
              />
            ) : (
              <div className="table-surface">
                <div className="table-summary">
                  {tableNodes.length} 个
                  {category === "entities"
                    ? "主体"
                    : category === "campuses"
                      ? "院区"
                      : "部门与服务单元"}
                  <span>点击名称维护字段</span>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>名称</TableHead>
                      <TableHead>编码</TableHead>
                      <TableHead>类别</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>院区范围</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tableNodes.map((node) => (
                      <TableRow key={node.id}>
                        <TableCell>
                          <Button
                            variant="link"
                            className="table-name"
                            onClick={() => setSelectedId(node.id)}
                          >
                            {node.data.name}
                          </Button>
                        </TableCell>
                        <TableCell className="code-cell">
                          {node.data.code}
                        </TableCell>
                        <TableCell>
                          {node.data.unitType ?? node.data.kind}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{node.data.status}</Badge>
                        </TableCell>
                        <TableCell>
                          {nodes.find((item) => item.id === node.data.campus)
                            ?.data.name ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                    {!tableNodes.length && (
                      <TableRow>
                        <TableCell colSpan={5} className="empty-table">
                          当前筛选下没有对象
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
            <div className="graph-legend">
              <span>
                <Square />
                已发布的示例身份
              </span>
              <span>
                <Square className="draft-mark" />
                草稿或尚未生效
              </span>
              <span>连线仅显示业务时点有效的已发布示例关系</span>
            </div>
            <p className="relationship-note">
              关系类型与期间独立记录；图中位置仅为浏览布局，不代表法人隶属或行政树。未接真实登记与许可核验。
            </p>
          </section>
          <footer className="prototype-note">
            虚构示例 · 保存仅保留当前页面草稿，刷新后重置 ·
            证照与许可未作真实法律核验
          </footer>
        </main>
      </div>

      <Sheet
        open={!!selectedNode}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      >
        <SheetContent className="detail-sheet">
          <SheetHeader>
            <SheetTitle>{selectedNode?.data.name ?? "对象详情"}</SheetTitle>
            <SheetDescription>
              维护示例字段；保存只保留当前页面草稿。
            </SheetDescription>
          </SheetHeader>
          {selectedNode && (
            <EntityForm
              key={selectedNode.id}
              data={selectedNode.data}
              existingCodes={nodes
                .filter((node) => node.id !== selectedNode.id)
                .map((node) => node.data.code)}
              onSave={(data) => saveEntity(data, selectedNode.id)}
              onCancel={() => setSelectedId(null)}
            />
          )}
        </SheetContent>
      </Sheet>
      <Sheet
        open={!!selectedRelation}
        onOpenChange={(open) => {
          if (!open) setSelectedRelation(null);
        }}
      >
        <SheetContent className="detail-sheet">
          <SheetHeader>
            <SheetTitle>关系详情</SheetTitle>
            <SheetDescription>
              关系类型与业务有效期间分别表达。
            </SheetDescription>
          </SheetHeader>
          {selectedRelation && (
            <div className="relation-detail">
              <Badge variant="outline">已发布的示例关系</Badge>
              <dl>
                <dt>关系类型</dt>
                <dd>{selectedRelation.data!.label}</dd>
                <dt>来源对象</dt>
                <dd>
                  {
                    nodes.find((node) => node.id === selectedRelation.source)
                      ?.data.name
                  }
                </dd>
                <dt>目标对象</dt>
                <dd>
                  {
                    nodes.find((node) => node.id === selectedRelation.target)
                      ?.data.name
                  }
                </dd>
                <dt>业务有效期间</dt>
                <dd>
                  {selectedRelation.data!.from} →{" "}
                  {selectedRelation.data!.to ?? "无固定结束"}
                </dd>
              </dl>
              <p>{selectedRelation.data!.purpose}</p>
              <p className="detail-note">
                图中位置只用于浏览。关系不代表法人隶属、行政上下级或物理地点。
              </p>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Dialog
        open={!!createKind}
        onOpenChange={(open) => {
          if (!open) setCreateKind(null);
        }}
      >
        <DialogContent className="entity-dialog">
          <DialogHeader>
            <DialogTitle>
              新增{createKind === "机构主体" ? "主体" : createKind}
            </DialogTitle>
            <DialogDescription>
              创建虚构示例草稿，刷新页面后重置。
            </DialogDescription>
          </DialogHeader>
          {createKind && (
            <EntityForm
              key={createKind}
              data={{
                name: "",
                code: "",
                kind: createKind,
                status: "新建草稿",
                draft: true,
              }}
              existingCodes={nodes.map((node) => node.data.code)}
              onSave={(data) => saveEntity(data)}
              onCancel={() => setCreateKind(null)}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="search-dialog" showCloseButton={false}>
          <DialogHeader className="sr-only">
            <DialogTitle>快速查找</DialogTitle>
            <DialogDescription>
              按名称或编码查找当前示例对象。
            </DialogDescription>
          </DialogHeader>
          <Command>
            <CommandInput
              aria-label="查找对象"
              placeholder="查找主体、院区、部门或服务单元…"
            />
            <CommandList aria-label="对象列表">
              <CommandEmpty>未找到匹配的示例对象</CommandEmpty>
              <CommandGroup heading="组织与院区">
                {nodes.map((node) => (
                  <CommandItem
                    key={node.id}
                    value={`${node.data.name} ${node.data.code}`}
                    onSelect={() => {
                      setSearchOpen(false);
                      setSelectedId(node.id);
                    }}
                  >
                    <Building2 />
                    <span>{node.data.name}</span>
                    <small>{node.data.code}</small>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!info}
        onOpenChange={(open) => {
          if (!open) setInfo(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{info}</DialogTitle>
            <DialogDescription>
              {info === "历史与有效期"
                ? "业务时点决定可见关系。选择 2024-06-01 可以查看南院区运营关系生效前的状态。"
                : info === "原型场景索引"
                  ? "本次可预览组织与院区的默认关系图、表格、历史时点、对象详情与部门服务单元场景。"
                  : "此页面为组织与院区独立交互原型。其他工作空间模块在后续范围中单独实现。"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            {info === "历史与有效期" && (
              <Button
                onClick={() => {
                  setDate("2024-06-01");
                  setView("graph");
                  setInfo(null);
                }}
              >
                查看历史时点
              </Button>
            )}
            <Button variant="outline" onClick={() => setInfo(null)}>
              返回组织与院区
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {notice && (
        <div className="save-notice" role="status">
          <Check />
          {notice}
        </div>
      )}
    </div>
  );
}

function EntityForm({
  data,
  existingCodes,
  onSave,
  onCancel,
}: {
  data: EntityData;
  existingCodes: string[];
  onSave: (data: EntityData) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(data);
  const [error, setError] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    const normalized = {
      ...draft,
      name: draft.name.trim(),
      code: draft.code.trim(),
      ...(draft.kind === "服务单元"
        ? { unitType: draft.unitType ?? "门诊单元" }
        : {}),
    };
    if (!normalized.name || !normalized.code) {
      setError("请填写名称和编码。");
      return;
    }
    if (
      existingCodes.some(
        (code) => code.toUpperCase() === normalized.code.toUpperCase(),
      )
    ) {
      setError("编码已存在，请使用不同的示例编码。");
      return;
    }
    onSave(normalized);
  }
  return (
    <form className="entity-form" onSubmit={submit} noValidate>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="entity-name">名称</FieldLabel>
          <Input
            id="entity-name"
            value={draft.name}
            autoComplete="off"
            maxLength={60}
            onChange={(event) => {
              setDraft({ ...draft, name: event.target.value });
              setError("");
            }}
            placeholder="填写对象名称"
            aria-describedby={error ? "entity-error" : undefined}
            aria-invalid={!!error && !draft.name.trim()}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="entity-code">编码</FieldLabel>
          <Input
            id="entity-code"
            value={draft.code}
            autoComplete="off"
            maxLength={40}
            onChange={(event) => {
              setDraft({ ...draft, code: event.target.value });
              setError("");
            }}
            placeholder="例如 ORG-0003"
            aria-describedby={error ? "entity-error" : undefined}
            aria-invalid={!!error}
          />
          <FieldDescription>示例身份编码须在当前页面内唯一。</FieldDescription>
        </Field>
        <Field>
          <FieldLabel>对象类别</FieldLabel>
          <div className="readonly-field">{draft.kind}</div>
        </Field>
        {draft.kind === "服务单元" && (
          <Field>
            <FieldLabel htmlFor="unit-type">服务单元类型</FieldLabel>
            <Select
              value={draft.unitType ?? "门诊单元"}
              onValueChange={(unitType) => setDraft({ ...draft, unitType })}
            >
              <SelectTrigger id="unit-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {["门诊单元", "住院单元", "急诊单元", "医技单元"].map(
                    (type) => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ),
                  )}
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldDescription>
              病区、护理单元、医疗服务与物理地点分别表达。
            </FieldDescription>
          </Field>
        )}
      </FieldGroup>
      {error && (
        <p className="form-error" id="entity-error" role="alert">
          {error}
        </p>
      )}
      <p className="detail-note">虚构示例 · 保存仅保留当前页面草稿</p>
      <div className="form-actions">
        <Button type="button" variant="outline" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit">保存草稿</Button>
      </div>
    </form>
  );
}
