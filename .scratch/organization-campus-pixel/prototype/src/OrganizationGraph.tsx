import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type NodeProps,
  type EdgeProps,
  type NodeChange,
  type ReactFlowInstance,
} from "@xyflow/react";
import {
  BadgeCheck,
  Building2,
  CircleCheck,
  Clock3,
  FilePenLine,
  Hospital,
  Network,
  Stethoscope,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { EntityNode, RelationEdge } from "./data";

const entityIcons = {
  机构主体: Hospital,
  院区: Building2,
  部门: Network,
  服务单元: Stethoscope,
};
const OpenRelationContext = createContext<(id: string) => void>(() => {});

const EntityCard = memo(function EntityCard({
  data,
  selected,
}: NodeProps<EntityNode>) {
  const Icon = entityIcons[data.kind];
  const statusVariant = data.draft
    ? "flow-draft"
    : data.status === "运行"
      ? "flow-running"
      : data.status === "筹建"
        ? "flow-planning"
        : "flow-neutral";
  const StatusIcon = data.draft
    ? FilePenLine
    : data.status === "运行"
      ? CircleCheck
      : data.status === "筹建"
        ? Clock3
        : BadgeCheck;
  return (
    <Card
      variant="flow"
      className={cn(
        "entity-card",
        data.draft && "entity-draft",
        selected && "entity-selected",
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="left"
        isConnectable={false}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        isConnectable={false}
      />
      <CardHeader className="entity-header">
        <span className="entity-icon" data-kind={data.kind} aria-hidden="true">
          <Icon />
        </span>
        <div className="entity-heading">
          <CardTitle title={data.name}>{data.name}</CardTitle>
          <CardDescription>{data.code}</CardDescription>
        </div>
      </CardHeader>
      <Separator />
      <CardFooter className="entity-footer">
        <span className="entity-kind">{data.kind}</span>
        <Badge variant={statusVariant}>
          <StatusIcon aria-hidden="true" />
          {data.status}
        </Badge>
      </CardFooter>
    </Card>
  );
});

function RelationLine(props: EdgeProps<RelationEdge>) {
  const openRelation = useContext(OpenRelationContext);
  const isOperating = props.data?.label.startsWith("运营") ?? false;
  const [path, x, y] = getSmoothStepPath({ ...props, borderRadius: 3 });
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        interactionWidth={22}
        style={{
          stroke: props.selected
            ? "var(--flow-link-active)"
            : "var(--flow-link)",
          strokeWidth: 1,
          strokeDasharray: "4 4",
        }}
      />
      <EdgeLabelRenderer>
        <button
          type="button"
          className={cn(
            "relation-label nodrag nopan",
            props.selected && "relation-selected",
          )}
          onClick={() => openRelation(props.id)}
          aria-label={`${props.data?.label}，${props.data?.from}至${props.data?.to ?? "无固定结束"}，查看关系详情`}
          style={{
            transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`,
          }}
        >
          <Badge variant={isOperating ? "flow-relation" : "flow-neutral"}>
            {props.data?.label}
          </Badge>
          <small>
            {props.data?.from} → {props.data?.to ?? "无固定结束"}
          </small>
        </button>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { entity: EntityCard };
const edgeTypes = { relation: RelationLine };
const initialViewport = { x: 0, y: 0, zoom: 1.05 };

type Props = {
  nodes: EntityNode[];
  edges: RelationEdge[];
  layoutMode: string;
  onNodesChange: (changes: NodeChange<EntityNode>[]) => void;
  onNodeSelect: (node: EntityNode) => void;
  onEdgeSelect: (edge: RelationEdge) => void;
};

export function OrganizationGraph({
  nodes,
  edges,
  layoutMode,
  onNodesChange,
  onNodeSelect,
  onEdgeSelect,
}: Props) {
  const [zoom, setZoom] = useState(1.05);
  const flow = useRef<ReactFlowInstance<EntityNode, RelationEdge> | null>(null);
  const previousMode = useRef(layoutMode);
  const openRelation = useCallback(
    (id: string) => {
      const edge = edges.find((item) => item.id === id);
      if (edge) onEdgeSelect(edge);
    },
    [edges, onEdgeSelect],
  );
  useEffect(() => {
    if (previousMode.current !== layoutMode && flow.current) {
      if (layoutMode === "base")
        flow.current.setViewport(initialViewport, { duration: 250 });
      else flow.current.fitView({ padding: 0.22, duration: 250 });
      previousMode.current = layoutMode;
    }
  }, [layoutMode]);
  return (
    <OpenRelationContext.Provider value={openRelation}>
      <div
        className="graph-surface"
        aria-label="组织与院区关系图"
        onKeyDownCapture={(event) => {
          if (event.key !== "Enter") return;
          const target = event.target as HTMLElement;
          const nodeId =
            target.closest<HTMLElement>(".react-flow__node")?.dataset.id;
          const edgeId =
            target.closest<HTMLElement>(".react-flow__edge")?.dataset.id;
          const node = nodes.find((item) => item.id === nodeId);
          const edge = edges.find((item) => item.id === edgeId);
          if (node || edge) {
            event.preventDefault();
            event.stopPropagation();
            if (node) onNodeSelect(node);
            else if (edge) onEdgeSelect(edge);
          }
        }}
      >
        <ReactFlow<EntityNode, RelationEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onNodeClick={(_, node) => onNodeSelect(node)}
          onEdgeClick={(_, edge) => onEdgeSelect(edge)}
          onInit={(instance) => {
            flow.current = instance;
          }}
          fitView={
            window.innerWidth < 1200 ||
            layoutMode !== "base" ||
            nodes.some((node) => node.id.startsWith("draft-"))
          }
          fitViewOptions={{ padding: 0.15, minZoom: 0.3, maxZoom: 1.05 }}
          defaultViewport={initialViewport}
          minZoom={0.3}
          maxZoom={1.8}
          onMove={(_, viewport) => setZoom(viewport.zoom)}
          nodesConnectable={false}
          edgesReconnectable={false}
          deleteKeyCode={null}
          ariaLabelConfig={{
            "controls.zoomIn.ariaLabel": "放大",
            "controls.zoomOut.ariaLabel": "缩小",
            "controls.fitView.ariaLabel": "适应画布",
            "node.a11yDescription.default": "按 Enter 查看对象详情。",
            "node.a11yDescription.keyboardDisabled":
              "按 Enter 查看对象详情；按空格选中后，用方向键调整浏览位置。",
            "edge.a11yDescription.default": "按 Enter 查看关系详情。",
          }}
          attributionPosition="bottom-right"
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={0.8}
            color="var(--flow-grid)"
          />
          <Controls
            showInteractive={false}
            orientation="horizontal"
            fitViewOptions={{ padding: 0.2 }}
          />
        </ReactFlow>
        <div className="canvas-count">
          {nodes.length} 个对象 <span>·</span> {edges.length} 条关系
        </div>
        <div className="canvas-hint">点击对象或连线查看详情</div>
        <span className="zoom-value" aria-live="polite">
          {Math.round(zoom * 100)}%
        </span>
      </div>
    </OpenRelationContext.Provider>
  );
}
