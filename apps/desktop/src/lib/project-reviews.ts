import { accept, agentOfTask, isTask } from './assign';
import { docText, objects } from './objects';
import { folders } from './project-runtime/folders';
import { ask } from './project-runtime/transport';
import { propOf, space } from './space';
import { reportOf, reportsOn } from './work';
import { agentState, sessions, watchWork } from './work-watch';

export type HostReview = { task: string; title: string; report: string; reportTitle: string; text: string };
export function shareProjectReviews() {
  const published = new Map<string, string>();
  let stopped = false,
    dirty = true,
    running = false,
    timer: ReturnType<typeof setTimeout> | undefined;
  async function write() {
    if (running || stopped) return;
    running = true;
    try {
      while (dirty && !stopped) {
        dirty = false;
        const pages = space.get().pages;
        for (const [project, link] of folders.get()) {
          if (link.missing) continue;
          const items = [];
          for (const task of pages) {
            if (
              !isTask(task) ||
              task.properties.done ||
              !Object.entries(task.properties).some(
                ([k, v]) => propOf(k)?.options.type === 'project' && Array.isArray(v) && v.includes(project),
              )
            )
              continue;
            const agent = agentOfTask(task);
            if (!agent || agentState(task, agent, sessions.get()) !== 'review') continue;
            const last = reportsOn(task.id, pages)
              .filter((r) => reportOf(r)?.by === agent.id)
              .at(-1);
            if (last) items.push({ task, title: task.title, report: last });
          }
          const remoteActions = await ask<{ folder: string; task: string; report: string }[]>(
            'GET',
            '/v1/mobile/review-actions/' + link.folder.location,
          );
          for (const a of remoteActions) {
            if (a.folder === link.folder.folderId && items.some((i) => i.task.id === a.task && i.report.id === a.report)) {
              await accept(a.task, a.report);
              dirty = true;
            }
            await ask('DELETE', '/v1/mobile/review-actions/' + link.folder.location + '/' + a.report);
          }
          if (remoteActions.length) {
            dirty = true;
            continue;
          }
          const stamp = JSON.stringify([
            link.folder.folderId,
            ...items.map((i) => [i.task.id, i.title, i.report.id, i.report.updatedAt]),
          ]);
          if (stamp === published.get(project)) continue;
          const reviews: HostReview[] = [];
          for (const i of items) {
            const report = await objects.get(i.report.id);
            if (report)
              reviews.push({
                task: i.task.id,
                title: i.title,
                report: report.id,
                reportTitle: report.title,
                text: docText(report.content).slice(0, 16000),
              });
          }
          if (stopped) return;
          await ask('PUT', '/v1/mobile/reviews/' + link.folder.location, { folder: link.folder.folderId, reviews });
          published.set(project, stamp);
        }
      }
    } catch {
      dirty = true;
    } finally {
      running = false;
    }
  }
  const change = () => {
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(write, 350);
  };
  const stop = [space.subscribe(change), folders.subscribe(change), sessions.subscribe(change), watchWork()];
  const retry = setInterval(() => {
    dirty = true;
    void write();
  }, 12000);
  change();
  return () => {
    stopped = true;
    clearTimeout(timer);
    clearInterval(retry);
    stop.forEach((fn) => fn?.());
  };
}
