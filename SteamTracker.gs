// ---------- Settings ----------
// Defaults. Everything here can be changed from Achievement Tracker > Settings.
const DEFAULTS = {
  sheetName: 'Sheet1',   // tab to update (falls back to the first tab if it isn't found)
  autoMinutes: 15,       // auto-update frequency; Google allows 1, 5, 10, 15 or 30
  sharedMinutes: 60,     // Family-shared and free-to-play games (no playtime from Steam) are re-checked at most this often
  recentHours: 6,        // games played within this many hours are always re-checked (catches mid-session achievements)
  statusColumn: true,    // fill the STATUS column
  genreColumn: true,     // fill the GENRE column (if the sheet has one)
  linkNames: true,       // turn game names into links to their Steam store pages
  postLastPlayed: true,  // Discord: post after a play session
  postCompletion: true,  // Discord: post when a game reaches 100%
  weeklyOn: true,        // Discord: weekly summary
  weeklyDay: 0,          // 0 = Sunday ... 6 = Saturday, in the sheet's time zone
  weeklyHour: 20,        // 0-23
  autoOn: false,         // remembers whether auto-update was turned on from the menu
  raOn: false,           // RetroAchievements on a second tab
  raSheetName: 'RetroAchievements',
  raWantAuto: false,     // RetroAchievements: add new games from your Want to Play list to the tab on every update
  statusColours: false,  // BACKLOG STATUS column: colour the cells (conditional formatting managed by the script)
  statusColourMap: { COMPLETED: '#d9d2e9', ACTIVE: '#d9ead3', IDLE: '#ffe599', BACKLOG: '#f4cccc' },
  idleAmount: 6,         // BACKLOG STATUS column: a played game not played for this long becomes IDLE (0 = never)
  idleUnit: 'months',    // 'days', 'weeks' or 'months'
  gameRows: 250,         // game rows created on a new blank sheet (use Add game rows to grow it later)
  sortRange: '',         // columns the Sort options move, e.g. 'A:L'. Empty = automatic (GAME LIST through the last tracker column)
  // Cell update rules: true = keep my edits (the script only fills blank cells), false = the script overwrites.
  keep: { appid: false, console: true, genre: true, unlocked: false, hardcore: false, total: false,
          hours: false, lastPlayed: false, completed: false, updated: false, playStatus: false }
};
const RULE_COLS = [
  ['appid', 'APPID / GAME ID'], ['console', 'CONSOLE'], ['genre', 'GENRE'], ['unlocked', 'COLLECTED ACHIES'],
  ['hardcore', 'COLLECTED HC ACHIES'], ['total', 'TOTAL ACHIES'], ['hours', 'HOURS PLAYED'],
  ['lastPlayed', 'LAST PLAYED'], ['completed', 'DATE COMPLETED'], ['updated', 'LAST UPDATED'], ['playStatus', 'BACKLOG STATUS']
];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Fixed behaviour (not shown in the menu).
const STATUS_HEADER = 'STATUS';
const STATUS_NOTE = 'Achievement Tracker: ';
const STATUS_NOTE_OLD = /^(Steam|Achievement) Tracker: /;   // notes written by earlier versions carry the old name
const GENRE_HEADER = 'GENRE';
const STALE_HOURS = 24;            // every game's achievements are re-fetched at least this often, even if nothing seems to have changed
const STORE_MISS_SEC = 2 * 3600;     // a game title the Steam store couldn't find is searched for again after this long
const GENRE_RETRY_DAYS = 7;        // a genre the source didn't have is asked for again after this many days
const GENRE_TIME_BUDGET_SEC = 200; // max time per run spent on genre lookups; the rest continues next run

// Layout created on a blank sheet (and by Achievement Tracker > Set up blank sheet).
const LAYOUT = ['GAME LIST', 'GENRE', 'APPID', 'COLLECTED ACHIES', 'TOTAL ACHIES', 'AMOUNT DONE', 'PROGRESS',
  'COMPLETED', 'HOURS PLAYED', 'LAST PLAYED', 'DATE COMPLETED', 'LAST UPDATED', 'STATUS'];

// Header names on your sheet (case-insensitive). Change these if you rename a column.
const NAME_HEADERS = ['game list', 'game', 'name', 'title', 'game name'];
const OUT_COLS = {
  appid: 'APPID',
  unlocked: 'COLLECTED ACHIES',
  total: 'TOTAL ACHIES',
  hours: 'HOURS PLAYED',
  lastPlayed: 'LAST PLAYED',
  updated: 'LAST UPDATED'
};

// ---------- Menu & settings ----------

function cfg_() {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty('SETTINGS');
    const c = Object.assign({}, DEFAULTS, raw ? JSON.parse(raw) : {});
    c.keep = Object.assign({}, DEFAULTS.keep, c.keep || {});
    if (c.idleMonths !== undefined && !(raw && JSON.parse(raw).idleAmount !== undefined)) { c.idleAmount = c.idleMonths; c.idleUnit = 'months'; }   // setting from earlier versions
    const saved = Object.assign({}, c.statusColourMap || {});
    if (saved.PLAYED !== undefined) { if (saved.ACTIVE === undefined) saved.ACTIVE = saved.PLAYED; delete saved.PLAYED; }   // PLAYED was renamed ACTIVE
    // Colours still at the old defaults move to the new defaults; colours you chose yourself are kept.
    const OLD = { COMPLETED: '#b7e1cd', ACTIVE: '#c9daf8', IDLE: '#fce8b2', BACKLOG: '#e6e6e6' };
    Object.keys(OLD).forEach(k => { if (String(saved[k]).toLowerCase() === OLD[k]) delete saved[k]; });
    c.statusColourMap = Object.assign({}, DEFAULTS.statusColourMap, saved);
    return c;
  } catch (e) {
    return Object.assign({}, DEFAULTS);
  }
}

function setCfg_(patch) {
  const props = PropertiesService.getScriptProperties();
  let saved = {};
  try { saved = JSON.parse(props.getProperty('SETTINGS') || '{}'); } catch (e) { /* start fresh */ }
  props.setProperty('SETTINGS', JSON.stringify(Object.assign(saved, patch)));
}

// IDLE threshold helpers: "6 months", "3 weeks", "10 days" (0 = never).
function idleLabel_(c) {
  if (!(c.idleAmount > 0)) return 'never';
  const u = c.idleUnit === 'days' ? 'day' : c.idleUnit === 'weeks' ? 'week' : 'month';
  return c.idleAmount + ' ' + u + (c.idleAmount === 1 ? '' : 's');
}

function idleCutoff_(c) {
  if (!(c.idleAmount > 0)) return null;
  const d = new Date();
  if (c.idleUnit === 'days') d.setDate(d.getDate() - c.idleAmount);
  else if (c.idleUnit === 'weeks') d.setDate(d.getDate() - 7 * c.idleAmount);
  else d.setMonth(d.getMonth() - c.idleAmount);
  return d;
}

function autoUpdateOn_() {
  try {
    return ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'updateSteamSheet');
  } catch (e) { // menus opened by the simple onOpen trigger can't list triggers
    return !!cfg_().autoOn;
  }
}

function onOpen() { buildMenu_(); }

function buildMenu_() {
  const ui = SpreadsheetApp.getUi();
  const c = cfg_();
  const onOff = b => (b ? 'ON' : 'OFF');

  const sortMenu = ui.createMenu('Sort the list')
    .addItem('A \u2192 Z (name)', 'sortAZ')
    .addItem('Z \u2192 A (name)', 'sortZA')
    .addSeparator()
    .addItem('Completion % (highest first)', 'sortPctHigh')
    .addItem('Completion % (lowest first)', 'sortPctLow')
    .addItem('Hours played (most first)', 'sortHours')
    .addItem('Last played (newest first)', 'sortRecent')
    .addItem('Genre (A \u2192 Z)', 'sortGenre')
    .addSeparator()
    .addItem('Backlog status, then A \u2192 Z', 'sortBacklog')
    .addItem('Date completed (newest first)', 'sortDoneNew')
    .addItem('Date completed (oldest first)', 'sortDoneOld')
    .addSeparator()
    .addItem('Sort range: ' + (c.sortRange || 'automatic') + ' (change)', 'settingSortRange');

  const addMenu = ui.createMenu('Add games')
    .addItem('Import Steam library games with achievements\u2026', 'importLibrary')
    .addItem('Import RetroAchievements Want to Play list', 'importWantToPlay')
    .addSeparator()
    .addItem('Add game rows\u2026', 'addGameRows');

  const setupMenu = ui.createMenu('Sheet setup')
    .addItem('Set up blank sheet (Steam)', 'setupSheet')
    .addItem('Set up RetroAchievements tab', 'setupRetroSheet')
    .addSeparator()
    .addItem('Add BACKLOG STATUS column', 'addPlayStatusColumn')
    .addItem('Add DATE COMPLETED column', 'addDateCompletedColumn')
    .addItem('Add HACK column (RetroAchievements)', 'addHackColumn')
    .addSeparator()
    .addItem('Add totals row under the header', 'addTopTotals')
    .addItem('Upgrade RetroAchievements columns (hardcore)', 'upgradeRetroLayout');

  const toolsMenu = ui.createMenu('Tools')
    .addItem('Diagnose selected game', 'diagnoseGame')
    .addItem('Send test 100% post to Discord', 'sendTestCompletion');

  const accounts = ui.createMenu('Accounts')
    .addItem('Steam API key & Steam ID', 'setupCredentials')
    .addItem('RetroAchievements username & key', 'setupRetro')
    .addItem('Discord webhook', 'setupDiscord');

  const updates = ui.createMenu('Updates')
    .addItem('Auto-update: ' + (autoUpdateOn_() ? 'ON (click to turn off)' : 'OFF (click to turn on)'), 'toggleAutoUpdate')
    .addItem('Auto-update every ' + c.autoMinutes + ' min (change)', 'settingAutoMinutes')
    .addItem('Re-check games played in last ' + c.recentHours + ' h (change)', 'settingRecentHours')
    .addItem('Re-check shared / free games every ' + c.sharedMinutes + ' min (change)', 'settingSharedMinutes');

  const sheets = ui.createMenu('Sheets & columns')
    .addItem('Steam tab: ' + c.sheetName + ' (change)', 'settingSheetName')
    .addItem('Game rows on a new sheet: ' + c.gameRows + ' (change)', 'settingGameRows')
    .addItem('Link game names (Steam): ' + onOff(c.linkNames), 'toggleLinkNames')
    .addItem('Genre column: ' + onOff(c.genreColumn), 'toggleGenre')
    .addItem('Status column (Steam): ' + onOff(c.statusColumn), 'toggleStatus');   // see also: RetroAchievements, Backlog status

  const retro = ui.createMenu('RetroAchievements')
    .addItem('Track RetroAchievements: ' + onOff(c.raOn), 'toggleRetro')
    .addItem('Tab: ' + c.raSheetName + ' (change)', 'settingRaSheetName')
    .addItem('Auto-add Want to Play games: ' + onOff(c.raWantAuto), 'toggleRaWant');

  const backlog = ui.createMenu('Backlog status')
    .addItem('Mark IDLE after ' + idleLabel_(c) + ' (change)', 'settingIdleMonths')
    .addSeparator()
    .addItem('Colour the status cells: ' + onOff(c.statusColours), 'toggleStatusColours');
  PLAY_STATES.forEach(w => backlog.addItem(w + ' colour: ' + (c.statusColourMap[w] || 'none') + ' (change)', 'statusColour_' + w));
  backlog.addItem('Reset to the default colours', 'resetStatusColours');

  const rules = ui.createMenu('Cell update rules');
  RULE_COLS.forEach(r => {
    rules.addItem(r[1] + ': ' + (c.keep[r[0]] ? 'KEEP my edits' : 'script overwrites'), 'rule_' + r[0]);
  });

  const discord = ui.createMenu('Discord')
    .addItem('Last-played posts: ' + onOff(c.postLastPlayed), 'toggleLastPlayed')
    .addItem('100% posts: ' + onOff(c.postCompletion), 'toggleCompletion')
    .addItem('Weekly summary: ' + onOff(c.weeklyOn), 'toggleWeekly')
    .addItem('Weekly summary time: ' + DAY_NAMES[c.weeklyDay] + ' ' + c.weeklyHour + ':00 (change)', 'settingWeeklyTime');

  const settings = ui.createMenu('Settings')
    .addSubMenu(accounts)
    .addSubMenu(updates)
    .addSubMenu(sheets)
    .addSubMenu(retro)
    .addSubMenu(backlog)
    .addSubMenu(rules)
    .addSubMenu(discord)
    .addSeparator()
    .addItem('Show all settings', 'showSettings')
    .addItem('Reset settings to defaults', 'resetSettings');

  ui.createMenu('Achievement Tracker')
    .addItem('Update now', 'updateSteamSheet')
    .addItem('Update + post last played to Discord', 'updateAndPostNow')
    .addItem('Post weekly summary now (preview)', 'postWeeklyNow')
    .addSeparator()
    .addSubMenu(sortMenu)
    .addSubMenu(addMenu)
    .addSubMenu(setupMenu)
    .addSubMenu(toolsMenu)
    .addSubMenu(settings)
    .addToUi();
}

function toggleRetro() {
  const props = PropertiesService.getScriptProperties();
  if (!cfg_().raOn && !(props.getProperty('RA_USER') && props.getProperty('RA_KEY'))) {
    alert_('Set your RetroAchievements username & key first.');
    return;
  }
  toggle_('raOn', 'RetroAchievements');
}

function settingRaSheetName() {
  const v = ask_('RetroAchievements tab', 'Name for the RetroAchievements tab (currently "' + cfg_().raSheetName +
    '"). If it doesn\'t exist yet it is created on the next update.');
  if (v === null || v === '') return;
  if (v === cfg_().sheetName) { alert_('That is the Steam tab. Pick a different name. Nothing was changed.'); return; }
  if (/[\[\]*?:\/\\]/.test(v) || v.length > 99) { alert_('Tab names can\'t contain [ ] * ? : / \\ . Nothing was changed.'); return; }
  setCfg_({ raSheetName: v });
  buildMenu_();
  alert_('The RetroAchievements tab is now "' + v + '".');
}

function toggle_(key, label) {
  const now = !cfg_()[key];
  setCfg_({ [key]: now });
  buildMenu_();
  alert_(label + ' is now ' + (now ? 'ON' : 'OFF') + '.');
}
function toggleLinkNames() {
  const wasOn = cfg_().linkNames;
  setCfg_({ linkNames: !wasOn });
  buildMenu_();
  if (!wasOn) { alert_('Linking game names is now ON. The links are added on the next update.'); return; }
  const cleared = withLock_(removeNameLinks_);
  alert_('Linking game names is now OFF. ' + (cleared ? 'Removed the Steam links from ' + cleared + ' game names and reset their text formatting.' : 'There were no Steam links to remove.'));
}

// Removes the store links the script added to the game names (links you added yourself, to other sites, are left alone)
// and resets the text style of those cells, so the names look like plain text again.
function removeNameLinks_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(cfg_().sheetName) || ss.getSheets()[0];
  const headers = headersOf_(sheet);
  const nameIdx = headers.findIndex(h => NAME_HEADERS.indexOf(h) !== -1);
  if (nameIdx === -1) return 0;
  const n = trimGameRows_(sheet, nameIdx);
  if (n < 1) return 0;
  const rng = sheet.getRange(topRow_(sheet), nameIdx + 1, n, 1);
  let cleared = 0;
  const out = rng.getRichTextValues().map(r => {
    const v = r[0];
    const ours = v.getRuns().some(run => /^https:\/\/store\.steampowered\.com\/app\//.test(run.getLinkUrl() || ''));
    if (!ours) return [v];
    cleared++;
    return [SpreadsheetApp.newRichTextValue().setText(v.getText()).build()];
  });
  if (cleared) rng.setRichTextValues(out);
  return cleared;
}
function toggleRaWant() { toggle_('raWantAuto', 'Auto-adding your RetroAchievements Want to Play games'); }
function toggleGenre() { toggle_('genreColumn', 'The GENRE column'); }
function toggleStatus() { toggle_('statusColumn', 'The STATUS column'); }
function toggleLastPlayed() { toggle_('postLastPlayed', 'Last-played posts'); }
function toggleCompletion() { toggle_('postCompletion', '100% completion posts'); }
function toggleWeekly() { toggle_('weeklyOn', 'The weekly summary'); }

function toggleAutoUpdate() {
  if (autoUpdateOn_()) { removeTriggers(); buildMenu_(); alert_('Auto-update turned off.'); }
  else installAutoUpdate();
}

// Asks for a value; returns the trimmed text, or null if cancelled.
function ask_(title, text) {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt(title, text, ui.ButtonSet.OK_CANCEL);
  return r.getSelectedButton() === ui.Button.OK ? r.getResponseText().trim() : null;
}

function settingSheetName() {
  const v = ask_('Sheet tab', 'Name of the tab to update (currently "' + cfg_().sheetName + '"):');
  if (v === null || v === '') return;
  if (!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(v)) {
    alert_('There is no tab called "' + v + '". Nothing was changed.');
    return;
  }
  setCfg_({ sheetName: v });
  buildMenu_();
  alert_('Now updating the "' + v + '" tab.');
}

function settingAutoMinutes() {
  const v = ask_('Auto-update frequency', 'Minutes between updates. Google allows 1, 5, 10, 15 or 30 (currently ' + cfg_().autoMinutes + '):');
  if (v === null) return;
  const n = Number(v);
  if ([1, 5, 10, 15, 30].indexOf(n) === -1) { alert_('Please enter 1, 5, 10, 15 or 30. Nothing was changed.'); return; }
  setCfg_({ autoMinutes: n });
  if (autoUpdateOn_()) installAutoUpdate(); // restart the schedule with the new frequency
  else { buildMenu_(); alert_('Saved. Turn auto-update on to use it.'); }
}

function settingRecentHours() {
  const v = ask_('Re-check recently played games', 'Games played within this many hours are always re-checked for new achievements (1-72, currently ' + cfg_().recentHours + '):');
  if (v === null) return;
  const n = Number(v);
  if (!(n >= 1 && n <= 72)) { alert_('Please enter a number from 1 to 72. Nothing was changed.'); return; }
  setCfg_({ recentHours: Math.round(n) });
  buildMenu_();
  alert_('Saved.');
}

function settingSharedMinutes() {
  const v = ask_('Re-check shared / free games', 'Family-shared and free-to-play games have no playtime in Steam, so they are re-checked on a timer. ' +
    'How many minutes between checks? (15-1440, currently ' + cfg_().sharedMinutes + '). Games you own are checked every update as needed.');
  if (v === null) return;
  const n = Number(v);
  if (!(n >= 15 && n <= 1440) || String(v).trim() === '') { alert_('Please enter a number from 15 to 1440. Nothing was changed.'); return; }
  setCfg_({ sharedMinutes: Math.round(n) });
  buildMenu_();
  alert_('Saved.');
}

function settingIdleMonths() {
  const c = cfg_();
  const v = ask_('Mark games IDLE', 'In the BACKLOG STATUS column, a game you have played but not played for this long becomes IDLE.\n' +
    'Type a number and a unit, for example: 30 days, 3 weeks or 6 months. A number alone keeps the current unit (' + c.idleUnit + ').\n' +
    '0 = never use IDLE. Currently: ' + idleLabel_(c) + '.');
  if (v === null) return;
  const m = String(v).trim().toLowerCase().match(/^(\d+)\s*(d|day|days|w|wk|wks|week|weeks|m|mo|mos|month|months)?$/);
  if (!m) { alert_('Please type a whole number with an optional unit (days, weeks or months), such as 45 days. Nothing was changed.'); return; }
  const unit = !m[2] ? c.idleUnit : m[2][0] === 'd' ? 'days' : m[2][0] === 'w' ? 'weeks' : 'months';
  const n = Number(m[1]);
  const max = { days: 3650, weeks: 520, months: 120 }[unit];
  if (n > max) { alert_('The most is ' + max + ' ' + unit + '. Nothing was changed.'); return; }
  setCfg_({ idleAmount: n, idleUnit: unit });
  buildMenu_();
  alert_(n ? 'Saved. Games you have played but not for ' + idleLabel_(cfg_()) + ' will show IDLE on the next update.' : 'Saved. IDLE will not be used.');
}

