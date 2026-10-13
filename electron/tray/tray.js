const { Tray, Menu } = require('electron');

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function createTray({ icon, settings, tasks, characters, getPet, openTasks, pause, exit, care }) {
  const tray = new Tray(icon);
  tray.setToolTip('Desktop Buddy');
  tray.on('click', () => openTasks('/tasks'));

  function todaysTasks() {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return tasks.list()
      .filter((t) => t.status === 'PENDING' && (t.nextOccurrenceAt || t.dueAt) && new Date(t.nextOccurrenceAt || t.dueAt) <= end)
      .slice(0, 10);
  }

  function template() {
    const s = settings.getAll();
    const pet = getPet();
    const visible = pet && pet.isVisible();
    const paused = s.pausedUntil && Date.parse(s.pausedUntil) > Date.now();
    const today = todaysTasks();
    const stats = care ? care.stats() : null;

    return [
      { label: visible ? 'Hide buddy' : 'Show buddy', accelerator: 'Ctrl+Alt+B', click: () => (visible ? pet.hide() : pet.show()) },
      ...(stats ? [
        {
          label: stats.treats ? `Feed a treat 🍪 (${stats.treats} left)` : 'Feed a treat 🍪 (finish a task to earn one)',
          enabled: stats.treats > 0 && !!visible,
          click: () => care.feed(),
        },
        { label: care.hintStats(), enabled: false },
        { type: 'separator' },
      ] : []),
      { label: 'Open task manager', click: () => openTasks('/tasks') },
      { label: 'Add a task…', click: () => openTasks('/tasks/new') },
      { label: 'Chat & bookmarks', click: () => openTasks('/chat') },
      { label: 'Notepad', click: () => openTasks('/notepad') },
      { label: 'Calculator', click: () => openTasks('/calculator') },
      {
        label: `Today's tasks (${today.length})`,
        submenu: today.length
          ? today.map((t) => ({
            label: `${t.nextOccurrenceAt || t.dueAt ? `${fmtTime(t.nextOccurrenceAt || t.dueAt)}  ` : ''}${t.title}`.slice(0, 60),
            click: () => openTasks(`/tasks/${t.id}`),
          }))
          : [{ label: 'Nothing left today 🎉', enabled: false }],
      },
      { type: 'separator' },
      {
        label: paused ? `Reminders paused until ${fmtTime(s.pausedUntil)}` : 'Pause reminders',
        submenu: [
          ...(paused ? [{ label: 'Resume now', click: () => pause(null) }, { type: 'separator' }] : []),
          { label: 'For 30 minutes', click: () => pause(30) },
          { label: 'For 1 hour', click: () => pause(60) },
          { label: 'For 3 hours', click: () => pause(180) },
          { label: 'Until tomorrow morning', click: () => {
            const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(8, 0, 0, 0);
            pause(Math.round((t - Date.now()) / 60_000));
          } },
        ],
      },
      {
        label: 'Character',
        submenu: characters().map(({ id, name }) => ({
          label: name, type: 'radio', checked: s.character === id,
          click: () => settings.update({ character: id }),
        })),
      },
      {
        label: pet && pet.isSleeping() ? 'Wake buddy up' : 'Put buddy to sleep',
        click: () => pet && pet.setSleeping(!pet.isSleeping()),
      },
      ...(care && !s.weather?.location && s.weather?.enabled ? [{ label: 'Set weather location…', click: () => openTasks('/settings') }] : []),
      {
        label: 'Show weather', type: 'checkbox', checked: !!s.weather?.enabled,
        click: (item) => settings.update({ weather: { enabled: item.checked } }),
      },
      { label: 'Settings…', click: () => openTasks('/settings') },
      { type: 'separator' },
      { label: 'Exit Desktop Buddy', click: exit },
    ];
  }

  // Built fresh on every open so "Today's tasks" and labels are always current.
  tray.on('right-click', () => tray.popUpContextMenu(Menu.buildFromTemplate(template())));

  return { popup: (win) => Menu.buildFromTemplate(template()).popup({ window: win }), tray };
}

module.exports = { createTray };
