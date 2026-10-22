import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
const require = createRequire(import.meta.url);
const { open } = require('../../electron/database/db');
const { createProjectService, kindOf } = require('../../electron/services/projects');
const v = require('../../electron/services/validation');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-projects-'));
  let t = Date.parse('2026-10-12T08:00:00.000Z');
  const projects = createProjectService({ db: open(':memory:'), filesDir: path.join(dir, 'files'), clock: () => new Date(t += 1000) });
  return { dir, projects };
}

describe('projects', () => {
  it('creates projects with tasks, notes and counts', () => {
    const { projects } = setup();
    const p = projects.create(v.parse(v.projectInput, { name: 'Website' }));
    const a = projects.addTask(p.id, { title: 'Design' });
    projects.addTask(p.id, { title: 'Build', dueDate: '2026-11-01' });
    projects.updateTask(a.id, { done: true });
    const n = projects.addNote(p.id, { title: 'Kickoff' });
    projects.updateNote(n.id, { body: 'Agenda' });

    const d = projects.detail(p.id);
    expect(d.counts).toEqual({ tasks: 2, done: 1, notes: 1, files: 0 });
    expect(d.tasks[d.tasks.length - 1]).toMatchObject({ title: 'Design', done: true });
    expect(d.notes[0]).toMatchObject({ title: 'Kickoff', body: 'Agenda' });
    expect(projects.list()[0].id).toBe(p.id);
  });

  it('copies files into the project and removes them with it', () => {
    const { dir, projects } = setup();
    const src = path.join(dir, 'spec.pdf');
    fs.writeFileSync(src, 'pdf');
    const p = projects.create({ name: 'Docs' });
    const { added, skipped } = projects.addFiles(p.id, [src, path.join(dir, 'missing.png')]);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ name: 'spec.pdf', kind: 'pdf', size: 3 });
    expect(skipped[0].name).toBe('missing.png');
    const stored = projects.filePath(added[0].id);
    expect(fs.readFileSync(stored, 'utf8')).toBe('pdf');

    projects.remove(p.id);
    expect(fs.existsSync(stored)).toBe(false);
    expect(() => projects.get(p.id)).toThrow('Project not found');
  });

  it('classifies files and validates input', () => {
    expect(kindOf('a.JPG')).toBe('image');
    expect(kindOf('clip.mp4')).toBe('video');
    expect(kindOf('x.zip')).toBe('other');
    expect(() => v.parse(v.projectInput, { name: ' ' })).toThrow('Name is required');
    expect(() => v.parse(v.projectTaskInput, { title: 'x', dueDate: '1/2/26' })).toThrow();
  });
});