function settingWeeklyTime() {
  const c = cfg_();
  const d = ask_('Weekly summary day', 'Which day? (Sunday, Monday, ... or 0-6 where 0 = Sunday). Currently ' + DAY_NAMES[c.weeklyDay] + ':');
  if (d === null) return;
  let day = /^[0-6]$/.test(d) ? Number(d) : DAY_NAMES.findIndex(n => n.toLowerCase().indexOf(d.toLowerCase()) === 0 && d.length >= 3);
  if (day < 0) { alert_('I couldn\'t read that day. Nothing was changed.'); return; }
  const h = ask_('Weekly summary hour', 'Which hour, 0-23 (20 = 8 PM), in the sheet\'s time zone? Currently ' + c.weeklyHour + ':');
  if (h === null) return;
  const hour = Number(h);
  if (h === '' || !(hour >= 0 && hour <= 23)) { alert_('Please enter an hour from 0 to 23. Nothing was changed.'); return; }
  setCfg_({ weeklyDay: day, weeklyHour: Math.floor(hour) });
  buildMenu_();
  alert_('Weekly summary set for ' + DAY_NAMES[day] + ' at ' + Math.floor(hour) + ':00.');
}

function showSettings() {
  const c = cfg_();
  const onOff = b => (b ? 'ON' : 'OFF');
  alert_([
    'Steam tab: ' + c.sheetName,
    'RetroAchievements: ' + onOff(c.raOn) + ' (tab "' + c.raSheetName + '", ' +
      (PropertiesService.getScriptProperties().getProperty('RA_KEY') ? 'key saved' : 'key NOT set') + ')',
    'Sort range: ' + (c.sortRange || 'automatic') + '   Game rows on a new sheet: ' + c.gameRows,
    'Cells the script overwrites: ' + (RULE_COLS.filter(r => !c.keep[r[0]]).map(r => r[1]).join(', ') || 'none') +
      '\nCells where your edits are kept: ' + (RULE_COLS.filter(r => c.keep[r[0]]).map(r => r[1]).join(', ') || 'none'),
    'Auto-update: ' + (autoUpdateOn_() ? 'ON, every ' + c.autoMinutes + ' min' : 'OFF (would run every ' + c.autoMinutes + ' min)'),
    'BACKLOG STATUS colours: ' + (c.statusColours ? 'ON (' + PLAY_STATES.map(w => w + ' ' + (c.statusColourMap[w] || 'none')).join(', ') + ')' : 'OFF') + '\nBACKLOG STATUS column: IDLE after ' + idleLabel_(c),
    'Re-check games played in last ' + c.recentHours + ' h; shared/free games every ' + c.sharedMinutes + ' min',
    'Auto-add Want to Play games: ' + onOff(c.raWantAuto),
    'Link game names: ' + onOff(c.linkNames),
    'Genre column: ' + onOff(c.genreColumn),
    'Status column: ' + onOff(c.statusColumn),
    'Discord last-played posts: ' + onOff(c.postLastPlayed),
    'Discord 100% posts: ' + onOff(c.postCompletion),
    'Discord weekly summary: ' + onOff(c.weeklyOn) + ' (' + DAY_NAMES[c.weeklyDay] + ' ' + c.weeklyHour + ':00)',
    'Steam key / ID: ' + (PropertiesService.getScriptProperties().getProperty('STEAM_API_KEY') ? 'saved' : 'NOT set'),
    'Discord webhook: ' + (PropertiesService.getScriptProperties().getProperty('DISCORD_WEBHOOK') ? 'saved' : 'NOT set')
  ].join('\n'));
}

function resetSettings() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Reset all settings to their defaults? (Your Steam key and Discord webhook are kept.)', ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  const wasOn = autoUpdateOn_();
  PropertiesService.getScriptProperties().deleteProperty('SETTINGS');
  setCfg_({ autoOn: wasOn });
  if (wasOn) installAutoUpdate(); else buildMenu_();
}

function setupCredentials() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();

  const k = ui.prompt('Steam Web API key',
    'Get one free at https://steamcommunity.com/dev/apikey', ui.ButtonSet.OK_CANCEL);
  if (k.getSelectedButton() !== ui.Button.OK) return;

  const s = ui.prompt('Steam ID',
    'Your 17-digit SteamID64, or your custom profile name (the part after /id/ in your profile URL).',
    ui.ButtonSet.OK_CANCEL);
  if (s.getSelectedButton() !== ui.Button.OK) return;

  props.setProperty('STEAM_API_KEY', k.getResponseText().trim());
  props.setProperty('STEAM_ID', s.getResponseText().trim());
  ui.alert('Saved. Now run Achievement Tracker > Update now.');
}

// Entry points (separate functions so trigger events aren't mistaken for arguments).
function updateSteamSheet() { run_(false, false); }
function updateAndPostNow() { run_(true, false); }
function postWeeklyNow() { run_(false, true); }

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { alert_('Another Achievement Tracker task is running. Try again in a moment.'); return; }
  try { return fn(); } finally { lock.releaseLock(); }
}

// Updates the Steam tab, then the RetroAchievements tab (if turned on), then sends the Discord posts.
function run_(force, weeklyNow) {
  withLock_(() => {
    const tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
    const errors = [];
    let tracked = [];
    try { tracked = tracked.concat(updateSteam_(force) || []); } catch (e) { errors.push(e); }
    if (cfg_().raOn) {
      try { tracked = tracked.concat(updateRetro_(force) || []); } catch (e) { errors.push(e); }
    }
    if (errors.length) throw errors[0];
    // A game listed twice on a sheet is only counted once in Discord posts.
    const seenKeys = {};
    tracked = tracked.filter(t => { const k = (t.src || 'steam') + ':' + t.appid; if (seenKeys[k]) return false; seenKeys[k] = true; return true; });
    notifyDiscord_(tracked, force, weeklyNow, tz);
  });
}

function updateSteam_(force) {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('STEAM_API_KEY');
  let steamId = props.getProperty('STEAM_ID');
  if (!key || !steamId) {
    alert_('Run Achievement Tracker > Settings > Set API key & Steam ID first.');
    return [];
  }
  if (!/^\d{17}$/.test(steamId)) {
    steamId = resolveVanity_(key, steamId);
    props.setProperty('STEAM_ID', steamId);
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const conf = cfg_();
  const sheet = ss.getSheetByName(conf.sheetName) || ss.getSheets()[0];
  if (isBlankSheet_(sheet)) {
    setupLayout_(sheet);
    alert_('Blank sheet set up. Type your game names under GAME LIST, then run Achievement Tracker > Update now.');
    return [];
  }
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const top = topRow_(sheet);
  const tz = ss.getSpreadsheetTimeZone();

  // --- Find columns by header (nothing is created except the optional status column) ---
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
    .map(h => String(h).trim().toLowerCase().replace(/\s+/g, ' '));

  const nameIdx = headers.findIndex(h => NAME_HEADERS.indexOf(h) !== -1);
  if (nameIdx === -1) throw new Error('Could not find a "GAME LIST" column in row 1.');

  const col = {};
  Object.keys(OUT_COLS).forEach(k => {
    const i = headers.indexOf(OUT_COLS[k].toLowerCase());
    if (i === -1) throw new Error('Could not find a "' + OUT_COLS[k] + '" column in row 1.');
    col[k] = i;
  });

  col.genre = conf.genreColumn ? headers.indexOf(GENRE_HEADER.toLowerCase()) : -1;
  col.completed = headers.indexOf('date completed');          // optional

  col.status = -1;
  if (conf.statusColumn) {
    const i = headers.indexOf(STATUS_HEADER.toLowerCase());
    if (i !== -1) {
      col.status = i;
    } else if (col.updated + 1 >= lastCol || headers[col.updated + 1] === '') {
      // Use the empty column right after LAST UPDATED, styled like that header.
      col.status = col.updated + 1;
      const target = sheet.getRange(1, col.status + 1);
      sheet.getRange(1, col.updated + 1).copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
      target.setValue(STATUS_HEADER);
    }
  }

  // Only the game rows in the name column (other columns like GAMES TO BUY can be longer).
  const nameCol = sheet.getRange(top, nameIdx + 1, Math.max(sheet.getLastRow() - top + 1, 1), 1).getValues();
  let numRows = nameCol.length;
  // A "TOTALS"-style label row ends the list, so its formulas are never read back or overwritten.
  const endIdx = nameCol.findIndex(r => /^(totals?|overall|summary)$/i.test(String(r[0]).trim()));
  if (endIdx !== -1) numRows = endIdx;
  while (numRows > 0 && String(nameCol[numRows - 1][0]).trim() === '') numRows--;
  if (numRows === 0) return [];

  // Copy the AMOUNT DONE / PROGRESS / COMPLETED formulas down to any game row that is missing them.
  fillFormulas_(sheet, headers, nameIdx, col, numRows);

  // Read one block spanning the columns we use (we only ever WRITE our own columns, one by one).
  const used = Object.keys(col).map(k => col[k]).filter(i => i >= 0).concat([nameIdx]);
  const minC = Math.min.apply(null, used);
  const maxC = Math.max.apply(null, used);
  const data = sheet.getRange(top, minC + 1, numRows, maxC - minC + 1).getValues();
  const cell = (row, idx) => row[idx - minC];

  // --- Library + recently played, fetched in parallel ---
  const base = 'https://api.steampowered.com/IPlayerService/';
  const [ownedRes, recentRes] = UrlFetchApp.fetchAll([
    { url: base + 'GetOwnedGames/v1/?key=' + key + '&steamid=' + steamId +
        '&include_appinfo=1&include_played_free_games=1&format=json', muteHttpExceptions: true },
    { url: base + 'GetRecentlyPlayedGames/v1/?key=' + key + '&steamid=' + steamId + '&format=json',
        muteHttpExceptions: true }
  ]);
  if (ownedRes.getResponseCode() !== 200) {
    throw new Error('Steam API error ' + ownedRes.getResponseCode() + ' (check your API key).');
  }
  const games = (JSON.parse(ownedRes.getContentText()).response || {}).games || [];
  if (!games.length) {
    throw new Error('Steam returned no games. Make sure your profile and "Game details" are set to Public.');
  }
  const byName = {};
  const byId = {};
  games.forEach(g => { byName[norm_(g.name)] = g; byId[g.appid] = g; });

  const recent = {};
  if (recentRes.getResponseCode() === 200) {
    ((JSON.parse(recentRes.getContentText()).response || {}).games || []).forEach(g => { recent[g.appid] = g; });
  }

  const keepRules = conf.keep;
  const lastAch = loadJson_(props, 'LAST_ACH') || {}; // appid -> [unlocked, total] as last written by the script
  const lastUnlock = loadJson_(props, 'LAST_UNLOCK') || {}; // appid -> unix time of the newest unlock seen
  const freeMap = JSON.parse(props.getProperty('FREE_MAP') || '{}');
  const dlcMap = JSON.parse(props.getProperty('DLC_MAP') || '{}'); // appid -> base game name if the app is DLC, else ''
  let freeMapChanged = false;
  const storeMiss = loadJson_(props, 'STORE_MISS') || {};
  let storeMissChanged = false;
  const nowSec = Math.floor(Date.now() / 1000);
  const day = d => (d instanceof Date ? Utilities.formatDate(d, tz, 'yyyy-MM-dd') : '');

  // --- Pass 1: match each sheet row to a Steam app and decide if it needs a refresh ---
  const items = [];
  data.forEach((row, i) => {
    const title = String(cell(row, nameIdx)).trim();
    if (!title) return;

    let game = null;
    let shared = false;
    let free = false;
    let dlc = '';
    let note = '';
    const existingId = Number(cell(row, col.appid));
    if (existingId && byId[existingId]) game = byId[existingId];
    // If you chose to keep your own APPIDs, a typed AppID is trusted over name matching.
    if (!game && !(keepRules.appid && existingId)) game = byName[norm_(title)];

    if (!game) {
      // Not in your own library: free-to-play or Family Sharing. Find the AppID via the store.
      let appid = existingId || 0;
      let hitType = '';
      if (!appid) {
        const mk = norm_(title);
        let hit = null;
        if (!(storeMiss[mk] && nowSec - storeMiss[mk] < STORE_MISS_SEC)) {     // a title the store didn't know is not searched again right away
          hit = storeSearch_(title);
          if (!hit) { storeMiss[mk] = nowSec; storeMissChanged = true; }
        }
        if (hit) {
          appid = hit.id;
          hitType = String(hit.type || '').toLowerCase();
          if (norm_(hit.name) !== norm_(title)) note = 'The Steam store matched "' + hit.name + '". If that is the wrong game, type the right AppID into APPID.';
        }
      }
      if (!appid) {
        items.push({ i: i, title: title, missing: true });
        return;
      }
      if (byId[appid]) {
        game = byId[appid]; // you own it; the sheet name just differed from the store name
      } else {
        game = recent[appid] || { appid: appid };
        shared = true;
        if (freeMap[appid] === undefined || dlcMap[appid] === undefined) {
          const meta = appMeta_(appid);
          if (meta) { freeMap[appid] = meta.free ? 1 : 0; dlcMap[appid] = meta.dlc; freeMapChanged = true; }
        }
        free = freeMap[appid] === 1;
        dlc = dlcMap[appid] || (hitType === 'dlc' ? 'its base game' : '');
      }
    }

    // Decide whether achievements need re-fetching.
    const hoursNow = game.playtime_forever !== undefined ? Math.round(game.playtime_forever / 6) / 10 : undefined;
    const gDay = game.rtime_last_played ? day(new Date(game.rtime_last_played * 1000)) : '';
    const playedRecently = game.rtime_last_played && (nowSec - game.rtime_last_played) < conf.recentHours * 3600;
    const hasData = cell(row, col.unlocked) !== '';
    const statusText = col.status >= 0 ? String(cell(row, col.status)) : '';
    const lastFetch = cell(row, col.updated);
    const stale = !(lastFetch instanceof Date) || (nowSec * 1000 - lastFetch.getTime()) > STALE_HOURS * 3600 * 1000;
    const failedBefore = /^(Retrying|Private|Not owned or private|Steam (error|says))/.test(statusText); // a failed fetch is retried on the next run
    // A number you changed by hand (and haven't told the script to keep) is put back to Steam's value.
    const la = lastAch[game.appid];
    const edited = !!la && ((!keepRules.unlocked && cell(row, col.unlocked) !== la[0]) ||
                            (!keepRules.total && cell(row, col.total) !== la[1]));
    // A finished game with no completion date yet is fetched to get the date of its last achievement
    // (unless an earlier fetch showed that Steam has no unlock times for it).
    const needDate = col.completed >= 0 && cell(row, col.completed) === '' && lastUnlock[game.appid] !== 0 &&
      isNum_(cell(row, col.unlocked)) && isNum_(cell(row, col.total)) && cell(row, col.total) > 0 &&
      cell(row, col.unlocked) === cell(row, col.total);
    // Shared / free games report no playtime, so they are re-checked on a timer instead of on every update.
    const sharedDue = shared && (!(lastFetch instanceof Date) || (nowSec * 1000 - lastFetch.getTime()) > conf.sharedMinutes * 60000);
    const need = force || sharedDue || !hasData || note !== '' || stale || failedBefore || edited || needDate ||
      (!keepRules.appid && existingId !== game.appid) ||
      (!keepRules.hours && hoursNow !== undefined && hoursNow !== cell(row, col.hours)) ||   // (shared games report no hours)
      (!keepRules.lastPlayed && gDay !== day(cell(row, col.lastPlayed))) ||
      playedRecently;

    items.push({ i: i, title: title, game: game, shared: shared, free: free, dlc: dlc, note: note,
                 hoursNow: hoursNow, need: need });
  });

  // --- Pass 2: fetch all needed achievements in parallel (in batches) ---
  const toFetch = items.filter(it => it.need && !it.missing);
  const fetchAch = list => UrlFetchApp.fetchAll(list.map(it => ({
    url: 'https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?key=' + key +
      '&steamid=' + steamId + '&appid=' + it.game.appid + '&l=english&format=json',
    muteHttpExceptions: true
  })));
  const CHUNK = 30;
  for (let s = 0; s < toFetch.length; s += CHUNK) {
    const batch = toFetch.slice(s, s + CHUNK);
    const resps = fetchAch(batch);
    batch.forEach((it, n) => { it.ach = parseAch_(resps[n]); });
    // Rate limit / server hiccup: pause and try those games once more right away.
    const retry = batch.filter(it => it.ach.err);
    if (retry.length) {
      Utilities.sleep(5000);
      const again = fetchAch(retry);
      retry.forEach((it, n) => { it.ach = parseAch_(again[n]); });
    }
    if (s + CHUNK < toFetch.length) Utilities.sleep(300);
  }

  // Steam has no stats yet for games you've never launched, even though they have achievements.
  // Get the total from the game's global achievement list instead (and show 0 unlocked).
  const noStats = toFetch.filter(it => it.ach.none === 'nostats');
  if (noStats.length) {
    const resps = UrlFetchApp.fetchAll(noStats.map(it => ({
      url: 'https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=' +
        it.game.appid + '&format=json',
      muteHttpExceptions: true
    })));
    noStats.forEach((it, n) => {
      let total = 0;
      try {
        total = (JSON.parse(resps[n].getContentText()).achievementpercentages.achievements || []).length;
      } catch (e) { /* no list: the game has no achievements */ }
      // Only treat it as "0 unlocked" for a game you've never played; otherwise keep the numbers already on the sheet.
      const existing = cell(data[it.i], col.unlocked);
      const neverPlayed = it.hoursNow === 0 || (it.hoursNow === undefined && (existing === '' || existing === 0));
      it.ach = total === 0 ? { none: 'none' }
        : neverPlayed ? { unlocked: 0, total: total, lastUnlock: 0, notStarted: true }
        : { none: 'nostats' };
    });
  }

  // --- Genres: looked up once per game (cached), paced to respect the Steam store's rate limit ---
  const genreCache = loadJson_(props, 'GENRE_CACHE') || {};
  const genreOf = {};
  let genresLeft = 0;
  if (col.genre >= 0) {
    const gblank = it => { const g = String(cell(data[it.i], col.genre)).trim(); return g === '' || g === 'Unknown'; };
    // Only look up games that aren't cached yet and whose cell the script would actually write.
    const need = items.filter(it => !it.missing && genreCache[it.game.appid] === undefined &&
      (!keepRules.genre || gblank(it)));
    const started = Date.now();
    let s = 0;
    while (s < need.length && Date.now() - started < GENRE_TIME_BUDGET_SEC * 1000) {
      const batch = need.slice(s, s + 10);
      const resps = UrlFetchApp.fetchAll(batch.map(it => ({
        url: 'https://store.steampowered.com/api/appdetails?appids=' + it.game.appid + '&cc=us&l=english',
        muteHttpExceptions: true
      })));
      let limited = false;
      batch.forEach((it, n) => {
        const code = resps[n].getResponseCode();
        if (code === 429 || code === 403) { limited = true; return; } // rate limited: retried below
        const g = parseGenre_(resps[n], it.game.appid);
        if (g) genreCache[it.game.appid] = g;
      });
      if (limited) { Utilities.sleep(30000); continue; } // rate limited: wait, then redo this batch
      s += 10;
      Utilities.sleep(3000);
    }
    items.forEach(it => { if (!it.missing && genreCache[it.game.appid]) genreOf[it.i] = genreCache[it.game.appid]; });
    genresLeft = need.filter(it => !genreCache[it.game.appid]).length;
    if (need.length) saveJson_(props, 'GENRE_CACHE', genreCache);
  }

  // --- Pass 3: fill the output columns ---
  const { out, orig, put } = outputSet_(data, col, Object.keys(col), cell, keepRules);
  // The cell holds a short label; the explanation goes into a note on the cell (hover to read it).
  const statusNotes = out.status ? sheet.getRange(top, col.status + 1, numRows, 1).getNotes() : null;
  const statusNotesOld = statusNotes ? statusNotes.map(n => n[0]) : null;
  const setStatus = (i, label, detail) => {
    if (!out.status) return;
    out.status[i] = [label];
    if (detail) statusNotes[i][0] = (STATUS_NOTE + detail).trim();
    else if (STATUS_NOTE_OLD.test(String(statusNotesOld[i]))) statusNotes[i][0] = '';
  };
  const now = new Date();
  const tracked = [];

  items.forEach(it => {
    const i = it.i;
    if (it.missing) {
      setStatus(i, 'Not owned', 'Game not found in your library, or not owned. It also wasn\'t found on the Steam store under this name. Check the spelling, or type the AppID into APPID.');
      return;
    }
    const game = it.game;
    put('appid', i, game.appid);
    if (it.hoursNow !== undefined) put('hours', i, it.hoursNow);
    else if (out.hours[i][0] === '') out.hours[i] = [0]; // no hours recorded (e.g. family share): show 0
    if (game.rtime_last_played) put('lastPlayed', i, new Date(game.rtime_last_played * 1000));
    if (genreOf[i]) put('genre', i, genreOf[i]);

    let ach = null;
    let newAch = [];
    if (it.need) {
      const tag = (it.dlc ? ' \u00b7 DLC' : it.shared ? (it.free ? ' \u00b7 Free' : ' \u00b7 Shared') : '') + (it.note ? ' \u00b7 Check match' : '');
      const why = (it.dlc ? 'The Steam store lists this as DLC for ' + it.dlc + ', not a game of its own. Achievements for DLC are usually counted under the base game. ' :
        it.shared ? (it.free ? 'This game is free to play and counts as owned. Steam doesn\'t always report its playtime. ' : 'A game you don\'t own (Family Sharing); Steam doesn\'t report its playtime. ') : '') + it.note;
      const r = it.ach;
      if (r.err) {
        // Steam hiccup: keep the old values and leave LAST UPDATED alone; it is retried on the next run.
        setStatus(i, 'Retrying' + tag, 'Steam returned an error (' + r.err + '). The script tries again on the next update. ' + why);
      } else if (r.none === 'private') {
        setStatus(i, 'Not owned or private', 'Steam returned no data: either you don\'t have this game, or your Steam Profile and Game details are private. If you do own it, set both to Public in Steam\'s privacy settings. ' + it.note);
      } else if (r.none === 'nostats') {
        setStatus(i, 'No stats' + tag, 'Steam has no stats for you in this game, so the existing numbers were kept. ' + why);
        put('updated', i, now);
      } else if (r.none) {
        // Steam says this game has no achievements: keep whatever numbers are already on your sheet.
        setStatus(i, 'No achievements' + tag, 'Steam lists no achievements for this game. Existing numbers were kept. ' + why);
        put('updated', i, now);
      } else {
        ach = r;
        // Achievements unlocked since the last time this game was seen (listed in the Discord post).
        const lu = lastUnlock[game.appid];
        if (lu !== undefined) newAch = (ach.recent || []).filter(a => a[2] > lu);
        lastUnlock[game.appid] = Math.max(lu || 0, ach.lastUnlock || 0);
        put('unlocked', i, ach.unlocked);
        put('total', i, ach.total);
        if (out.completed) put('completed', i, ach.total > 0 && ach.unlocked === ach.total && ach.lastUnlock ? new Date(ach.lastUnlock * 1000) : '');
        setStatus(i, (ach.total && ach.unlocked === ach.total ? 'Complete' : (ach.notStarted ? 'Not started' : 'OK')) + tag, why);
        put('updated', i, now);
      }
    }

    lastAch[game.appid] = [out.unlocked[i][0], out.total[i][0]]; // what the script now considers "its" values
    tracked.push({
      src: 'steam',
      title: it.title,
      appid: game.appid,
      hours: out.hours[i][0],
      unlocked: out.unlocked[i][0],
      total: out.total[i][0],
      cover: 'https://cdn.cloudflare.steamstatic.com/steam/apps/' + game.appid + '/header.jpg',
      newAch: newAch,
      // "Last played" = latest play time Steam reports, or latest achievement unlock (covers shared games).
      lastTs: Math.max(game.rtime_last_played || 0, ach ? ach.lastUnlock : 0)
    });
  });

  // --- Write back (only our columns; AMOUNT DONE / COMPLETED formulas and other lists are untouched) ---
  writeColumns_(sheet, col, out, numRows, orig);
  alignColumns_(sheet, headers, numRows);
  if (statusNotes && statusNotes.some((n, i) => n[0] !== statusNotesOld[i])) sheet.getRange(top, col.status + 1, numRows, 1).setNotes(statusNotes);

  // --- Link each game name to its Steam store page (the name text itself is unchanged) ---
  if (conf.linkNames) {
    const nameRange = sheet.getRange(top, nameIdx + 1, numRows, 1);
    const rich = nameRange.getRichTextValues();
    let linksChanged = false;
    items.forEach(it => {
      if (it.missing || !it.game) return;
      const url = 'https://store.steampowered.com/app/' + it.game.appid + '/';
      if (rich[it.i][0].getLinkUrl() !== url) {
        rich[it.i][0] = rich[it.i][0].copy().setLinkUrl(url).build(); // keeps existing text formatting
        linksChanged = true;
      }
    });
    if (linksChanged) nameRange.setRichTextValues(rich);
  }

  applyPlayStatus_(sheet, headers, nameIdx, numRows);

  if (storeMissChanged) saveJson_(props, 'STORE_MISS', storeMiss);
  if (freeMapChanged) { props.setProperty('FREE_MAP', JSON.stringify(freeMap)); props.setProperty('DLC_MAP', JSON.stringify(dlcMap)); }
  saveJson_(props, 'LAST_ACH', lastAch);
  saveJson_(props, 'LAST_UNLOCK', lastUnlock);
  if (genresLeft > 0) alert_(genresLeft + ' genres are still blank (Steam store rate limit). Run Update now again in a few minutes.');
  return tracked;
}

// ---------- Discord ----------

// Accepts a webhook link from any Discord client and returns the standard discord.com form, or '' if it isn't one.
function normalizeWebhook_(text) {
  const t = String(text || '').trim().replace(/^[<"'\s]+|[>"'\s]+$/g, '');
  const m = t.match(/^https?:\/\/(?:[a-z0-9-]+\.)?discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/(\d+)\/([\w-]+)/i);
  return m ? 'https://discord.com/api/webhooks/' + m[1] + '/' + m[2] : '';
}

function setupDiscord() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Discord webhook URL',
    'In Discord: Server Settings > Integrations > Webhooks > New Webhook > pick the channel > Copy Webhook URL.',
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const url = normalizeWebhook_(r.getResponseText());
  if (!url) {
    ui.alert('That doesn\'t look like a Discord webhook URL. It should look like https://discord.com/api/webhooks/123456789/abcDEF... ' +
      '(Discord Canary, PTB, Vencord and Legcord links are accepted too).');
    return;
  }
  const test = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json',
    payload: JSON.stringify({ content: 'Achievement Tracker is connected \u2705' }), muteHttpExceptions: true });
  const code = test.getResponseCode();
  if (code < 200 || code >= 300) {
    ui.alert('Discord rejected that webhook (HTTP ' + code + '). It may have been deleted or copied incompletely. Nothing was saved.');
    return;
  }
  PropertiesService.getScriptProperties().setProperty('DISCORD_WEBHOOK', url);
  ui.alert('Saved. A test message was sent to your channel.');
}

