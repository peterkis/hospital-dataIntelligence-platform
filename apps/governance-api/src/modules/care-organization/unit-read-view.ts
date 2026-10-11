import type {UnitHistory, UnitVersion} from './contracts.js';
import {knownUnit, unitAt, declaredBindingAt} from './timeline.js';
import {careState} from './care-lifecycle-time.js';

export type UnitReadState = 'ACTIVE' | 'SUSPENDED' | 'CLOSED' | 'NOT_EFFECTIVE';
export interface UnitListFilter {
  campus: 'NORTH' | 'SOUTH';
  campusId?: string;
  departmentId?: string;
  after?: string;
  limit?: number;
  businessAt?: string;
  recordAsOf?: string;
  q?: string;
  state?: UnitReadState;
}

/** Same business-time decision as the Owner's existing as-of read. */
export function unitReadState(history: UnitHistory, at: string): UnitReadState {
  if (unitAt(history, at)) return 'ACTIVE';
  const lifecycle = careState(history.versions, at);
  return lifecycle === 'ACTIVE' ? 'NOT_EFFECTIVE' : lifecycle;
}

/** A registration label identifies an inactive record; it is never an active fact. */
export function unitDisplayAt(history: UnitHistory, at: string) {
  const current = unitAt(history, at);
  const label: UnitVersion | undefined = current ?? history.versions.filter(
    version => version.action === 'CREATE' || version.action === 'REVISE',
  ).at(-1);
  if (!label) return null;
  return {
    name: label.facts.unitName,
    code: label.facts.unitCode,
    type: label.facts.unitType,
    version: label.number,
    validFrom: label.validFrom,
    validTo: label.validTo,
    mode: current ? 'CURRENT' as const : 'REGISTERED' as const,
  };
}

/** Input histories have already passed the Owner's SQL authorization boundary.
 * Filter the authorized set before slicing; never search just the displayed page.
 * This reuses the finite Owner reader, not an independent search index or engine.
 */
export function selectUnitPage(histories: readonly UnitHistory[], input: UnitListFilter, at: string) {
  const q = input.q?.trim().toLowerCase();
  const matches = histories.map(history => knownUnit(history, input.recordAsOf))
    .filter(history => {
      if (!history.versions.length) return false;
      if (input.departmentId && history.departmentId !== input.departmentId) return false;
      if (input.after && history.id <= input.after) return false;
      if (input.campusId && declaredBindingAt(history, at)?.campusId !== input.campusId) return false;
      if (input.state && unitReadState(history, at) !== input.state) return false;
      if (!q) return true;
      const label = unitDisplayAt(history, at);
      return !!label && [label.name, label.code].some(value => value.toLowerCase().includes(q));
    }).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const page = matches.slice(0, input.limit ?? 50);
  return {page, nextAfterId: matches.length > page.length ? page.at(-1)!.id : null};
}
