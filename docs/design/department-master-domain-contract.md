# Department Master Domain Contract

This document records the implementation boundary for PV-005-A.1. It does not define HTTP routes, UI, external-system integration, or formal acceptance.

## Stable identity and semantic versions

`Department` is the permanent, non-reusable hospital-level identity. `DepartmentVersion` is an immutable published semantic version; names, type, duties, mapping applicability, lifecycle, business validity, and record time belong to the version. A generic parent department and campus do not.

Draft content may be edited inside the department module and its semantic SHA-256 digest must be recomputed. The digest excludes Workflow state, `releaseId`, and update metadata. Workflow owns submission, review, rejection, and approval; the domain version stores only `DRAFT` or `PUBLISHED`. Final publication atomically registers the release, freezes the snapshot, changes `DRAFT` to `PUBLISHED`, records `releaseId`, appends audit evidence, and closes the prior published record period.

## Independent hierarchy views

Administrative, operational, and medical-record hierarchies are independently governed strict trees or forests. Finance and statistical types are registration-only in this prototype. A hierarchy view version freezes its complete node set, display names, and explicit department or group versions. Group nodes are view-local and never receive a department stable identity.

## Source evidence and source binding

`DepartmentAlias` is confirmed name or alias evidence for a known department. It is not an executable source-code binding. `DepartmentSourceMapping` binds a source-system department code to a department stable identity and begins in `PENDING`; it can transition once to `CONFIRMED` or `REJECTED` without changing its binding content.

`DepartmentSubjectMapping` is reserved for a future governed mapping between departments and medical-institution diagnostic-subject codes. It is separate from source-system mapping and is not implemented by PV-005-A.1.

## Campus assignment and subject applicability

Department-to-campus membership is an independent, append-only, bitemporal relation. One department may serve multiple campuses without copying its stable identity. Changes close the former record period and append a new relation; `campusId` never enters `DepartmentVersion`.

`subjectMappingApplicability` has five values: `REQUIRED_OUTPATIENT`, `REQUIRED_CLINICAL_SERVICE`, `EXEMPT_MEDICAL_TECHNOLOGY`, `EXEMPT_AUXILIARY`, and `PENDING_DETERMINATION`. Clinical or mixed-duty departments require a `REQUIRED_*` value. Only pure medical-technology or auxiliary departments may use their corresponding exemption. Insufficient evidence uses `PENDING_DETERMINATION`; names are never used to infer applicability.

## Lifecycle fail-closed boundary

- `SUSPENDED` may later resume using the same stable department identity.
- `DEPRECATED` is a permanent exit without a successor.
- `SUPERSEDED` requires an explicit department-evolution relation and therefore fails with `DEPARTMENT_EVOLUTION_RELATION_REQUIRED` until that model exists.
- Department split and merge are outside the PV-005-B basic HTTP lifecycle.

## Time contract

All business, record, publication, audit, and relation timestamps are timezone-free local date-times interpreted only as `Asia/Shanghai`. PostgreSQL uses `timestamp without time zone` and `tsrange`; UTC, `Z`, offsets, `timestamptz`, and timestamp-with-time-zone values are forbidden.