// Script properties hold up to ~9 KB per value, so bigger state is stored in 8 KB chunks.
function loadJson_(props, key) {
  const n = props.getProperty(key + '_n');
  let txt;
  if (n !== null) {
    txt = '';
    for (let i = 0; i < Number(n); i++) txt += props.getProperty(key + '_' + i) || '';
  } else {
    txt = props.getProperty(key); // older single-value format
  }
  if (txt === null || txt === undefined) return null;
  try { return JSON.parse(txt); } catch (e) { return null; }
}

function saveJson_(props, key, obj) {
  const txt = JSON.stringify(obj);
  const old = Number(props.getProperty(key + '_n') || 0);
  const parts = [];
  for (let i = 0; i < txt.length; i += 8000) parts.push(txt.slice(i, i + 8000));
  parts.forEach((p, i) => props.setProperty(key + '_' + i, p));
  for (let i = parts.length; i < old; i++) props.deleteProperty(key + '_' + i);
  props.setProperty(key + '_n', String(parts.length));
  props.deleteProperty(key);
}

const isNum_ = v => typeof v === 'number' && !isNaN(v);
const isComplete_ = t => isNum_(t.unlocked) && isNum_(t.total) && t.total > 0 && t.unlocked === t.total;
const round1_ = n => Math.round(n * 10) / 10;
const srcOf_ = t => t.src || 'steam';
const SRC_NAME = { steam: 'Steam', ra: 'RetroAchievements' };

// The 100% complete post. `n` = [games at 100%, games tracked]; `earned` = the final achievements (may be empty).
function completionEmbed_(t, n, earned, test) {
  const ra = srcOf_(t) === 'ra';
  const fields = [{ name: 'Achievements', value: t.unlocked + ' / ' + t.total, inline: true }];
  if (ra) fields.push({ name: 'Hardcore', value: isNum_(t.hardcore) ? t.hardcore + ' / ' + t.total : 'n/a', inline: true });
  else fields.push({ name: 'Total hours', value: isNum_(t.hours) ? t.hours + ' h' : 'n/a', inline: true });
  fields.push({ name: 'Games at 100%', value: n[0] + ' / ' + n[1], inline: true });
  if (earned.length) fields.push({ name: earned.length > 1 ? '\uD83C\uDFC5 Final achievements' : '\uD83C\uDFC5 Final achievement', value: achLines_(earned, 0) });
  const lead = test ? 'This is a test message. ' : '';
  const embed = {
    title: (test ? '\uD83E\uDDEA TEST \u2014 ' : '') + '\uD83C\uDFC6 100% complete: ' + t.title,
    description: lead + (ra ? (t.hardcore === t.total ? 'Mastered in hardcore!' : 'Every achievement unlocked (softcore).') : 'Every achievement unlocked!'),
    color: 0xf1c40f,
    fields: fields
  };
  if (t.cover) embed[ra ? 'thumbnail' : 'image'] = { url: t.cover };   // Steam: wide header image; RetroAchievements: game icon
  if (ra) embed.footer = { text: 'RetroAchievements' };
  return embed;
}

// Menu: sends a sample 100% post (using a finished game from your sheet if there is one) so you can see how it looks.
function sendTestCompletion() {
  if (!PropertiesService.getScriptProperties().getProperty('DISCORD_WEBHOOK')) {
    alert_('Set your Discord webhook first (Settings > Accounts > Discord webhook).');
    return;
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const c = cfg_();
  const picks = [];
  const finished = (sheet, src) => {
    if (!sheet) return null;
    const h = headersOf_(sheet);
    const ni = h.findIndex(x => NAME_HEADERS.indexOf(x) !== -1), ui = h.indexOf('collected achies'), ti = h.indexOf('total achies');
    if (ni === -1 || ui === -1 || ti === -1) return null;
    const rows = sheet.getRange(topRow_(sheet), 1, trimGameRows_(sheet, ni), sheet.getLastColumn()).getValues();
    const col = k => h.indexOf(k);
    let best = null, nDone = 0;
    rows.forEach(r => {
      if (!(typeof r[ui] === 'number' && typeof r[ti] === 'number' && r[ti] > 0 && r[ui] === r[ti])) return;
      nDone++;
      const when = col('date completed') >= 0 && r[col('date completed')] instanceof Date ? r[col('date completed')].getTime() : 0;
      if (!best || when >= best.when) best = { row: r, when: when };
    });
    if (!best) return null;
    const r = best.row;
    const t = { src: src, title: String(r[ni]).trim(), unlocked: r[ui], total: r[ti], n: [nDone, rows.length] };
    if (src === 'steam') {
      t.hours = col('hours played') >= 0 && typeof r[col('hours played')] === 'number' ? r[col('hours played')] : undefined;
      const id = col('appid') >= 0 ? r[col('appid')] : '';
      if (id) t.cover = 'https://cdn.cloudflare.steamstatic.com/steam/apps/' + id + '/header.jpg';
    } else {
      const hci = col('collected hc achies') >= 0 ? col('collected hc achies') : col('hardcore achies');
      t.hardcore = hci >= 0 ? r[hci] : undefined;
      t.consoleName = col('console') >= 0 ? String(r[col('console')]).trim() : '';
    }
    return t;
  };
  const steam = finished(ss.getSheetByName(c.sheetName) || ss.getSheets()[0], 'steam');
  if (steam) picks.push(steam);
  if (c.raOn && raUser_()) {
    const ra = finished(ss.getSheetByName(c.raSheetName), 'ra');
    if (ra) {
      try {   // the game icon comes from your RetroAchievements history
        const entries = raFetchProgress_();
        const byTitle = {};
        entries.forEach(e => { e._key = normRa_(e.Title); (byTitle[e._key] = byTitle[e._key] || []).push(e); });
        const m = raMatch_(ra.title, ra.consoleName, byTitle, entries, isHackTitle_(ra.title));
        if (m.entry) ra.cover = raImage_(m.entry.ImageIcon);
      } catch (e) { /* post without an icon */ }
      ra.title += ra.consoleName ? ' [' + ra.consoleName + ']' : '';
      picks.push(ra);
    }
  }
  let example = false;
  if (!picks.length) {
    example = true;
    picks.push({ src: 'steam', title: 'Example Game', unlocked: 50, total: 50, hours: 12.3, n: [1, 1],
      cover: 'https://cdn.cloudflare.steamstatic.com/steam/apps/620/header.jpg' });
  }
  let bad = 0;
  picks.forEach(t => {
    const code = postDiscord_({ embeds: [completionEmbed_(t, t.n, [], true)] });
    if (code < 200 || code >= 300) bad++;
  });
  alert_(bad ? 'Discord rejected the test message. Set the webhook again under Settings > Accounts > Discord webhook.'
    : 'Test sent to Discord' + (example ? ' (no game on your sheet is at 100% yet, so it uses an example game).' : ' using a finished game from your sheet.') +
      ' Nothing was recorded, so real posts are not affected.');
}

// Discord posts (last played, 100% complete, weekly summary), based only on the games on your sheet.
function notifyDiscord_(tracked, force, weeklyNow, tz) {
  const props = PropertiesService.getScriptProperties();
  const hook = props.getProperty('DISCORD_WEBHOOK');
  if (!hook) return;

  const c = cfg_();
  const seen = loadJson_(props, 'SEEN') || {};   // appid -> [hours, unlocked, total] as of the last run
  const base = loadJson_(props, 'BASE') || {};   // appid -> unlocked as of the last post for that game
  const doneRaw = loadJson_(props, 'DONE');      // appid -> 1 for games already at 100%
  const done = doneRaw || {};
  // Achievements earned but not yet announced: appid -> [[name, description, unixTime], ...]
  const pend = loadJson_(props, 'PEND') || {};
  if (c.postLastPlayed || c.postCompletion) {
    tracked.forEach(t => {
      if (!t.newAch || !t.newAch.length) return;
      const cur = pend[t.appid] || [];
      t.newAch.forEach(a => { if (!cur.some(x => x[0] === a[0] && x[2] === a[2])) cur.push(a); });
      cur.sort((x, y) => x[2] - y[2]);
      pend[t.appid] = cur.slice(-15);
    });
  }
  const takePend = id => { const l = pend[id] || []; delete pend[id]; return l; };
  // [games at 100%, games tracked] for one source ('steam' or 'ra')
  const at100 = src => { const l = tracked.filter(t => srcOf_(t) === src); return [l.filter(isComplete_).length, l.length]; };

  // ----- 2. 100% completion -----
  const completed = [];
  tracked.forEach(t => {
    const id = t.appid;
    if (isComplete_(t)) {
      if (!done[id]) {
        done[id] = 1;
        // Not announced the first time the script runs, or when an already-finished game is added to the sheet.
        if (doneRaw !== null && seen[id] !== undefined) completed.push(t);
      }
    } else if (done[id]) {
      delete done[id]; // e.g. a DLC added more achievements; announce again when it's finished again
    }
  });

  // ----- 1. Last played -----
  const byRecent = arr => arr.slice().sort((a, b) => b.lastTs - a.lastTs)[0];
  const changed = tracked.filter(t => {
    const s = seen[t.appid];
    if (!s || t.defer) return false;
    return isNum_(t.hours) && isNum_(s[0]) ? t.hours !== s[0] : t.unlocked !== s[1];
  });

  // A game that just hit 100% gets its own completion post, so it doesn't also get a "last played" post.
  const sessions = changed.filter(t => completed.indexOf(t) === -1);
  let pick = null;
  if (force) pick = byRecent(tracked.filter(t => t.lastTs > 0));
  else if (sessions.length) pick = byRecent(sessions);

  if (pick && (force || c.postLastPlayed)) {
    const achTxt = isNum_(pick.unlocked) ? pick.unlocked + ' / ' + pick.total : 'No achievements';
    let newTxt = 'n/a';
    if (isNum_(pick.unlocked)) {
      const b = base[pick.appid];
      newTxt = isNum_(b) ? '+' + Math.max(0, pick.unlocked - b) : 'First check';
    }
    const isRa = srcOf_(pick) === 'ra';
    const fields = isRa
      ? [{ name: 'Achievements', value: achTxt, inline: true },
         { name: 'Hardcore', value: isNum_(pick.hardcore) ? pick.hardcore + ' / ' + pick.total : 'n/a', inline: true }]
      : [{ name: 'Total hours', value: isNum_(pick.hours) ? pick.hours + ' h' : 'n/a', inline: true },
         { name: 'Achievements', value: achTxt, inline: true }];
    fields.push({ name: 'New since last post', value: newTxt, inline: true });
    const earned = takePend(pick.appid);
    if (earned.length) {
      const b = base[pick.appid];
      const extra = isNum_(b) && isNum_(pick.unlocked) ? Math.max(0, pick.unlocked - b - earned.length) : 0;
      fields.push({ name: earned.length + extra > 1 ? '\uD83C\uDFC5 New achievements' : '\uD83C\uDFC5 New achievement', value: achLines_(earned, extra) });
    }
    const embed = {
      title: '🎮 Last played: ' + pick.title,
      color: isRa ? 0xe8b400 : 0x1b2838,
      fields: fields
    };
    if (isRa) embed.footer = { text: 'RetroAchievements' };
    if (pick.lastTs > 0) embed.timestamp = new Date(pick.lastTs * 1000).toISOString();
    postDiscord_({ embeds: [embed] });
    if (isNum_(pick.unlocked)) base[pick.appid] = pick.unlocked;
  }

  // ----- 2. (continued) post the completions -----
  (c.postCompletion ? completed : []).forEach(t => {
    postDiscord_({ embeds: [completionEmbed_(t, at100(srcOf_(t)), takePend(t.appid), false)] });
    Utilities.sleep(500);
  });

  // ----- 3. Weekly summary -----
  const weekRaw = loadJson_(props, 'WEEK_BASE');  // appid -> [hours, unlocked] at the start of the week
  const week = weekRaw || {};
  const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const dow = Number(Utilities.formatDate(new Date(), tz, 'u')) % 7;      // Sunday = 0
  const hourNow = Number(Utilities.formatDate(new Date(), tz, 'H'));
  const scheduled = c.weeklyOn && dow === c.weeklyDay && hourNow >= c.weeklyHour && props.getProperty('WEEKLY_LAST') !== today;
  let resetWeek = false;

  if (weekRaw !== null && (scheduled || weeklyNow)) {
    let hours = 0, achs = 0;
    const per = [];
    const finished = [];
    tracked.forEach(t => {
      const b = week[t.appid];
      if (!b) return; // added to the sheet this week: starts counting from now
      const dh = isNum_(t.hours) && isNum_(b[0]) ? Math.max(0, t.hours - b[0]) : 0;
      const da = isNum_(t.unlocked) && isNum_(b[1]) ? Math.max(0, t.unlocked - b[1]) : 0;
      hours += dh;
      achs += da;
      if (dh > 0 || da > 0) per.push({ title: t.title, dh: dh, da: da });
      if (isComplete_(t) && isNum_(b[1]) && b[1] < t.total) finished.push(t.title);
    });
    per.sort((x, y) => (y.dh - x.dh) || (y.da - x.da));

    const played = per.length; // games with playtime or new achievements
    const lines = per.slice(0, 5).map(p =>
      '• ' + p.title + ' — ' + (p.dh > 0 ? round1_(p.dh) + ' h' : '0 h') + (p.da > 0 ? ', +' + p.da + ' achievements' : ''));
    const sumOf = (src, k) => tracked.filter(t => srcOf_(t) === src)
      .reduce((n, t) => n + (isNum_(t[k]) ? t[k] : 0), 0);
    const overall = src => {
      const tot = sumOf(src, 'total'), got = sumOf(src, 'unlocked');
      const n = at100(src);
      return got + ' / ' + tot + ' achievements (' + (tot ? Math.round(got / tot * 1000) / 10 : 0) + '%)\n' +
        (src === 'steam' ? round1_(sumOf('steam', 'hours')) + ' h total • ' : '') +
        n[0] + ' / ' + n[1] + ' games at 100%';
    };

    const fields = [
      { name: 'Hours played', value: round1_(hours) + ' h', inline: true },
      { name: 'Achievements unlocked', value: '+' + achs, inline: true },
      { name: 'Games played', value: String(played), inline: true }
    ];
    if (lines.length) fields.push({ name: 'Top games', value: lines.join('\n').slice(0, 1000) });
    if (finished.length) fields.push({ name: '🏆 Completed this week', value: finished.join(', ').slice(0, 1000) });
    ['steam', 'ra'].forEach(src => {
      if (tracked.some(t => srcOf_(t) === src)) fields.push({ name: SRC_NAME[src] + ' overall', value: overall(src) });
    });

    postDiscord_({
      embeds: [{
        title: '📅 Weekly summary' + (weeklyNow && !scheduled ? ' (preview)' : ''),
        description: per.length ? 'Games on your sheet only.' : 'Quiet week: no playtime or new achievements.',
        color: 0x5865f2,
        fields: fields
      }]
    });
    if (scheduled && !weeklyNow) { props.setProperty('WEEKLY_LAST', today); resetWeek = true; }
  }

  // ----- Save state for the next run -----
  const newSeen = Object.assign({}, seen); // keep history of games not in this run (e.g. one source failed)
  tracked.forEach(t => {
    if (t.defer) return;                       // keep the old numbers so the change is still seen next run (with its achievement names)
    newSeen[t.appid] = [t.hours, t.unlocked, t.total];
    if (!isNum_(base[t.appid]) && isNum_(t.unlocked)) base[t.appid] = t.unlocked;
    // The weekly baseline starts at setup, restarts after each weekly post, and picks up new games as they appear.
    if (resetWeek || !week[t.appid]) week[t.appid] = [t.hours, t.unlocked];
  });
  try {
    saveJson_(props, 'SEEN', newSeen);
    saveJson_(props, 'BASE', base);
    saveJson_(props, 'DONE', done);
    saveJson_(props, 'WEEK_BASE', week);
    // Keep the pending list small (per game and in total).
    while (JSON.stringify(pend).length > 60000) { const k = Object.keys(pend)[0]; if (k === undefined) break; delete pend[k]; }
    saveJson_(props, 'PEND', pend);
  } catch (e) { /* storage full: notifications may repeat */ }
}

function postDiscord_(payload) {
  const hook = PropertiesService.getScriptProperties().getProperty('DISCORD_WEBHOOK');
  if (!hook) return;
  return UrlFetchApp.fetch(hook, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  }).getResponseCode();
}

