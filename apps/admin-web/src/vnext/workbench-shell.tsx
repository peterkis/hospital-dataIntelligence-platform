import type { MouseEvent, ReactNode } from 'react';
import { Button } from '../components/ui/button.js';
import { Badge } from '../components/ui/badge.js';
import { useWorkbenchUiStore } from './workbench-ui-store.js';
import { Link, useLocation } from 'react-router';
import './workbench-shell.css';

export type WorkbenchSection = 'organization' | 'dictionary' | 'imports' | 'review';

export type WorkbenchShellProps = {
  children: ReactNode;
  actor: string;
  onActorChange: (actor: string) => void;
  locked?: boolean;
  active?: WorkbenchSection;
  title?: string;
  reviewHref?: string;
  showActor?: boolean;
  reloadNavigation?: boolean;
  actorOptions?: readonly (readonly [string, string])[];
};

type IconName = 'organization' | 'people' | 'dictionary' | 'imports' | 'review' | 'sidebar';
function NavigationIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    organization: <><rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M9 7h2m2 0h2M9 11h2m2 0h2M9 15h2m2 0h2M10 21v-3h4v3"/></>,
    people: <><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v2"/></>,
    dictionary: <><path d="M4 4h6a3 3 0 0 1 3 3v14a3 3 0 0 0-3-3H4zM13 7a3 3 0 0 1 3-3h4v14h-4a3 3 0 0 0-3 3"/></>,
    imports: <><path d="M12 3v12m-4-4 4 4 4-4M4 15v5h16v-5"/></>,
    review: <><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M9 12l2 2 4-4"/></>,
    sidebar: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></>,
  };
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function WorkbenchShell({ children, actor, onActorChange, locked = false, active = 'organization', title = '组织与院区', reviewHref, showActor = true, reloadNavigation = false, actorOptions = [['maker','编辑人'],['maker-alias','编辑人别名（同一人）'],['reviewer','独立核验 / 复核人'],['outsider','无授权身份']] }: WorkbenchShellProps) {
  const {pathname} = useLocation();
  const collapsed = useWorkbenchUiStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useWorkbenchUiStore((state) => state.toggleSidebar);
  const preventLockedNavigation = (event: MouseEvent<HTMLAnchorElement>) => { if (locked) event.preventDefault(); };
  const target = (href: string) => { const url = new URL(href, window.location.origin); url.searchParams.set('actor', actor); return url.pathname.replace(/^\/admin\/vnext(?=\/|$)/, '') + url.search; };
  const link = (section: WorkbenchSection, label: string, href: string, icon: IconName) => (
    <Link className="workbench-shell__nav-item" to={target(href)} reloadDocument={reloadNavigation} aria-current={active === section ? 'page' : undefined} aria-disabled={locked || undefined} onClick={preventLockedNavigation} title={collapsed ? label : undefined}>
      <NavigationIcon name={icon}/><span className="workbench-shell__nav-label">{label}</span>
    </Link>
  );

  return <div className="workbench-shell" data-sidebar-collapsed={collapsed}>
    <a className="workbench-shell__skip" href="#workbench-content">跳到工作区</a>
    <aside className="workbench-shell__sidebar" aria-label="工作台导航">
      <div className="workbench-shell__brand"><span className="workbench-shell__mark" aria-hidden="true">H</span><div className="workbench-shell__nav-label"><strong>数据维护工作台</strong><span>医院基础数据</span></div></div>
      <Button variant="ghost" size="icon" className="workbench-shell__collapse" onClick={toggleSidebar} aria-controls="workbench-navigation" aria-expanded={!collapsed} aria-label={collapsed ? '展开导航' : '收起导航'} title={collapsed ? '展开导航' : '收起导航'}><NavigationIcon name="sidebar"/></Button>
      <nav id="workbench-navigation" className="workbench-shell__navigation" aria-label="主要模块">
        <p className="workbench-shell__group-label">工作空间</p>
        {link('organization', '组织与院区', '/admin/vnext/care-space', 'organization')}
        {active === 'organization' && <div className="workbench-shell__subnav">
          <Link to={target('/admin/vnext/departments')} aria-current={pathname.endsWith('/departments')?'page':undefined} reloadDocument={reloadNavigation} aria-disabled={locked || undefined} onClick={preventLockedNavigation}>逻辑科室</Link>
          <Link to={target('/admin/vnext/organizations')} aria-current={pathname.endsWith('/organizations')?'page':undefined} reloadDocument={reloadNavigation} aria-disabled={locked || undefined} onClick={preventLockedNavigation}>机构与院区</Link>
          <Link to={target('/admin/vnext/care-space')} aria-current={pathname.includes('/care-space')?'page':undefined} reloadDocument={reloadNavigation} aria-disabled={locked || undefined} onClick={preventLockedNavigation}>业务单元与关系</Link>
        </div>}
        <div className="workbench-shell__nav-item workbench-shell__nav-item--unavailable" title="人员身份、聘用与任职接口尚未接入" aria-disabled="true"><NavigationIcon name="people"/><span className="workbench-shell__nav-label">人员<span className="workbench-shell__unavailable-note">待接入</span></span></div>
        {link('dictionary', '字典与标准', '/admin/vnext/location-usage-types', 'dictionary')}
        {link('imports', '导入任务', '/admin/vnext/imports', 'imports')}
        {reviewHref ? link('review', '变更与审核', reviewHref, 'review') : <div className="workbench-shell__nav-item workbench-shell__nav-item--unavailable" title="在各对象的申请区处理；尚无统一审核列表" aria-disabled="true"><NavigationIcon name="review"/><span className="workbench-shell__nav-label">变更与审核<span className="workbench-shell__unavailable-note">按对象处理</span></span></div>}
      </nav>
      <div className="workbench-shell__sidebar-footer"><span className="workbench-shell__nav-label">当前仅使用虚构业务数据</span><Badge variant="outline">合成环境</Badge></div>
    </aside>
    <div className="workbench-shell__canvas">
      <header className="workbench-shell__topbar"><div className="workbench-shell__breadcrumb"><span>工作空间</span><span aria-hidden="true">/</span><span>{title}</span></div>{showActor&&<label className="workbench-shell__actor"><span>当前身份</span><select value={actor} disabled={locked} onChange={(event) => onActorChange(event.target.value)} aria-describedby="workbench-identity-note">{!actorOptions.some(([value])=>value===actor)&&<option value={actor}>当前身份（权限由服务器核验）</option>}{actorOptions.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>}</header>
      <p id="workbench-identity-note" className="workbench-shell__identity-note">合成环境身份用于验证权限；所有保存与审批均由服务器核验。{locked && ' 请先完成当前编辑或核对请求结果，再切换工作区。'}</p>
      <div id="workbench-content" className="workbench-shell__content" tabIndex={-1}>{children}</div>
    </div>
  </div>;
}

export { WorkbenchShell as AppShell };
