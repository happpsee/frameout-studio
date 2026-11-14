import type { ProjectSummary } from '../../lib/projects';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** How long a deleted project stays restorable. */
export const TRASH_DAYS = 30;

/** A plain greeting for the hour of day. */
export function greeting(hour: number): string {
  if (hour >= 5 && hour < 11) return '早上好';
  if (hour >= 11 && hour < 13) return '中午好';
  if (hour >= 13 && hour < 18) return '下午好';
  if (hour >= 18 && hour < 23) return '晚上好';
  return '夜深了';
}

/** 00:12 or 1:02:03. */
function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const pad = (value: number) => String(value).padStart(2, '0');
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return hours ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${pad(minutes)}:${pad(rest)}`;
}

/** "刚刚", "12 分钟前", "3 天前", or a date once it is a month old. */
export function timeAgo(time: number, now: number): string {
  const elapsed = Math.max(0, now - time);
  if (elapsed < MINUTE) return '刚刚';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} 分钟前`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} 小时前`;
  const days = Math.floor(elapsed / DAY);
  if (days === 1) return '昨天';
  if (days < 30) return `${days} 天前`;
  const date = new Date(time);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  const day = `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
  return sameYear ? day : `${date.getFullYear()} 年 ${day}`;
}

export type ProjectStage = 'blank' | 'material' | 'film';

export function projectStage(project: ProjectSummary): ProjectStage {
  if (project.shotCount > 0) return 'film';
  return project.cardCount > 0 ? 'material' : 'blank';
}

/** The short status under a card title. */
export function projectStatus(project: ProjectSummary): string {
  const stage = projectStage(project);
  if (stage === 'film')
    return `成片 ${project.shotCount} 个镜头 · ${formatDuration(project.durationSeconds)}`;
  if (stage === 'material') return `${project.cardCount} 个素材`;
  return '空白';
}

/** Whole days a deleted project can still be restored; at least 1 until it is purged. */
export function daysLeft(deletedAt: number, now: number): number {
  const left = Math.ceil((deletedAt + TRASH_DAYS * DAY - now) / DAY);
  return Math.min(TRASH_DAYS, Math.max(1, left));
}

export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
}