// ---------- troubleshooting ----------

// Click any cell in a game's row, then run this to see exactly what Steam says about that game.
function diagnoseGame() {
  const activeSheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  if (activeSheet.getName() === cfg_().raSheetName) { diagnoseRetro_(activeSheet); return; }
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('STEAM_API_KEY');
  let steamId = props.getProperty('STEAM_ID');
  if (!key || !steamId) { alert_('Set your API key & Steam ID first (Settings).'); return; }
  if (!/^\d{17}$/.test(steamId)) steamId = resolveVanity_(key, steamId);

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const row = sheet.getActiveCell().getRow();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(h => String(h).trim().toLowerCase().replace(/\s+/g, ' '));
  const nameIdx = headers.findIndex(h => NAME_HEADERS.indexOf(h) !== -1);
  const idIdx = headers.indexOf(OUT_COLS.appid.toLowerCase());
  if (row < topRow_(sheet) || nameIdx === -1) { alert_('Click a cell in a game\'s row first (not the header or totals row).'); return; }

  const name = String(sheet.getRange(row, nameIdx + 1).getValue()).trim();
  let appid = idIdx >= 0 ? Number(sheet.getRange(row, idIdx + 1).getValue()) : 0;
  const lines = ['Game: ' + name];
  if (!appid) {
    const hit = storeSearch_(name);
    appid = hit ? hit.id : 0;
    lines.push(hit ? 'No AppID on the sheet. Store search found "' + hit.name + '" (' + appid + ').'
                   : 'No AppID on the sheet and the Steam store has no match for that name. Check the spelling or type the AppID.');
  } else {
    lines.push('AppID: ' + appid);
  }
  if (!appid) { alert_(lines.join('\n')); return; }

  const owned = UrlFetchApp.fetch('https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=' + key +
    '&steamid=' + steamId + '&include_played_free_games=1&format=json', { muteHttpExceptions: true });
  if (owned.getResponseCode() === 200) {
    const g = (((JSON.parse(owned.getContentText()).response || {}).games) || []).filter(x => x.appid === appid)[0];
    lines.push(g ? 'In your library: yes (' + Math.round(g.playtime_forever / 6) / 10 + ' h played)'
                 : 'In your library: no (family share or free-to-play, so hours are unavailable)');
  } else {
    lines.push('Could not read your library (HTTP ' + owned.getResponseCode() + '). Is the API key right and Game details public?');
  }

  const res = UrlFetchApp.fetch('https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?key=' + key +
    '&steamid=' + steamId + '&appid=' + appid + '&format=json', { muteHttpExceptions: true });
  const r = parseAch_(res);
  lines.push('Achievements request: HTTP ' + res.getResponseCode());
  lines.push(r.err ? 'Result: Steam error (' + r.err + '). Usually temporary; it retries on the next update.'
    : r.none === 'private' ? 'Result: Steam says your game details are private. Set Profile and Game details to Public.'
    : r.none === 'nostats' ? 'Result: Steam has no stats for you in this game yet (never launched). The total is taken from the game\'s achievement list.'
    : r.none ? 'Result: this game has no achievements on Steam.'
    : 'Result: ' + r.unlocked + ' of ' + r.total + ' achievements unlocked.');
  lines.push('Steam said: ' + res.getContentText().slice(0, 160));
  alert_(lines.join('\n'));
}

// ---------- blank sheet setup ----------

function isBlankSheet_(sheet) {
  return sheet.getLastRow() === 0 || sheet.getLastColumn() === 0;
}

// Menu entry: only ever acts on a completely empty sheet, so it can't overwrite your data.
function setupSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(cfg_().sheetName) || ss.getSheets()[0];
  if (!isBlankSheet_(sheet)) {
    alert_('The "' + sheet.getName() + '" tab already has content, so nothing was changed. ' +
      'The layout is only created on a completely blank sheet.');
    return;
  }
  setupLayout_(sheet);
  alert_('Sheet set up. Type your game names under GAME LIST, then run Update now.');
}

// The achievement columns come in groups: normal, and (on the RetroAchievements tab) hardcore.
const ACH_GROUPS = [
  { c: 'COLLECTED ACHIES', t: 'TOTAL ACHIES', a: 'AMOUNT DONE', p: 'PROGRESS', d: 'COMPLETED' },
  { c: 'COLLECTED HC ACHIES', t: 'TOTAL HC ACHIES', a: 'HC AMOUNT DONE', p: 'HC PROGRESS', d: 'HC COMPLETED' }
];
const BAR = '{"charttype","bar";"max",1;"color1","#34a853"}';

// A1 formulas for one game row of a group. L maps header -> column letter, nl is the GAME LIST letter.
function groupRowFormulas_(L, g, nl, r) {
  const done = L[g.a] + r, f = {};
  f[g.a] = '=IFERROR(IF(OR(' + L[g.c] + r + '="",' + L[g.t] + r + '=""),"",' + L[g.c] + r + '/' + L[g.t] + r + '),"")';
  f[g.p] = '=IF(' + done + '="","",SPARKLINE(MIN(' + done + ',1),' + BAR + '))';
  f[g.d] = '=IF(' + nl + r + '="","",IFS(' + done + '>=5,"?",' + done + '>=1,"✓",TRUE,"X"))';
  return f;
}

// Totals formulas for the row `tr` (game rows first..last). only = restrict to one group.
function writeTotals_(sheet, L, tr, first, last, nl, only) {
  const put = (h, f, fmt) => {
    if (!L[h]) return;
    const r = sheet.getRange(tr, colIndex_(L[h]) + 1).setFormula(f);
    if (fmt) r.setNumberFormat(fmt);
  };
  const sum = h => '=SUM(' + L[h] + first + ':' + L[h] + last + ')';
  ACH_GROUPS.forEach(g => {
    if (only && only !== g) return;
    if (!(L[g.c] && L[g.t] && L[g.a])) return;
    put(g.c, sum(g.c)); put(g.t, sum(g.t));
    put(g.a, '=IFERROR(' + L[g.c] + tr + '/' + L[g.t] + tr + ',"")', '0.0%');
    put(g.p, '=IF(' + L[g.a] + tr + '="","",SPARKLINE(MIN(' + L[g.a] + tr + ',1),' + BAR + '))');
    put(g.d, '=COUNTIF(' + L[g.d] + first + ':' + L[g.d] + last + ',"✓") & " / " & COUNTA(' + nl + first + ':' + nl + last + ')');
  });
  if (!only) put('HOURS PLAYED', sum('HOURS PLAYED'), '#,##0.0" hrs"');
}

// Relative R1C1 reference from column index `to` to column index `from` on the same row.
function rc_(from, to) { return from === to ? 'RC' : 'RC[' + (from - to) + ']'; }

// Copies the AMOUNT DONE / PROGRESS / COMPLETED formulas into empty cells of game rows. Existing formulas and values are untouched.
function fillFormulas_(sheet, headers, nameIdx, col, numRows) {
  const top = topRow_(sheet);
  const targets = [];
  ACH_GROUPS.forEach(g => {
    const [ci, ti, amount, progress, completed] = [g.c, g.t, g.a, g.p, g.d].map(h => headers.indexOf(h.toLowerCase()));
    if (amount === -1 || ci === -1 || ti === -1) return;
    targets.push({ idx: amount, def: '=IFERROR(IF(OR(' + rc_(ci, amount) + '="",' + rc_(ti, amount) + '=""),"",' +
        rc_(ci, amount) + '/' + rc_(ti, amount) + '),"")' });
    if (progress !== -1) {
      const a = rc_(amount, progress);
      targets.push({ idx: progress, def: '=IF(' + a + '="","",SPARKLINE(MIN(' + a + ',1),' + BAR + '))' });
    }
    if (completed !== -1) {
      const a = rc_(amount, completed);
      targets.push({ idx: completed,
        def: '=IF(' + rc_(nameIdx, completed) + '="","",IFS(' + a + '>=5,"?",' + a + '>=1,"✓",TRUE,"X"))' });
    }
  });

  if (!targets.length) return;
  const lo = Math.min.apply(null, targets.map(t => t.idx)), hi = Math.max.apply(null, targets.map(t => t.idx));
  const blk = sheet.getRange(top, lo + 1, numRows, hi - lo + 1);
  const BF = blk.getFormulasR1C1(), BV = blk.getValues();          // one read for every column that may need a formula
  targets.forEach(t => {
    const f = BF.map(r => [r[t.idx - lo]]);
    const v = BV.map(r => [r[t.idx - lo]]);
    let last = null;
    const fills = []; // [firstRowIndex, lastRowIndex, formula]
    for (let i = 0; i < numRows; i++) {
      if (f[i][0] !== '') { last = f[i][0]; continue; }
      if (v[i][0] !== '') continue;                      // your own content: leave it
      const formula = last !== null ? last : t.def;
      const prev = fills[fills.length - 1];
      if (prev && prev[1] === i - 1 && prev[2] === formula) prev[1] = i; else fills.push([i, i, formula]);
    }
    fills.forEach(fl => {
      const n = fl[1] - fl[0] + 1;
      const rows = [];
      for (let k = 0; k < n; k++) rows.push([fl[2]]);
      sheet.getRange(top + fl[0], t.idx + 1, n, 1).setFormulasR1C1(rows);
    });
  });
}

