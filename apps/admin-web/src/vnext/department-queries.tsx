import { useEffect, useRef, useState } from "react";
import {
  createVNextCatalogClient,
  type VNextOperations as Operations,
} from "@hospital-data-intelligence/generated-api-client";
import {
  DepartmentForm,
  DepartmentData,
  initialForm,
  type FormSchema,
  type ReferenceChoices,
} from "./department-form.js";
import { departmentForms } from "./department-forms.generated.js";
import { departmentValue as value } from "./department-request.js";
type History =
  Operations["getDepartmentVersionHistory"]["responses"][200]["content"]["application/json"];
const queries = {
  getDepartmentAsOf: "按业务 B / 记录 R 查询",
  getExactDepartmentReference: "读取准确版本引用",
  getDepartmentCoverage: "核对完整期间覆盖",
  compareDepartmentVersions: "比较两个版本",
  getDepartmentVersionHistory: "按 R 查询版本历史",
} as const;
type Query = keyof typeof queries;
export function DepartmentQueries({
  actor,
  histories,
}: {
  actor: string;
  histories: History[];
}) {
  const [operation, setOperation] = useState<Query>("getDepartmentAsOf"),
    [body, setBody] = useState<unknown>(() =>
      initialForm(
        departmentForms.operations.getDepartmentAsOf.schema as FormSchema,
      ),
    ),
    [result, setResult] = useState<unknown>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const choices: ReferenceChoices = {
    objects: histories.map((item) => ({
      value: item.id,
      label: `${item.versions.at(-1)?.facts.name ?? item.initialCode} · ${item.initialCode}`,
    })),
  };
  return (
    <section className="department-queries">
      <h2>科室时点与版本核对</h2>
      <label>
        查询方式
        <select
          aria-label="科室查询方式"
          value={operation}
          disabled={busy}
          onChange={(event) => {
            const next = event.target.value as Query;
            setOperation(next);
            setBody(
              initialForm(
                departmentForms.operations[next].schema as FormSchema,
              ),
            );
            setResult(null);
            setError("");
          }}
        >
          {Object.entries(queries).map(([key, label]) => (
            <option value={key} key={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <DepartmentForm
        schema={departmentForms.operations[operation].schema as FormSchema}
        value={body}
        onChange={setBody}
        choices={choices}
        disabled={busy}
      />
      <button
        disabled={busy}
        onClick={() =>
          void (async () => {
            setBusy(true);
            setError("");
            try {
              const client = createVNextCatalogClient(location.origin, actor),
                output = await value(
                  client.POST(
                    departmentForms.operations[operation].path as Parameters<
                      typeof client.POST
                    >[0],
                    { body: body as never },
                  ),
                );
              if (alive.current) setResult(output);
            } catch (error) {
              if (alive.current)
                setError(error instanceof Error ? error.message : "查询失败");
            } finally {
              if (alive.current) setBusy(false);
            }
          })()
        }
      >
        查询科室
      </button>
      <p role="status">{error}</p>
      <DepartmentData value={result} label="当前 Owner 查询结果" />
    </section>
  );
}