function colLetter_(idx) { // 0 -> A
  let n = idx + 1, s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function setupLayout_(sheet, layout) {
  layout = layout || LAYOUT;
  const lastGameRow = 1 + Math.max(1, Number(cfg_().gameRows) || 250);   // formulas run down to here
  const totalsRow = lastGameRow + 1;                                     // totals sit right below
  const n = layout.length;
  if (sheet.getMaxRows() < totalsRow) sheet.insertRowsAfter(sheet.getMaxRows(), totalsRow - sheet.getMaxRows());
  if (sheet.getMaxColumns() < n) sheet.insertColumnsAfter(sheet.getMaxColumns(), n - sheet.getMaxColumns());

  const L = {};                                   // header -> column letter
  layout.forEach((h, i) => { L[h] = colLetter_(i); });
  const at = h => layout.indexOf(h) + 1;          // header -> 1-based column number
  const has = h => at(h) > 0;

  // Headers
  sheet.getRange(1, 1, 1, n).setValues([layout])
    .setFontWeight('bold').setBackground('#1b2838').setFontColor('#ffffff');
  sheet.setFrozenRows(1);

  // Formulas for AMOUNT DONE, PROGRESS and COMPLETED (and the HC versions), filled down for future games
  const nl = L['GAME LIST'];
  const nrows = lastGameRow - 1;
  ACH_GROUPS.forEach(g => {
    if (!(has(g.c) && has(g.t) && has(g.a))) return;
    const cols = {};
    for (let r = 2; r <= lastGameRow; r++) {
      const f = groupRowFormulas_(L, g, nl, r);
      Object.keys(f).forEach(h => { (cols[h] = cols[h] || []).push([f[h]]); });
    }
    Object.keys(cols).forEach(h => { if (has(h)) sheet.getRange(2, at(h), nrows, 1).setFormulas(cols[h]); });
  });
  const rows = new Array(nrows);

  // Number formats
  ACH_GROUPS.forEach(g => { if (has(g.a)) sheet.getRange(2, at(g.a), rows.length, 1).setNumberFormat('0.00%'); });
  if (has('HOURS PLAYED')) sheet.getRange(2, at('HOURS PLAYED'), rows.length, 1).setNumberFormat('0.0');
  sheet.getRange(2, at('LAST PLAYED'), rows.length, 1).setNumberFormat('yyyy-mm-dd');
  if (has('DATE COMPLETED')) sheet.getRange(2, at('DATE COMPLETED'), rows.length, 1).setNumberFormat('yyyy-mm-dd');
  sheet.getRange(2, at('LAST UPDATED'), rows.length, 1).setNumberFormat('yyyy-mm-dd hh:mm');

  alignColumns_(sheet, layout.map(h => h.toLowerCase()), rows.length + 1, true);   // the totals row too

  // COMPLETED colours
  let cf = sheet.getConditionalFormatRules();
  ACH_GROUPS.forEach(g => {
    if (!has(g.d)) return;
    const cr = sheet.getRange(2, at(g.d), rows.length, 1);
    cf = cf.concat([
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('✓').setBackground('#b7e1cd').setRanges([cr]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('X').setBackground('#f4c7c3').setRanges([cr]).build()
    ]);
  });
  sheet.setConditionalFormatRules(cf);

  // Totals row
  writeTotals_(sheet, L, totalsRow, 2, lastGameRow, nl);
  const tr = totalsRow;
  sheet.getRange(tr, 1, 1, n).setFontWeight('bold');

  sheet.setColumnWidth(at('GAME LIST'), 260);
  if (has('HACK')) { sheet.setColumnWidth(at('HACK'), 60); sheet.getRange(2, at('HACK'), nrows, 1).insertCheckboxes(); }
}

// ---------- shared sheet helpers ----------

// Header names that belong to the game table (used to work out which columns the Sort / Add rows tools move).
const TABLE_HEADERS = ['game list', 'game', 'name', 'title', 'game name', 'genre', 'appid', 'game id', 'console',
  'collected achies', 'hardcore achies', 'total achies', 'amount done', 'progress', 'completed',
  'collected hc achies', 'total hc achies', 'hc amount done', 'hc progress', 'hc completed', 'hours played',
  'last played', 'date completed', 'last updated', 'status', 'backlog status', 'play status', 'backlog', 'hack'];

function headersOf_(sheet) {
  const n = sheet.getLastColumn();
  return n < 1 ? [] : sheet.getRange(1, 1, 1, n).getValues()[0].map(h => String(h).trim().toLowerCase().replace(/\s+/g, ' '));
}

// First game row: 2, or 3 when a TOTALS row sits directly under the header (Tools > Add totals row under the header).
function topRow_(sheet) {
  try {
    const n = sheet.getLastColumn();
    if (n < 1) return 2;
    const ni = headersOf_(sheet).findIndex(h => NAME_HEADERS.indexOf(h) !== -1);
    if (ni === -1) return 2;
    const r = sheet.getRange(2, 1, 1, n);
    return /^totals?$/i.test(String(r.getValues()[0][ni]).trim()) && r.getFormulas()[0].some(f => f) ? 3 : 2;
  } catch (e) {
    return 2;
  }
}

// Number of game rows: ends at the last filled name, or at a "TOTALS"-style label row.
function trimGameRows_(sheet, nameIdx) {
  const top = topRow_(sheet);
  const nameCol = sheet.getRange(top, nameIdx + 1, Math.max(sheet.getLastRow() - top + 1, 1), 1).getValues();
  let n = nameCol.length;
  const end = nameCol.findIndex(r => /^(totals?|overall|summary)$/i.test(String(r[0]).trim()));
  if (end !== -1) n = end;
  while (n > 0 && String(nameCol[n - 1][0]).trim() === '') n--;
  return n;
}

function colIndex_(letters) { // 'A' -> 0
  return letters.toUpperCase().split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
}

// First and last (0-based) column of the game table: your custom Sort range, or automatic.
function tableSpan_(headers) {
  const custom = cfg_().sortRange;
  const m = custom && /^([A-Za-z]{1,2}):([A-Za-z]{1,2})$/.exec(custom);
  if (m) return { min: Math.min(colIndex_(m[1]), colIndex_(m[2])), max: Math.max(colIndex_(m[1]), colIndex_(m[2])) };
  const idx = TABLE_HEADERS.map(h => headers.indexOf(h)).filter(i => i >= 0);
  return idx.length ? { min: Math.min.apply(null, idx), max: Math.max.apply(null, idx) } : null;
}

// The tab the Sort / Add rows tools act on: the tab you're looking at if it's one of ours, else the Steam tab.
function targetSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const c = cfg_();
  const active = ss.getActiveSheet();
  if (active && (active.getName() === c.sheetName || active.getName() === c.raSheetName)) return active;
  return ss.getSheetByName(c.sheetName) || ss.getSheets()[0];
}

// ---------- sorting ----------
// Sorts only the game rows and only the table columns, so your other lists, the totals row and the empty
// rows below the list are never moved. Rows keep their formulas, links and formatting.

function sortAZ() { sortList_('az'); }
function sortZA() { sortList_('za'); }
function sortPctHigh() { sortList_('pctHigh'); }
function sortPctLow() { sortList_('pctLow'); }
function sortHours() { sortList_('hours'); }
function sortRecent() { sortList_('recent'); }
function sortGenre() { sortList_('genre'); }
function sortBacklog() { sortList_('backlog'); }
function sortDoneNew() { sortList_('doneNew'); }
function sortDoneOld() { sortList_('doneOld'); }

const SORT_LABELS = {
  az: 'A → Z', za: 'Z → A', pctHigh: 'completion % (highest first)', pctLow: 'completion % (lowest first)',
  hours: 'hours played (most first)', recent: 'last played (newest first)', genre: 'genre (A → Z)',
  backlog: 'backlog status (BACKLOG, ACTIVE, IDLE, COMPLETED), then A → Z',
  doneNew: 'date completed (newest first)', doneOld: 'date completed (oldest first)'
};

function sortList_(kind) {
  withLock_(() => {
    const sheet = targetSheet_();
    const headers = headersOf_(sheet);
    const H = h => headers.indexOf(h);
    const nameIdx = headers.findIndex(h => NAME_HEADERS.indexOf(h) !== -1);
    if (nameIdx === -1) { alert_('Could not find a GAME LIST column in row 1 of "' + sheet.getName() + '".'); return; }
    const need = { pctHigh: ['collected achies', 'total achies'], pctLow: ['collected achies', 'total achies'],
                   hours: ['hours played'], recent: ['last played'], genre: ['genre'],
                   doneNew: ['date completed'], doneOld: ['date completed'] }[kind] || [];
    const statusIdx = headers.findIndex(h => PLAY_STATUS_HEADERS.indexOf(h) !== -1);
    if (kind === 'backlog' && statusIdx === -1) {
      alert_('"' + sheet.getName() + '" has no BACKLOG STATUS column. Run Achievement Tracker > Add backlog status column first.');
      return;
    }
    const missing = need.filter(h => H(h) === -1);
    if (missing.length) { alert_('"' + sheet.getName() + '" has no ' + missing[0].toUpperCase() + ' column, so it can\'t be sorted that way.'); return; }

    const numRows = trimGameRows_(sheet, nameIdx);
    if (numRows < 2) { alert_('There is nothing to sort yet.'); return; }
    const span = tableSpan_(headers);
    if (!span || nameIdx < span.min || nameIdx > span.max) { alert_('The sort range must include the GAME LIST column.'); return; }

    const top = topRow_(sheet);
    const block = sheet.getRange(top, 1, numRows, sheet.getLastColumn()).getValues();
    const num = v => (typeof v === 'number' && !isNaN(v)) ? v : null;
    const cellOf = (r, h) => (H(h) >= 0 ? r[H(h)] : '');
    const rows = block.map((r, i) => {
      const unl = num(cellOf(r, 'collected achies')), tot = num(cellOf(r, 'total achies'));
      const last = cellOf(r, 'last played');
      return { i: i, name: String(r[nameIdx]).trim(), pct: unl !== null && tot ? unl / tot : null,
               hours: num(cellOf(r, 'hours played')), last: last instanceof Date ? last.getTime() : null,
               genre: String(cellOf(r, 'genre')).trim(),
               done: (v => (v instanceof Date ? v.getTime() : null))(cellOf(r, 'date completed')),
               status: statusIdx >= 0 ? String(r[statusIdx]).trim().toUpperCase() : '' };
    });
    const nameCmp = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
    const byNum = (k, desc) => (a, b) => {
      const x = a[k], y = b[k];
      if (x === null && y === null) return nameCmp(a, b);
      if (x === null) return 1;                       // rows with no value always go last
      if (y === null) return -1;
      return (desc ? y - x : x - y) || nameCmp(a, b);
    };
    const STATUS_ORDER = { BACKLOG: 0, ACTIVE: 1, PLAYED: 1, IDLE: 2, COMPLETED: 3 };   // PLAYED = the old name for ACTIVE
    const statusRank = r => (STATUS_ORDER[r.status] !== undefined ? STATUS_ORDER[r.status] : 4);   // blank / unknown last
    const cmps = {
      doneNew: byNum('done', true), doneOld: byNum('done', false),
      backlog: (a, b) => (statusRank(a) - statusRank(b)) || nameCmp(a, b),
      az: nameCmp, za: (a, b) => nameCmp(b, a),
      pctHigh: byNum('pct', true), pctLow: byNum('pct', false), hours: byNum('hours', true), recent: byNum('last', true),
      genre: (a, b) => (a.genre === '' ? (b.genre === '' ? nameCmp(a, b) : 1) : b.genre === '' ? -1 :
        (a.genre.localeCompare(b.genre, undefined, { sensitivity: 'base' }) || nameCmp(a, b)))
    };
    const cmp = cmps[kind];
    const ordered = rows.slice().sort((a, b) => (!a.name && b.name) ? 1 : (a.name && !b.name) ? -1 : cmp(a, b));
    const rank = new Array(numRows);
    ordered.forEach((r, pos) => { rank[r.i] = [pos + 1]; });

    // A temporary key column right after the table carries the new order; then it is removed again.
    sheet.insertColumnAfter(span.max + 1);
    const helper = span.max + 2;
    try {
      sheet.getRange(top, helper, numRows, 1).setValues(rank);
      sheet.getRange(top, span.min + 1, numRows, helper - span.min).sort({ column: helper, ascending: true });
    } finally {
      sheet.deleteColumn(helper);
    }
    alert_('Sorted "' + sheet.getName() + '" by ' + SORT_LABELS[kind] + '.');
  });
}

function settingSortRange() {
  const cur = cfg_().sortRange;
  const v = ask_('Sort range', 'Columns the Sort options should move, e.g. A:L (from GAME LIST to the last column of your game table).\n' +
    'Leave empty for automatic. Currently: ' + (cur || 'automatic'));
  if (v === null) return;
  if (v !== '' && !/^[A-Za-z]{1,2}:[A-Za-z]{1,2}$/.test(v)) { alert_('Please enter something like A:L. Nothing was changed.'); return; }
  setCfg_({ sortRange: v.toUpperCase() });
  buildMenu_();
  alert_(v ? 'Sort range set to ' + v.toUpperCase() + '.' : 'Sort range is automatic again.');
}

// ---------- adding game rows ----------

function addGameRows() {
  const sheet = targetSheet_();
  const v = ask_('Add game rows', 'How many game rows do you want to add to the "' + sheet.getName() + '" tab? (1-2000)');
  if (v === null) return;
  const n = Math.floor(Number(v));
  if (!(n >= 1 && n <= 2000)) { alert_('Please enter a whole number from 1 to 2000. Nothing was changed.'); return; }
  withLock_(() => alert_(extendRows_(sheet, n)));
}

// The totals row is the lowest row whose achievements column holds a =SUM(...). Returns its row number, or 0.
function totalsRowOf_(sheet, headers) {
  const lastRow = sheet.getLastRow();
  const top = topRow_(sheet);
  const sumIdx = ['collected achies', 'total achies', 'hardcore achies', 'hours played'].map(h => headers.indexOf(h)).filter(i => i >= 0)[0];
  if (sumIdx === undefined || lastRow < top + 1) return 0;
  const f = sheet.getRange(top, sumIdx + 1, lastRow - top + 1, 1).getFormulas();
  for (let r = f.length - 1; r >= 0; r--) { if (/^=SUM\(/i.test(f[r][0])) return r + top; }
  return 0;
}

// Makes room for n more games above the totals row (formulas, formats and totals ranges grow with it).
function extendRows_(sheet, n) {
  const headers = headersOf_(sheet);
  const H = h => headers.indexOf(h);
  const nameIdx = headers.findIndex(h => NAME_HEADERS.indexOf(h) !== -1);
  if (nameIdx === -1) return 'Could not find a GAME LIST column in row 1 of "' + sheet.getName() + '".';
  const span = tableSpan_(headers);
  const lastRow = sheet.getLastRow();

  const totalsRow = totalsRowOf_(sheet, headers);
  const top = topRow_(sheet);

  let first, src;
  if (totalsRow >= top + 2) {
    first = totalsRow - 1;                     // insert inside the totals' ranges so they grow too
    src = totalsRow - 2;
    sheet.insertRowsBefore(first, n);
  } else {
    first = Math.max(lastRow, 1) + 1;
    src = Math.max(lastRow, 2);
    sheet.insertRowsAfter(Math.max(lastRow, 1), n);
  }

  // Copy the formulas and formatting from the row above into the new rows.
  ['amount done', 'progress', 'completed'].forEach(h => {
    const idx = H(h);
    if (idx === -1) return;
    const f = sheet.getRange(src, idx + 1).getFormulaR1C1();
    if (f) sheet.getRange(first, idx + 1, n, 1).setFormulaR1C1(f);
  });
  if (span) {
    sheet.getRange(src, span.min + 1, 1, span.max - span.min + 1)
      .copyTo(sheet.getRange(first, span.min + 1, n, span.max - span.min + 1), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  }
  // Also copy any dropdowns / chips (e.g. on the BACKLOG STATUS column) down into the new rows.
  if (span) {
    try {
      sheet.getRange(src, span.min + 1, 1, span.max - span.min + 1)
        .copyTo(sheet.getRange(first, span.min + 1, n, span.max - span.min + 1), SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
    } catch (e) { /* cosmetic */ }
  }

  // Point every range in the totals row at the new last game row (this also fixes totals that stopped short).
  let lastGame = first + n - 1;
  if (totalsRow >= top + 2) {
    const newTotals = totalsRow + n;
    lastGame = newTotals - 1;
    const width = sheet.getLastColumn();
    const rng = sheet.getRange(newTotals, 1, 1, width);
    const f = rng.getFormulas()[0];
    const fixed = f.map(x => x ? x.replace(new RegExp('\\$?([A-Z]{1,3})\\$?' + top + ':\\$?([A-Z]{1,3})\\$?\\d+', 'g'), (m, a, b) => a + top + ':' + b + lastGame) : x);
    if (fixed.some((x, i) => x !== f[i])) rng.setFormulas([fixed]);
  }
  return 'Added ' + n + ' rows to "' + sheet.getName() + '". Game rows now run from row ' + top + ' to row ' + lastGame + '.';
}

function settingGameRows() {
  const v = ask_('Game rows on a new sheet', 'How many game rows should a new blank sheet get? (10-5000, currently ' + cfg_().gameRows + ').\n' +
    'This only affects sheets the script sets up from scratch. Use "Add game rows" to grow an existing list.');
  if (v === null) return;
  const n = Math.floor(Number(v));
  if (!(n >= 10 && n <= 5000)) { alert_('Please enter a number from 10 to 5000. Nothing was changed.'); return; }
  setCfg_({ gameRows: n });
  buildMenu_();
  alert_('New blank sheets will get ' + n + ' game rows.');
}

// ---------- RetroAchievements: HACK column ----------
// A checkbox column between BACKLOG STATUS and GAME LIST. The script ticks it when a game is a hack (its RetroAchievements
// title starts with ~Hack~). Tick it yourself on a game you haven't played to make the script search the hacks for it.

function addHackColumn() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(cfg_().raSheetName);
  if (!sheet) { alert_('There is no "' + cfg_().raSheetName + '" tab yet.'); return; }
  const r = withLock_(() => addHackColumn_(sheet));
  if (r) { alert_(r); updateSteamSheet(); }
}

function addHackColumn_(sheet) {
  const headers = headersOf_(sheet);
  const nameIdx = headers.findIndex(h => NAME_HEADERS.indexOf(h) !== -1);
  if (nameIdx === -1) return 'Could not find a GAME LIST column in row 1 of "' + sheet.getName() + '".';
  if (['hack', 'is hack', 'romhack'].some(h => headers.indexOf(h) !== -1)) { alert_('"' + sheet.getName() + '" already has a HACK column.'); return null; }
  sheet.insertColumnBefore(nameIdx + 1);                          // directly left of GAME LIST (so right of BACKLOG STATUS)
  sheet.getRange(1, nameIdx + 2).copyTo(sheet.getRange(1, nameIdx + 1), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  sheet.getRange(1, nameIdx + 1).setValue('HACK');
  sheet.setColumnWidth(nameIdx + 1, 60);
  const top = topRow_(sheet);
  const tr = totalsRowOf_(sheet, headersOf_(sheet));
  const last = tr ? tr - 1 : Math.max(sheet.getLastRow(), top);
  sheet.getRange(top, nameIdx + 1, last - top + 1, 1).insertCheckboxes().setHorizontalAlignment('center');
  return 'Added a HACK column to "' + sheet.getName() + '", left of GAME LIST. It is ticked automatically for ROM hacks. Tick it yourself on a hack you haven\'t played to have the script search the hack list for it.';
}

// ---------- RetroAchievements: split hardcore into its own columns ----------
// Older RetroAchievements tabs have one HARDCORE ACHIES column. This replaces it with a full hardcore set after COMPLETED:
// COLLECTED HC ACHIES, TOTAL HC ACHIES, HC AMOUNT DONE, HC PROGRESS, HC COMPLETED (with totals), and keeps your hardcore numbers.

const HC_HEADERS = ['COLLECTED HC ACHIES', 'TOTAL HC ACHIES', 'HC AMOUNT DONE', 'HC PROGRESS', 'HC COMPLETED'];

function upgradeRetroLayout() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(cfg_().raSheetName);
  if (!sheet) { alert_('There is no "' + cfg_().raSheetName + '" tab yet.'); return; }
  const r = withLock_(() => upgradeRetroLayout_(sheet));
  if (r) { alert_(r); updateSteamSheet(); }
}

function upgradeRetroLayout_(sheet) {
  let headers = headersOf_(sheet);
  const name = '"' + sheet.getName() + '"';
  if (headers.indexOf('collected hc achies') !== -1) { alert_(name + ' already has the hardcore columns.'); return null; }
  const need = ['collected achies', 'total achies'];
  if (need.some(h => headers.indexOf(h) === -1)) { alert_(name + ' needs COLLECTED ACHIES and TOTAL ACHIES columns first.'); return null; }
  const tr0 = totalsRowOf_(sheet, headers);
  const top = topRow_(sheet);
  const anchor = Math.max.apply(null, ['completed', 'progress', 'amount done', 'total achies'].map(h => headers.indexOf(h)));
  const maxRows = sheet.getMaxRows();

  sheet.insertColumnsAfter(anchor + 1, 5);                        // five new columns right after COMPLETED
  headers = headersOf_(sheet);
  const oldHc = headers.indexOf('hardcore achies');
  const at = h => headers.indexOf(h);
  const dst = [anchor + 1, anchor + 2, anchor + 3, anchor + 4, anchor + 5];
  const src = [oldHc >= 0 ? oldHc : at('collected achies'), at('total achies'), at('amount done'), at('progress'), at('completed')];
  dst.forEach((d, k) => {
    if (src[k] < 0) return;
    sheet.getRange(1, src[k] + 1, maxRows, 1).copyTo(sheet.getRange(1, d + 1, maxRows, 1), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  });
  sheet.getRange(1, anchor + 2, 1, 5).setValues([HC_HEADERS]);
  const last = tr0 ? tr0 - 1 : Math.max(sheet.getLastRow(), top);
  if (oldHc >= 0 && last >= top) {                                // carry over the hardcore numbers you already have
    const vals = sheet.getRange(top, oldHc + 1, last - top + 1, 1).getValues();
    sheet.getRange(top, anchor + 2, vals.length, 1).setValues(vals);
  }
  if (oldHc >= 0) sheet.deleteColumn(oldHc + 1);

  // Letters for the final layout, then formulas for every game row (down to the totals row) and the totals.
  headers = headersOf_(sheet);
  const L = {};
  headers.forEach((h, i) => { if (h) L[h.toUpperCase()] = colLetter_(i); });
  const nl = colLetter_(headers.findIndex(h => NAME_HEADERS.indexOf(h) !== -1));
  const g = ACH_GROUPS[1];
  const cols = {};
  for (let r = top; r <= last; r++) {
    const f = groupRowFormulas_(L, g, nl, r);
    Object.keys(f).forEach(h => { (cols[h] = cols[h] || []).push([f[h]]); });
  }
  Object.keys(cols).forEach(h => sheet.getRange(top, headers.indexOf(h.toLowerCase()) + 1, last - top + 1, 1).setFormulas(cols[h]));
  sheet.getRange(top, headers.indexOf('total hc achies') + 1, last - top + 1, 1).clearContent();   // filled by the next update

  const cr = sheet.getRange(top, headers.indexOf('hc completed') + 1, Math.max(sheet.getMaxRows() - top + 1, 1), 1);
  sheet.setConditionalFormatRules(sheet.getConditionalFormatRules().concat([
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('✓').setBackground('#b7e1cd').setRanges([cr]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('X').setBackground('#f4c7c3').setRanges([cr]).build()
  ]));

  const tr = tr0 ? tr0 : 0;                                       // the bottom totals row (deleting a column doesn't move rows)
  if (tr) writeTotals_(sheet, L, tr, top, last, nl, g);
  if (top === 3) {                                                // the TOTALS row under the header mirrors the new columns
    const row2 = {};
    HC_HEADERS.forEach(h => {
      const c = L[h];
      row2[h] = h === 'HC PROGRESS' ? '=IF(' + L['HC AMOUNT DONE'] + '2="","",SPARKLINE(MIN(' + L['HC AMOUNT DONE'] + '2,1),' + BAR + '))' : (tr ? '=' + c + tr : '');
      if (row2[h]) sheet.getRange(2, colIndex_(c) + 1).setFormula(row2[h]);
    });
  }
  return 'The hardcore columns were added after COMPLETED on ' + name + ' (COLLECTED HC ACHIES, TOTAL HC ACHIES, HC AMOUNT DONE, HC PROGRESS, HC COMPLETED), with totals. Your hardcore numbers were kept; the totals are filled in by the update that follows.';
}

// ---------- totals row under the header ----------
// Inserts a TOTALS row directly under the header that mirrors the totals row at the bottom, so the totals are always in view.
// Rows below move down by one; the script finds the first game row by looking for this row.

function addTopTotals() {
  const sheet = targetSheet_();
  const r = withLock_(() => addTopTotals_(sheet));
  if (r) alert_(r);
}

function addTopTotals_(sheet) {
  const headers = headersOf_(sheet);
  const nameIdx = headers.findIndex(h => NAME_HEADERS.indexOf(h) !== -1);
  if (nameIdx === -1) return 'Could not find a GAME LIST column in row 1 of "' + sheet.getName() + '".';
  if (topRow_(sheet) === 3) return '"' + sheet.getName() + '" already has a totals row under the header.';
  const tr = totalsRowOf_(sheet, headers);
  if (!tr) return 'There is no totals row at the bottom of "' + sheet.getName() + '" to mirror. Add one first (a row with =SUM formulas under your games), or run Tools > Set up blank sheet on a new tab.';
  const width = sheet.getLastColumn();
  const bottom = sheet.getRange(tr, 1, 1, width);
  const bf = bottom.getFormulas()[0], bv = bottom.getValues()[0];
  const L = i => colLetter_(i);

  sheet.insertRowsAfter(1, 1);                                   // the new row 2 (the bottom totals row is now at tr + 1)
  const row = sheet.getRange(2, 1, 1, width);
  sheet.getRange(tr + 1, 1, 1, width).copyTo(row, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  const bars = {};                                               // PROGRESS column index -> its AMOUNT DONE column index
  ACH_GROUPS.forEach(g => { const p = headers.indexOf(g.p.toLowerCase()), a = headers.indexOf(g.a.toLowerCase()); if (p >= 0 && a >= 0) bars[p] = a; });
  const f = [];
  for (let i = 0; i < width; i++) {
    if (i === nameIdx) f.push('TOTALS');
    else if (bars[i] !== undefined) f.push('=IF(' + L(bars[i]) + '2="","",SPARKLINE(MIN(' + L(bars[i]) + '2,1),' + BAR + '))');
    else if (bf[i] || (bv[i] !== '' && bv[i] !== null)) f.push('=' + L(i) + (tr + 1));
    else f.push('');
  }
  row.setValues([f.map(x => (x.charAt(0) === '=' ? '' : x))]);
  row.setFormulas([f]);                                          // formulas as formulas, the label as text
  row.setFontWeight('bold');
  sheet.getRange(2, nameIdx + 1).setValue('TOTALS');
  sheet.setFrozenRows(2);
  return 'Added a TOTALS row under the header of "' + sheet.getName() + '" (frozen, so it stays in view). It shows the totals from the row at the bottom. Your games now start on row 3.';
}

// Adds games to the first free rows of the list (below it, or above the totals row, making room if needed).
// entries: [{columnIndex: value, ...}] with the game name in the name column. Returns how many were added.
function appendGameRows_(sheet, headers, nameIdx, entries) {
  if (!entries.length) return 0;
  const slots = () => {
    const top = topRow_(sheet);
    const col = sheet.getRange(top, nameIdx + 1, Math.max(sheet.getLastRow() - top + 1, 1), 1).getValues();
    let end = col.findIndex(r => /^(totals?|overall|summary)$/i.test(String(r[0]).trim()));
    const tr = totalsRowOf_(sheet, headers);                       // the totals row (it may have no label)
    if (tr >= top + 1 && (end === -1 || tr - top < end)) end = tr - top;
    const limit = end === -1 ? col.length : end;
    const free = [];
    for (let i = 0; i < limit; i++) if (String(col[i][0]).trim() === '') free.push(i);
    if (end === -1) for (let i = limit; free.length < entries.length; i++) free.push(i);   // below the list
    return free;
  };
  let free = slots();
  if (free.length < entries.length) {                     // a totals row sits below the list: make room above it first
    extendRows_(sheet, entries.length - free.length);
    free = slots();
  }
  const list = entries.slice(0, free.length);
  const top = topRow_(sheet);
  if (list.length && sheet.getMaxRows() < top + free[list.length - 1]) sheet.insertRowsAfter(sheet.getMaxRows(), top + free[list.length - 1] - sheet.getMaxRows());
  let a = 0;                                              // write in runs of consecutive rows
  while (a < list.length) {
    let b = a;
    while (b + 1 < list.length && free[b + 1] === free[b] + 1) b++;
    Object.keys(list[a]).forEach(k => {
      if (Number(k) < 0) return;
      sheet.getRange(top + free[a], Number(k) + 1, b - a + 1, 1).setValues(list.slice(a, b + 1).map(e => [e[k]]));
    });
    a = b + 1;
  }
  return list.length;
}

// ---------- import library ----------
// Manual button: adds every game in your Steam library that has achievements and isn't on the sheet yet.
const IMPORT_BUDGET_SEC = 240;

function importLibrary() {
  const ui = SpreadsheetApp.getUi();
  const answer = ui.alert('Import library games with achievements',
    'This adds every game in your Steam library that has achievements (games without achievements are ignored) and is not on the sheet yet.\n\n' +
    'WARNING: this can take a long time on a big library, because Steam is asked about every game. If it runs out of time it saves its progress; ' +
    'run it again to carry on.\n\nYour Steam profile and Game details must be Public. Continue?', ui.ButtonSet.OK_CANCEL);
  if (answer !== ui.Button.OK) return;
  const r = withLock_(importLibrary_);
  if (!r) return;
  alert_(r.msg);
  if (r.added > 0) run_(false, false);     // fill in hours, achievements and genres for the new rows
}

function importLibrary_() {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('STEAM_API_KEY');
  let steamId = props.getProperty('STEAM_ID');
  if (!key || !steamId) return { msg: 'Run Achievement Tracker > Settings > Accounts > Steam API key & Steam ID first.', added: 0 };
  if (!/^\d{17}$/.test(steamId)) { steamId = resolveVanity_(key, steamId); props.setProperty('STEAM_ID', steamId); }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(cfg_().sheetName) || ss.getSheets()[0];
  if (isBlankSheet_(sheet)) return { msg: 'The "' + sheet.getName() + '" tab is blank. Run Tools > Set up blank sheet first, then import.', added: 0 };
  const headers = headersOf_(sheet);
  const nameIdx = headers.findIndex(h => NAME_HEADERS.indexOf(h) !== -1);
  const idIdx = headers.indexOf('appid');
  if (nameIdx === -1 || idIdx === -1) return { msg: 'The tab needs a GAME LIST column and an APPID column in row 1.', added: 0 };

  const res = UrlFetchApp.fetch('https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=' + key + '&steamid=' + steamId +
    '&include_appinfo=1&include_played_free_games=1&format=json', { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('Steam API error ' + res.getResponseCode() + ' (check your API key).');
  const games = (JSON.parse(res.getContentText()).response || {}).games || [];
  if (!games.length) throw new Error('Steam returned no games. Make sure your profile and "Game details" are set to Public.');

  // Games already on the sheet (by AppID or by name).
  const have = trimGameRows_(sheet, nameIdx);
  const haveNames = {}, haveIds = {};
  if (have > 0) {
    sheet.getRange(topRow_(sheet), nameIdx + 1, have, 1).getValues().forEach(r => { if (String(r[0]).trim()) haveNames[norm_(r[0])] = 1; });
    sheet.getRange(topRow_(sheet), idIdx + 1, have, 1).getValues().forEach(r => { if (Number(r[0])) haveIds[Number(r[0])] = 1; });
  }
  const candidates = games.filter(g => g.name && !haveIds[g.appid] && !haveNames[norm_(g.name)]);

  // Which of them have achievements (remembered, so an interrupted import carries on where it stopped).
  const known = loadJson_(props, 'IMPORT_CHECK') || {};
  const unknown = candidates.filter(g => known[g.appid] === undefined);
  const started = Date.now();
  let s = 0;
  while (s < unknown.length && Date.now() - started < IMPORT_BUDGET_SEC * 1000) {
    const batch = unknown.slice(s, s + 30);
    let resps = UrlFetchApp.fetchAll(batch.map(g => ({
      url: 'https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=' + g.appid + '&format=json',
      muteHttpExceptions: true })));
    if (resps.some(r => r.getResponseCode() === 429)) { Utilities.sleep(20000); continue; }   // rate limited: wait, redo the batch
    batch.forEach((g, n) => {
      const code = resps[n].getResponseCode();
      if (code === 200) {
        let total = 0;
        try { total = (JSON.parse(resps[n].getContentText()).achievementpercentages.achievements || []).length; } catch (e) { /* none */ }
        known[g.appid] = total;
      } else if (code === 400 || code === 403 || code === 404) known[g.appid] = 0;   // no achievement list
      // anything else is a hiccup: left unknown, checked again next time
    });
    s += 30;
    Utilities.sleep(300);
  }
  saveJson_(props, 'IMPORT_CHECK', known);
  const stillUnknown = candidates.filter(g => known[g.appid] === undefined).length;
  const toAdd = candidates.filter(g => known[g.appid] > 0)
    .sort((a, b) => a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0);

  const added = appendGameRows_(sheet, headers, nameIdx, toAdd.map(g => { const c = {}; c[nameIdx] = g.name; c[idIdx] = g.appid; return c; }));
  const skipped = candidates.length - toAdd.length - stillUnknown;
  return { added: added, msg: 'Checked ' + candidates.length + ' games that were not on the sheet.\nAdded ' + added + ' with achievements; ' +
    skipped + ' had no achievements and were ignored.' +
    (stillUnknown ? '\n\n' + stillUnknown + ' games could not be checked yet (time limit or Steam busy). Run Import library games again to carry on.' : '') +
    (added ? '\n\nNow fetching their hours, achievements and genres.' : '') };
}

// ---------- cell update rules ----------
// For each column the script fills in, choose: KEEP my edits (the script only fills blank cells) or let the
// script overwrite. STATUS is always managed by the script.

function toggleRule_(key) {
  const keep = Object.assign({}, cfg_().keep);
  keep[key] = !keep[key];
  setCfg_({ keep: keep });
  buildMenu_();
  const label = RULE_COLS.filter(r => r[0] === key)[0][1];
  alert_(label + ': ' + (keep[key] ? 'the script now KEEPS what you type and only fills blank cells.' : 'the script now overwrites this column with fresh data.'));
}
function rule_appid() { toggleRule_('appid'); }
function rule_console() { toggleRule_('console'); }
function rule_genre() { toggleRule_('genre'); }
function rule_unlocked() { toggleRule_('unlocked'); }
function rule_hardcore() { toggleRule_('hardcore'); }
function rule_total() { toggleRule_('total'); }
function rule_hours() { toggleRule_('hours'); }
function rule_lastPlayed() { toggleRule_('lastPlayed'); }
function rule_updated() { toggleRule_('updated'); }
function rule_completed() { toggleRule_('completed'); }
function rule_playStatus() { toggleRule_('playStatus'); }

// ---------- BACKLOG STATUS column ----------
// Optional column (header BACKLOG STATUS, PLAY STATUS or BACKLOG, anywhere on the sheet). The script fills it with
// COMPLETED / IDLE / ACTIVE / BACKLOG as text. Chips or colours you add yourself stay (the script never touches them). A cell that holds your own formula is left alone.

const PLAY_STATUS_HEADERS = ['backlog status', 'play status', 'backlog'];
const PLAY_STATES = ['BACKLOG', 'ACTIVE', 'IDLE', 'COMPLETED'];

function playStatusOf_(unlocked, total, hours, lastPlayed, cutoff) {
  const u = Number(unlocked) || 0, t = Number(total) || 0, h = Number(hours) || 0;
  if (t > 0 && u >= t) return 'COMPLETED';
  if (h > 0 || u > 0) {                       // played (achievements count too: shared and retro games have no hours)
    const d = lastPlayed instanceof Date ? lastPlayed : (lastPlayed ? new Date(lastPlayed) : null);
    if (cutoff && d && !isNaN(d.getTime()) && d < cutoff) return 'IDLE';
    return 'ACTIVE';
  }
  return 'BACKLOG';
}

// True if a data-validation rule is a checkbox.
function isCheckbox_(dv) {
  try { return !!dv && dv.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.CHECKBOX; } catch (e) { return false; }
}

function applyPlayStatus_(sheet, headers, nameIdx, numRows) {
  const si = headers.findIndex(h => PLAY_STATUS_HEADERS.indexOf(h) !== -1);
  if (si === -1 || numRows < 1) return;
  const c = cfg_();
  const top = topRow_(sheet);
  // A new column can inherit the HACK column's checkboxes, which reject text such as ACTIVE: remove them from this column.
  if (isCheckbox_(sheet.getRange(top, si + 1).getDataValidation())) {
    sheet.getRange(top, si + 1, Math.max(sheet.getMaxRows() - top + 1, 1), 1).clearDataValidations();
  }
  // One read covers every column that decides the status.
  const ix = { n: nameIdx, u: headers.indexOf('collected achies'), t: headers.indexOf('total achies'),
               h: headers.indexOf('hours played'), l: headers.indexOf('last played'), s: si };
  const used = Object.keys(ix).map(k => ix[k]).filter(v => v >= 0);
  const lo = Math.min.apply(null, used), hi = Math.max.apply(null, used);
  const blk = sheet.getRange(top, lo + 1, numRows, hi - lo + 1).getValues();
  const at = (r, k) => (ix[k] < 0 ? null : blk[r][ix[k] - lo]);
  const rng = sheet.getRange(top, si + 1, numRows, 1);
  const form = rng.getFormulas();
  const old = blk.map((r, i) => [at(i, 's')]);
  if (/^=ARRAYFORMULA\(/i.test(form[0][0]) && /BACKLOG/i.test(form[0][0])) {       // the formula an earlier version installed
    sheet.getRange(top, si + 1).clearContent(); form[0][0] = ''; old[0][0] = '';
  }
  const cutoff = idleCutoff_(c);
  const out = old.map((o, i) => {
    if (form[i][0]) return [form[i][0]];                                            // your own formula: untouched
    if (c.keep.playStatus && String(o[0]).trim() !== '') return [o[0]];             // "keep my edits"
    if (String(at(i, 'n')).trim() === '') return [''];
    return [playStatusOf_(at(i, 'u'), at(i, 't'), at(i, 'h'), at(i, 'l'), cutoff)];
  });
  if (out.some((r, i) => r[0] !== old[i][0])) rng.setValues(out);                   // only when something changed
  syncStatusColours_(sheet, si, numRows);

  // The script only writes the text. Dropdowns, chips and colours you add to this column yourself are left alone.
}

// ---------- BACKLOG STATUS colours ----------
// Google doesn't let scripts set the colours of Insert > Dropdown chips, so this colours the cells with conditional
// formatting instead (use one or the other). Off by default. When on, the script owns the four rules for this column.

const COLOUR_NAMES = { red: '#f4c7c3', green: '#b7e1cd', blue: '#c9daf8', yellow: '#fff2cc', orange: '#fce5cd', purple: '#d9d2e9',
  pink: '#ead1dc', teal: '#d0e0e3', grey: '#e6e6e6', gray: '#e6e6e6', white: '#ffffff' };

function statusRulesOf_(rules, col1) {
  const words = PLAY_STATES.map(x => x.toUpperCase()).concat(['PLAYED']);   // PLAYED: rules from before the rename
  return rules.filter(r => {
    try {
      const bc = r.getBooleanCondition();
      return !!bc && bc.getCriteriaValues().some(v => words.indexOf(String(v).toUpperCase()) !== -1) &&
        r.getRanges().some(g => g.getColumn() === col1);
    } catch (e) { return false; }
  });
}

function syncStatusColours_(sheet, si, numRows) {
  const c = cfg_();
  if (!c.statusColours) return;
  try {
    const all = sheet.getConditionalFormatRules();
    const mine = statusRulesOf_(all, si + 1);
    const want = PLAY_STATES.filter(w => c.statusColourMap[w]);
    const same = mine.length === want.length && want.every(w => mine.some(r => {
      try { const bc = r.getBooleanCondition(); return String(bc.getCriteriaValues()[0]).toUpperCase() === w &&
        String(bc.getBackground()).toLowerCase() === c.statusColourMap[w].toLowerCase(); } catch (e) { return false; }
    }));
    if (same) return;
    const top = topRow_(sheet);
    const area = sheet.getRange(top, si + 1, Math.max(sheet.getMaxRows() - top + 1, numRows), 1);
    const rest = all.filter(r => mine.indexOf(r) === -1);
    sheet.setConditionalFormatRules(rest.concat(want.map(w =>
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(w).setBackground(c.statusColourMap[w]).setRanges([area]).build())));
  } catch (e) { /* colours are cosmetic */ }
}

function removeStatusColours_(sheet, si) {
  try {
    const all = sheet.getConditionalFormatRules();
    const mine = statusRulesOf_(all, si + 1);
    if (mine.length) sheet.setConditionalFormatRules(all.filter(r => mine.indexOf(r) === -1));
  } catch (e) { /* cosmetic */ }
}

// Runs fn(sheet, statusColumnIndex) on each tracker tab that has a status column.
function eachStatusSheet_(fn) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  [cfg_().sheetName, cfg_().raSheetName].forEach(n => {
    const sh = ss.getSheetByName(n);
    if (!sh) return;
    const si = headersOf_(sh).findIndex(h => PLAY_STATUS_HEADERS.indexOf(h) !== -1);
    if (si !== -1) fn(sh, si);
  });
}

function refreshPlayStatus_(sheet) {
  const headers = headersOf_(sheet);
  const nameIdx = headers.findIndex(h => NAME_HEADERS.indexOf(h) !== -1);
  if (nameIdx === -1) return;
  applyPlayStatus_(sheet, headers, nameIdx, trimGameRows_(sheet, nameIdx));
}

function toggleStatusColours() {
  const on = !cfg_().statusColours;
  setCfg_({ statusColours: on });
  eachStatusSheet_((sh, si) => { if (on) refreshPlayStatus_(sh); else removeStatusColours_(sh, si); });
  buildMenu_();
  alert_(on ? 'Status colours are ON. The script now colours the BACKLOG STATUS cells (and replaces any colour rules for those four words in that column). Use the colour options below to change them.'
            : 'Status colours are OFF. The script\'s colour rules were removed from the column.');
}

function setStatusColour_(word) {
  const cur = cfg_().statusColourMap[word];
  const v = ask_(word + ' colour', 'Type a colour for ' + word + ': a hex code like #b7e1cd, or a name (red, green, blue, yellow, orange, purple, pink, teal, grey, white), or "none" for no colour. Currently ' + (cur || 'none') + '.');
  if (v === null) return;
  const t = String(v).trim().toLowerCase();
  let hex = null;
  if (t === 'none') hex = '';
  else if (COLOUR_NAMES[t]) hex = COLOUR_NAMES[t];
  else if (/^#?([0-9a-f]{3}|[0-9a-f]{6})$/.test(t)) {
    hex = t.charAt(0) === '#' ? t : '#' + t;
    if (hex.length === 4) hex = '#' + hex.slice(1).split('').map(ch => ch + ch).join('');
  }
  if (hex === null) { alert_('That isn\'t a colour I understand. Use a hex code like #b7e1cd or a name like green. Nothing was changed.'); return; }
  const map = Object.assign({}, cfg_().statusColourMap); map[word] = hex;
  setCfg_({ statusColourMap: map });
  buildMenu_();
  if (cfg_().statusColours) eachStatusSheet_(sh => refreshPlayStatus_(sh));
  alert_(word + ' is now ' + (hex || 'uncoloured') + '.' + (cfg_().statusColours ? '' : ' Turn on "Colour the status cells" to see it.'));
}
function statusColour_COMPLETED() { setStatusColour_('COMPLETED'); }
function statusColour_ACTIVE() { setStatusColour_('ACTIVE'); }
function statusColour_IDLE() { setStatusColour_('IDLE'); }
function statusColour_BACKLOG() { setStatusColour_('BACKLOG'); }

function resetStatusColours() {
  setCfg_({ statusColourMap: Object.assign({}, DEFAULTS.statusColourMap) });
  buildMenu_();
  if (cfg_().statusColours) eachStatusSheet_(sh => refreshPlayStatus_(sh));
  alert_('Status colours reset to the defaults.');
}

// Menu: inserts a DATE COMPLETED column before LAST UPDATED on the current tab, then updates.
function addDateCompletedColumn() {
  const sheet = targetSheet_();
  const headers = headersOf_(sheet);
  if (headers.indexOf('date completed') !== -1) { alert_('"' + sheet.getName() + '" already has a DATE COMPLETED column.'); return; }
  const upd = headers.indexOf('last updated');
  if (upd === -1) { alert_('Could not find a LAST UPDATED column on "' + sheet.getName() + '", so there is nowhere to put DATE COMPLETED.'); return; }
  sheet.insertColumnBefore(upd + 1);
  sheet.getRange(1, upd + 2).copyTo(sheet.getRange(1, upd + 1), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  sheet.getRange(1, upd + 1).setValue('DATE COMPLETED');
  sheet.setColumnWidth(upd + 1, 120);
  const top = topRow_(sheet);
  const rows = Math.max(sheet.getMaxRows() - top + 1, 1);
  sheet.getRange(top, upd + 1, rows, 1).setNumberFormat('yyyy-mm-dd');
  updateSteamSheet();
}

// Menu: inserts a BACKLOG STATUS column left of GAME LIST on the current tab and fills it.
function addPlayStatusColumn() {
  const sheet = targetSheet_();
  let headers = headersOf_(sheet);
  let nameIdx = headers.findIndex(h => NAME_HEADERS.indexOf(h) !== -1);
  if (nameIdx === -1) { alert_('Could not find a GAME LIST column in row 1 of "' + sheet.getName() + '". Nothing was changed.'); return; }
  const had = headers.findIndex(h => PLAY_STATUS_HEADERS.indexOf(h) !== -1) !== -1;
  if (!had) {
    if (nameIdx > 0 && headers[nameIdx - 1] === 'hack') nameIdx--;                // BACKLOG STATUS, then HACK, then GAME LIST
    sheet.insertColumnBefore(nameIdx + 1);
    sheet.getRange(1, nameIdx + 2).copyTo(sheet.getRange(1, nameIdx + 1), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    sheet.getRange(1, nameIdx + 1).setValue('BACKLOG STATUS');
    sheet.setColumnWidth(nameIdx + 1, 120);
    headers = headersOf_(sheet);
    nameIdx = headers.findIndex(h => NAME_HEADERS.indexOf(h) !== -1);
  }
  applyPlayStatus_(sheet, headers, nameIdx, trimGameRows_(sheet, nameIdx));
  alert_(had ? 'The "' + sheet.getName() + '" tab already has a backlog status column. It was refreshed.'
    : 'Added a BACKLOG STATUS column to "' + sheet.getName() + '", left of GAME LIST. ' +
      (cfg_().sortRange ? 'Note: your custom sort range (' + cfg_().sortRange + ') was set before the new column, so check it in Settings > Sort the list.' : 'It keeps itself up to date on every update.'));
}

// ---------- RetroAchievements ----------

const RA_BASE = 'https://retroachievements.org/API/';
const RA_LAYOUT = ['HACK', 'GAME LIST', 'CONSOLE', 'GENRE', 'COLLECTED ACHIES', 'TOTAL ACHIES', 'AMOUNT DONE', 'PROGRESS', 'COMPLETED',
  'COLLECTED HC ACHIES', 'TOTAL HC ACHIES', 'HC AMOUNT DONE', 'HC PROGRESS', 'HC COMPLETED',
  'LAST PLAYED', 'DATE COMPLETED', 'LAST UPDATED'];
const RA_NOTE = 'RetroAchievements: ';

function normRa_(s) { return norm_(String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')); }

function raUrl_(endpoint, params) {
  const props = PropertiesService.getScriptProperties();
  const q = ['y=' + encodeURIComponent(props.getProperty('RA_KEY') || '')];
  Object.keys(params || {}).forEach(k => q.push(k + '=' + encodeURIComponent(params[k])));
  return RA_BASE + endpoint + '?' + q.join('&');
}
function raImage_(path) { return path ? 'https://media.retroachievements.org' + path : ''; }

function raUser_() { return PropertiesService.getScriptProperties().getProperty('RA_USER') || ''; }

function parseRaDate_(s) {
  if (!s) return null;
  const t = String(s);
  const d = new Date(t.indexOf('T') !== -1 ? t : t.replace(' ', 'T') + 'Z'); // RetroAchievements times are UTC
  return isNaN(d.getTime()) ? null : d;
}

// Every game in your RetroAchievements history, with achievement counts.
function raFetchProgress_() {
  const all = [];
  for (let page = 0; page < 20; page++) {
    const res = UrlFetchApp.fetch(raUrl_('API_GetUserCompletionProgress.php', { u: raUser_(), c: 500, o: all.length }),
      { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      throw new Error('RetroAchievements error (HTTP ' + res.getResponseCode() + '). Check your username and Web API key in Settings.');
    }
    let j;
    try { j = JSON.parse(res.getContentText()); } catch (e) { throw new Error('RetroAchievements sent an unreadable reply. Try again in a few minutes.'); }
    const rs = j.Results || [];
    rs.forEach(e => all.push(e));
    if (!rs.length || all.length >= (j.Total || 0)) break;
  }
  return all;
}

// gameId -> Date of your most recent play (only for your 50 most recently played games).
function raFetchRecent_() {
  const out = {};
  try {
    const res = UrlFetchApp.fetch(raUrl_('API_GetUserRecentlyPlayedGames.php', { u: raUser_(), c: 50, o: 0 }), { muteHttpExceptions: true });
    if (res.getResponseCode() === 200) {
      JSON.parse(res.getContentText()).forEach(g => { const d = parseRaDate_(g.LastPlayed); if (d) out[g.GameID] = d; });
    }
  } catch (e) { /* optional */ }
  return out;
}

// Per-game details (genre, and totals for a game that isn't in your history yet), paced gently.
function raFetchInfo_(ids, budgetSec) {
  const out = {};
  const started = Date.now();
  let s = 0;
  while (s < ids.length && Date.now() - started < budgetSec * 1000) {
    const batch = ids.slice(s, s + 5);
    const resps = UrlFetchApp.fetchAll(batch.map(id => ({
      url: raUrl_('API_GetGameInfoAndUserProgress.php', { g: id, u: raUser_() }), muteHttpExceptions: true
    })));
    let limited = false;
    batch.forEach((id, n) => {
      const code = resps[n].getResponseCode();
      if (code === 429) { limited = true; return; }
      if (code !== 200) { out[id] = null; return; }
      try { out[id] = JSON.parse(resps[n].getContentText()); } catch (e) { out[id] = null; }
    });
    if (limited) { Utilities.sleep(20000); continue; }
    s += 5;
    Utilities.sleep(1000);
  }
  return out;
}

// ---------- RetroAchievements: Want to Play list ----------
// Adds the games on your RetroAchievements "Want to Play" list that aren't on the tab yet (title, console and game ID);
// the update that follows fills in their total achievements, with collected and hardcore as 0.

function raFetchWantToPlay_() {
  const all = [];
  for (let page = 0; page < 20; page++) {
    const res = UrlFetchApp.fetch(raUrl_('API_GetUserWantToPlayList.php', { u: raUser_(), c: 500, o: all.length }), { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      throw new Error('RetroAchievements error (HTTP ' + res.getResponseCode() + '). Check your username and Web API key in Settings.');
    }
    let j;
    try { j = JSON.parse(res.getContentText()); } catch (e) { throw new Error('RetroAchievements sent an unreadable reply. Try again in a few minutes.'); }
    const rs = j.Results || [];
    rs.forEach(e => all.push(e));
    if (!rs.length || all.length >= (j.Total || 0)) break;
  }
  return all;
}

function importWantToPlay() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('RA_USER') || !props.getProperty('RA_KEY')) { alert_('Connect RetroAchievements first: Settings > Accounts > RetroAchievements username & key.'); return; }
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(cfg_().raSheetName);
  if (!sheet || isBlankSheet_(sheet)) { alert_('The "' + cfg_().raSheetName + '" tab is missing or blank. Run Tools > Set up RetroAchievements tab first.'); return; }
  let r;
  try { r = withLock_(() => raImportWantToPlay_(sheet)); } catch (e) { alert_(String(e.message || e)); return; }
  if (!r) return;
  alert_(r.msg);
  if (r.added > 0) run_(false, false);
}

function raImportWantToPlay_(sheet) {
  const headers = headersOf_(sheet);
  const nameIdx = headers.findIndex(h => NAME_HEADERS.indexOf(h) !== -1);
  if (nameIdx === -1) return { added: 0, msg: 'The tab needs a GAME LIST column in row 1.' };
  const consoleIdx = headers.indexOf('console'), idIdx = headers.indexOf('game id'), hackIdx = headers.indexOf('hack');
  const list = raFetchWantToPlay_();

  // What is already on the tab: titles (with their console) and game IDs.
  const have = trimGameRows_(sheet, nameIdx), top = topRow_(sheet);
  const titles = {}, ids = {};
  if (have > 0) {
    const names = sheet.getRange(top, nameIdx + 1, have, 1).getValues();
    const cons = consoleIdx >= 0 ? sheet.getRange(top, consoleIdx + 1, have, 1).getValues() : null;
    names.forEach((r, i) => { const k = normRa_(r[0]); if (k) (titles[k] = titles[k] || []).push(cons ? normRa_(cons[i][0]) : ''); });
    if (idIdx >= 0) sheet.getRange(top, idIdx + 1, have, 1).getValues().forEach(r => { if (Number(r[0])) ids[Number(r[0])] = 1; });
  }
  let already = 0, noAch = 0;
  const entries = [];
  list.forEach(g => {
    if (!g || !g.Title) return;
    if (g.AchievementsPublished !== undefined && !(Number(g.AchievementsPublished) > 0)) { noAch++; return; }   // nothing to track
    const k = normRa_(g.Title), con = normRa_(g.ConsoleName || '');
    if (ids[g.ID] || (titles[k] && titles[k].some(c => c === '' || c === con))) { already++; return; }
    const e = {};
    e[nameIdx] = g.Title;
    if (consoleIdx >= 0) e[consoleIdx] = g.ConsoleName || '';
    if (idIdx >= 0) e[idIdx] = g.ID;
    if (hackIdx >= 0 && isHackTitle_(g.Title)) e[hackIdx] = true;
    entries.push(e);
  });
  const added = appendGameRows_(sheet, headers, nameIdx, entries);
  return { added: added, msg: 'Your Want to Play list has ' + list.length + ' games.\nAdded ' + added + ' new games to the tab; ' + already + ' were already there' +
    (noAch ? ' and ' + noAch + ' have no achievements (skipped)' : '') + '.' + (added ? '\n\nNow fetching their total achievements.' : '') };
}

// Finds a sheet row's game in your RetroAchievements list: exact title, then a close title; CONSOLE narrows it down.
// RetroAchievements tags hacks with a "~Hack~" prefix in the title. A row counts as a hack when its title has the tag or
// its HACK box is ticked; it is then matched against the hack titles with the tags removed.
function isHackTitle_(t) { return /~\s*hack\s*~/i.test(String(t)); }
function stripTags_(t) { return String(t).replace(/~[^~]*~\s*/g, '').trim(); }

function raMatch_(title, consoleTxt, byTitle, entries, hack) {
  const key = normRa_(title);
  let cands = byTitle[key] || [];
  let note = '';
  if (hack) {
    const hk = normRa_(stripTags_(title));
    const hacks = entries.filter(e => isHackTitle_(e.Title));
    const hk2 = e => normRa_(stripTags_(e.Title));
    let hc = hacks.filter(e => hk2(e) === hk);
    if (!hc.length && hk.length >= 5) {
      hc = hacks.filter(e => hk2(e).indexOf(hk) !== -1 || (hk2(e).length >= 5 && hk.indexOf(hk2(e)) !== -1));
      if (hc.length) note = 'matched "' + hc[0].Title + '", please verify';
    }
    if (hc.length) cands = hc;
  }
  if (!cands.length && key.length >= 5) {
    cands = entries.filter(e => e._key.indexOf(key) !== -1 || (e._key.length >= 5 && key.indexOf(e._key) !== -1));
    if (cands.length) note = 'matched "' + cands[0].Title + '", please verify';
  }
  if (cands.length > 1 && consoleTxt) {
    const ck = normRa_(consoleTxt);
    const f = cands.filter(e => { const c = normRa_(e.ConsoleName); return c === ck || c.indexOf(ck) !== -1 || ck.indexOf(c) !== -1; });
    if (f.length) cands = f;
  }
  if (cands.length > 1) {
    cands = cands.slice().sort((a, b) => (Number(b.NumAwarded) || 0) - (Number(a.NumAwarded) || 0));
    const consoles = cands.slice(0, 4).map(e => e.ConsoleName).join(', ');
    note = (note ? note + '; ' : '') + 'several matches (' + consoles + '), using ' + cands[0].ConsoleName + '. Fill in CONSOLE to choose';
  }
  return { entry: cands[0] || null, note: note };
}

// ---------- RetroAchievements catalog (games you have not played) ----------
// A game that isn't in your history is looked up in RetroAchievements' per-console game lists, which are cached for 6 hours.

const RA_CACHE_SEC = 21600;
const RA_FOUND_DAYS = 3;                    // how long a found game's total is trusted before it is looked up again
const RA_SEARCH_SEC = 60;                   // time budget for downloading game lists in one update
const RA_ALIASES = { psx: 'playstation', ps1: 'playstation', ps2: 'playstation 2', psp: 'playstation portable',
  gba: 'game boy advance', gbc: 'game boy color', gb: 'game boy', megadrive: 'mega drive', n64: 'nintendo 64',
  nds: 'nintendo ds', ds: 'nintendo ds', gc: 'gamecube', dc: 'dreamcast', sms: 'master system', gg: 'game gear',
  pce: 'pc engine', turbografx: 'pc engine', saturn: 'saturn' };

function raCacheGet_(key) {
  try {
    const cache = CacheService.getScriptCache();
    const n = Number(cache.get(key + '_n'));
    if (!n) return null;
    let txt = '';
    for (let i = 0; i < n; i++) { const part = cache.get(key + '_' + i); if (part === null) return null; txt += part; }
    if (txt.charAt(0) === 'Z') {
      return Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(txt.slice(1)), 'application/x-gzip')).getDataAsString();
    }
    return txt.slice(1);
  } catch (e) { return null; }
}

function raCachePut_(key, text) {
  try {
    let body = 'P' + text;
    try { body = 'Z' + Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(text, 'text/plain')).getBytes()); } catch (e) { /* store uncompressed */ }
    const all = {};
    let n = 0;
    for (let i = 0; i < body.length; i += 90000) all[key + '_' + n++] = body.slice(i, i + 90000);
    all[key + '_n'] = String(n);
    CacheService.getScriptCache().putAll(all, RA_CACHE_SEC);
  } catch (e) { /* too big or cache unavailable: just fetch again next time */ }
}

// [[consoleId, name], ...] for real game systems.
function raConsoles_() {
  const cached = raCacheGet_('RA_CONSOLES');
  if (cached) { try { return JSON.parse(cached); } catch (e) { /* refetch */ } }
  const res = UrlFetchApp.fetch(raUrl_('API_GetConsoleIDs.php', { a: 1, g: 1 }), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  try {
    const list = JSON.parse(res.getContentText()).map(c => [Number(c.ID !== undefined ? c.ID : c.id), String(c.Name !== undefined ? c.Name : c.name)])
      .filter(c => c[0] > 0);
    if (list.length) raCachePut_('RA_CONSOLES', JSON.stringify(list));
    return list.length ? list : null;
  } catch (e) { return null; }
}

// Games with achievements on one console: [[id, title, achievements], ...], or null if RetroAchievements couldn't be reached.
function raConsoleGames_(consoleId, st) {
  const cached = raCacheGet_('RA_GAMES_' + consoleId);
  if (cached !== null) return cached === '' ? [] : cached.split('\n').map(l => { const p = l.split('\t'); return [Number(p[0]), p[1], Number(p[2])]; });
  if (Date.now() > st.until) return null;
  const res = UrlFetchApp.fetch(raUrl_('API_GetGameList.php', { i: consoleId, f: 1 }), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) { if (res.getResponseCode() === 429) st.until = 0; return null; }
  let games;
  try { games = JSON.parse(res.getContentText()); } catch (e) { return null; }
  const list = games.map(g => [Number(g.ID !== undefined ? g.ID : g.id), String(g.Title !== undefined ? g.Title : g.title),
    Number(g.NumAchievements !== undefined ? g.NumAchievements : g.numAchievements) || 0]).filter(g => g[0] > 0 && g[2] > 0);
  raCachePut_('RA_GAMES_' + consoleId, list.map(g => g[0] + '\t' + g[1].replace(/[\t\n]/g, ' ') + '\t' + g[2]).join('\n'));
  Utilities.sleep(300);
  return list;
}

// Consoles whose name matches what you typed in CONSOLE (SNES, GBA, Game Boy Advance, ...).
function raConsoleMatches_(text, consoles) {
  const raw = normRa_(text);
  const want = normRa_(RA_ALIASES[raw] || text);
  const exact = consoles.filter(c => String(c[1]).split('/').some(p => normRa_(p) === want));
  if (exact.length) return exact;
  return want.length >= 4 ? consoles.filter(c => normRa_(c[1]).indexOf(want) !== -1) : [];
}

// Looks up a game that isn't in your history: { found: {...} } or { why: 'text' }. `st` is shared by all rows in one update.
function raCatalogLookup_(title, consoleTxt, st, hack) {
  hack = !!hack || isHackTitle_(title);
  const q = normRa_(hack ? stripTags_(title) : title);
  const key = q + '|' + normRa_(consoleTxt) + (hack ? '|hack' : '');
  const old = st.found[key];
  if (old && Date.now() - old.t < RA_FOUND_DAYS * 864e5) return { found: old, note: old.note || '' };
  const scanned = st.scanned[key];
  if (!old && scanned && Date.now() - scanned.t < 12 * 36e5) return { why: scanned.why };

  if (!st.consoles) st.consoles = raConsoles_();
  if (!st.consoles) return { why: 'could not reach the RetroAchievements game list; it will retry on the next update.' };
  let consoles = st.consoles;
  if (old) consoles = consoles.filter(c => c[0] === old.cid);
  else if (consoleTxt) {
    consoles = raConsoleMatches_(consoleTxt, consoles);
    if (!consoles.length) {
      const why = 'unknown console "' + consoleTxt + '". Use a name like SNES, Game Boy Advance or PlayStation.';
      st.scanned[key] = { t: Date.now(), why: why }; st.dirty = true;
      return { why: why };
    }
  }

  const exact = [], loose = [];
  let complete = true;
  for (let n = 0; n < consoles.length; n++) {
    const c = consoles[n];
    const list = raConsoleGames_(c[0], st);
    if (list === null) { complete = false; break; }
    list.forEach(g => {
      if (hack) { if (!isHackTitle_(g[1])) return; }                              // a hack row only looks at hacks
      else if (/^~|\[subset/i.test(g[1]) && q.indexOf('subset') === -1) return;  // otherwise hacks, homebrew and subsets are skipped
      const k = normRa_(hack ? stripTags_(g[1]) : g[1]);
      const hit = { id: g[0], title: g[1], total: g[2], cid: c[0], console: c[1] };
      if (k === q) exact.push(hit);
      else if (q.length >= 6 && (k.indexOf(q) === 0 || q.indexOf(k) === 0)) loose.push(hit);
    });
  }

  const pick = (hits, note) => {
    const best = hits.slice().sort((a, b) => b.total - a.total)[0];
    const f = { id: best.id, title: best.title, console: best.console, cid: best.cid, total: best.total, t: Date.now(), note: note || '' };
    st.found[key] = f; st.dirty = true;
    return { found: f, note: f.note };
  };
  const consolesOf = hits => hits.map(h => h.console).filter((v, i, a) => a.indexOf(v) === i);

  if (exact.length) {
    const cs = consolesOf(exact);
    if (cs.length === 1) return pick(exact, '');
    const why = 'found on several consoles (' + cs.slice(0, 5).join(', ') + '). Fill in CONSOLE to choose one.';
    st.scanned[key] = { t: Date.now(), why: why }; st.dirty = true;
    return { why: why };
  }
  if (loose.length) {
    const cs = consolesOf(loose);
    const titles = loose.map(h => h.title).filter((v, i, a) => a.indexOf(v) === i);
    if (cs.length === 1 && titles.length === 1) return pick(loose, 'matched "' + loose[0].title + '", please verify');
    const why = 'no exact match. Similar: ' + loose.slice(0, 4).map(h => h.title + ' [' + h.console + ']').join('; ') + '. Type the exact title or fill in CONSOLE.';
    st.scanned[key] = { t: Date.now(), why: why }; st.dirty = true;
    return { why: why };
  }
  if (!complete) return old ? { found: old, note: old.note || '' } : { why: 'still searching the RetroAchievements catalog. It continues on the next updates.' };
  if (old) return { found: old, note: old.note || '' };
  const why = 'not found on RetroAchievements (it may have no achievements there). Check the spelling or fill in CONSOLE.';
  st.scanned[key] = { t: Date.now(), why: why }; st.dirty = true;
  return { why: why };
}

function raSearchState_() {
  const props = PropertiesService.getScriptProperties();
  return { until: Date.now() + RA_SEARCH_SEC * 1000, found: loadJson_(props, 'RA_FOUND') || {}, scanned: loadJson_(props, 'RA_SCANNED') || {},
    consoles: null, dirty: false };
}

function raSearchSave_(st) {
  if (!st.dirty) return;
  const props = PropertiesService.getScriptProperties();
  saveJson_(props, 'RA_FOUND', st.found);
  saveJson_(props, 'RA_SCANNED', st.scanned);
}

function setupRetro() {
  const u = ask_('RetroAchievements username', 'Your RetroAchievements username (the name on your profile):');
  if (!u) return;
  const k = ask_('RetroAchievements Web API key', 'On retroachievements.org: click your name > Settings > Keys > "Web API Key". Paste it here:');
  if (!k) return;
  const res = UrlFetchApp.fetch(RA_BASE + 'API_GetUserProfile.php?y=' + encodeURIComponent(k) + '&u=' + encodeURIComponent(u),
    { muteHttpExceptions: true });
  let ok = false;
  try { ok = res.getResponseCode() === 200 && !!JSON.parse(res.getContentText()).User; } catch (e) { ok = false; }
  if (!ok) {
    alert_('RetroAchievements did not accept that username and key (HTTP ' + res.getResponseCode() + '). Nothing was saved.');
    return;
  }
  const props = PropertiesService.getScriptProperties();
  props.setProperty('RA_USER', u);
  props.setProperty('RA_KEY', k);
  setCfg_({ raOn: true });
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const name = cfg_().raSheetName;
  let created = false;
  if (!ss.getSheetByName(name)) { const sh = ss.insertSheet(name); setupLayout_(sh, RA_LAYOUT); created = true; }
  buildMenu_();
  alert_('Connected to RetroAchievements as ' + u + '. ' + (created ? 'The "' + name + '" tab was created. ' : '') +
    'Type your retro games under GAME LIST on that tab, then run Update now.');
}

// Menu: creates and sets up the RetroAchievements tab if it is missing or blank.
function setupRetroSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const name = cfg_().raSheetName;
  let sheet = ss.getSheetByName(name);
  let created = false;
  if (!sheet) { sheet = ss.insertSheet(name); created = true; }
  if (!isBlankSheet_(sheet)) {
    alert_('The "' + name + '" tab already has content, so nothing was changed. The layout is only created on a completely blank tab.');
    return;
  }
  setupLayout_(sheet, RA_LAYOUT);
  const props = PropertiesService.getScriptProperties();
  const connected = !!(props.getProperty('RA_USER') && props.getProperty('RA_KEY'));
  alert_((created ? 'The "' + name + '" tab was created and set up. ' : 'The "' + name + '" tab is set up. ') +
    (connected ? 'Type your retro games under GAME LIST, then run Update now.'
      : 'Next, run Settings > Set RetroAchievements username & key to connect your account, then type your games under GAME LIST.'));
}

function updateRetro_(force) {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('RA_USER') || !props.getProperty('RA_KEY')) return [];
  const c = cfg_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(c.raSheetName);
  if (!sheet) sheet = ss.insertSheet(c.raSheetName);
  if (isBlankSheet_(sheet)) {
    setupLayout_(sheet, RA_LAYOUT);
    alert_('The "' + c.raSheetName + '" tab is set up. Type your retro games under GAME LIST, then run Update now.');
    return [];
  }

  if (c.raWantAuto) { try { raImportWantToPlay_(sheet); } catch (e) { /* the list is optional; the normal update carries on */ } }

  const headers = headersOf_(sheet);
  const H = h => headers.indexOf(h);
  const nameIdx = headers.findIndex(h => NAME_HEADERS.indexOf(h) !== -1);
  if (nameIdx === -1) throw new Error('Could not find a "GAME LIST" column in row 1 of the "' + c.raSheetName + '" tab.');
  const col = { unlocked: H('collected achies'), total: H('total achies'), hardcore: H('collected hc achies') >= 0 ? H('collected hc achies') : H('hardcore achies'), totalHc: H('total hc achies'), console: H('console'),
    genre: c.genreColumn ? H('genre') : -1, lastPlayed: H('last played'), completed: H('date completed'),
    updated: H('last updated'), appid: H('game id'), hack: ['hack', 'is hack', 'romhack'].map(h => H(h)).filter(i => i >= 0)[0] };
  if (col.hack === undefined) col.hack = -1;
  if (col.unlocked === -1 || col.total === -1) {
    throw new Error('The "' + c.raSheetName + '" tab needs COLLECTED ACHIES and TOTAL ACHIES columns.');
  }
  const numRows = trimGameRows_(sheet, nameIdx);
  if (numRows === 0) return [];
  const top = topRow_(sheet);
  fillFormulas_(sheet, headers, nameIdx, col, numRows);

  const used = Object.keys(col).map(k => col[k]).filter(i => i >= 0).concat([nameIdx]);
  const minC = Math.min.apply(null, used);
  const maxC = Math.max.apply(null, used);
  const data = sheet.getRange(top, minC + 1, numRows, maxC - minC + 1).getValues();
  const cell = (row, idx) => row[idx - minC];
  const keepRules = c.keep;

  // --- Your RetroAchievements history ---
  const entries = raFetchProgress_();
  const byId = {};
  const byTitle = {};
  entries.forEach(e => {
    e._key = normRa_(e.Title);
    byId[e.GameID] = e;
    (byTitle[e._key] = byTitle[e._key] || []).push(e);
  });
  const recent = raFetchRecent_();

  // --- Match every row ---
  const items = [];
  const search = raSearchState_();
  data.forEach((row, i) => {
    const title = String(cell(row, nameIdx)).trim();
    if (!title) return;
    const typedId = col.appid >= 0 ? Number(cell(row, col.appid)) : 0;
    const consoleTxt = col.console >= 0 ? String(cell(row, col.console)).trim() : '';
    let entry = typedId ? (byId[typedId] || null) : null;
    let id = typedId || 0;
    let note = '';
    const hack = isHackTitle_(title) || (col.hack >= 0 && /^(true|1|yes|x|✓)$/i.test(String(cell(row, col.hack)).trim()));
    if (!entry && !(keepRules.appid && typedId)) {
      const m = raMatch_(title, consoleTxt, byTitle, entries, hack);
      if (m.entry) { entry = m.entry; id = entry.GameID; }
      note = m.note;
    }
    if (!entry && !id) {
      const f = raCatalogLookup_(title, consoleTxt, search, hack);
      if (f.found) { items.push({ i: i, title: title, id: f.found.id, entry: null, found: f.found, note: f.note }); return; }
      items.push({ i: i, title: title, missing: true, why: f.why });
      return;
    }
    items.push({ i: i, title: title, id: id, entry: entry, note: note });
  });

  // --- Details we still need: genres, and totals for a typed Game ID that isn't in your history ---
  const genreCache = loadJson_(props, 'GENRE_CACHE') || {};
  const gblank = it => { const g = String(cell(data[it.i], col.genre)).trim(); return g === '' || g === 'Unknown'; };
  // RetroAchievements has no genre for some games. That is remembered as "Unknown" but asked again after a week.
  const nowMs = Date.now();
  const genreDue = id => genreCache['ra' + id] === undefined || (genreCache['ra' + id] === 'Unknown' && nowMs - (genreCache['rat' + id] || 0) > GENRE_RETRY_DAYS * 86400000);
  const needInfo = items.filter(it => !it.missing && ((!it.entry && !it.found) ||
    (col.genre >= 0 && genreDue(it.id) && (!keepRules.genre || gblank(it)))));
  // Games with a newer achievement than last time also need their achievement list (names for the Discord post).
  const lastUnlock = loadJson_(props, 'LAST_UNLOCK') || {};
  const epochOf = e => { const d = e ? parseRaDate_(e.MostRecentAwardedDate) : null; return d ? Math.floor(d.getTime() / 1000) : 0; };
  const needAch = items.filter(it => !it.missing && it.entry && lastUnlock['ra' + it.id] !== undefined &&
    epochOf(it.entry) > lastUnlock['ra' + it.id]);
  const ids = [];
  needInfo.concat(needAch).forEach(it => { if (ids.indexOf(it.id) === -1) ids.push(it.id); });
  const infos = ids.length ? raFetchInfo_(ids, 150) : {};
  let cacheChanged = false;
  ids.forEach(id => {
    if (infos[id] && genreDue(id)) {
      const g = String(infos[id].Genre || '').trim();
      genreCache['ra' + id] = g || 'Unknown';
      if (g) delete genreCache['rat' + id]; else genreCache['rat' + id] = nowMs;
      cacheChanged = true;
    }
  });
  if (cacheChanged) saveJson_(props, 'GENRE_CACHE', genreCache);

  // --- Fill the output columns ---
  const { out, orig, put } = outputSet_(data, col,
    ['appid', 'console', 'genre', 'unlocked', 'hardcore', 'total', 'totalHc', 'lastPlayed', 'completed', 'updated', 'hack'], cell,
    Object.assign({}, keepRules, { totalHc: keepRules.total }));
  const nameRange = sheet.getRange(top, nameIdx + 1, numRows, 1);
  const notes = nameRange.getNotes();
  const oldNotes = notes.map(n => n[0]);
  // Problems are shown as a note on the game name (there is no STATUS column on this tab).
  const setNote = (i, text) => {
    if (text) notes[i][0] = RA_NOTE + text;
    else if (String(oldNotes[i]).indexOf(RA_NOTE) === 0) notes[i][0] = '';
  };
  const now = new Date();
  const tracked = [];

  items.forEach(it => {
    const i = it.i;
    if (it.missing) {
      setNote(i, it.why || 'not found on RetroAchievements. Check the spelling or fill in CONSOLE.');
      return;
    }
    const e = it.entry;
    const inf = infos[it.id];
    let total, awarded, hc, consoleName, lastDate, doneDate = null;
    if (e) {
      total = Number(e.MaxPossible) || 0;
      awarded = Number(e.NumAwarded) || 0;
      hc = Number(e.NumAwardedHardcore) || 0;
      consoleName = e.ConsoleName;
      lastDate = recent[e.GameID] || parseRaDate_(e.MostRecentAwardedDate);
      doneDate = parseRaDate_(e.MostRecentAwardedDate);
    } else if (it.found) {
      // Not in your history (never played): the total comes from the game list, and nothing is collected yet.
      total = it.found.total; awarded = 0; hc = 0; consoleName = it.found.console; lastDate = null;
    } else if (inf) {
      total = Number(inf.NumAchievements) || 0;
      awarded = Number(inf.NumAwardedToUser) || 0;
      hc = Number(inf.NumAwardedToUserHardcore) || 0;
      consoleName = inf.ConsoleName;
      let latest = null;
      Object.keys(inf.Achievements || {}).forEach(k => {
        const d = parseRaDate_(inf.Achievements[k].DateEarned);
        if (d && (!latest || d > latest)) latest = d;
      });
      lastDate = recent[it.id] || latest;
      doneDate = latest;
    } else {
      setNote(i, 'could not read this game right now; it will retry on the next update.');
      return;
    }

    put('appid', i, it.id);
    put('console', i, consoleName);
    if ((it.entry && isHackTitle_(it.entry.Title)) || (it.found && isHackTitle_(it.found.title))) put('hack', i, true);   // tick the HACK box
    if (genreCache['ra' + it.id]) put('genre', i, genreCache['ra' + it.id]);
    if (lastDate) put('lastPlayed', i, lastDate);

    if (total > 0) {
      const changed = orig.unlocked[i][0] !== awarded || orig.total[i][0] !== total ||
        (out.hardcore && orig.hardcore[i][0] !== hc) || (out.updated && orig.updated[i][0] === '');
      put('unlocked', i, awarded);
      put('total', i, total);
      put('totalHc', i, total);
      put('hardcore', i, hc);
      if (out.completed) put('completed', i, awarded === total && doneDate ? doneDate : '');
      if (changed) put('updated', i, now);
      setNote(i, it.note);
      // Newly earned achievements (names + descriptions) for the Discord post.
      const ukey = 'ra' + it.id, lu = lastUnlock[ukey];
      const topTs = e ? epochOf(e) : (lastDate ? Math.floor(lastDate.getTime() / 1000) : 0);
      let newAch = [], defer = false;
      if (lu === undefined) {
        if (topTs) lastUnlock[ukey] = topTs;
        else if (it.found) lastUnlock[ukey] = 0;                  // not played yet: the first achievement will be listed                       // first time seen: just remember where we are
      } else if (topTs > lu) {
        if (inf && inf.Achievements) {
          Object.keys(inf.Achievements).forEach(k => {
            const a = inf.Achievements[k];
            const d = parseRaDate_(a.DateEarnedHardcore || a.DateEarned);
            const ts = d ? Math.floor(d.getTime() / 1000) : 0;
            if (ts > lu) newAch.push([clip_(a.Title, 60), clip_(a.Description, 140), ts]);
          });
          newAch.sort((x, y) => x[2] - y[2]);
          newAch = newAch.slice(-15);
          lastUnlock[ukey] = Math.max(lu, topTs);
        } else {
          defer = true;                                             // no details this time: hold the Discord post and try again next run
        }
      }
      tracked.push({
        src: 'ra',
        title: it.title + (consoleName ? ' [' + consoleName + ']' : ''),
        appid: 'ra' + it.id,
        unlocked: out.unlocked[i][0],
        total: out.total[i][0],
        hardcore: out.hardcore ? out.hardcore[i][0] : hc,
        cover: raImage_(e ? e.ImageIcon : (inf && inf.ImageIcon)),
        newAch: newAch,
        defer: defer,
        lastTs: lastDate ? Math.floor(lastDate.getTime() / 1000) : 0
      });
    } else {
      setNote(i, 'this game has no achievements on RetroAchievements.');
    }
  });

  raSearchSave_(search);

  // --- Write back (only our columns) ---
  writeColumns_(sheet, col, out, numRows, orig);
  alignColumns_(sheet, headers, numRows);
  if (notes.some((n, i) => n[0] !== oldNotes[i])) nameRange.setNotes(notes);
  saveJson_(props, 'LAST_UNLOCK', lastUnlock);
  applyPlayStatus_(sheet, headers, nameIdx, numRows);
  return tracked;
}

// Shows how a row on the RetroAchievements tab is matched.
function diagnoseRetro_(sheet) {
  if (!raUser_()) { alert_('Set your RetroAchievements username & key first (Settings).'); return; }
  const row = sheet.getActiveCell().getRow();
  const headers = headersOf_(sheet);
  const nameIdx = headers.findIndex(h => NAME_HEADERS.indexOf(h) !== -1);
  if (row < topRow_(sheet) || nameIdx === -1) { alert_('Click a cell in a game\'s row first (not the header or totals row).'); return; }
  const title = String(sheet.getRange(row, nameIdx + 1).getValue()).trim();
  const ci = headers.indexOf('console');
  const consoleTxt = ci >= 0 ? String(sheet.getRange(row, ci + 1).getValue()).trim() : '';
  const entries = raFetchProgress_();
  const byTitle = {};
  entries.forEach(e => { e._key = normRa_(e.Title); (byTitle[e._key] = byTitle[e._key] || []).push(e); });
  const hi = ['hack', 'is hack', 'romhack'].map(h => headers.indexOf(h)).filter(i => i >= 0)[0];
  const hack = isHackTitle_(title) || (hi !== undefined && sheet.getRange(row, hi + 1).getValue() === true);
  const m = raMatch_(title, consoleTxt, byTitle, entries, hack);
  const lines = ['Game: ' + title + (consoleTxt ? ' (' + consoleTxt + ')' : ''),
                 'Your RetroAchievements history has ' + entries.length + ' games.'];
  if (m.entry) {
    const e = m.entry;
    lines.push('Matched: ' + e.Title + ' [' + e.ConsoleName + '] (game ' + e.GameID + ')');
    lines.push(e.NumAwarded + ' of ' + e.MaxPossible + ' achievements (' + e.NumAwardedHardcore + ' in hardcore)');
    if (m.note) lines.push('Note: ' + m.note);
  } else {
    const f = raCatalogLookup_(title, consoleTxt, raSearchState_(), hack);
    if (f.found) {
      lines.push('Not in your history (not played yet), but found in the game list: ' + f.found.title + ' [' + f.found.console + '] (game ' + f.found.id + ')');
      lines.push(f.found.total + ' achievements; collected and hardcore are shown as 0.');
      if (f.note) lines.push('Note: ' + f.note);
    } else {
      lines.push('Not in your history, and not in the game list: ' + f.why);
    }
    const k = normRa_(title).slice(0, 4);
    const close = entries.filter(e => k && e._key.indexOf(k) === 0).slice(0, 5).map(e => e.Title + ' [' + e.ConsoleName + ']');
    if (close.length) lines.push('Similar games in your history:\n  ' + close.join('\n  '));
  }
  alert_(lines.join('\n'));
}

// ---------- helpers ----------

// Output columns for one update. put() writes a value unless the column is set to "keep my edits" and the cell isn't empty.
function outputSet_(data, col, keys, cell, keepRules) {
  const out = {}, orig = {};
  keys.forEach(k => {
    if (col[k] < 0 || col[k] === undefined) return;
    out[k] = data.map(r => [cell(r, col[k])]);
    orig[k] = out[k].map(x => [x[0]]);
  });
  const put = (k, i, v) => {
    if (!out[k] || (keepRules[k] && orig[k][i][0] !== '' && !(k === 'genre' && orig[k][i][0] === 'Unknown'))) return;   // an "Unknown" genre may be filled in later
    out[k][i] = [v];
  };
  return { out: out, orig: orig, put: put };
}

// Text alignment for the number and date columns (header names, so it works on both tabs).
const ALIGN_CENTER = ['collected achies', 'hardcore achies', 'total achies', 'completed', 'collected hc achies', 'total hc achies', 'hc completed',
  'hours played', 'last played', 'date completed', 'hack'];
const ALIGN_RIGHT = ['appid', 'game id', 'amount done', 'hc amount done'];

function alignColumns_(sheet, headers, numRows, force) {
  if (numRows < 1) return;
  // Only redone when the columns or the number of rows change, so alignment you set by hand is kept until then.
  const props = PropertiesService.getScriptProperties();
  const sig = headers.join('|') + '#' + numRows;
  const seen = loadJson_(props, 'ALIGNED') || {};
  if (!force && seen[sheet.getName()] === sig) return;
  seen[sheet.getName()] = sig;
  saveJson_(props, 'ALIGNED', seen);
  const top = topRow_(sheet);
  [[ALIGN_CENTER, 'center'], [ALIGN_RIGHT, 'right']].forEach(g => g[0].forEach(h => {
    const i = headers.indexOf(h);
    if (i >= 0) sheet.getRange(top, i + 1, numRows, 1).setHorizontalAlignment(g[1]);
  }));
}

// Writes only the columns the script owns, and sets the date formats on the date columns.
function sameCell_(a, b) { return a instanceof Date ? (b instanceof Date && a.getTime() === b.getTime()) : a === b; }

function writeColumns_(sheet, col, out, numRows, orig) {
  const dateFormats = { lastPlayed: 'yyyy-mm-dd', completed: 'yyyy-mm-dd', updated: 'yyyy-mm-dd hh:mm' };
  const top = topRow_(sheet);
  if (sheet.getFrozenRows() < top - 1) sheet.setFrozenRows(top - 1);   // keep the header (and the TOTALS row, if present) in view
  Object.keys(out).forEach(k => {
    if (orig && orig[k] && out[k].every((r, i) => sameCell_(r[0], orig[k][i][0]))) return;      // nothing changed in this column
    const range = sheet.getRange(top, col[k] + 1, numRows, 1);
    range.setValues(out[k]);
    if (dateFormats[k]) range.setNumberFormat(dateFormats[k]);
  });
}

// Store genres as "Action, Adventure". Returns '' on a temporary error (retried next run), 'Unknown' if the store has no entry.
function parseGenre_(res, appid) {
  if (res.getResponseCode() !== 200) return '';
  try {
    const entry = JSON.parse(res.getContentText())[appid];
    if (!entry || !entry.success || !entry.data) return 'Unknown';
    const names = (entry.data.genres || []).map(g => g.description)
      .filter(n => !/^(free to play|early access)$/i.test(n));
    return names.slice(0, 2).join(', ') || 'Unknown';
  } catch (e) {
    return '';
  }
}

// Returns {unlocked,total,lastUnlock}, or {none: reason} when Steam has no achievements for this game
// ('none', 'nostats' = never launched, 'private' = game details hidden), or {err: 'HTTP ###'} on a hiccup.
// Shortens text for Discord: single line, at most n characters.
function clip_(text, n) {
  const t = String(text === null || text === undefined ? '' : text).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '\u2026' : t;
}

// Escapes Discord markdown characters so achievement names show as written.
function mdEsc_(text) { return String(text).replace(/([\\*_~`|>])/g, '\\$1'); }

// [[name, description, unixTime], ...] -> bullet list that fits a Discord field (max 1024 characters). `more` = extra not shown.
function achLines_(list, more) {
  const lines = [];
  let used = 0, shown = 0;
  list.slice().sort((a, b) => a[2] - b[2]).forEach(a => {
    const line = '\uD83C\uDFC5 **' + mdEsc_(a[0]) + '**' + (a[1] ? ' \u2014 ' + mdEsc_(a[1]) : '');
    if (shown >= 10 || used + line.length + 1 > 940) return;
    lines.push(line); used += line.length + 1; shown++;
  });
  const left = (list.length - shown) + Math.max(0, more || 0);
  if (left > 0) lines.push('\u2026and ' + left + ' more');
  return lines.join('\n');
}

function parseAch_(res) {
  const code = res.getResponseCode();
  let ps = null;
  try { ps = JSON.parse(res.getContentText()).playerstats; } catch (e) { /* not JSON */ }
  const msg = ps && ps.error ? String(ps.error) : '';

  if (code === 200 && ps && ps.success) {
    if (!ps.achievements) return { none: 'none' };       // the game has stats but no achievements
    const got = ps.achievements.filter(a => a.achieved === 1);
    const lastUnlock = got.reduce((m, a) => Math.max(m, a.unlocktime || 0), 0);
    // The newest unlocks with their names (used for the Discord posts).
    const recent = got.filter(a => a.unlocktime).sort((a, b) => b.unlocktime - a.unlocktime).slice(0, 15)
      .map(a => [clip_(a.name || a.apiname, 60), clip_(a.description, 140), a.unlocktime]);
    return { unlocked: got.length, total: ps.achievements.length, lastUnlock: lastUnlock, recent: recent };
  }
  if (/not public|private/i.test(msg)) return { none: 'private' };
  if (/no stats/i.test(msg)) return { none: 'nostats' };
  if (code === 400 && ps) return { none: 'none' };
  return { err: 'HTTP ' + code };                        // 403 with no message = bad API key; 429/5xx = hiccup
}

// Looks up a game's AppID on the Steam store by name. Prefers an exact (normalized) name match.
function storeSearch_(title) {
  const url = 'https://store.steampowered.com/api/storesearch/?term=' + encodeURIComponent(title) +
    '&l=english&cc=us';
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  const items = JSON.parse(res.getContentText()).items || [];
  if (!items.length) return null;
  const exact = items.filter(it => norm_(it.name) === norm_(title))[0];
  return exact || items[0];
}

// Asks the Steam store about an app: {free: is it free to play, dlc: name of the base game if it is DLC, else ''}.
// Returns null on a temporary error so it is asked again next run.
function appMeta_(appid) {
  try {
    const res = UrlFetchApp.fetch('https://store.steampowered.com/api/appdetails?appids=' + appid +
      '&filters=basic&cc=us', { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;
    const entry = JSON.parse(res.getContentText())[appid];
    if (!entry || !entry.success || !entry.data) return { free: false, dlc: '' };
    const d = entry.data;
    return { free: !!d.is_free, dlc: d.type === 'dlc' ? ((d.fullgame && d.fullgame.name) || 'its base game') : '' };
  } catch (e) {
    return null;
  }
}

function resolveVanity_(key, vanity) {
  const res = UrlFetchApp.fetch('https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=' + key +
    '&vanityurl=' + encodeURIComponent(vanity), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    throw new Error('Steam API error ' + res.getResponseCode() + ' (check your API key).');
  }
  const r = JSON.parse(res.getContentText());
  if (!r.response || r.response.success !== 1) throw new Error('Could not resolve Steam profile name "' + vanity + '".');
  return r.response.steamid;
}

function norm_(s) {
  return String(s).toLowerCase().replace(/[™®©]/g, '').replace(/[^a-z0-9]/g, '');
}

function alert_(msg) {
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { console.log(msg); }
}

function installAutoUpdate() {
  removeTriggers();
  const m = cfg_().autoMinutes;
  ScriptApp.newTrigger('updateSteamSheet').timeBased().everyMinutes(m).create();
  setCfg_({ autoOn: true });
  alert_('Auto-update turned on (every ' + m + ' minutes).');
  buildMenu_();
}

function removeTriggers() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'updateSteamSheet')
    .forEach(t => ScriptApp.deleteTrigger(t));
  setCfg_({ autoOn: false });
}
